import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { MockInternalAuthProvider } from "./mock-internal-auth.provider";
import { AuthService } from "./auth.service";

describe("auth service", () => {
  it("allows the built-in mock admin account with the expected password", async () => {
    const sessionRepository = createSessionRepository();
    const service = new AuthService(new MockInternalAuthProvider(), sessionRepository.repo);

    const result = await service.login({
      account: "admin",
      password: "123456",
    });

    expect(result.user.account).toBe("admin");
    expect(result.user.displayName).toBe("管理员");
    expect(result.user.roles).toContain("admin");
  });

  it("rejects the built-in mock admin account when the password is incorrect", async () => {
    const sessionRepository = createSessionRepository();
    const service = new AuthService(new MockInternalAuthProvider(), sessionRepository.repo);

    await expect(
      service.login({
        account: "admin",
        password: "wrong-password",
      }),
    ).rejects.toMatchObject({
      message: "account_or_password_invalid",
    });
  });

  it("returns account-based login payload and persists access/refresh session", async () => {
    const sessionRepository = createSessionRepository();
    const service = new AuthService(new MockInternalAuthProvider(), sessionRepository.repo);

    const result = await service.login({
      account: "zhangsan",
      password: "secret"
    });

    expect(result.user.account).toBe("zhangsan");
    expect(result.user.roles).toContain("user");
    expect(result.accessToken.startsWith("access-")).toBe(true);
    expect(result.refreshToken.startsWith("refresh-")).toBe(true);
    expect(sessionRepository.sessions[0]?.accessTokenHash).toBeTruthy();
    expect(sessionRepository.sessions[0]?.refreshTokenHash).toBeTruthy();
  });

  it("refreshes an existing session from persisted refresh token and updates access token hash", async () => {
    const sessionRepository = createSessionRepository();
    const service = new AuthService(new MockInternalAuthProvider(), sessionRepository.repo);

    const loginResult = await service.login({
      account: "zhangsan",
      password: "secret"
    });

    const result = await service.refresh(loginResult.refreshToken);

    expect(result.accessToken.startsWith("access-")).toBe(true);
    expect(result.expiresIn).toBe(7200);
    expect(sessionRepository.updateAccessTokenByRefreshTokenHashCalled).toBe(true);
  });

  it("requires account and password before delegating to auth provider", async () => {
    const sessionRepository = createSessionRepository();
    const service = new AuthService(new MockInternalAuthProvider(), sessionRepository.repo);

    await expect(
      service.login({
        account: "",
        password: "",
      }),
    ).rejects.toMatchObject({
      message: "account_or_password_required",
    });
  });

  it("accepts alias fields from frontend payloads for account and password", async () => {
    const sessionRepository = createSessionRepository();
    const service = new AuthService(new MockInternalAuthProvider(), sessionRepository.repo);

    const result = await service.login({
      userName: "zhangsan",
      passwd: "secret",
    } as any);

    expect(result.user.account).toBe("zhangsan");
    expect(result.user.roles).toContain("user");
  });

  it("accepts nested login payloads under data.credentials", async () => {
    const sessionRepository = createSessionRepository();
    const service = new AuthService(new MockInternalAuthProvider(), sessionRepository.repo);

    const result = await service.login({
      data: {
        credentials: {
          username: "lisi",
          password: "secret",
        },
      },
    } as any);

    expect(result.user.account).toBe("lisi");
    expect(result.user.roles).toContain("user");
  });

  it("normalizes upstream UnauthorizedException to generic account_or_password_invalid", async () => {
    const sessionRepository = createSessionRepository();
    const service = new AuthService(
      {
        async validateCredentials() {
          throw new UnauthorizedException("cas_account_or_password_invalid");
        },
      },
      sessionRepository.repo,
    );

    await expect(
      service.login({
        account: "zhangsan",
        password: "wrong",
      }),
    ).rejects.toMatchObject({
      message: "account_or_password_invalid",
    });
  });

  it("uses invalid-credentials fallback when provider returns null for a non-empty login", async () => {
    const sessionRepository = createSessionRepository();
    const service = new AuthService(
      {
        async validateCredentials() {
          return null;
        },
      },
      sessionRepository.repo,
    );

    await expect(
      service.login({
        account: "zhangsan",
        password: "wrong",
      }),
    ).rejects.toMatchObject({
      message: "account_or_password_invalid",
    });
  });

  it("resolves profile through persisted access token", async () => {
    const sessionRepository = createSessionRepository();
    const service = new AuthService(new MockInternalAuthProvider(), sessionRepository.repo);

    const loginResult = await service.login({
      account: "zhangsan",
      password: "secret"
    });
    const me = await service.me(loginResult.accessToken);

    expect(me.account).toBe("zhangsan");
    expect(me.roles).toContain("user");

    const introspect = await service.introspect(loginResult.accessToken);
    expect(introspect.active).toBe(true);
    expect(introspect.user?.account).toBe("zhangsan");
  });
});

function createSessionRepository() {
  const sessions: Array<{
    id: string;
    account: string;
    displayName: string;
    roles: string[];
    accessTokenHash: string;
    accessTokenExpiresAt: Date;
    refreshTokenHash: string;
    refreshTokenExpiresAt: Date;
    revokedAt?: Date | null;
  }> = [];

  let updateAccessTokenByRefreshTokenHashCalled = false;

  return {
    sessions,
    get updateAccessTokenByRefreshTokenHashCalled() {
      return updateAccessTokenByRefreshTokenHashCalled;
    },
    repo: {
      create: async (input: {
        account: string;
        displayName: string;
        roles: string[];
        accessTokenHash: string;
        accessTokenExpiresAt: Date;
        refreshTokenHash: string;
        refreshTokenExpiresAt: Date;
      }) => {
        const record = {
          id: `session-${sessions.length + 1}`,
          ...input,
          revokedAt: null
        };
        sessions.push(record);
        return record;
      },
      findActiveByAccessTokenHash: async (accessTokenHash: string) => {
        return (
          sessions.find((session) => {
            return (
              session.accessTokenHash === accessTokenHash &&
              !session.revokedAt &&
              session.accessTokenExpiresAt.getTime() > Date.now()
            );
          }) ?? null
        );
      },
      findActiveByRefreshTokenHash: async (refreshTokenHash: string) => {
        return (
          sessions.find((session) => {
            return (
              session.refreshTokenHash === refreshTokenHash &&
              !session.revokedAt &&
              session.refreshTokenExpiresAt.getTime() > Date.now()
            );
          }) ?? null
        );
      },
      updateAccessTokenByRefreshTokenHash: async (input: {
        refreshTokenHash: string;
        accessTokenHash: string;
        accessTokenExpiresAt: Date;
      }) => {
        const target = sessions.find((session) => {
          return (
            session.refreshTokenHash === input.refreshTokenHash &&
            !session.revokedAt &&
            session.refreshTokenExpiresAt.getTime() > Date.now()
          );
        });

        if (!target) {
          return false;
        }

        target.accessTokenHash = input.accessTokenHash;
        target.accessTokenExpiresAt = input.accessTokenExpiresAt;
        updateAccessTokenByRefreshTokenHashCalled = true;
        return true;
      },
      revokeByRefreshTokenHash: async (refreshTokenHash: string) => {
        for (const session of sessions) {
          if (session.refreshTokenHash === refreshTokenHash && !session.revokedAt) {
            session.revokedAt = new Date();
          }
        }
      }
    }
  };
}

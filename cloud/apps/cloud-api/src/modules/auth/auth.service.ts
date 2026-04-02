import type {
  AuthIntrospectResponse,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthMeResponse
} from "@myclaw-cloud/shared";
import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";

import { AUTH_SESSION_REPOSITORY, type AuthSessionRepository } from "./auth-session.repository";
import { INTERNAL_AUTH_PROVIDER, type InternalAuthProvider } from "./internal-auth-provider";

const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 7200;
const REFRESH_TOKEN_EXPIRES_IN_DAYS = 180;

@Injectable()
export class AuthService {
  constructor(
    @Inject(INTERNAL_AUTH_PROVIDER)
    private readonly internalAuthProvider: InternalAuthProvider,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly authSessionRepository: AuthSessionRepository
  ) {}

  async login(input: AuthLoginRequest | Record<string, unknown> | null | undefined): Promise<AuthLoginResponse> {
    const { loginAccount, rawPassword } = this.resolveLoginCredentials(input);
    if (!loginAccount || !rawPassword) {
      throw new UnauthorizedException("account_or_password_required");
    }

    let user;
    try {
      user = await this.internalAuthProvider.validateCredentials(loginAccount, rawPassword);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new UnauthorizedException("account_or_password_invalid");
      }
      if (error instanceof ForbiddenException) {
        throw new ForbiddenException("account_forbidden");
      }
      if (error instanceof HttpException) {
        throw new ServiceUnavailableException("internal_auth_provider_failed");
      }

      throw new ServiceUnavailableException("internal_auth_provider_failed");
    }

    if (!user) {
      throw new UnauthorizedException("account_or_password_invalid");
    }

    const account = user.account;
    const accessToken = this.createOpaqueToken("access");
    const refreshToken = this.createOpaqueToken("refresh");
    const accessTokenExpiresAt = this.createAccessTokenExpiresAt();
    const refreshTokenExpiresAt = this.createRefreshTokenExpiresAt();

    await this.authSessionRepository.create({
      account,
      displayName: user.displayName,
      roles: user.roles,
      accessTokenHash: this.hashToken(accessToken),
      accessTokenExpiresAt,
      refreshTokenHash: this.hashToken(refreshToken),
      refreshTokenExpiresAt
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
      user: {
        account,
        displayName: user.displayName,
        roles: user.roles
      }
    };
  }

  async refresh(refreshToken: string) {
    const refreshTokenHash = this.hashToken(refreshToken);
    const hasActiveSession = await this.authSessionRepository.findActiveByRefreshTokenHash(refreshTokenHash);
    if (!hasActiveSession) {
      throw new UnauthorizedException("refresh_session_not_found");
    }

    const accessToken = this.createOpaqueToken("access");
    const updated = await this.authSessionRepository.updateAccessTokenByRefreshTokenHash({
      refreshTokenHash,
      accessTokenHash: this.hashToken(accessToken),
      accessTokenExpiresAt: this.createAccessTokenExpiresAt()
    });

    if (!updated) {
      throw new UnauthorizedException("refresh_session_not_found");
    }

    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS
    };
  }

  async logout(refreshToken: string) {
    await this.authSessionRepository.revokeByRefreshTokenHash(this.hashToken(refreshToken));
    return { ok: true };
  }

  async me(accessToken: string): Promise<AuthMeResponse> {
    const session = await this.authSessionRepository.findActiveByAccessTokenHash(this.hashToken(accessToken));
    if (!session) {
      throw new UnauthorizedException("access_token_invalid");
    }

    return {
      account: session.account,
      displayName: session.displayName,
      roles: session.roles
    };
  }

  async introspect(accessToken: string): Promise<AuthIntrospectResponse> {
    if (!accessToken) {
      return { active: false };
    }

    const session = await this.authSessionRepository.findActiveByAccessTokenHash(this.hashToken(accessToken));
    if (!session) {
      return { active: false };
    }

    return {
      active: true,
      expiresAt: session.accessTokenExpiresAt.toISOString(),
      user: {
        account: session.account,
        displayName: session.displayName,
        roles: session.roles
      }
    };
  }

  extractBearerToken(authorization?: string): string {
    return authorization?.replace(/^Bearer\s+/i, "").trim() ?? "";
  }

  async resolveAccountFromAccessToken(accessToken: string): Promise<string | null> {
    if (!accessToken) {
      return null;
    }

    const session = await this.authSessionRepository.findActiveByAccessTokenHash(this.hashToken(accessToken));
    return session?.account ?? null;
  }

  private createOpaqueToken(kind: "access" | "refresh"): string {
    return `${kind}-${randomBytes(32).toString("base64url")}`;
  }

  private createAccessTokenExpiresAt() {
    return new Date(Date.now() + ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000);
  }

  private createRefreshTokenExpiresAt() {
    return new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private resolveLoginCredentials(input: AuthLoginRequest | Record<string, unknown> | null | undefined): {
    loginAccount: string;
    rawPassword: string;
  } {
    const root = this.asRecord(input);
    const sources = this.collectLoginSources(root);

    const loginAccount = this.pickFirstString(sources, [
      "account",
      "username",
      "userName",
      "loginName",
      "accountName",
      "user",
      "email"
    ]);
    const rawPassword = this.pickFirstString(sources, [
      "password",
      "passWord",
      "passwd",
      "pwd",
      "passcode"
    ]);

    return {
      loginAccount,
      rawPassword
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private pickRecord(source: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
    return this.asRecord(source?.[key]);
  }

  private collectLoginSources(root: Record<string, unknown> | null): Record<string, unknown>[] {
    if (!root) {
      return [];
    }

    const relationKeys = ["data", "payload", "body", "user", "credentials"];
    const visited = new Set<Record<string, unknown>>();
    const queue: Array<{ source: Record<string, unknown>; depth: number }> = [{ source: root, depth: 0 }];
    const sources: Record<string, unknown>[] = [];

    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current.source)) {
        continue;
      }

      visited.add(current.source);
      sources.push(current.source);
      if (current.depth >= 2) {
        continue;
      }

      for (const key of relationKeys) {
        const nested = this.pickRecord(current.source, key);
        if (nested) {
          queue.push({
            source: nested,
            depth: current.depth + 1
          });
        }
      }
    }

    return sources;
  }

  private pickFirstString(sources: Record<string, unknown>[], keys: string[]): string {
    for (const source of sources) {
      for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
        if (typeof value === "number" && Number.isFinite(value)) {
          return String(value);
        }
      }
    }

    return "";
  }
}

import { ForbiddenException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CasInternalAuthProvider } from "../providers/cas-internal-auth.provider";

describe("cas internal auth provider", () => {
  afterEach(() => {
    delete process.env.CAS_VALIDATE_USER_URL;
    delete process.env.INTERNAL_AUTH_REQUIRED_ROLES;
    delete process.env.INTERNAL_AUTH_TIMEOUT_MS;
    vi.unstubAllGlobals();
  });

  it("validates user via CAS response payload and extracts roles", async () => {
    process.env.CAS_VALIDATE_USER_URL = "http://cas.100credit.cn/api/user/validate";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: "00",
          result: JSON.stringify({
            code: 0,
            username: "zhangsan",
            displayName: "张三",
            roleCodes: ["cloud-user", "mcp-user"]
          })
        })
      })
    );

    const provider = new CasInternalAuthProvider();
    const user = await provider.validateCredentials("zhangsan", "secret");

    expect(user).toEqual({
      account: "zhangsan",
      displayName: "张三",
      roles: ["cloud-user", "mcp-user"]
    });
  });

  it("accepts CAS responses that use numeric 0 as the top-level success code", async () => {
    process.env.CAS_VALIDATE_USER_URL = "http://cas.100credit.cn/api/user/validate";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          result: {
            code: 0,
            username: "wangwu",
            displayName: "王五",
            roleCodes: ["cloud-user"]
          }
        })
      })
    );

    const provider = new CasInternalAuthProvider();
    const user = await provider.validateCredentials("wangwu", "secret");

    expect(user).toEqual({
      account: "wangwu",
      displayName: "王五",
      roles: ["cloud-user"]
    });
  });

  it("uses the login account when CAS succeeds without a result payload", async () => {
    process.env.CAS_VALIDATE_USER_URL = "http://cas.100credit.cn/api/user/validate";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          message: "成功",
          result: null
        })
      })
    );

    const provider = new CasInternalAuthProvider();
    const warnSpy = vi.spyOn((provider as any).logger, "warn");
    const user = await provider.validateCredentials("zhaoliu", "secret");

    expect(user).toEqual({
      account: "zhaoliu",
      displayName: "zhaoliu",
      roles: []
    });
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringMatching(/success without result payload/i));
  });

  it("uses parsedResult when CAS wraps profile outside result", async () => {
    process.env.CAS_VALIDATE_USER_URL = "http://cas.100credit.cn/api/user/validate";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          message: "成功",
          result: null,
          resultType: "object",
          parsedResult: {
            username: "wangmazi",
            displayName: "王麻子",
            roleCodes: ["cloud-user"]
          }
        })
      })
    );

    const provider = new CasInternalAuthProvider();
    const user = await provider.validateCredentials("fallback-account", "secret");

    expect(user).toEqual({
      account: "wangmazi",
      displayName: "王麻子",
      roles: ["cloud-user"]
    });
  });

  it("reports invalid credentials when CAS rejects the username or password", async () => {
    process.env.CAS_VALIDATE_USER_URL = "http://cas.100credit.cn/api/user/validate";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: 7001,
          message: "用户名或密码错误!",
          result: null
        })
      })
    );

    const provider = new CasInternalAuthProvider();

    await expect(provider.validateCredentials("lisi", "wrong-password")).rejects.toMatchObject({
      message: "cas_account_or_password_invalid"
    });
  });

  it("rejects login when user roles do not match required role list", async () => {
    process.env.CAS_VALIDATE_USER_URL = "http://cas.100credit.cn/api/user/validate";
    process.env.INTERNAL_AUTH_REQUIRED_ROLES = "admin,security";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: "00",
          result: JSON.stringify({
            code: 0,
            username: "lisi",
            displayName: "李四",
            roleCodes: ["cloud-user"]
          })
        })
      })
    );

    const provider = new CasInternalAuthProvider();

    await expect(provider.validateCredentials("lisi", "secret")).rejects.toBeInstanceOf(ForbiddenException);
  });
});

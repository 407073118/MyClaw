import { afterEach, describe, expect, it, vi } from "vitest";

import {
  introspectCloudAuth,
  loginCloudAuth,
  logoutCloudAuth,
  refreshCloudAuth,
} from "@/services/cloud-auth-client";

describe("cloud auth client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the runtime login proxy with the cloud auth contract payload", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: "access-1",
          refreshToken: "refresh-1",
          expiresIn: 7200,
          user: {
            account: "zhangjianing",
            displayName: "张建宁",
            roles: ["admin"],
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await loginCloudAuth("http://127.0.0.1:43110", {
      account: "zhangjianing",
      password: "secret",
    });

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:43110/api/cloud-auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        account: "zhangjianing",
        password: "secret",
      }),
    });
  });

  it("uses runtime auth proxy paths for refresh, introspect, and logout requests", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: "access-2", expiresIn: 7200 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ active: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await refreshCloudAuth("http://127.0.0.1:43110", "refresh-1");
    await introspectCloudAuth("http://127.0.0.1:43110", "access-2");
    await logoutCloudAuth("http://127.0.0.1:43110", "refresh-1");

    expect(fetchSpy).toHaveBeenNthCalledWith(1, "http://127.0.0.1:43110/api/cloud-auth/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        refreshToken: "refresh-1",
      }),
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "http://127.0.0.1:43110/api/cloud-auth/introspect", {
      method: "POST",
      headers: {
        authorization: "Bearer access-2",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(3, "http://127.0.0.1:43110/api/cloud-auth/logout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        refreshToken: "refresh-1",
      }),
    });
  });
});

import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cloudAuthClient from "@/services/cloud-auth-client";
import { useDesktopAuthStore } from "@/stores/auth";

const AUTH_STORAGE_KEY = "myclaw-desktop-auth-session";

function createLoginPayload() {
  return {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresIn: 7200,
    user: {
      account: "zhangjianing",
      displayName: "张建宁",
      roles: ["admin"],
    },
  };
}

describe("desktop auth store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("persists the login session after authenticating through cloud auth", async () => {
    vi.spyOn(cloudAuthClient, "loginCloudAuth").mockResolvedValue(createLoginPayload());
    const store = useDesktopAuthStore();

    await store.login("http://127.0.0.1:43110", {
      account: "zhangjianing",
      password: "secret",
    });

    expect(store.session.accessToken).toBe("access-1");
    expect(store.session.user?.account).toBe("zhangjianing");
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toContain("access-1");
  });

  it("refreshes an expired persisted session before allowing desktop access", async () => {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        accessToken: "expired-access",
        refreshToken: "refresh-1",
        expiresIn: 1,
        loggedInAt: "2026-03-01T00:00:00.000Z",
        user: {
          account: "zhangjianing",
          displayName: "张建宁",
          roles: ["admin"],
        },
      }),
    );
    vi.spyOn(cloudAuthClient, "refreshCloudAuth").mockResolvedValue({
      accessToken: "access-2",
      expiresIn: 7200,
    });

    const store = useDesktopAuthStore();
    const authenticated = await store.ensureAuthenticated("http://127.0.0.1:43110");

    expect(authenticated).toBe(true);
    expect(store.session.accessToken).toBe("access-2");
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toContain("access-2");
  });
});

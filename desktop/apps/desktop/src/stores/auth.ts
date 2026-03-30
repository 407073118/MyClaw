import type {
  AuthIntrospectResponse,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthRefreshResponse,
  AuthUser,
} from "@myclaw-desktop/shared";
import { defineStore } from "pinia";

import {
  introspectCloudAuth,
  loginCloudAuth,
  logoutCloudAuth,
  refreshCloudAuth,
} from "@/services/cloud-auth-client";

const AUTH_STORAGE_KEY = "myclaw-desktop-auth-session";

export type DesktopAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  loggedInAt: string | null;
  user: AuthUser | null;
};

function createEmptySession(): DesktopAuthSession {
  return {
    accessToken: "",
    refreshToken: "",
    expiresIn: 0,
    loggedInAt: null,
    user: null,
  };
}

/** 防御性解析本地持久化会话，避免旧版本或损坏数据导致应用启动崩溃。 */
function parsePersistedSession(raw: string | null): DesktopAuthSession {
  if (!raw) {
    return createEmptySession();
  }

  try {
    return {
      ...createEmptySession(),
      ...JSON.parse(raw),
    };
  } catch {
    return createEmptySession();
  }
}

/** 根据登录时间和有效期计算 access token 的过期时间。 */
function resolveSessionExpiresAt(session: DesktopAuthSession): Date | null {
  if (!session.loggedInAt || !session.expiresIn) {
    return null;
  }

  const loggedInAt = Date.parse(session.loggedInAt);
  if (Number.isNaN(loggedInAt)) {
    return null;
  }

  return new Date(loggedInAt + session.expiresIn * 1000);
}

export const useDesktopAuthStore = defineStore("desktop-auth", {
  state: () => ({
    session: createEmptySession(),
    hydrated: false,
    validationChecked: false,
    restoring: false,
  }),
  getters: {
    isLoggedIn(state): boolean {
      return Boolean(state.session.accessToken && state.session.user?.account);
    },
    sessionExpiresAt(state): Date | null {
      return resolveSessionExpiresAt(state.session);
    },
    isAccessTokenExpired(): boolean {
      const expiresAt = this.sessionExpiresAt;
      return Boolean(expiresAt && expiresAt.getTime() <= Date.now());
    },
    isAuthenticated(): boolean {
      return this.isLoggedIn;
    },
  },
  actions: {
    /** 从本地存储恢复桌面登录态，只在应用启动或守卫首次运行时执行一次。 */
    hydrateFromStorage(force = false) {
      if (this.hydrated && !force) {
        return;
      }

      if (typeof window === "undefined") {
        this.hydrated = true;
        return;
      }

      this.session = parsePersistedSession(localStorage.getItem(AUTH_STORAGE_KEY));
      this.hydrated = true;
      this.validationChecked = false;
      console.info("[desktop-auth] 已从本地存储恢复登录态", {
        hasAccessToken: Boolean(this.session.accessToken),
        account: this.session.user?.account ?? null,
      });
    },

    /** 将当前登录态写回本地存储，保证桌面应用重启后仍然能够恢复。 */
    persistSession() {
      if (typeof window === "undefined") {
        return;
      }

      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(this.session));
      console.info("[desktop-auth] 已写入本地登录态", {
        account: this.session.user?.account ?? null,
        hasRefreshToken: Boolean(this.session.refreshToken),
      });
    },

    /** 使用 cloud 登录响应更新完整会话，并标记当前令牌已经过服务端验证。 */
    applyLoginSession(payload: AuthLoginResponse) {
      this.session = {
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        expiresIn: payload.expiresIn,
        loggedInAt: new Date().toISOString(),
        user: payload.user,
      };
      this.validationChecked = true;
      this.persistSession();
      console.info("[desktop-auth] 登录成功并更新本地会话", {
        account: payload.user.account,
        roles: payload.user.roles,
      });
    },

    /** 使用 refresh 响应更新 access token，保留已有 refresh token 和用户资料。 */
    applyRefreshSession(payload: AuthRefreshResponse) {
      this.session = {
        ...this.session,
        accessToken: payload.accessToken,
        expiresIn: payload.expiresIn,
        loggedInAt: new Date().toISOString(),
      };
      this.validationChecked = true;
      this.persistSession();
      console.info("[desktop-auth] 已刷新桌面 access token", {
        account: this.session.user?.account ?? null,
      });
    },

    /** 清空桌面登录态，并同步删除本地持久化缓存。 */
    clearSession() {
      this.session = createEmptySession();
      this.validationChecked = false;
      this.hydrated = true;

      if (typeof window !== "undefined") {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }

      console.info("[desktop-auth] 已清空桌面登录态");
    },

    /** 调用 cloud 登录接口并写入本地持久化会话。 */
    async login(baseUrl: string, payload: AuthLoginRequest) {
      console.info("[desktop-auth] 开始执行桌面登录", {
        account: payload.account,
      });
      const response = await loginCloudAuth(baseUrl, payload);
      this.applyLoginSession(response);
      return response;
    },

    /** 使用 refresh token 尝试续期当前会话，失败时主动清空本地状态。 */
    async refreshSession(baseUrl: string): Promise<boolean> {
      if (!this.session.refreshToken) {
        console.warn("[desktop-auth] 当前没有 refresh token，无法续期");
        this.clearSession();
        return false;
      }

      try {
        console.info("[desktop-auth] access token 已过期，开始续期", {
          account: this.session.user?.account ?? null,
        });
        const response = await refreshCloudAuth(baseUrl, this.session.refreshToken);
        this.applyRefreshSession(response);
        return true;
      } catch (error) {
        console.warn("[desktop-auth] access token 续期失败，清空本地会话", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.clearSession();
        return false;
      }
    },

    /** 调用 cloud introspect 校验当前 access token 是否仍然有效。 */
    async introspectSession(baseUrl: string): Promise<boolean> {
      if (!this.session.accessToken) {
        console.warn("[desktop-auth] 当前没有 access token，跳过会话校验");
        this.clearSession();
        return false;
      }

      try {
        console.info("[desktop-auth] 开始校验桌面持久化会话", {
          account: this.session.user?.account ?? null,
        });
        const payload = await introspectCloudAuth(baseUrl, this.session.accessToken);
        return this.applyIntrospectResult(payload);
      } catch (error) {
        console.warn("[desktop-auth] 会话校验失败，清空本地会话", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.clearSession();
        return false;
      }
    },

    /** 根据 cloud introspect 结果更新当前会话的验证状态。 */
    applyIntrospectResult(payload: AuthIntrospectResponse): boolean {
      if (!payload.active || !payload.user) {
        console.warn("[desktop-auth] cloud 返回会话无效，清空本地会话");
        this.clearSession();
        return false;
      }

      this.session = {
        ...this.session,
        user: payload.user,
      };
      this.validationChecked = true;
      this.persistSession();
      console.info("[desktop-auth] cloud 会话校验通过", {
        account: payload.user.account,
      });
      return true;
    },

    /** 对外暴露统一的桌面鉴权入口，供路由守卫和应用启动流程复用。 */
    async ensureAuthenticated(baseUrl: string): Promise<boolean> {
      if (this.restoring) {
        console.info("[desktop-auth] 登录态恢复进行中，复用当前流程");
        return this.isAuthenticated;
      }

      this.hydrateFromStorage();
      if (!this.isLoggedIn) {
        console.info("[desktop-auth] 当前没有可用登录态");
        return false;
      }

      this.restoring = true;
      try {
        if (this.isAccessTokenExpired) {
          return await this.refreshSession(baseUrl);
        }

        if (!this.validationChecked) {
          return await this.introspectSession(baseUrl);
        }

        return true;
      } finally {
        this.restoring = false;
      }
    },

    /** 主动退出桌面登录态，同时尽量通知 cloud 撤销 refresh token。 */
    async logout(baseUrl: string) {
      const refreshToken = this.session.refreshToken;
      console.info("[desktop-auth] 开始执行退出登录", {
        account: this.session.user?.account ?? null,
      });
      if (refreshToken) {
        try {
          await logoutCloudAuth(baseUrl, refreshToken);
        } catch (error) {
          console.warn("[desktop-auth] cloud 登出请求失败，继续清理本地会话", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.clearSession();
    },
  },
});

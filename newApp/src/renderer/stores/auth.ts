import { create } from "zustand";

export type AuthUser = {
  account: string;
  displayName: string;
  roles: string[];
  [key: string]: unknown;
};

export type DesktopAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  loggedInAt: string | null;
  user: AuthUser | null;
};

type AuthLoginRequest = {
  account: string;
  password: string;
};

type AuthLoginResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
};

type AuthRefreshResponse = {
  accessToken: string;
  expiresIn: number;
};

type AuthIntrospectResponse = {
  active: boolean;
  user: AuthUser | null;
};

const AUTH_STORAGE_KEY = "myclaw-desktop-auth-session";

function createEmptySession(): DesktopAuthSession {
  return {
    accessToken: "",
    refreshToken: "",
    expiresIn: 0,
    loggedInAt: null,
    user: null,
  };
}

function parsePersistedSession(raw: string | null): DesktopAuthSession {
  if (!raw) {
    return createEmptySession();
  }
  try {
    return { ...createEmptySession(), ...JSON.parse(raw) };
  } catch {
    return createEmptySession();
  }
}

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

type AuthState = {
  session: DesktopAuthSession;
  hydrated: boolean;
  validationChecked: boolean;
  restoring: boolean;

  // Computed flags (recalculated after every set())
  isLoggedIn: boolean;
  isAccessTokenExpired: boolean;
  isAuthenticated: boolean;

  // Actions
  hydrateFromStorage: (force?: boolean) => void;
  persistSession: () => void;
  applyLoginSession: (payload: AuthLoginResponse) => void;
  applyRefreshSession: (payload: AuthRefreshResponse) => void;
  clearSession: () => void;
  login: (payload: AuthLoginRequest) => Promise<AuthLoginResponse>;
  refreshSession: () => Promise<boolean>;
  introspectSession: () => Promise<boolean>;
  applyIntrospectResult: (payload: AuthIntrospectResponse) => boolean;
  ensureAuthenticated: () => Promise<boolean>;
  logout: () => Promise<void>;
};

/** Compute derived auth flags from session state. */
function computeAuthFlags(session: DesktopAuthSession) {
  const isLoggedIn = Boolean(session.accessToken && session.user?.account);
  const expiresAt = resolveSessionExpiresAt(session);
  const isAccessTokenExpired = Boolean(expiresAt && expiresAt.getTime() <= Date.now());
  return { isLoggedIn, isAccessTokenExpired, isAuthenticated: isLoggedIn };
}

export const useAuthStore = create<AuthState>()((rawSet, get) => {
  // Wrap set() so derived flags are always recalculated after every state change.
  const set = (partial: Partial<AuthState> | ((state: AuthState) => Partial<AuthState>)) => {
    rawSet(partial as Parameters<typeof rawSet>[0]);
    const state = get();
    const flags = computeAuthFlags(state.session);
    if (
      state.isLoggedIn !== flags.isLoggedIn ||
      state.isAccessTokenExpired !== flags.isAccessTokenExpired ||
      state.isAuthenticated !== flags.isAuthenticated
    ) {
      rawSet(flags);
    }
  };

  return {
  session: createEmptySession(),
  hydrated: false,
  validationChecked: false,
  restoring: false,

  // NOTE: These are computed as regular properties, not JS getters, because
  // zustand's set() uses Object.assign which does not preserve getter descriptors.
  // They are recalculated via selectors or by calling deriveAuthFlags() after set().
  isLoggedIn: false,
  isAccessTokenExpired: false,
  isAuthenticated: false,

  hydrateFromStorage(force = false) {
    const state = get();
    if (state.hydrated && !force) {
      return;
    }

    if (typeof window === "undefined") {
      set({ hydrated: true });
      return;
    }

    const session = parsePersistedSession(localStorage.getItem(AUTH_STORAGE_KEY));
    set({ session, hydrated: true, validationChecked: false });
    console.info("[desktop-auth] 已从本地存储恢复登录态", {
      hasAccessToken: Boolean(session.accessToken),
      account: session.user?.account ?? null,
    });
  },

  persistSession() {
    if (typeof window === "undefined") {
      return;
    }
    const { session } = get();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    console.info("[desktop-auth] 已写入本地登录态", {
      account: session.user?.account ?? null,
      hasRefreshToken: Boolean(session.refreshToken),
    });
  },

  applyLoginSession(payload) {
    const session: DesktopAuthSession = {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      expiresIn: payload.expiresIn,
      loggedInAt: new Date().toISOString(),
      user: payload.user,
    };
    set({ session, validationChecked: true });
    get().persistSession();
    console.info("[desktop-auth] 登录成功并更新本地会话", {
      account: payload.user.account,
    });
  },

  applyRefreshSession(payload) {
    const current = get().session;
    const session: DesktopAuthSession = {
      ...current,
      accessToken: payload.accessToken,
      expiresIn: payload.expiresIn,
      loggedInAt: new Date().toISOString(),
    };
    set({ session, validationChecked: true });
    get().persistSession();
    console.info("[desktop-auth] 已刷新桌面 access token", {
      account: session.user?.account ?? null,
    });
  },

  clearSession() {
    set({
      session: createEmptySession(),
      validationChecked: false,
      hydrated: true,
    });
    if (typeof window !== "undefined") {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
    console.info("[desktop-auth] 已清空桌面登录态");
  },

  async login(payload) {
    console.info("[desktop-auth] 开始执行桌面登录", { account: payload.account });
    const response = await window.myClawAPI.auth.login(payload);
    get().applyLoginSession(response);
    return response;
  },

  async refreshSession() {
    const { session } = get();
    if (!session.refreshToken) {
      console.warn("[desktop-auth] 当前没有 refresh token，无法续期");
      get().clearSession();
      return false;
    }

    try {
      console.info("[desktop-auth] access token 已过期，开始续期", {
        account: session.user?.account ?? null,
      });
      const response = await window.myClawAPI.auth.refresh(session.refreshToken);
      get().applyRefreshSession(response);
      return true;
    } catch (error) {
      console.warn("[desktop-auth] access token 续期失败，清空本地会话", {
        error: error instanceof Error ? error.message : String(error),
      });
      get().clearSession();
      return false;
    }
  },

  async introspectSession() {
    const { session } = get();
    if (!session.accessToken) {
      console.warn("[desktop-auth] 当前没有 access token，跳过会话校验");
      get().clearSession();
      return false;
    }

    try {
      console.info("[desktop-auth] 开始校验桌面持久化会话", {
        account: session.user?.account ?? null,
      });
      const payload = await window.myClawAPI.auth.introspect(session.accessToken);
      return get().applyIntrospectResult(payload);
    } catch (error) {
      console.warn("[desktop-auth] 会话校验失败，清空本地会话", {
        error: error instanceof Error ? error.message : String(error),
      });
      get().clearSession();
      return false;
    }
  },

  applyIntrospectResult(payload) {
    if (!payload.active || !payload.user) {
      console.warn("[desktop-auth] cloud 返回会话无效，清空本地会话");
      get().clearSession();
      return false;
    }

    const current = get().session;
    const session: DesktopAuthSession = { ...current, user: payload.user };
    set({ session, validationChecked: true });
    get().persistSession();
    console.info("[desktop-auth] cloud 会话校验通过", { account: payload.user.account });
    return true;
  },

  async ensureAuthenticated() {
    const state = get();
    if (state.restoring) {
      console.info("[desktop-auth] 登录态恢复进行中，复用当前流程");
      return state.isLoggedIn;
    }

    get().hydrateFromStorage();

    if (!get().isLoggedIn) {
      console.info("[desktop-auth] 当前没有可用登录态");
      return false;
    }

    set({ restoring: true });
    try {
      if (get().isAccessTokenExpired) {
        return await get().refreshSession();
      }
      if (!get().validationChecked) {
        return await get().introspectSession();
      }
      return true;
    } finally {
      set({ restoring: false });
    }
  },

  async logout() {
    const { session } = get();
    console.info("[desktop-auth] 开始执行退出登录", {
      account: session.user?.account ?? null,
    });
    if (session.refreshToken) {
      try {
        await window.myClawAPI.auth.logout(session.refreshToken);
      } catch (error) {
        console.warn("[desktop-auth] cloud 登出请求失败，继续清理本地会话", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    get().clearSession();
  },
};
});

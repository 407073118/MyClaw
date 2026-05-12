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

const DEV_BYPASS_TOKEN_PREFIX = "dev-bypass-";
const DEV_BYPASS_EXPIRES_IN_SECONDS = 24 * 60 * 60;
const GUEST_TOKEN_PREFIX = "guest-";
const GUEST_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;

/** dev 模式是否启用 cloud-api 校验跳过（仅 Vite MODE === "development" 生效）。 */
export function isDevAuthBypassEnabled(): boolean {
  return import.meta.env.MODE === "development";
}

/** 判断给定 token 是否为 dev bypass mock token（前缀匹配）。 */
function isDevBypassToken(token: string | undefined | null): boolean {
  return Boolean(token && token.startsWith(DEV_BYPASS_TOKEN_PREFIX));
}

/** 判断给定 token 是否为游客本地 token，游客会话不访问 cloud-api。 */
function isGuestToken(token: string | undefined | null): boolean {
  return Boolean(token && token.startsWith(GUEST_TOKEN_PREFIX));
}

/** 判断给定 token 是否为桌面端纯本地 token，用于统一跳过 cloud-api 校验。 */
function isLocalAuthToken(token: string | undefined | null): boolean {
  return isDevBypassToken(token) || isGuestToken(token);
}

/** 构造 dev mock 登录响应；不调用 IPC，纯本地生成。 */
function buildDevBypassSession(account: string): AuthLoginResponse {
  const safeAccount = account.trim() || "dev-user";
  const stamp = Date.now().toString(36);
  return {
    accessToken: `${DEV_BYPASS_TOKEN_PREFIX}access-${stamp}`,
    refreshToken: `${DEV_BYPASS_TOKEN_PREFIX}refresh-${stamp}`,
    expiresIn: DEV_BYPASS_EXPIRES_IN_SECONDS,
    user: {
      account: safeAccount,
      displayName: safeAccount,
      roles: ["dev-bypass"],
    },
  };
}

/** 构造游客登录响应；不调用 IPC，纯本地生成可持久化的游客会话。 */
function buildGuestSession(): AuthLoginResponse {
  const stamp = Date.now().toString(36);
  console.info("[desktop-auth] 构造游客本地会话", { account: "guest" });
  return {
    accessToken: `${GUEST_TOKEN_PREFIX}access-${stamp}`,
    refreshToken: `${GUEST_TOKEN_PREFIX}refresh-${stamp}`,
    expiresIn: GUEST_EXPIRES_IN_SECONDS,
    user: {
      account: "guest",
      displayName: "游客",
      roles: ["guest"],
    },
  };
}

/** 创建一份空登录会话，用作初始化与清空后的统一默认值。 */
function createEmptySession(): DesktopAuthSession {
  return {
    accessToken: "",
    refreshToken: "",
    expiresIn: 0,
    loggedInAt: null,
    user: null,
  };
}

/** 解析本地持久化的登录会话，失败时回退为空会话。 */
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

/** 计算当前会话的 access token 过期时间。 */
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

  // 派生标记，每次 set 后都重新计算。
  isLoggedIn: boolean;
  isAccessTokenExpired: boolean;
  isAuthenticated: boolean;

  // 动作
  hydrateFromStorage: (force?: boolean) => void;
  persistSession: () => void;
  applyLoginSession: (payload: AuthLoginResponse) => void;
  applyRefreshSession: (payload: AuthRefreshResponse) => void;
  clearSession: () => void;
  login: (payload: AuthLoginRequest) => Promise<AuthLoginResponse>;
  loginAsGuest: () => Promise<AuthLoginResponse>;
  refreshSession: () => Promise<boolean>;
  introspectSession: () => Promise<boolean>;
  applyIntrospectResult: (payload: AuthIntrospectResponse) => boolean;
  ensureAuthenticated: () => Promise<boolean>;
  logout: () => Promise<void>;
};

/** 根据会话状态计算登录态派生标记。 */
function computeAuthFlags(session: DesktopAuthSession) {
  const isLoggedIn = Boolean(session.accessToken && session.user?.account);
  const expiresAt = resolveSessionExpiresAt(session);
  const isAccessTokenExpired = Boolean(expiresAt && expiresAt.getTime() <= Date.now());
  return { isLoggedIn, isAccessTokenExpired, isAuthenticated: isLoggedIn };
}

export const useAuthStore = create<AuthState>()((rawSet, get) => {
  // 包装 `set()`，确保每次状态变化后都重新计算派生标记。
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

  // 这些字段使用普通属性而不是 getter，避免 zustand 的 `Object.assign`
  // 在 set() 过程中丢失 getter 描述符；每次更新后统一重算。
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
    if (isDevAuthBypassEnabled()) {
      console.warn("[desktop-auth] DEV 模式跳过 cloud-api 校验，注入本地 mock 会话", {
        account: payload.account,
      });
      const response = buildDevBypassSession(payload.account);
      get().applyLoginSession(response);
      return response;
    }
    const response = await window.myClawAPI.auth.login(payload);
    get().applyLoginSession(response);
    return response;
  },

  async loginAsGuest() {
    console.info("[desktop-auth] 开始创建游客登录会话");
    const response = buildGuestSession();
    get().applyLoginSession(response);
    console.info("[desktop-auth] 游客登录成功，已进入本地桌面会话", {
      account: response.user.account,
    });
    return response;
  },

  async refreshSession() {
    const { session } = get();
    if (!session.refreshToken) {
      console.warn("[desktop-auth] 当前没有 refresh token，无法续期");
      get().clearSession();
      return false;
    }

    if (isDevBypassToken(session.refreshToken)) {
      console.info("[desktop-auth] DEV 模式 mock 会话，跳过 cloud-api refresh", {
        account: session.user?.account ?? null,
      });
      const stamp = Date.now().toString(36);
      get().applyRefreshSession({
        accessToken: `${DEV_BYPASS_TOKEN_PREFIX}access-${stamp}`,
        expiresIn: DEV_BYPASS_EXPIRES_IN_SECONDS,
      });
      return true;
    }

    if (isGuestToken(session.refreshToken)) {
      console.info("[desktop-auth] 游客会话跳过 cloud-api refresh，刷新本地 access token", {
        account: session.user?.account ?? null,
      });
      const stamp = Date.now().toString(36);
      get().applyRefreshSession({
        accessToken: `${GUEST_TOKEN_PREFIX}access-${stamp}`,
        expiresIn: GUEST_EXPIRES_IN_SECONDS,
      });
      return true;
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

    if (isDevBypassToken(session.accessToken)) {
      console.info("[desktop-auth] DEV 模式 mock 会话，跳过 cloud-api introspect", {
        account: session.user?.account ?? null,
      });
      set({ validationChecked: true });
      return true;
    }

    if (isGuestToken(session.accessToken)) {
      console.info("[desktop-auth] 游客会话跳过 cloud-api introspect", {
        account: session.user?.account ?? null,
      });
      set({ validationChecked: true });
      return true;
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
    if (session.refreshToken && !isLocalAuthToken(session.refreshToken)) {
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

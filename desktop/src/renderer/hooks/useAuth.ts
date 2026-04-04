import { useAuthStore, type DesktopAuthSession, type AuthUser } from "../stores/auth";

/** 便捷封装认证 store，统一暴露常用状态与动作。 */
export function useAuth() {
  const session = useAuthStore((s) => s.session);
  const hydrated = useAuthStore((s) => s.hydrated);
  const validationChecked = useAuthStore((s) => s.validationChecked);
  const restoring = useAuthStore((s) => s.restoring);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isAccessTokenExpired = useAuthStore((s) => s.isAccessTokenExpired);

  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const refreshSession = useAuthStore((s) => s.refreshSession);
  const introspectSession = useAuthStore((s) => s.introspectSession);
  const ensureAuthenticated = useAuthStore((s) => s.ensureAuthenticated);
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage);
  const clearSession = useAuthStore((s) => s.clearSession);

  return {
    // 基础状态
    session,
    hydrated,
    validationChecked,
    restoring,

    // 派生状态
    isLoggedIn,
    isAuthenticated,
    isAccessTokenExpired,

    /** 当前登录用户对象的快捷访问入口。 */
    user: session.user as AuthUser | null,

    /** 便于接口调用直接取用的 access token。 */
    accessToken: session.accessToken,

    // 动作
    login,
    logout,
    refreshSession,
    introspectSession,
    ensureAuthenticated,
    hydrateFromStorage,
    clearSession,
  };
}

export type UseAuthReturn = ReturnType<typeof useAuth>;
export type { DesktopAuthSession, AuthUser };

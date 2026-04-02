import { useAuthStore, type DesktopAuthSession, type AuthUser } from "../stores/auth";

/**
 * Convenience hook for consuming the auth store.
 * Provides typed access to session state and auth actions.
 */
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
    // State
    session,
    hydrated,
    validationChecked,
    restoring,

    // Derived
    isLoggedIn,
    isAuthenticated,
    isAccessTokenExpired,

    /** Shortcut to the current user object. */
    user: session.user as AuthUser | null,

    /** Access token for use in API calls. */
    accessToken: session.accessToken,

    // Actions
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

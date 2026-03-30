import type { AuthLoginResponse, AuthUser } from "@myclaw-cloud/shared";

type CloudSessionState = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  loggedInAt: string | null;
  user: AuthUser | null;
};

const SESSION_STORAGE_KEY = "myclaw-cloud-session";

function createEmptySession(): CloudSessionState {
  return {
    accessToken: "",
    refreshToken: "",
    expiresIn: 0,
    loggedInAt: null,
    user: null
  };
}

function parseSession(raw: string | null | undefined): CloudSessionState {
  if (!raw) {
    return createEmptySession();
  }

  try {
    return {
      ...createEmptySession(),
      ...JSON.parse(raw)
    };
  } catch {
    return createEmptySession();
  }
}

export function useCloudSession() {
  const sessionCookie = useCookie<string | null>(SESSION_STORAGE_KEY, {
    sameSite: "lax",
    default: () => null
  });
  const session = useState<CloudSessionState>("cloud-session", () => parseSession(sessionCookie.value));
  const hydrated = useState<boolean>("cloud-session-hydrated", () => false);
  const storageListenerBound = useState<boolean>("cloud-session-storage-bound", () => false);
  const sessionExpiresAt = computed(() => {
    if (!session.value.loggedInAt || !session.value.expiresIn) {
      return null;
    }

    const timestamp = Date.parse(session.value.loggedInAt);
    if (Number.isNaN(timestamp)) {
      return null;
    }

    return new Date(timestamp + session.value.expiresIn * 1000);
  });

  const isSessionValid = computed(() => {
    const hasToken = Boolean(session.value.accessToken && session.value.user?.account);
    if (!hasToken) {
      return false;
    }

    const expiresAt = sessionExpiresAt.value;
    if (!expiresAt) {
      return true;
    }

    return expiresAt.getTime() > Date.now();
  });

  if (import.meta.client && !hydrated.value) {
    hydrated.value = true;

    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      applyParsedSession(parseSession(stored));
      sessionCookie.value = JSON.stringify(session.value);
    } else if (sessionCookie.value) {
      applyParsedSession(parseSession(sessionCookie.value));
    }
  }

  function persist() {
    const serialized = JSON.stringify(session.value);
    sessionCookie.value = serialized;

    if (import.meta.client) {
      localStorage.setItem(SESSION_STORAGE_KEY, serialized);
    }
  }

  function applyParsedSession(value: CloudSessionState) {
    session.value = value;
    if (!isSessionValid.value) {
      clearSession();
    }
  }

  function handleStorage(event: StorageEvent) {
    if (event.key !== SESSION_STORAGE_KEY) {
      return;
    }

    applyParsedSession(parseSession(event.newValue));
  }

  if (import.meta.client && !storageListenerBound.value) {
    window.addEventListener("storage", handleStorage);
    storageListenerBound.value = true;
  }

  function setSession(payload: AuthLoginResponse) {
    session.value = {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      expiresIn: payload.expiresIn,
      loggedInAt: new Date().toISOString(),
      user: payload.user
    };
    persist();
  }

  function clearSession() {
    session.value = createEmptySession();
    sessionCookie.value = null;

    if (import.meta.client) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  return {
    session,
    user: computed(() => session.value.user),
    isLoggedIn: computed(() => Boolean(session.value.accessToken)),
    sessionExpiresAt,
    isSessionValid,
    setSession,
    clearSession
  };
}

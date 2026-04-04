import type { AuthLoginResponse, AuthUser } from "@myclaw-cloud/shared";

type CloudSessionState = {
  accessToken: string;
  expiresIn: number;
  loggedInAt: string | null;
  user: AuthUser | null;
};

const SESSION_STORAGE_KEY = "myclaw-cloud-session";

function createEmptySession(): CloudSessionState {
  return {
    accessToken: "",
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

  function persist() {
    const serialized = JSON.stringify(session.value);
    sessionCookie.value = serialized;
  }

  function applyParsedSession(value: CloudSessionState) {
    session.value = value;
    if (!isSessionValid.value) {
      clearSession();
    }
  }

  /** 记录登录成功后的最小会话信息，避免在浏览器侧长期保存额外敏感字段。 */
  function setSession(payload: AuthLoginResponse) {
    session.value = {
      accessToken: payload.accessToken,
      expiresIn: payload.expiresIn,
      loggedInAt: new Date().toISOString(),
      user: payload.user
    };
    persist();
  }

  function clearSession() {
    session.value = createEmptySession();
    sessionCookie.value = null;
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

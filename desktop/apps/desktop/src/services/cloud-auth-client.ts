import type {
  AuthIntrospectResponse,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthRefreshResponse,
} from "@myclaw-desktop/shared";

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const payload = await response.json();
    if (payload && typeof payload === "object") {
      const detail = "message" in payload ? payload.message : "error" in payload ? payload.error : null;
      if (typeof detail === "string" && detail.trim()) {
        return detail.trim();
      }
    }
  } catch {
    // 忽略 JSON 解析失败，继续尝试读取文本内容。
  }

  try {
    const text = await response.text();
    if (text.trim()) {
      return text.trim();
    }
  } catch {
    // 忽略文本解析失败。
  }

  return null;
}

/** 将 cloud auth 代理的非成功响应转换成统一异常，方便登录页直接映射错误码。 */
async function throwCloudAuthError(response: Response, fallbackMessage: string): Promise<never> {
  const detail = await readErrorDetail(response);
  throw new Error(detail ? `${fallbackMessage}: ${detail}` : `${fallbackMessage}: ${response.status}`);
}

/** 通过本地 runtime 代理调用 cloud 登录接口，避免桌面前端直接访问云端地址。 */
export async function loginCloudAuth(baseUrl: string, payload: AuthLoginRequest): Promise<AuthLoginResponse> {
  const response = await fetch(`${baseUrl}/api/cloud-auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwCloudAuthError(response, "Cloud login failed");
  }

  return response.json() as Promise<AuthLoginResponse>;
}

/** 通过 runtime 代理刷新云端访问令牌，确保桌面端重启后可以自动续期。 */
export async function refreshCloudAuth(baseUrl: string, refreshToken: string): Promise<AuthRefreshResponse> {
  const response = await fetch(`${baseUrl}/api/cloud-auth/refresh`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      refreshToken,
    }),
  });

  if (!response.ok) {
    await throwCloudAuthError(response, "Cloud token refresh failed");
  }

  return response.json() as Promise<AuthRefreshResponse>;
}

/** 使用当前 access token 向 cloud 校验会话有效性，避免本地持久化脏状态误放行。 */
export async function introspectCloudAuth(baseUrl: string, accessToken: string): Promise<AuthIntrospectResponse> {
  const response = await fetch(`${baseUrl}/api/cloud-auth/introspect`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    await throwCloudAuthError(response, "Cloud session introspect failed");
  }

  return response.json() as Promise<AuthIntrospectResponse>;
}

/** 调用 cloud 登出接口撤销 refresh token，随后由上层清空本地桌面会话。 */
export async function logoutCloudAuth(baseUrl: string, refreshToken: string): Promise<{ ok: boolean }> {
  const response = await fetch(`${baseUrl}/api/cloud-auth/logout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      refreshToken,
    }),
  });

  if (!response.ok) {
    await throwCloudAuthError(response, "Cloud logout failed");
  }

  return response.json() as Promise<{ ok: boolean }>;
}

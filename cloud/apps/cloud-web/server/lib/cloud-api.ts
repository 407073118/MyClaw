import type { H3Event } from "h3";
import { createError, getCookie, getRequestHeader } from "h3";

type ProxyCloudApiOptions = {
  body?: unknown;
  forwardAuth?: boolean;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  query?: Record<string, unknown>;
};

const SESSION_COOKIE_KEY = "myclaw-cloud-session";

function buildCloudApiUrl(event: H3Event, path: string, query?: Record<string, unknown>) {
  const config = useRuntimeConfig(event);
  const url = new URL(path, config.cloudApiBase);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      if (Array.isArray(value)) {
        value.forEach((entry) => url.searchParams.append(key, String(entry)));
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export async function proxyCloudApi<T>(
  event: H3Event,
  path: string,
  options: ProxyCloudApiOptions = {}
) {
  const headers: Record<string, string> = {};

  if (options.forwardAuth) {
    const authorization = getRequestHeader(event, "authorization");
    if (authorization) {
      headers.authorization = authorization;
    } else {
      const accessToken = resolveSessionAccessToken(event);
      if (accessToken) {
        headers.authorization = `Bearer ${accessToken}`;
      }
    }
  }

  try {
    return await $fetch<T>(buildCloudApiUrl(event, path, options.query), {
      method: options.method,
      body: options.body,
      headers
    });
  } catch (error: any) {
    throw createError({
      statusCode: error?.response?.status ?? 500,
      statusMessage:
        error?.response?._data?.message ??
        error?.response?.statusText ??
        error?.message ??
        "cloud_api_request_failed",
      data: error?.response?._data
    });
  }
}

function resolveSessionAccessToken(event: H3Event): string {
  const rawCookie = getCookie(event, SESSION_COOKIE_KEY);
  if (!rawCookie) {
    return "";
  }

  try {
    const parsed = JSON.parse(rawCookie) as { accessToken?: unknown };
    return typeof parsed.accessToken === "string" ? parsed.accessToken.trim() : "";
  } catch {
    return "";
  }
}

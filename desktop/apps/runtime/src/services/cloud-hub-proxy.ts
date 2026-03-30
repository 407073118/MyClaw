const DEFAULT_CLOUD_HUB_BASE_URL = "http://127.0.0.1:43210";

type CloudHubProxyResponse = {
  status: number;
  contentType: string;
  body: string;
};

type CloudHubForwardOptions = {
  method?: string;
  searchParams?: URLSearchParams;
  headers?: Record<string, string>;
  body?: string;
};

function normalizeCloudHubBaseUrl(explicitBaseUrl?: string): string {
  return explicitBaseUrl?.trim() || process.env.MYCLAW_CLOUD_HUB_BASE_URL?.trim() || DEFAULT_CLOUD_HUB_BASE_URL;
}

/** 通过 runtime 代理访问云端 Hub，避免桌面前端直接跨域请求外部服务。 */
export class CloudHubProxy {
  private readonly baseUrl: string;

  constructor(explicitBaseUrl?: string) {
    this.baseUrl = normalizeCloudHubBaseUrl(explicitBaseUrl);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** 转发云端 API 请求，并保留上游状态码与响应体，供 runtime 原样回传给桌面前端。 */
  async forward(relativePath: string, options: CloudHubForwardOptions = {}): Promise<CloudHubProxyResponse> {
    const targetUrl = new URL(relativePath, this.baseUrl);
    if (options.searchParams) {
      for (const [key, value] of options.searchParams.entries()) {
        if (value.trim()) {
          targetUrl.searchParams.set(key, value);
        }
      }
    }

    const response = await fetch(targetUrl, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
    });
    const body = await response.text();

    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "application/json",
      body,
    };
  }
}

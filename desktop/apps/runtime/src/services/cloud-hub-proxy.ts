const DEFAULT_CLOUD_HUB_BASE_URL = "http://127.0.0.1:43210";

type CloudHubProxyResponse = {
  status: number;
  contentType: string;
  body: string;
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

  /** 转发 Hub GET 请求并保留上游 JSON 响应，供 runtime API 原样返回。 */
  async forward(relativePath: string, searchParams?: URLSearchParams): Promise<CloudHubProxyResponse> {
    const targetUrl = new URL(relativePath, this.baseUrl);
    if (searchParams) {
      for (const [key, value] of searchParams.entries()) {
        if (value.trim()) {
          targetUrl.searchParams.set(key, value);
        }
      }
    }

    const response = await fetch(targetUrl);
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Cloud hub request failed: ${response.status}`);
    }

    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "application/json",
      body,
    };
  }
}

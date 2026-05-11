import type { WorkflowHttpRequestNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";
import { renderWorkflowTemplate } from "../variable-resolver";

type HttpRequestFn = typeof fetch;

/** 解析 HTTP 响应体，优先保留 JSON 结构，失败则回退为原始文本。*/
function parseResponseBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

export class HttpRequestNodeExecutor implements NodeExecutor {
  readonly kind = "http-request" as const;

  /** 使用内置 fetch 执行工作流里的 HTTP 节点。*/
  constructor(private httpRequest: HttpRequestFn = fetch) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as WorkflowHttpRequestNode;
    const config = node.httpRequest;
    const method = config.method ?? "GET";
    const headers = Object.fromEntries(
      Object.entries(config.headers ?? {}).map(([key, value]) => [
        key,
        renderWorkflowTemplate(value, ctx.state, ctx.resolvedInputs),
      ]),
    );
    const url = renderWorkflowTemplate(config.url, ctx.state, ctx.resolvedInputs);
    console.info("[workflow] 执行 http-request 节点", {
      runId: ctx.runId,
      nodeId: node.id,
      method,
      url,
    });
    const init: RequestInit = {
      method,
      headers,
      signal: ctx.signal,
    };

    if (config.body !== undefined && method !== "GET") {
      init.body = renderWorkflowTemplate(config.body, ctx.state, ctx.resolvedInputs);
      if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json";
        init.headers = headers;
      }
    }

    const response = await this.httpRequest(url, init);
    const responseText = await response.text();
    const parsedBody = parseResponseBody(responseText);
    const outputKey = config.outputKey
      ?? (node.outputBindings ? Object.values(node.outputBindings)[0] : null)
      ?? "lastHttpResponse";

    return {
      writes: [{ channelName: outputKey, value: parsedBody }],
      outputs: {
        status: response.status,
        ok: response.ok,
        body: parsedBody,
        headers: response.headers ? Object.fromEntries(response.headers.entries()) : {},
      },
      durationMs: Date.now() - start,
    };
  }
}

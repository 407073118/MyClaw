import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeContext } from "../runtime-context";

export type HttpRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RuntimeHttpRequest = IncomingMessage & { url: string };

export type HttpRouteContext = {
  request: RuntimeHttpRequest;
  response: ServerResponse<IncomingMessage>;
  requestUrl: URL;
  runtimeContext: RuntimeContext;
  pathMatch: RegExpMatchArray | null;
};

export type HttpRouteHandler = (context: HttpRouteContext) => void | boolean | Promise<void | boolean>;

export type HttpRouter = {
  register: (method: HttpRouteMethod, pathname: string, handler: HttpRouteHandler) => void;
  registerPattern: (method: HttpRouteMethod, pattern: RegExp, handler: HttpRouteHandler) => void;
  handle: (context: HttpRouteContext) => Promise<boolean>;
};

export type RuntimeHttpRequestHandlerInput = {
  router: HttpRouter;
  runtimeContext: RuntimeContext;
  fallbackHandler?: (context: HttpRouteContext) => Promise<boolean | void>;
};

/**
 * 创建最小 HTTP 路由分发器。
 * 第一刀只支持 method + pathname 的精确匹配，便于逐步把 server.ts 路由域迁出。
 */
export function createHttpRouter(): HttpRouter {
  const routes = new Map<string, HttpRouteHandler>();
  const patternRoutes: Array<{ method: HttpRouteMethod; pattern: RegExp; handler: HttpRouteHandler }> = [];

  /**
   * 注册精确匹配路由；同 method+pathname 只保留最后一次注册，避免重复命中。
   */
  function register(method: HttpRouteMethod, pathname: string, handler: HttpRouteHandler): void {
    routes.set(`${method} ${pathname}`, handler);
  }

  /**
   * 注册正则路由，适用于带 path 参数的 endpoint（例如 `/api/sessions/:id`）。
   */
  function registerPattern(method: HttpRouteMethod, pattern: RegExp, handler: HttpRouteHandler): void {
    patternRoutes.push({ method, pattern, handler });
  }

  /**
   * 按当前请求执行命中处理器，返回是否已处理。
   */
  async function handle(context: HttpRouteContext): Promise<boolean> {
    const method = context.request.method?.toUpperCase() as HttpRouteMethod | undefined;
    if (!method) {
      return false;
    }

    const handler = routes.get(`${method} ${context.requestUrl.pathname}`);
    if (!handler) {
      for (const candidate of patternRoutes) {
        if (candidate.method !== method) {
          continue;
        }

        const match = context.requestUrl.pathname.match(candidate.pattern);
        if (!match) {
          continue;
        }

        const handled = await candidate.handler({
          ...context,
          pathMatch: match,
        });
        return handled !== false;
      }

      return false;
    }

    const handled = await handler({
      ...context,
      pathMatch: null,
    });
    return handled !== false;
  }

  return {
    register,
    registerPattern,
    handle,
  };
}

/**
 * 组装 runtime 的统一 HTTP 入口，接管协议层能力：
 * CORS、OPTIONS、URL 解析、健康检查、路由分发与 404 回退。
 */
export function createRuntimeHttpRequestHandler(input: RuntimeHttpRequestHandlerInput) {
  return async (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type, authorization");

    if (!request.url) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_request_url" }));
      return;
    }

    const requestUrl = new URL(request.url, "http://runtime.local");

    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", service: "runtime" }));
      return;
    }

    const routedRequest = request as RuntimeHttpRequest;
    const routeContext: HttpRouteContext = {
      request: routedRequest,
      response,
      requestUrl,
      runtimeContext: input.runtimeContext,
      pathMatch: null,
    };

    if (await input.router.handle(routeContext)) {
      return;
    }

    if (input.fallbackHandler) {
      const fallbackResult = await input.fallbackHandler(routeContext);
      if (fallbackResult !== false) {
        return;
      }
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  };
}

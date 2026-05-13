import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { approveApprovalRequest, denyApprovalRequest } from "../core/approval-store.js";
import { scaffoldEmployeeFolder, type SiliconLogger } from "../core/employee-scaffold.js";
import { initializeSiliconRuntimeRoot } from "../core/runtime-root.js";
import { createEmployeeTask } from "../core/task-store.js";
import { runSiliconDaemonTick } from "../runtime/daemon.js";
import { runEmployeeHeartbeat } from "../runtime/heartbeat.js";
import { readArtifactReviewView } from "../services/artifact-review.js";
import { getEmployeeDetailView } from "../services/employee-detail.js";
import { getRuntimeDashboardView } from "../services/runtime-dashboard.js";
import { resolveRuntimeEmployeeDir } from "../services/runtime-paths.js";
import { readRunTimelineView } from "../services/run-timeline.js";

export type CreateSiliconHttpServerInput = {
  runtimeRoot: string;
  uiRoot?: string;
  logger?: SiliconLogger;
};

type RouteContext = {
  runtimeRoot: string;
  uiRoot: string;
  logger: SiliconLogger;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** 创建 Silicon 本地 HTTP server，服务 JSON API 和 Workbench 静态 UI。 */
export function createSiliconHttpServer(input: CreateSiliconHttpServerInput): Server {
  const logger = input.logger ?? noopLogger;
  const context: RouteContext = {
    runtimeRoot: input.runtimeRoot,
    uiRoot: input.uiRoot ?? resolveDefaultUiRoot(),
    logger,
  };
  logger.info("创建 Silicon UI HTTP server", {
    runtimeRoot: context.runtimeRoot,
    uiRoot: context.uiRoot,
  });
  return createServer((request, response) => {
    void handleRequest(request, response, context).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.warn("Silicon UI HTTP 请求处理失败", { message });
      writeJson(response, 500, {
        code: "internal_error",
        message,
        recoverable: true,
      });
    });
  });
}

/** 启动默认 HTTP server，供 `node dist/http/server.js` 直接运行。 */
export async function startSiliconHttpServer(input: CreateSiliconHttpServerInput & { port?: number; host?: string }): Promise<Server> {
  const port = input.port ?? Number.parseInt(process.env.SILICON_UI_PORT ?? "17321", 10);
  const host = input.host ?? process.env.SILICON_UI_HOST ?? "127.0.0.1";
  const server = createSiliconHttpServer(input);
  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });
  input.logger?.info("Silicon UI HTTP server 已启动", { host, port, runtimeRoot: input.runtimeRoot });
  return server;
}

/** 分发 HTTP 请求，API 路由优先，其他请求交给静态 UI。 */
async function handleRequest(request: IncomingMessage, response: ServerResponse, context: RouteContext): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  context.logger.info("Silicon UI HTTP 收到请求", { method: request.method, path: url.pathname });
  if (url.pathname.startsWith("/api/")) {
    await handleApiRequest(request, response, url, context);
    return;
  }
  await serveStaticUi(response, url.pathname, context);
}

/** 分发 JSON API 请求，保持 UI 与 runtime 文件结构解耦。 */
async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: RouteContext,
): Promise<void> {
  if (request.method === "GET" && url.pathname === "/api/runtime/dashboard") {
    writeJson(response, 200, await getRuntimeDashboardView({ runtimeRoot: context.runtimeRoot, logger: context.logger }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/runtime/init") {
    writeJson(response, 200, await initializeSiliconRuntimeRoot({ runtimeRoot: context.runtimeRoot, logger: context.logger }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/daemon/tick") {
    writeJson(response, 200, await runSiliconDaemonTick({ runtimeRoot: context.runtimeRoot, logger: context.logger }));
    return;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "api" && parts[1] === "employees") {
    await handleEmployeeApiRequest(request, response, parts.slice(2), context);
    return;
  }
  writeJson(response, 404, { code: "not_found", message: "API 不存在", recoverable: false });
}

/** 处理员工范围 API，包括创建、详情、任务、审批、heartbeat 和输出。 */
async function handleEmployeeApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  parts: string[],
  context: RouteContext,
): Promise<void> {
  if (request.method === "POST" && parts.length === 0) {
    const body = await readJsonBody(request);
    writeJson(response, 200, await scaffoldEmployeeFolder({
      runtimeRoot: context.runtimeRoot,
      employeeId: readRequiredString(body, "employeeId"),
      displayName: readRequiredString(body, "displayName"),
      definitionId: readRequiredString(body, "definitionId"),
      logger: context.logger,
    }));
    return;
  }

  const employeeId = parts[0];
  if (!employeeId) {
    writeJson(response, 400, { code: "employee_required", message: "缺少 employeeId", recoverable: true });
    return;
  }
  if (request.method === "GET" && parts.length === 1) {
    writeJson(response, 200, await getEmployeeDetailView({ runtimeRoot: context.runtimeRoot, employeeId, logger: context.logger }));
    return;
  }
  if (request.method === "POST" && parts[1] === "heartbeat" && parts[2] === "tick") {
    writeJson(response, 200, await runEmployeeHeartbeat({ employeeDir: resolveRuntimeEmployeeDir(context.runtimeRoot, employeeId, context.logger), logger: context.logger }));
    return;
  }
  if (parts[1] === "tasks") {
    await handleTaskApiRequest(request, response, employeeId, parts.slice(2), context);
    return;
  }
  if (parts[1] === "approvals") {
    await handleApprovalApiRequest(request, response, employeeId, parts.slice(2), context);
    return;
  }
  if (request.method === "GET" && parts[1] === "runs" && parts[2]) {
    writeJson(response, 200, await readRunTimelineView({ runtimeRoot: context.runtimeRoot, employeeId, runId: parts[2], logger: context.logger }));
    return;
  }
  writeJson(response, 404, { code: "not_found", message: "员工 API 不存在", recoverable: false });
}

/** 处理任务 API，支持创建任务和读取 artifact/review 视图。 */
async function handleTaskApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  employeeId: string,
  parts: string[],
  context: RouteContext,
): Promise<void> {
  const employeeDir = resolveRuntimeEmployeeDir(context.runtimeRoot, employeeId, context.logger);
  if (request.method === "POST" && parts.length === 0) {
    const body = await readJsonBody(request);
    writeJson(response, 200, await createEmployeeTask({
      employeeDir,
      taskId: readRequiredString(body, "taskId"),
      title: readRequiredString(body, "title"),
      instruction: readRequiredString(body, "instruction"),
      requestedCapability: readOptionalCapability(body),
      logger: context.logger,
    }));
    return;
  }
  if (request.method === "GET" && parts[1] === "output") {
    writeJson(response, 200, await readArtifactReviewView({ runtimeRoot: context.runtimeRoot, employeeId, taskId: parts[0], logger: context.logger }));
    return;
  }
  writeJson(response, 404, { code: "not_found", message: "任务 API 不存在", recoverable: false });
}

/** 处理审批 API，支持 approve 和 deny。 */
async function handleApprovalApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  employeeId: string,
  parts: string[],
  context: RouteContext,
): Promise<void> {
  const employeeDir = resolveRuntimeEmployeeDir(context.runtimeRoot, employeeId, context.logger);
  if (request.method === "POST" && parts[0] && parts[1] === "approve") {
    writeJson(response, 200, await approveApprovalRequest({ employeeDir, approvalId: parts[0], logger: context.logger }));
    return;
  }
  if (request.method === "POST" && parts[0] && parts[1] === "deny") {
    writeJson(response, 200, await denyApprovalRequest({ employeeDir, approvalId: parts[0], logger: context.logger }));
    return;
  }
  writeJson(response, 404, { code: "not_found", message: "审批 API 不存在", recoverable: false });
}

/** 服务静态 Workbench UI，禁止路径穿越。 */
async function serveStaticUi(response: ServerResponse, pathName: string, context: RouteContext): Promise<void> {
  const relative = pathName === "/" ? "index.html" : pathName.replace(/^\/+/, "");
  const normalized = normalize(relative);
  if (normalized.startsWith("..") || normalized.includes("..\\")) {
    writeJson(response, 403, { code: "forbidden_path", message: "禁止访问 UI 根目录之外的文件", recoverable: false });
    return;
  }
  const filePath = join(context.uiRoot, normalized);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    writeJson(response, 404, { code: "ui_not_found", message: "UI 静态资源不存在", recoverable: false });
    return;
  }
  const body = await readFile(filePath);
  response.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream" });
  response.end(body);
}

/** 读取 JSON 请求体，空 body 返回空对象。 */
async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("请求体必须是 JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** 从 JSON body 读取必填字符串。 */
function readRequiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`缺少必填字段：${key}`);
  }
  return value;
}

/** 从 JSON body 读取可选 capability 字符串。 */
function readOptionalCapability(body: Record<string, unknown>): "filesystem.read" | "artifact.write" | "shell.execute" | "network.external" | "employee.cross_access" | undefined {
  const value = body.requestedCapability ?? body.capability;
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "filesystem.read"
    || value === "artifact.write"
    || value === "shell.execute"
    || value === "network.external"
    || value === "employee.cross_access"
  ) {
    return value;
  }
  throw new Error(`不支持的 capability：${String(value)}`);
}

/** 写出 JSON 响应。 */
function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

/** 解析默认 UI 静态目录，兼容从 repo root 或 silicon 目录启动。 */
function resolveDefaultUiRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith("silicon")) {
    return join(cwd, "apps", "ui");
  }
  return join(cwd, "silicon", "apps", "ui");
}

/** 判断指定 argv 路径是否指向当前模块入口，兼容相对路径和绝对路径。 */
export function isSiliconHttpServerEntrypoint(currentModuleUrl: string, argvPath: string | undefined, cwd = process.cwd()): boolean {
  if (!argvPath) {
    return false;
  }
  return normalize(fileURLToPath(currentModuleUrl)).toLowerCase() === normalize(resolve(cwd, argvPath)).toLowerCase();
}

/** 解析 HTTP server 直接启动参数，并允许环境变量作为默认值。 */
export function readSiliconHttpServerCliOptions(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): { runtimeRoot: string; port?: number; host?: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Invalid server argument near ${key ?? "<empty>"}`);
    }
    values.set(key.slice(2), value);
  }
  const runtimeRoot = values.get("runtime-root") ?? env.SILICON_RUNTIME_ROOT;
  if (!runtimeRoot) {
    throw new Error("启动 Silicon UI 需要设置 --runtime-root 或 SILICON_RUNTIME_ROOT");
  }
  const portText = values.get("port") ?? env.SILICON_UI_PORT;
  return {
    runtimeRoot,
    port: portText ? Number.parseInt(portText, 10) : undefined,
    host: values.get("host") ?? env.SILICON_UI_HOST,
  };
}

if (isSiliconHttpServerEntrypoint(import.meta.url, process.argv[1])) {
  await startSiliconHttpServer({ ...readSiliconHttpServerCliOptions(process.argv.slice(2)), logger: console });
}

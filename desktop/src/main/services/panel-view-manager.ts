import { WebContentsView, shell, type BrowserWindow, type WebContents } from "electron";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Readable } from "node:stream";

import { FILE_VIEWER_PANEL_PATH, type FileViewerPayload, type OpenWebPanelPayload, type PanelBounds, type SkillDefinition } from "@shared/contracts";
import type { RuntimeContext } from "./runtime-context";
import { buildPanelViewerHtml } from "./panel-viewer-html";

const requireFromPanelManager = createRequire(__filename);

type PanelViewManagerOptions = {
  getMainWindow: () => BrowserWindow | null;
  runtimeContext: Pick<RuntimeContext, "state">;
  panelPreloadPath: string;
};

type PanelRecord = {
  id: string;
  view: WebContentsView;
  owner: BrowserWindow;
  url: string;
  payload: OpenWebPanelPayload;
  skillId: string | null;
};

type FileTokenRecord = {
  path: string;
  mimeType: string | null;
};

export const PANEL_PARTITION = "myclaw-panel";
const PANEL_CONTENT_ZOOM_FACTOR = 0.85;
const FILE_TOKEN_PATTERN = /^myclaw-file:\/\/([^/]+)\/([^/?#]+)/i;
const SAFE_SKILL_ASSET_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".mp3",
  ".wav",
  ".mp4",
  ".webm",
  ".ttf",
  ".woff",
  ".woff2",
]);

/** 统一路径分隔符，便于跨平台做 Skill 根目录校验。 */
function normalizeSep(path: string): string {
  return path.replace(/\\/g, "/");
}

/** 判断目标路径是否仍位于指定根目录内，避免 Skill HTML 越界加载。 */
function isInsideBase(base: string, target: string): boolean {
  const normalizedBase = normalizeSep(resolve(base)).toLowerCase();
  const normalizedTarget = normalizeSep(resolve(target)).toLowerCase();
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}/`);
}

/** 将任意 unknown 转为可安全写入 executeJavaScript 的 JSON 字面量。 */
function toJsonLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** 判断 URL 是否属于右侧面板允许的自定义协议。 */
function isAllowedPanelUrl(url: string): boolean {
  return url.startsWith("myclaw-skill://")
    || url.startsWith("myclaw-viewer://")
    || url.startsWith("myclaw-file://")
    || url.startsWith("myclaw-vendor://")
    || url === "about:blank";
}

/** 比较本地文件路径是否指向同一授权文件，Windows 下按大小写不敏感处理。 */
function isSamePath(a: string, b: string): boolean {
  if (!a || !b) return false;
  return normalizeSep(resolve(a)).toLowerCase() === normalizeSep(resolve(b)).toLowerCase();
}

/** 只允许 Skill 的 assets 目录暴露常见静态资源，避免根目录任意文件泄露。 */
function isAllowedSkillAsset(skill: SkillDefinition, relativePath: string): boolean {
  const normalized = normalizeSep(relativePath);
  return Boolean(
    skill.hasAssetsDirectory
    && normalized.startsWith("assets/")
    && SAFE_SKILL_ASSET_EXTENSIONS.has(extname(normalized).toLowerCase()),
  );
}

/** 管理右侧 WebContentsView 生命周期、加载源和宿主通信。 */
export class PanelViewManager {
  private current: PanelRecord | null = null;
  private fileTokens = new Map<string, FileTokenRecord>();

  constructor(private readonly options: PanelViewManagerOptions) {}

  /** 打开右侧原生 WebContentsView，并向页面发送结构化面板数据。 */
  async open(payload: OpenWebPanelPayload): Promise<void> {
    const owner = this.options.getMainWindow();
    if (!owner) {
      throw new Error("主窗口尚未初始化，无法打开右侧面板。");
    }

    this.close();
    const panelId = randomUUID();
    const preparedPayload = this.preparePayload(panelId, payload);
    const target = this.resolvePanelUrl(preparedPayload);
    const view = this.createPanelView();
    owner.contentView.addChildView(view);
    this.current = { id: panelId, view, owner, url: target.url, payload: preparedPayload, skillId: target.skillId };

    console.info("[panel-view] 打开右侧 WebContentsView 面板", {
      panelId,
      title: preparedPayload.title,
      viewPath: preparedPayload.viewPath,
      url: target.url,
    });
    try {
      await view.webContents.loadURL(target.url);
      this.sendHostMessage({ type: "skill-data", payload: preparedPayload.data });
    } catch (error) {
      owner.contentView.removeChildView(view);
      view.webContents.close();
      this.current = null;
      throw error;
    }
  }

  /** 只更新当前面板数据，不重建 WebContentsView，保持右侧预览常驻。 */
  updateData(data: unknown): void {
    if (!this.current) return;
    this.current.payload = { ...this.current.payload, data };
    console.info("[panel-view] 向右侧 WebContentsView 增量注入面板数据", {
      panelId: this.current.id,
      title: this.current.payload.title,
    });
    this.sendHostMessage({ type: "skill-data", payload: data });
  }

  /** 根据右侧 Dock 的屏幕矩形同步 WebContentsView bounds。 */
  setBounds(bounds: PanelBounds): void {
    if (!this.current) return;
    const normalized = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    this.current.view.setBounds(normalized);
  }

  /** 刷新当前面板，并重新发送最新结构化数据。 */
  async refresh(): Promise<void> {
    if (!this.current) {
      throw new Error("右侧面板尚未打开，无法刷新。");
    }
    console.info("[panel-view] 刷新右侧 WebContentsView 面板", {
      panelId: this.current.id,
      title: this.current.payload.title,
    });
    await this.current.view.webContents.loadURL(this.current.url);
    this.sendHostMessage({ type: "skill-data", payload: this.current.payload.data });
  }

  /** 关闭右侧 WebContentsView，并释放临时文件 token。 */
  close(): void {
    if (!this.current) return;
    const { id, owner, view } = this.current;
    console.info("[panel-view] 关闭右侧 WebContentsView 面板", { panelId: id });
    owner.contentView.removeChildView(view);
    view.webContents.close();
    this.fileTokens.clear();
    this.current = null;
  }

  /** 判断 IPC 发送方是否是当前右侧面板自身，避免主窗口或其他 WebContents 冒用。 */
  isPanelSender(sender: WebContents | null | undefined): boolean {
    return Boolean(sender && this.current && sender === this.current.view.webContents);
  }

  /** 接收旧 HTML 或新 bridge 发回的面板消息。 */
  async handlePanelMessage(message: unknown): Promise<unknown> {
    if (!message || typeof message !== "object") return { success: false, error: "空面板消息。" };
    const record = message as Record<string, unknown>;
    if (record.type === "skill-callback" && record.action === "read-data-ref") {
      const result = this.readSkillDataRef(record);
      this.sendHostMessage({
        type: "skill-data-ref-result",
        requestId: typeof record.requestId === "string" ? record.requestId : "",
        success: result.success,
        payload: result.data,
        error: result.error,
      });
      return result;
    }
    console.info("[panel-view] 收到右侧 HTML 面板回调", { action: record.action ?? record.type });
    return { success: true };
  }

  /** 执行文件查看器里的受控宿主动作。 */
  async invokeAction(action: string, data: unknown): Promise<unknown> {
    if (!this.current || this.current.payload.viewPath !== FILE_VIEWER_PANEL_PATH) {
      console.warn("[panel-view] 非文件查看器面板请求本地文件动作已拒绝", { action });
      return { success: false, error: "只有内建文件查看器可以执行本地文件动作。" };
    }
    const path = data && typeof data === "object" && typeof (data as { path?: unknown }).path === "string"
      ? (data as { path: string }).path
      : "";
    if ((action === "file-viewer:open-external" || action === "file-viewer:reveal") && !path) {
      return { success: false, error: "缺少文件路径。" };
    }
    const currentFilePath = this.current.payload.data
      && typeof this.current.payload.data === "object"
      && typeof (this.current.payload.data as { path?: unknown }).path === "string"
      ? (this.current.payload.data as { path: string }).path
      : "";
    if ((action === "file-viewer:open-external" || action === "file-viewer:reveal") && !isSamePath(path, currentFilePath)) {
      console.warn("[panel-view] 文件查看器请求操作非当前文件路径已拒绝", { action, path });
      return { success: false, error: "只能操作当前文件查看器授权的文件。" };
    }
    if (action === "file-viewer:open-external") {
      const error = await shell.openPath(path);
      return error ? { success: false, error } : { success: true };
    }
    if (action === "file-viewer:reveal") {
      shell.showItemInFolder(path);
      return { success: true };
    }
    return { success: false, error: "未知面板动作：" + action };
  }

  /** 为自定义协议返回内容，供 protocol.handle 调用。 */
  handleProtocolRequest(url: string): Response {
    if (url.startsWith("myclaw-viewer://")) {
      return new Response(buildPanelViewerHtml(), {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    }
    if (url.startsWith("myclaw-skill://")) {
      return this.readSkillResource(url);
    }
    if (url.startsWith("myclaw-file://")) {
      return this.readFileTokenResource(url);
    }
    if (url.startsWith("myclaw-vendor://")) {
      return this.readVendorResource(url);
    }
    return new Response("Not found", { status: 404 });
  }

  /** 创建带有最小权限配置的 WebContentsView。 */
  private createPanelView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: this.options.panelPreloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: PANEL_PARTITION,
      },
    });
    view.webContents.setZoomFactor(PANEL_CONTENT_ZOOM_FACTOR);
    this.configureWebContentsSecurity(view.webContents);
    return view;
  }

  /** 为面板 WebContents 收紧导航、弹窗、权限和下载。 */
  private configureWebContentsSecurity(webContents: WebContents): void {
    webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url);
      }
      return { action: "deny" };
    });
    webContents.on("will-navigate", (event, url) => {
      if (isAllowedPanelUrl(url)) return;
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url);
      }
    });
    webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    webContents.session.on("will-download", (event) => {
      event.preventDefault();
    });
  }

  /** 根据旧 viewMeta 兼容生成 WebContentsView 可加载的自定义协议 URL。 */
  private resolvePanelUrl(payload: OpenWebPanelPayload): { url: string; skillId: string | null } {
    if (payload.viewPath === FILE_VIEWER_PANEL_PATH) {
      return { url: "myclaw-viewer://file-viewer", skillId: null };
    }
    const match = this.findSkillPage(payload.viewPath);
    if (!match) {
      throw new Error("HTML 面板路径不属于任何已声明的 Skill 页面：" + payload.viewPath);
    }
    return {
      url: `myclaw-skill://${encodeURIComponent(match.skill.id)}/${match.relativePath.split("/").map(encodeURIComponent).join("/")}`,
      skillId: match.skill.id,
    };
  }

  /** 查找绝对 HTML 路径对应的 Skill 与声明页面。 */
  private findSkillPage(viewPath: string): { skill: SkillDefinition; relativePath: string } | null {
    const resolvedPath = resolve(viewPath);
    for (const skill of this.options.runtimeContext.state.skills) {
      if (!skill.path || !isInsideBase(skill.path, resolvedPath)) continue;
      const relativePath = normalizeSep(relative(skill.path, resolvedPath));
      if (!skill.viewFiles?.includes(relativePath)) {
        throw new Error(`页面未声明为 Skill HTML 面板：${relativePath}`);
      }
      return { skill, relativePath };
    }
    return null;
  }

  /** 为文件查看 payload 替换受控 myclaw-file URL，避免直接暴露 file://。 */
  private preparePayload(panelId: string, payload: OpenWebPanelPayload): OpenWebPanelPayload {
    if (payload.viewPath !== FILE_VIEWER_PANEL_PATH || !payload.data || typeof payload.data !== "object") {
      return payload;
    }
    const data = { ...(payload.data as FileViewerPayload) };
    if (typeof data.path === "string" && data.previewUrl) {
      const token = randomUUID();
      this.fileTokens.set(`${panelId}:${token}`, {
        path: data.path,
        mimeType: data.mimeType ?? null,
      });
      data.previewUrl = `myclaw-file://${panelId}/${token}`;
    }
    return { ...payload, data };
  }

  /** 从 Skill 根目录读取 HTML 或静态资源。 */
  private readSkillResource(url: string): Response {
    const parsed = new URL(url);
    const skillId = decodeURIComponent(parsed.hostname);
    const skill = this.options.runtimeContext.state.skills.find((item) => item.id === skillId);
    if (!skill?.path) return new Response("Skill not found", { status: 404 });
    const relativePath = normalizeSep(decodeURIComponent(parsed.pathname.replace(/^\/+/, "")));
    const resolvedPath = resolve(join(skill.path, relativePath));
    if (!isInsideBase(skill.path, resolvedPath) || !existsSync(resolvedPath)) {
      return new Response("Not found", { status: 404 });
    }
    if (extname(resolvedPath).toLowerCase() === ".html" && !skill.viewFiles?.includes(relativePath)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (extname(resolvedPath).toLowerCase() !== ".html" && !isAllowedSkillAsset(skill, relativePath)) {
      return new Response("Forbidden", { status: 403 });
    }
    let body = readFileSync(resolvedPath);
    const contentType = inferContentType(resolvedPath);
    if (contentType.startsWith("text/html")) {
      body = Buffer.from(injectHtmlCsp(body.toString("utf8")), "utf8");
    }
    return new Response(body, { headers: { "content-type": contentType } });
  }

  /** 读取当前面板授权的本地文件 token。 */
  private readFileTokenResource(url: string): Response {
    const match = url.match(FILE_TOKEN_PATTERN);
    if (!match) return new Response("Bad token", { status: 400 });
    const record = this.fileTokens.get(`${match[1]}:${match[2]}`);
    if (!record || !existsSync(record.path)) return new Response("Not found", { status: 404 });
    const size = statSync(record.path).size;
    const body = Readable.toWeb(createReadStream(record.path)) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        "content-type": record.mimeType ?? inferContentType(record.path),
        "content-length": String(size),
      },
    });
  }

  /** 读取打包在 node_modules 内的受控前端库资源。 */
  private readVendorResource(url: string): Response {
    const parsed = new URL(url);
    const vendor = parsed.hostname;
    const relativePath = normalizeSep(decodeURIComponent(parsed.pathname.replace(/^\/+/, "")));
    let resolvedPath = "";

    if (vendor === "pdfjs") {
      const pdfRoot = resolve(requireFromPanelManager.resolve("pdfjs-dist/package.json"), "..");
      resolvedPath = resolve(pdfRoot, "build", relativePath);
      if (!isInsideBase(resolve(pdfRoot, "build"), resolvedPath)) {
        return new Response("Forbidden", { status: 403 });
      }
    } else if (vendor === "monaco") {
      const monacoRoot = resolve(requireFromPanelManager.resolve("monaco-editor/package.json"), "..");
      resolvedPath = resolve(monacoRoot, "min", relativePath);
      if (!isInsideBase(resolve(monacoRoot, "min"), resolvedPath)) {
        return new Response("Forbidden", { status: 403 });
      }
    } else {
      return new Response("Unknown vendor", { status: 404 });
    }

    if (!existsSync(resolvedPath)) return new Response("Not found", { status: 404 });
    return new Response(readFileSync(resolvedPath), {
      headers: {
        "content-type": inferContentType(resolvedPath),
      },
    });
  }

  /** 读取 Skill dataRef JSON，并限制在当前 Skill 目录。 */
  private readSkillDataRef(request: Record<string, unknown>): { success: boolean; data?: unknown; error?: string } {
    const currentSkillId = this.current?.skillId ?? "";
    const requestedSkillId = typeof request.skillId === "string" ? request.skillId : "";
    const dataRef = typeof request.dataRef === "string" ? request.dataRef : "";
    if (!currentSkillId) return { success: false, error: "当前面板不是 Skill HTML，不能读取 dataRef。" };
    if (requestedSkillId && requestedSkillId !== currentSkillId) {
      return { success: false, error: "dataRef 只能读取当前面板所属 Skill。" };
    }
    const skill = this.options.runtimeContext.state.skills.find((item) => item.id === currentSkillId);
    if (!skill?.path || !dataRef.trim()) return { success: false, error: "缺少 skillId 或 dataRef。" };
    const resolvedPath = resolve(skill.path, dataRef);
    if (!isInsideBase(skill.path, resolvedPath)) return { success: false, error: "dataRef 只能读取当前 Skill 目录内的文件。" };
    if (extname(resolvedPath).toLowerCase() !== ".json") return { success: false, error: "dataRef 只允许读取 JSON 文件。" };
    if (!existsSync(resolvedPath)) return { success: false, error: "dataRef 文件不存在：" + basename(resolvedPath) };
    const raw = readFileSync(resolvedPath, "utf8");
    if (raw.length > 2 * 1024 * 1024) return { success: false, error: "dataRef 超过 2MiB 上限。" };
    try {
      return { success: true, data: JSON.parse(raw) };
    } catch (error) {
      return { success: false, error: "dataRef 文件不是合法 JSON：" + (error instanceof Error ? error.message : String(error)) };
    }
  }

  /** 向当前面板发送宿主消息，同时兼容旧 message listener。 */
  private sendHostMessage(message: unknown): void {
    if (!this.current) return;
    this.current.view.webContents.send("panel:host-message", message);
    const script = `window.dispatchEvent(new MessageEvent("message", { data: ${toJsonLiteral(message)} }));`;
    this.current.view.webContents.executeJavaScript?.(script).catch(() => {});
  }
}

/** 注入默认 CSP，约束旧 Skill HTML 的资源范围。 */
function injectHtmlCsp(html: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' myclaw-skill: myclaw-file: data:; img-src 'self' myclaw-skill: myclaw-file: data:; media-src 'self' myclaw-file:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'none';">`;
  const withCsp = /<meta\s+http-equiv=["']Content-Security-Policy["']/i.test(html)
    ? html
    : injectIntoHtmlHead(html, csp);
  return injectHtmlHostDefaults(withCsp);
}

/** 向 HTML head 注入片段；没有 head 时保持片段在文档最前方。 */
function injectIntoHtmlHead(html: string, fragment: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (head) => `${head}\n${fragment}`);
  return `${fragment}\n${html}`;
}

/** 注入 Codex 风格的暗色宿主默认值，避免旧面板空白期呈现整片白底。 */
function injectHtmlHostDefaults(html: string): string {
  if (/id=["']myclaw-panel-host-defaults["']/i.test(html)) return html;
  const style = `<style id="myclaw-panel-host-defaults">
:root{color-scheme:dark;}
*,*::before,*::after{box-sizing:border-box;min-width:0;}
html{min-height:100%;width:100%;max-width:100%;background:#0c0c0d;overflow-x:hidden;}
body{min-height:100vh;width:100%;max-width:100%;margin:0;background:#0c0c0d;color:#f4f4f5;font-family:"Microsoft YaHei UI","Segoe UI",system-ui,sans-serif;overflow-x:hidden;}
img,video,canvas,svg,table,pre,code{max-width:100%;}
body>*,#app,.app,.shell,.container,.page,.layout,.content,.main{max-width:100%;}
body:empty::before{content:"正在加载预览";min-height:100vh;display:flex;align-items:center;justify-content:center;color:#a1a1aa;font-size:13px;background:#0c0c0d;}
</style>`;
  return injectIntoHtmlHead(html, style);
}

/** 根据扩展名返回基础 Content-Type。 */
function inferContentType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".ttf") return "font/ttf";
  if (ext === ".woff") return "font/woff";
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  return "application/octet-stream";
}

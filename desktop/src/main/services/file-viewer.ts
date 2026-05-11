import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FILE_VIEWER_PANEL_PATH,
  type FileViewMode,
  type FileViewerKind,
  type FileViewerPayload,
} from "@shared/contracts";

export { FILE_VIEWER_PANEL_PATH };
export const FILE_VIEW_INLINE_BYTE_LIMIT = 2 * 1024 * 1024;

const MARKDOWN_EXTS = new Set([".md", ".markdown", ".mdown"]);
const TEXT_EXTS = new Set([".txt", ".log", ".env", ".ini", ".conf", ".properties"]);
const JSON_EXTS = new Set([".json", ".jsonc"]);
const TABLE_EXTS = new Set([".csv", ".tsv"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif"]);
const MEDIA_EXTS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm", ".mov"]);
const DOCUMENT_EXTS = new Set([".docx"]);
const SPREADSHEET_EXTS = new Set([".xlsx", ".xls", ".xlsm"]);
const SLIDES_EXTS = new Set([".pptx"]);
const ARCHIVE_EXTS = new Set([".zip", ".7z", ".rar", ".tar", ".gz"]);
const CODE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".yaml",
  ".yml",
  ".toml",
  ".rs",
  ".go",
  ".py",
  ".java",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".sql",
  ".sh",
  ".ps1",
]);

export type FileViewArgs = {
  path: string;
  mode: FileViewMode;
};

/** 解析 file.view 工具参数，兼容 JSON 和旧式纯路径。 */
export function parseFileViewArgs(label: string): FileViewArgs {
  const raw = label.trim();
  if (!raw) return { path: "", mode: "auto" };
  try {
    const parsed = JSON.parse(raw) as { path?: unknown; mode?: unknown };
    return {
      path: typeof parsed.path === "string" ? parsed.path : "",
      mode: normalizeFileViewMode(parsed.mode),
    };
  } catch {
    return { path: raw, mode: "auto" };
  }
}

/** 标准化模型传入的查看模式，避免未知值扩散到执行层。 */
export function normalizeFileViewMode(value: unknown): FileViewMode {
  return value === "panel" || value === "external" || value === "reveal" || value === "auto"
    ? value
    : "auto";
}

/** 根据扩展名推断右侧阅览器类型。 */
export function inferFileViewerKind(path: string, isDirectory = false): FileViewerKind {
  if (isDirectory) return "directory";
  const ext = extname(path).toLowerCase();
  if (MARKDOWN_EXTS.has(ext)) return "markdown";
  if (JSON_EXTS.has(ext)) return "json";
  if (TABLE_EXTS.has(ext)) return "table";
  if (TEXT_EXTS.has(ext)) return "text";
  if (CODE_EXTS.has(ext)) return "code";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if (DOCUMENT_EXTS.has(ext)) return "document";
  if (SPREADSHEET_EXTS.has(ext)) return "spreadsheet";
  if (SLIDES_EXTS.has(ext)) return "slides";
  if (MEDIA_EXTS.has(ext)) return "media";
  if (ARCHIVE_EXTS.has(ext)) return "archive";
  return "unsupported";
}

/** 生成轻量 MIME 类型，供前端选择预览控件。 */
export function inferFileViewerMimeType(path: string, kind: FileViewerKind): string | null {
  const ext = extname(path).toLowerCase();
  if (kind === "markdown") return "text/markdown";
  if (kind === "json") return "application/json";
  if (kind === "table") return ext === ".tsv" ? "text/tab-separated-values" : "text/csv";
  if (kind === "text" || kind === "code") return "text/plain";
  if (kind === "pdf") return "application/pdf";
  if (kind === "document") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (kind === "spreadsheet") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (kind === "slides") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (kind === "image") {
    const imageType = ext === ".jpg" ? "jpeg" : ext.slice(1);
    return imageType ? `image/${imageType}` : null;
  }
  if (kind === "media") {
    if ([".mp3", ".wav", ".ogg", ".m4a"].includes(ext)) return `audio/${ext.slice(1)}`;
    if ([".mp4", ".webm", ".mov"].includes(ext)) return `video/${ext.slice(1)}`;
  }
  if (kind === "archive") return "application/octet-stream";
  return null;
}

/** 判断当前类型是否适合把小体积文本作为面板数据传给渲染层。 */
function shouldInlineText(kind: FileViewerKind): boolean {
  return kind === "markdown" || kind === "text" || kind === "code" || kind === "json" || kind === "table";
}

/** 构建右侧文件阅览 payload；正文只进 UI 数据，不进入工具输出。 */
export async function buildFileViewerPayload(resolvedPath: string): Promise<FileViewerPayload> {
  const stats = await stat(resolvedPath);
  const kind = inferFileViewerKind(resolvedPath, stats.isDirectory());
  const ext = extname(resolvedPath).toLowerCase();
  const payload: FileViewerPayload = {
    panelKind: "file-viewer",
    path: resolvedPath,
    fileName: basename(resolvedPath),
    ext,
    mimeType: inferFileViewerMimeType(resolvedPath, kind),
    sizeBytes: stats.size,
    viewerKind: kind,
    actions: {
      openExternal: true,
      reveal: true,
    },
  };

  if (kind === "image" || kind === "pdf" || kind === "media") {
    payload.previewUrl = pathToFileURL(resolvedPath).toString();
  }

  if (shouldInlineText(kind) && stats.size <= FILE_VIEW_INLINE_BYTE_LIMIT) {
    payload.content = await readFile(resolvedPath, "utf8");
  } else if (shouldInlineText(kind) && stats.size > FILE_VIEW_INLINE_BYTE_LIMIT) {
    const buffer = await readFile(resolvedPath);
    payload.content = buffer.subarray(0, FILE_VIEW_INLINE_BYTE_LIMIT).toString("utf8");
    payload.truncated = true;
  }

  return payload;
}

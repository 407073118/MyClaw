import React, { useMemo } from "react";
import { ExternalLink, FileQuestion, FolderSearch, Minimize2 } from "lucide-react";

import type { FileViewerPayload } from "@shared/contracts";
import MarkdownView from "./MarkdownView";

type FileViewerPanelProps = {
  data: unknown;
  isFullscreen?: boolean;
  onExitFullscreen?: () => void;
};

/** 判断主进程传入的数据是否符合文件阅览面板契约。 */
function isFileViewerPayload(data: unknown): data is FileViewerPayload {
  if (!data || typeof data !== "object") return false;
  const record = data as Partial<FileViewerPayload>;
  return record.panelKind === "file-viewer"
    && typeof record.path === "string"
    && typeof record.fileName === "string"
    && typeof record.viewerKind === "string";
}

/** 将字节数转换为面板里更易扫读的体积标签。 */
function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

/** 为 JSON 预览做格式化；失败时回退原始内容。 */
function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

/** 解析 CSV/TSV 的前若干行，满足快速阅览而不承担完整表格引擎职责。 */
function parseDelimitedRows(content: string, separator: "," | "\t"): string[][] {
  const rows: string[][] = [];
  for (const line of content.split(/\r?\n/).slice(0, 200)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        quoted = !quoted;
        continue;
      }
      if (char === separator && !quoted) {
        cells.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    cells.push(current);
    rows.push(cells);
  }
  return rows;
}

/** 渲染可横向滚动的表格预览，避免长列撑破右侧面板。 */
function TablePreview({ content, ext }: { content: string; ext: string }) {
  const rows = useMemo(
    () => parseDelimitedRows(content, ext === ".tsv" ? "\t" : ","),
    [content, ext],
  );

  if (rows.length === 0) {
    return <div className="file-viewer-empty">空表格</div>;
  }

  const [head, ...body] = rows;
  return (
    <div className="file-viewer-table-wrap">
      <table className="file-viewer-table">
        <thead>
          <tr>
            {head.map((cell, index) => <th key={`${index}-${cell}`}>{cell || `Column ${index + 1}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {head.map((_, cellIndex) => <td key={cellIndex}>{row[cellIndex] ?? ""}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 渲染文件的主要预览区域。 */
function FilePreviewBody({ payload }: { payload: FileViewerPayload }) {
  const content = payload.content ?? "";
  if (payload.documentError && !content) {
    return <FallbackBody payload={payload} message={payload.documentError} />;
  }

  switch (payload.viewerKind) {
    case "markdown":
      return <MarkdownView source={content} className="file-viewer-markdown" />;
    case "document":
    case "spreadsheet":
    case "slides":
      return content
        ? <MarkdownView source={content} className="file-viewer-markdown" />
        : <FallbackBody payload={payload} message="该文档可用本地应用打开。" />;
    case "json":
      return <pre className="file-viewer-code"><code>{formatJson(content)}</code></pre>;
    case "table":
      return content ? <TablePreview content={content} ext={payload.ext} /> : <FallbackBody payload={payload} />;
    case "text":
    case "code":
      return <pre className="file-viewer-code"><code>{content}</code></pre>;
    case "image":
      return payload.previewUrl
        ? <div className="file-viewer-media-stage"><img src={payload.previewUrl} alt={payload.fileName} /></div>
        : <FallbackBody payload={payload} />;
    case "pdf":
      return payload.previewUrl
        ? <iframe className="file-viewer-pdf" title={payload.fileName} src={payload.previewUrl} />
        : <FallbackBody payload={payload} />;
    case "media":
      if (!payload.previewUrl) return <FallbackBody payload={payload} />;
      return payload.mimeType?.startsWith("video/")
        ? <div className="file-viewer-media-stage"><video src={payload.previewUrl} controls /></div>
        : <div className="file-viewer-media-stage"><audio src={payload.previewUrl} controls /></div>;
    case "archive":
    case "directory":
    case "unsupported":
    default:
      return <FallbackBody payload={payload} />;
  }
}

/** 渲染不支持内嵌预览时的元信息兜底界面。 */
function FallbackBody({ payload, message }: { payload: FileViewerPayload; message?: string }) {
  return (
    <section className="file-viewer-fallback">
      <FileQuestion size={32} aria-hidden />
      <h3>{payload.fileName}</h3>
      <p>{message ?? "当前格式不支持内嵌预览。"}</p>
      <dl>
        <div><dt>类型</dt><dd>{payload.ext || payload.viewerKind}</dd></div>
        <div><dt>大小</dt><dd>{formatBytes(payload.sizeBytes)}</dd></div>
      </dl>
    </section>
  );
}

/** 右侧文件阅览面板内容，承接 file_view 工具发送的结构化预览数据。 */
export default function FileViewerPanel({ data, isFullscreen = false, onExitFullscreen }: FileViewerPanelProps) {
  if (!isFileViewerPayload(data)) {
    return <div className="file-viewer-empty">无法加载文件预览</div>;
  }
  const payload = data;

  /** 调用系统默认应用打开当前文件。 */
  function handleOpenExternal() {
    void window.myClawAPI.fileViewerOpenExternal(payload.path);
  }

  /** 在系统文件管理器中定位当前文件。 */
  function handleReveal() {
    void window.myClawAPI.fileViewerReveal(payload.path);
  }

  /** 退出右侧文件预览全屏，并记录触发来源，便于排查全屏状态。 */
  function handleExitFullscreen() {
    console.info("[file-viewer] 退出文件预览全屏", { path: payload.path });
    onExitFullscreen?.();
  }

  return (
    <section className="file-viewer-panel" data-testid="file-viewer-panel">
      <header className="file-viewer-header">
        <div className="file-viewer-meta">
          <span>{data.viewerKind}</span>
          <span>{formatBytes(data.sizeBytes)}</span>
          {data.truncated && <span>已截断</span>}
        </div>
        <div className="file-viewer-actions">
          <button type="button" onClick={handleOpenExternal} title="用本地应用打开">
            <ExternalLink size={14} aria-hidden />
            <span>用本地应用打开</span>
          </button>
          <button type="button" onClick={handleReveal} title="定位文件">
            <FolderSearch size={14} aria-hidden />
            <span>定位文件</span>
          </button>
          {isFullscreen && onExitFullscreen && (
            <button
              type="button"
              className="file-viewer-fullscreen-exit"
              onClick={handleExitFullscreen}
              title="退出全屏"
              data-testid="file-viewer-fullscreen-exit"
            >
              <Minimize2 size={14} aria-hidden />
              <span>退出全屏</span>
            </button>
          )}
        </div>
      </header>
      <div className="file-viewer-path" title={data.path}>{data.path}</div>
      <main className="file-viewer-body">
        <FilePreviewBody payload={data} />
      </main>

      <style>{`
        .file-viewer-panel {
          min-height: 0;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-base);
          color: var(--text-primary);
        }

        .file-viewer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          min-height: 42px;
          padding: 8px 12px;
          border-bottom: 1px solid var(--glass-border);
          background: rgba(255, 255, 255, 0.025);
          flex-shrink: 0;
        }

        .file-viewer-meta,
        .file-viewer-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .file-viewer-meta span {
          display: inline-flex;
          align-items: center;
          height: 22px;
          padding: 0 8px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
        }

        .file-viewer-actions {
          flex-shrink: 0;
        }

        .file-viewer-actions button {
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 0 9px;
          border: 1px solid var(--glass-border);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.035);
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }

        .file-viewer-actions button:hover {
          background: rgba(255, 255, 255, 0.075);
          color: var(--text-primary);
        }

        .file-viewer-actions .file-viewer-fullscreen-exit {
          border-color: rgba(103, 232, 249, 0.22);
          background: rgba(103, 232, 249, 0.075);
          color: var(--text-primary);
        }

        .file-viewer-actions .file-viewer-fullscreen-exit:hover {
          border-color: rgba(103, 232, 249, 0.36);
          background: rgba(103, 232, 249, 0.13);
        }

        .file-viewer-path {
          flex-shrink: 0;
          padding: 8px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          color: var(--text-muted);
          font-family: "Cascadia Code", "Fira Code", ui-monospace, monospace;
          font-size: 11px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .file-viewer-body {
          flex: 1;
          min-height: 0;
          overflow: auto;
        }

        .file-viewer-markdown {
          width: min(100%, 880px);
          margin: 0 auto;
          padding: 26px 30px 42px;
          color: var(--text-primary);
          line-height: 1.72;
          font-size: 14px;
          overflow-wrap: break-word;
        }

        .file-viewer-markdown h1,
        .file-viewer-markdown h2,
        .file-viewer-markdown h3 {
          color: var(--text-primary);
          line-height: 1.25;
        }

        .file-viewer-markdown h1 { font-size: 24px; margin: 0 0 18px; }
        .file-viewer-markdown h2 { font-size: 19px; margin: 28px 0 12px; }
        .file-viewer-markdown h3 { font-size: 16px; margin: 22px 0 10px; }
        .file-viewer-markdown p,
        .file-viewer-markdown li,
        .file-viewer-markdown td { color: var(--text-secondary); }
        .file-viewer-markdown code {
          font-family: "Cascadia Code", "Fira Code", ui-monospace, monospace;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 5px;
          padding: 1px 5px;
          background: rgba(255, 255, 255, 0.055);
        }
        .file-viewer-markdown pre {
          padding: 14px 16px;
          overflow-x: auto;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(0, 0, 0, 0.28);
        }
        .file-viewer-markdown pre code {
          border: 0;
          padding: 0;
          background: transparent;
        }

        .file-viewer-code {
          margin: 0;
          min-height: 100%;
          padding: 16px 18px 36px;
          box-sizing: border-box;
          font-family: "Cascadia Code", "Fira Code", ui-monospace, monospace;
          font-size: 12px;
          line-height: 1.65;
          color: #d4d4d8;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .file-viewer-table-wrap {
          min-height: 100%;
          overflow: auto;
          padding: 14px;
          box-sizing: border-box;
        }

        .file-viewer-table {
          border-collapse: collapse;
          min-width: 100%;
          font-size: 12px;
        }

        .file-viewer-table th,
        .file-viewer-table td {
          max-width: 280px;
          padding: 8px 10px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: var(--text-secondary);
          text-align: left;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .file-viewer-table th {
          position: sticky;
          top: 0;
          background: var(--bg-sidebar);
          color: var(--text-primary);
          z-index: 1;
        }

        .file-viewer-media-stage {
          height: 100%;
          min-height: 260px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
          box-sizing: border-box;
          background: #0b0b0d;
        }

        .file-viewer-media-stage img,
        .file-viewer-media-stage video {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        .file-viewer-media-stage audio {
          width: min(100%, 460px);
        }

        .file-viewer-pdf {
          width: 100%;
          height: 100%;
          min-height: 520px;
          border: 0;
          background: #111;
        }

        .file-viewer-fallback,
        .file-viewer-empty {
          min-height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 28px;
          box-sizing: border-box;
          text-align: center;
          color: var(--text-muted);
        }

        .file-viewer-fallback h3 {
          margin: 0;
          color: var(--text-primary);
          font-size: 16px;
        }

        .file-viewer-fallback p {
          margin: 0;
          max-width: 42ch;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.6;
        }

        .file-viewer-fallback dl {
          display: grid;
          gap: 6px;
          margin: 0;
          font-size: 12px;
        }

        .file-viewer-fallback dl div {
          display: grid;
          grid-template-columns: 48px minmax(0, 1fr);
          gap: 8px;
          text-align: left;
        }

        .file-viewer-fallback dt {
          color: var(--text-muted);
        }

        .file-viewer-fallback dd {
          margin: 0;
          color: var(--text-secondary);
        }

        @media (max-width: 720px) {
          .file-viewer-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .file-viewer-actions {
            width: 100%;
          }

          .file-viewer-actions button {
            flex: 1;
          }

          .file-viewer-markdown {
            padding: 18px;
          }
        }
      `}</style>
    </section>
  );
}

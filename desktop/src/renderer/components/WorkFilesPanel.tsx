import { useEffect, useMemo } from "react";
import {
  Archive,
  Code,
  Database,
  FileText,
  Image as ImageIcon,
  Paperclip,
  ScrollText,
} from "lucide-react";

import type { ArtifactRecord, ArtifactScopeRef } from "@shared/contracts";

import { useWorkspaceStore } from "../stores/workspace";
import { formatRelativeTime } from "../utils/format-time";

type WorkFilesPanelProps = {
  scope: ArtifactScopeRef | null;
  title?: string;
  description?: string;
  mode?: "sidebar" | "page";
  emptyHint?: string;
};

/** 将字节数转换成更适合面板展示的文本。 */
function formatBytes(sizeBytes: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) return "未知大小";
  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

/** 将 artifact 类型映射成中文短标签。 */
function kindLabel(kind: ArtifactRecord["kind"]): string {
  return (
    {
      doc: "文档",
      image: "图片",
      code: "代码",
      dataset: "数据集",
      archive: "压缩包",
      log: "日志",
      other: "其他",
    } as Record<ArtifactRecord["kind"], string>
  )[kind] ?? kind;
}

/** 类型图标映射，使用 lucide 图标避免 emoji。 */
function KindIcon({ kind, size = 18 }: { kind: ArtifactRecord["kind"]; size?: number }) {
  const className = `wf-item__icon-svg wf-item__icon-svg--${kind}`;
  switch (kind) {
    case "doc":
      return <FileText size={size} className={className} aria-hidden />;
    case "image":
      return <ImageIcon size={size} className={className} aria-hidden />;
    case "code":
      return <Code size={size} className={className} aria-hidden />;
    case "dataset":
      return <Database size={size} className={className} aria-hidden />;
    case "archive":
      return <Archive size={size} className={className} aria-hidden />;
    case "log":
      return <ScrollText size={size} className={className} aria-hidden />;
    case "other":
    default:
      return <Paperclip size={size} className={className} aria-hidden />;
  }
}

/** 从 session 流事件中解析当前面板需要比对的会话 ID。 */
function readSessionStreamScopeId(event: Record<string, unknown>): string | null {
  if (typeof event.sessionId === "string") {
    return event.sessionId;
  }

  if (event.session && typeof event.session === "object" && typeof (event.session as { id?: unknown }).id === "string") {
    return (event.session as { id: string }).id;
  }

  if (
    event.approvalRequest
    && typeof event.approvalRequest === "object"
    && typeof (event.approvalRequest as { sessionId?: unknown }).sessionId === "string"
  ) {
    return (event.approvalRequest as { sessionId: string }).sessionId;
  }

  return null;
}

/** 仅让命中当前 session scope 的流事件触发工件重载。 */
function shouldReloadArtifactsForSessionEvent(scope: ArtifactScopeRef, event: Record<string, unknown>): boolean {
  if (scope.scopeKind !== "session") {
    return false;
  }
  return readSessionStreamScopeId(event) === scope.scopeId;
}

/** 渲染单个文件项。 */
function ArtifactItem({
  artifact,
}: {
  artifact: ArtifactRecord;
}) {
  const openArtifact = useWorkspaceStore((state) => state.openArtifact ?? (async () => undefined));
  const revealArtifact = useWorkspaceStore((state) => state.revealArtifact ?? (async () => undefined));

  return (
    <article className="wf-item">
      <div className="wf-item__icon">
        <KindIcon kind={artifact.kind} size={18} />
      </div>
      <div className="wf-item__body">
        <div className="wf-item__name">{artifact.title}</div>
        <div className="wf-item__meta">
          <span>{kindLabel(artifact.kind)}</span>
          <span>·</span>
          <span>{formatBytes(artifact.sizeBytes)}</span>
          <span>·</span>
          <span>{formatRelativeTime(artifact.updatedAt)}</span>
        </div>
      </div>
      <div className="wf-item__actions">
        <button type="button" className="btn-toolbar wf-btn-compact" onClick={() => void openArtifact(artifact.id)} title="打开文件">
          打开
        </button>
        <button type="button" className="btn-toolbar wf-btn-compact" onClick={() => void revealArtifact(artifact.id)} title="在文件管理器中定位">
          定位
        </button>
      </div>
    </article>
  );
}

/** 统一工作文件面板，可在聊天和员工页面复用。 */
export default function WorkFilesPanel({
  scope,
  title = "会话文件",
  description = "当前对话产生的文件",
  mode = "sidebar",
  emptyHint = "暂无文件——对话产生的文件会显示在这里",
}: WorkFilesPanelProps) {
  const artifactsByScope = useWorkspaceStore((state) => state.artifactsByScope ?? {});
  const loadArtifactsByScope = useWorkspaceStore(
    (state) => state.loadArtifactsByScope ?? (async () => []),
  );
  const applyArtifactEvent = useWorkspaceStore(
    (state) => state.applyArtifactEvent ?? (() => undefined),
  );

  const scopeKey = scope ? `${scope.scopeKind}:${scope.scopeId}` : null;
  const scopedArtifacts = useMemo(
    () => (scopeKey ? artifactsByScope[scopeKey] ?? [] : []),
    [artifactsByScope, scopeKey],
  );

  /** 按更新时间倒序排列。 */
  const sortedArtifacts = useMemo(
    () => [...scopedArtifacts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [scopedArtifacts],
  );

  useEffect(() => {
    if (!scope) return;
    void loadArtifactsByScope(scope);
  }, [loadArtifactsByScope, scope?.scopeId, scope?.scopeKind]);

  useEffect(() => {
    if (!scope) return;
    const unsubscribeSession = window.myClawAPI.onSessionStream((event) => {
      const type = typeof event.type === "string" ? event.type : "";
      if (type.startsWith("artifact.")) {
        applyArtifactEvent(event);
        void loadArtifactsByScope(scope);
        return;
      }
      if (
        type === "session.updated" ||
        type === "tasks.updated" ||
        type === "approval.requested" ||
        type === "approval.resolved"
      ) {
        if (!shouldReloadArtifactsForSessionEvent(scope, event)) {
          return;
        }
        void loadArtifactsByScope(scope);
      }
    });
    const unsubscribeWorkflow = window.myClawAPI.onWorkflowStream?.((event: unknown) => {
      const payload = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
      if (scope.scopeKind === "workflowRun" && payload.runId === scope.scopeId) {
        void loadArtifactsByScope(scope);
      }
    });
    return () => {
      unsubscribeSession();
      unsubscribeWorkflow?.();
    };
  }, [applyArtifactEvent, loadArtifactsByScope, scope?.scopeId, scope?.scopeKind]);

  return (
    <aside className={`wf-panel wf-panel--${mode}`} data-testid="work-files-panel">
      <div className="wf-panel__header">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>

      {sortedArtifacts.length === 0 ? (
        <section className="empty-state empty-state--minimal">
          <Paperclip size={32} className="empty-state__icon" aria-hidden />
          <p className="empty-state__body">{emptyHint}</p>
        </section>
      ) : (
        <div className="wf-list">
          {sortedArtifacts.map((artifact) => (
            <ArtifactItem key={artifact.id} artifact={artifact} />
          ))}
        </div>
      )}

      <style>{`
        .wf-panel { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
        .wf-panel--sidebar { width: 100%; max-width: 360px; flex-shrink: 0; border-left: 1px solid var(--glass-border); background: color-mix(in srgb, var(--bg-card) 88%, transparent); padding: 20px; overflow-y: auto; box-sizing: border-box; }
        .wf-panel--page { width: 100%; }
        .wf-panel__header h3 { margin: 0 0 4px; font-size: 16px; color: var(--text-primary); }
        .wf-panel__header p { margin: 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
        .wf-list { display: flex; flex-direction: column; gap: 8px; }
        .wf-item { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: var(--radius-lg); border: 1px solid var(--glass-border); background: rgba(255,255,255,0.03); }
        .wf-item__icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex-shrink: 0; color: var(--text-secondary); border-radius: var(--radius-sm); background: rgba(255,255,255,0.04); }
        .wf-item__icon-svg { display: block; }
        .wf-item__icon-svg--doc { color: var(--text-secondary); }
        .wf-item__icon-svg--image { color: var(--accent-cyan); }
        .wf-item__icon-svg--code { color: #8b5cf6; }
        .wf-item__icon-svg--dataset { color: #3b82f6; }
        .wf-item__icon-svg--archive { color: var(--status-yellow); }
        .wf-item__icon-svg--log { color: var(--text-muted); }
        .wf-item__icon-svg--other { color: var(--text-muted); }
        .wf-item__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .wf-item__name { color: var(--text-primary); font-size: 13px; font-weight: 600; line-height: 1.4; word-break: break-word; }
        .wf-item__meta { display: flex; flex-wrap: wrap; gap: 4px; color: var(--text-muted); font-size: 11px; }
        .wf-item__actions { display: flex; gap: 6px; flex-shrink: 0; margin-top: 2px; }
        .wf-btn-compact { height: 26px; padding: 0 10px; font-size: 11px; }
        @media (max-width: 1200px) {
          .wf-panel--sidebar { max-width: 320px; }
        }
      `}</style>
    </aside>
  );
}

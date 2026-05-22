import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Code,
  Database,
  FileText,
  Image as ImageIcon,
  Paperclip,
  ScrollText,
} from "lucide-react";

import { EventType, type ArtifactRecord, type ArtifactScopeRef } from "@shared/contracts";

import { useWorkspaceStore } from "../stores/workspace";
import { formatRelativeTime } from "../utils/format-time";

type WorkFilesPanelProps = {
  scope: ArtifactScopeRef | null;
  title?: string;
  description?: string;
  mode?: "sidebar" | "page";
  emptyHint?: string;
};

const WORK_FILES_ARTIFACT_RELOAD_DEBOUNCE_MS = 150;
const ARTIFACT_RELOAD_EVENT_TYPES = new Set<string>([
  EventType.ArtifactCreated,
  EventType.ArtifactUpdated,
  EventType.ArtifactCompleted,
  EventType.ArtifactFailed,
  EventType.ArtifactLinked,
  "artifact.changed",
  "artifact.deleted",
]);
const WORK_FILES_PANEL_DEBUG_LOGGING = resolveWorkFilesPanelDebugLogging();

/** 读取工作文件面板调试日志开关，默认关闭以免频繁 stream 事件刷屏。 */
function resolveWorkFilesPanelDebugLogging(): boolean {
  try {
    return globalThis.localStorage?.getItem("MYCLAW_DEBUG_WORK_FILES_PANEL") === "1";
  } catch {
    return false;
  }
}

/** 输出工作文件面板调试日志，仅在显式打开开关时进入 console。 */
function logWorkFilesPanelDebug(message: string, detail: Record<string, unknown>): void {
  if (!WORK_FILES_PANEL_DEBUG_LOGGING) {
    return;
  }
  console.debug(message, detail);
}

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

/** 判断 artifact stream 事件是否命中当前面板 scope。 */
function shouldReloadArtifactsForArtifactEvent(scope: ArtifactScopeRef, event: Record<string, unknown>): boolean {
  const type = typeof event.type === "string" ? event.type : "";
  const eventScopeKind = typeof event.scopeKind === "string"
    ? event.scopeKind
    : typeof event.sessionId === "string"
      ? "session"
      : typeof event.runId === "string"
        ? "workflowRun"
        : null;
  const eventScopeId = typeof event.scopeId === "string"
    ? event.scopeId
    : typeof event.sessionId === "string"
      ? event.sessionId
      : typeof event.runId === "string"
        ? event.runId
        : null;
  const shouldReload = (
    eventScopeKind === scope.scopeKind
    && eventScopeId === scope.scopeId
    && ARTIFACT_RELOAD_EVENT_TYPES.has(type)
  );
  if (!shouldReload) {
    logWorkFilesPanelDebug("[work-files-panel] 已忽略非当前 scope 的 artifact 事件", {
      scopeKind: scope.scopeKind,
      scopeId: scope.scopeId,
      eventScopeKind,
      eventScopeId,
      eventType: type,
      runId: typeof event.runId === "string" ? event.runId : null,
    });
  }
  return shouldReload;
}

/** 渲染单个文件项。 */
function ArtifactItem({
  artifact,
}: {
  artifact: ArtifactRecord;
}) {
  const revealArtifact = useWorkspaceStore((state) => state.revealArtifact ?? (async () => undefined));
  const openWebPanel = useWorkspaceStore((state) => state.openWebPanel);
  const applyArtifactEvent = useWorkspaceStore((state) => state.applyArtifactEvent ?? (() => undefined));
  const myClawRootPath = useWorkspaceStore((state) => state.myClawRootPath);
  const artifactsRootPath = useWorkspaceStore((state) => state.artifactsRootPath);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");

  /** 点击工作文件时打开右侧预览面板，避免把 md/doc 等文件直接丢给系统外部应用。 */
  async function handlePreviewArtifact(): Promise<void> {
    const baseDirectory = artifact.storageClass === "artifact"
      ? artifactsRootPath ?? myClawRootPath
      : myClawRootPath;
    const candidateBaseDirectories = [artifactsRootPath, myClawRootPath].filter((path): path is string => Boolean(path));
    console.info("[work-files-panel] 用户请求预览工作文件", {
      artifactId: artifact.id,
      relativePath: artifact.relativePath,
      baseDirectory: baseDirectory ?? null,
    });
    setPreviewState("loading");
    try {
      const result = await window.myClawAPI.fileViewerPreview({
        path: artifact.relativePath,
        baseDirectory: baseDirectory ?? null,
        candidateBaseDirectories,
      });
      if (!result.success || !result.viewMeta) {
        console.warn("[work-files-panel] 工作文件预览失败", {
          artifactId: artifact.id,
          relativePath: artifact.relativePath,
          error: result.error ?? "主进程未返回预览面板数据",
        });
        setPreviewState("error");
        return;
      }

      openWebPanel(result.viewMeta.viewPath, result.viewMeta.title, result.viewMeta.data);
      applyArtifactEvent({
        type: "artifact.updated",
        artifact: {
          ...artifact,
          lastOpenedAt: new Date().toISOString(),
          openCount: (artifact.openCount ?? 0) + 1,
        },
      });
      console.info("[work-files-panel] 已打开右侧工作文件预览", {
        artifactId: artifact.id,
        title: result.viewMeta.title,
      });
      setPreviewState("idle");
    } catch (error) {
      console.error("[work-files-panel] 工作文件预览异常", {
        artifactId: artifact.id,
        relativePath: artifact.relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
      setPreviewState("error");
    }
  }

  return (
    <article className="wf-item">
      <div className="wf-item__icon">
        <KindIcon kind={artifact.kind} size={18} />
      </div>
      <div className="wf-item__body">
        <button
          type="button"
          className="wf-item__name wf-item__name-button"
          onClick={() => void handlePreviewArtifact()}
          title={`打开右侧预览：${artifact.title}`}
          disabled={previewState === "loading"}
        >
          {artifact.title}
        </button>
        <div className="wf-item__meta">
          <span>{kindLabel(artifact.kind)}</span>
          <span>·</span>
          <span>{formatBytes(artifact.sizeBytes)}</span>
          <span>·</span>
          <span>{formatRelativeTime(artifact.updatedAt)}</span>
        </div>
      </div>
      <div className="wf-item__actions">
        <button
          type="button"
          className="btn-toolbar wf-btn-compact"
          onClick={() => void handlePreviewArtifact()}
          title={previewState === "error" ? "预览失败，请检查文件是否还存在" : "打开右侧预览"}
          disabled={previewState === "loading"}
        >
          {previewState === "loading" ? "打开中" : "打开"}
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

  const scopeKind = scope?.scopeKind ?? null;
  const scopeId = scope?.scopeId ?? null;
  const stableScope = useMemo<ArtifactScopeRef | null>(
    () => (scopeKind && scopeId ? { scopeKind, scopeId } : null),
    [scopeId, scopeKind],
  );
  const scopeKey = stableScope ? `${stableScope.scopeKind}:${stableScope.scopeId}` : null;
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
    if (!stableScope) return;
    void loadArtifactsByScope(stableScope);
  }, [loadArtifactsByScope, stableScope]);

  useEffect(() => {
    if (!stableScope) return;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    /** 合并短时间内的 artifact 刷新请求，避免 workflow 高频事件触发重复加载。 */
    const scheduleArtifactReload = (reason: string): void => {
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }
      logWorkFilesPanelDebug("[work-files-panel] 已计划刷新工作文件列表", {
        scopeKind: stableScope.scopeKind,
        scopeId: stableScope.scopeId,
        reason,
      });
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void loadArtifactsByScope(stableScope);
      }, WORK_FILES_ARTIFACT_RELOAD_DEBOUNCE_MS);
    };
    const unsubscribeSession = window.myClawAPI.onSessionStream((event) => {
      const type = typeof event.type === "string" ? event.type : "";
      if (ARTIFACT_RELOAD_EVENT_TYPES.has(type)) {
        if (shouldReloadArtifactsForArtifactEvent(stableScope, event)) {
          applyArtifactEvent(event);
          scheduleArtifactReload(`session:${type}`);
        }
        return;
      }
      logWorkFilesPanelDebug("[work-files-panel] 已忽略非 artifact 变更 session 事件", {
        scopeKind: stableScope.scopeKind,
        scopeId: stableScope.scopeId,
        eventType: type,
      });
    });
    const unsubscribeWorkflow = window.myClawAPI.onWorkflowStream?.((event: unknown) => {
      const payload = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
      if (shouldReloadArtifactsForArtifactEvent(stableScope, payload)) {
        scheduleArtifactReload(`workflow:${String(payload.type)}`);
      }
    });
    return () => {
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }
      unsubscribeSession();
      unsubscribeWorkflow?.();
    };
  }, [applyArtifactEvent, loadArtifactsByScope, stableScope]);

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
        .wf-item__name-button { width: fit-content; max-width: 100%; padding: 0; border: 0; background: transparent; text-align: left; cursor: pointer; }
        .wf-item__name-button:hover,
        .wf-item__name-button:focus-visible { color: var(--accent-cyan); text-decoration: underline; text-underline-offset: 2px; outline: none; }
        .wf-item__name-button:disabled { cursor: progress; opacity: 0.7; text-decoration: none; }
        @media (max-width: 1200px) {
          .wf-panel--sidebar { max-width: 320px; }
        }
      `}</style>
    </aside>
  );
}

import { useEffect, useMemo } from "react";
import { Link, useInRouterContext } from "react-router-dom";

import type { ArtifactRecord, ArtifactScopeRef } from "@shared/contracts";

import { useWorkspaceStore } from "../stores/workspace";

type WorkFilesPanelProps = {
  scope: ArtifactScopeRef | null;
  title?: string;
  description?: string;
  mode?: "sidebar" | "page";
  allowGlobalJump?: boolean;
  emptyHint?: string;
};

/** 将字节数转换成更适合面板展示的文本。 */
function formatBytes(sizeBytes: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

/** 将 artifact 生命周期映射成稳定的展示标签。 */
function lifecycleLabel(lifecycle: ArtifactRecord["lifecycle"]): string {
  return (
    {
      working: "Working",
      ready: "Ready",
      final: "Final",
      superseded: "Superseded",
      archived: "Archived",
      failed: "Failed",
    } as Record<ArtifactRecord["lifecycle"], string>
  )[lifecycle] ?? lifecycle;
}

/** 将 artifact 类型映射成面板短标签。 */
function kindLabel(kind: ArtifactRecord["kind"]): string {
  return (
    {
      doc: "Doc",
      image: "Image",
      code: "Code",
      dataset: "Dataset",
      archive: "Archive",
      log: "Log",
      other: "Other",
    } as Record<ArtifactRecord["kind"], string>
  )[kind] ?? kind;
}

/** 按当前展示视图把工作文件拆成几个高频分组。 */
function splitArtifacts(artifacts: ArtifactRecord[]) {
  const sorted = [...artifacts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return {
    justNow: sorted.slice(0, 6),
    finals: sorted.filter((item) => item.lifecycle === "final"),
    working: sorted.filter((item) => item.lifecycle === "working" || item.lifecycle === "ready"),
    archived: sorted.filter((item) => item.lifecycle === "archived" || item.lifecycle === "superseded"),
  };
}

/** 渲染单个工作文件卡片，并统一提供打开、定位和提升操作。 */
function ArtifactCard({
  artifact,
  scope,
}: {
  artifact: ArtifactRecord;
  scope: ArtifactScopeRef | null;
}) {
  const openArtifact = useWorkspaceStore((state) => state.openArtifact ?? (async () => undefined));
  const revealArtifact = useWorkspaceStore((state) => state.revealArtifact ?? (async () => undefined));
  const markArtifactFinal = useWorkspaceStore((state) => state.markArtifactFinal ?? (async () => undefined));

  return (
    <article className="work-files-card">
      <div className="work-files-card__main">
        <div className="work-files-card__title-row">
          <strong>{artifact.title}</strong>
          <span className={`work-files-chip work-files-chip--${artifact.lifecycle}`}>
            {lifecycleLabel(artifact.lifecycle)}
          </span>
        </div>
        <div className="work-files-card__meta">
          <span>{kindLabel(artifact.kind)}</span>
          <span>{formatBytes(artifact.sizeBytes)}</span>
          <span>{artifact.relativePath}</span>
        </div>
      </div>
      <div className="work-files-card__actions">
        <button type="button" className="work-files-btn" onClick={() => void openArtifact(artifact.id)}>
          Open
        </button>
        <button type="button" className="work-files-btn" onClick={() => void revealArtifact(artifact.id)}>
          Reveal
        </button>
        {artifact.lifecycle !== "final" && (
          <button
            type="button"
            className="work-files-btn work-files-btn--primary"
            onClick={() => void markArtifactFinal(artifact.id, scope ?? undefined)}
          >
            Mark Final
          </button>
        )}
      </div>
    </article>
  );
}

/** 统一工作文件面板，可在聊天、workflow 和员工页面复用。 */
export default function WorkFilesPanel({
  scope,
  title = "Work Files",
  description = "Recent outputs, drafts, and deliverables for the current scope.",
  mode = "sidebar",
  allowGlobalJump = true,
  emptyHint = "No indexed files in this scope yet.",
}: WorkFilesPanelProps) {
  const artifactsByScope = useWorkspaceStore((state) => state.artifactsByScope ?? {});
  const loadArtifactsByScope = useWorkspaceStore(
    (state) => state.loadArtifactsByScope ?? (async () => []),
  );
  const applyArtifactEvent = useWorkspaceStore(
    (state) => state.applyArtifactEvent ?? (() => undefined),
  );
  const hasRouterContext = useInRouterContext();

  const scopeKey = scope ? `${scope.scopeKind}:${scope.scopeId}` : null;
  const scopedArtifacts = useMemo(
    () => (scopeKey ? artifactsByScope[scopeKey] ?? [] : []),
    [artifactsByScope, scopeKey],
  );
  const sections = useMemo(() => splitArtifacts(scopedArtifacts), [scopedArtifacts]);

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
    <aside className={`work-files-panel work-files-panel--${mode}`} data-testid="work-files-panel">
      <div className="work-files-panel__header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {allowGlobalJump && hasRouterContext ? (
          <Link to="/files" className="work-files-link">
            View All
          </Link>
        ) : null}
      </div>

      {scopedArtifacts.length === 0 ? (
        <div className="work-files-empty">{emptyHint}</div>
      ) : (
        <div className="work-files-sections">
          {sections.justNow.length > 0 && (
            <section className="work-files-section">
              <div className="work-files-section__title">Just Now</div>
              <div className="work-files-stack">
                {sections.justNow.map((artifact) => (
                  <ArtifactCard key={`just-${artifact.id}`} artifact={artifact} scope={scope} />
                ))}
              </div>
            </section>
          )}

          {sections.finals.length > 0 && (
            <section className="work-files-section">
              <div className="work-files-section__title">Final Deliverables</div>
              <div className="work-files-stack">
                {sections.finals.map((artifact) => (
                  <ArtifactCard key={`final-${artifact.id}`} artifact={artifact} scope={scope} />
                ))}
              </div>
            </section>
          )}

          {sections.working.length > 0 && (
            <section className="work-files-section">
              <div className="work-files-section__title">Working Files</div>
              <div className="work-files-stack">
                {sections.working.map((artifact) => (
                  <ArtifactCard key={`working-${artifact.id}`} artifact={artifact} scope={scope} />
                ))}
              </div>
            </section>
          )}

          {sections.archived.length > 0 && (
            <section className="work-files-section">
              <div className="work-files-section__title">Archived</div>
              <div className="work-files-stack">
                {sections.archived.map((artifact) => (
                  <ArtifactCard key={`archived-${artifact.id}`} artifact={artifact} scope={scope} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <style>{`
        .work-files-panel { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        .work-files-panel--sidebar { width: 100%; max-width: 360px; flex-shrink: 0; border-left: 1px solid var(--glass-border); background: color-mix(in srgb, var(--bg-card) 88%, transparent); padding: 20px; overflow-y: auto; box-sizing: border-box; }
        .work-files-panel--page { width: 100%; }
        .work-files-panel__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
        .work-files-panel__header h3 { margin: 0 0 4px; font-size: 16px; color: var(--text-primary); }
        .work-files-panel__header p { margin: 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
        .work-files-link { color: var(--accent-cyan); text-decoration: none; font-size: 12px; font-weight: 700; }
        .work-files-link:hover { text-decoration: underline; }
        .work-files-empty { padding: 18px; border-radius: 16px; border: 1px dashed var(--glass-border); color: var(--text-muted); font-size: 13px; background: rgba(255,255,255,0.03); }
        .work-files-sections { display: flex; flex-direction: column; gap: 18px; }
        .work-files-section { display: flex; flex-direction: column; gap: 10px; }
        .work-files-section__title { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; color: var(--text-muted); text-transform: uppercase; }
        .work-files-stack { display: flex; flex-direction: column; gap: 10px; }
        .work-files-card { display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 16px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.03); }
        .work-files-card__main { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
        .work-files-card__title-row { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
        .work-files-card__title-row strong { color: var(--text-primary); font-size: 14px; line-height: 1.4; word-break: break-word; }
        .work-files-card__meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--text-muted); font-size: 11px; }
        .work-files-chip { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--glass-border); font-size: 11px; font-weight: 700; white-space: nowrap; }
        .work-files-chip--final { color: #86efac; border-color: rgba(34,197,94,0.24); background: rgba(34,197,94,0.08); }
        .work-files-chip--working, .work-files-chip--ready { color: #7dd3fc; border-color: rgba(56,189,248,0.24); background: rgba(56,189,248,0.08); }
        .work-files-chip--failed { color: #fca5a5; border-color: rgba(248,113,113,0.24); background: rgba(248,113,113,0.08); }
        .work-files-chip--archived, .work-files-chip--superseded { color: var(--text-muted); }
        .work-files-card__actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .work-files-btn { padding: 7px 12px; border-radius: 10px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 700; cursor: pointer; }
        .work-files-btn:hover { background: rgba(255,255,255,0.06); color: var(--text-primary); }
        .work-files-btn--primary { border-color: rgba(16,163,127,0.3); color: var(--accent-cyan); }
        @media (max-width: 1200px) {
          .work-files-panel--sidebar { max-width: 320px; }
        }
      `}</style>
    </aside>
  );
}

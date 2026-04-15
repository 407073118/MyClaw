import { useEffect, useMemo } from "react";

import type { ArtifactRecord } from "@shared/contracts";

import { useWorkspaceStore } from "../stores/workspace";

/** 将 artifact 类型映射成页面里的短标签。 */
function artifactKindLabel(kind: ArtifactRecord["kind"]): string {
  return ({
    doc: "文档",
    image: "图片",
    code: "代码",
    dataset: "数据集",
    archive: "压缩包",
    log: "日志",
    other: "其他",
  } as Record<ArtifactRecord["kind"], string>)[kind] ?? kind;
}

/** 将 artifact 生命周期映射成统一标签。 */
function artifactLifecycleLabel(lifecycle: ArtifactRecord["lifecycle"]): string {
  return ({
    working: "处理中",
    ready: "就绪",
    final: "最终稿",
    superseded: "已替代",
    archived: "已归档",
    failed: "失败",
  } as Record<ArtifactRecord["lifecycle"], string>)[lifecycle] ?? lifecycle;
}

/** 将 artifact 存储位置映射成统一标签。 */
function artifactStorageClassLabel(storageClass: ArtifactRecord["storageClass"]): string {
  return ({
    workspace: "工作区",
    artifact: "产物区",
    cache: "缓存区",
  } as Record<ArtifactRecord["storageClass"], string>)[storageClass] ?? storageClass;
}

/** 全局 Files 工作台，承载跨任务的最近产出与本地资产回看。 */
export default function FilesWorkspacePage() {
  const loadRecentArtifacts = useWorkspaceStore((state) => state.loadRecentArtifacts);
  const openArtifact = useWorkspaceStore((state) => state.openArtifact);
  const revealArtifact = useWorkspaceStore((state) => state.revealArtifact);
  const recentArtifacts = useWorkspaceStore((state) => state.recentArtifacts);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const artifactsRootPath = useWorkspaceStore((state) => state.artifactsRootPath);
  const cacheRootPath = useWorkspaceStore((state) => state.cacheRootPath);

  useEffect(() => {
    void loadRecentArtifacts({ limit: 60 });
  }, [loadRecentArtifacts]);

  useEffect(() => {
    const unsubscribe = window.myClawAPI.onSessionStream((event) => {
      if (typeof event.type === "string" && event.type.startsWith("artifact.")) {
        void loadRecentArtifacts({ limit: 60 });
      }
    });
    return () => unsubscribe();
  }, [loadRecentArtifacts]);

  const stats = useMemo(() => {
    const finalCount = recentArtifacts.filter((item) => item.lifecycle === "final").length;
    const workingCount = recentArtifacts.filter((item) => item.lifecycle === "working" || item.lifecycle === "ready").length;
    const failedCount = recentArtifacts.filter((item) => item.lifecycle === "failed").length;
    return { total: recentArtifacts.length, finalCount, workingCount, failedCount };
  }, [recentArtifacts]);

  return (
    <main data-testid="files-workspace-view" className="files-workspace page-container">
      <header className="page-header files-page-header">
        <div className="header-text">
          <span className="eyebrow">文件工作台</span>
          <h2 className="page-title">工作文件</h2>
          <p className="page-subtitle">在这里查看最近产出的文件、草稿、交付物，以及支撑整个文件体系的本地目录。</p>
        </div>
        <div className="header-actions files-stats" aria-label="文件工作台统计">
          <div className="files-stat"><strong>{stats.total}</strong><span>最近文件</span></div>
          <div className="files-stat"><strong>{stats.finalCount}</strong><span>最终稿</span></div>
          <div className="files-stat"><strong>{stats.workingCount}</strong><span>处理中</span></div>
          <div className="files-stat"><strong>{stats.failedCount}</strong><span>失败</span></div>
        </div>
      </header>

      <section className="files-roots">
        {workspaceRootPath && <div className="files-root-card"><span>工作区目录</span><code>{workspaceRootPath}</code></div>}
        {artifactsRootPath && <div className="files-root-card"><span>产物目录</span><code>{artifactsRootPath}</code></div>}
        {cacheRootPath && <div className="files-root-card"><span>缓存目录</span><code>{cacheRootPath}</code></div>}
      </section>

      <section className="files-list-card">
        <div className="files-list-header">
          <h2>最近输出</h2>
          <button type="button" className="files-refresh-btn" onClick={() => void loadRecentArtifacts({ limit: 60 })}>
            刷新
          </button>
        </div>

        {recentArtifacts.length === 0 ? (
          <div className="files-empty">暂时还没有已索引的输出。聊天、工作流或硅基员工产生受管文件后，会自动显示在这里。</div>
        ) : (
          <div className="files-list">
            {recentArtifacts.map((artifact) => (
              <article key={artifact.id} className="files-row">
                <div className="files-row__main">
                  <div className="files-row__title">
                    <strong>{artifact.title}</strong>
                    <span className={`files-chip files-chip--${artifact.lifecycle}`}>{artifactLifecycleLabel(artifact.lifecycle)}</span>
                  </div>
                  <div className="files-row__meta">
                    <span>{artifactKindLabel(artifact.kind)}</span>
                    <span>{artifactStorageClassLabel(artifact.storageClass)}</span>
                    <span>{artifact.relativePath}</span>
                    {artifact.lastOpenedAt && <span>上次打开：{artifact.lastOpenedAt}</span>}
                  </div>
                </div>
                <div className="files-row__actions">
                  <button type="button" className="files-action" onClick={() => void openArtifact(artifact.id)}>打开</button>
                  <button type="button" className="files-action" onClick={() => void revealArtifact(artifact.id)}>定位</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <style>{`
        .files-workspace { flex: 1; min-width: 0; height: 100%; overflow-y: auto; background: var(--bg-base); color: var(--text-primary); }
        .files-page-header { align-items: flex-start; }
        .files-stats { display: grid; grid-template-columns: repeat(4, minmax(96px, 1fr)); gap: 12px; min-width: 420px; padding-bottom: 0; }
        .files-stat { padding: 16px; border-radius: 16px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.03); display: flex; flex-direction: column; gap: 6px; }
        .files-stat strong { font-size: 24px; color: var(--text-primary); }
        .files-stat span { font-size: 12px; color: var(--text-muted); }
        .files-roots { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 12px; }
        .files-root-card { padding: 16px; border-radius: 16px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.03); display: flex; flex-direction: column; gap: 8px; }
        .files-root-card span { font-size: 12px; font-weight: 700; color: var(--text-secondary); }
        .files-root-card code { color: var(--text-muted); font-size: 12px; white-space: pre-wrap; word-break: break-all; }
        .files-list-card { display: flex; flex-direction: column; gap: 16px; padding: 22px; border-radius: 20px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.03); }
        .files-list-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .files-list-header h2 { margin: 0; font-size: 18px; }
        .files-refresh-btn, .files-action { padding: 8px 14px; border-radius: 10px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 12px; font-weight: 700; }
        .files-refresh-btn:hover, .files-action:hover { background: rgba(255,255,255,0.06); color: var(--text-primary); }
        .files-empty { padding: 18px; border-radius: 16px; border: 1px dashed var(--glass-border); color: var(--text-muted); line-height: 1.6; }
        .files-list { display: flex; flex-direction: column; gap: 12px; }
        .files-row { display: flex; justify-content: space-between; gap: 18px; padding: 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.06); background: rgba(0,0,0,0.14); }
        .files-row__main { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
        .files-row__title { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .files-row__title strong { font-size: 15px; color: var(--text-primary); }
        .files-row__meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--text-muted); font-size: 12px; }
        .files-row__actions { display: flex; gap: 8px; align-items: flex-start; flex-shrink: 0; }
        .files-chip { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--glass-border); font-size: 11px; font-weight: 800; }
        .files-chip--final { color: #86efac; border-color: rgba(34,197,94,0.24); background: rgba(34,197,94,0.08); }
        .files-chip--working, .files-chip--ready { color: #7dd3fc; border-color: rgba(56,189,248,0.24); background: rgba(56,189,248,0.08); }
        .files-chip--failed { color: #fca5a5; border-color: rgba(248,113,113,0.24); background: rgba(248,113,113,0.08); }
        @media (max-width: 1100px) {
          .files-page-header { flex-direction: column; }
          .files-stats { min-width: 0; width: 100%; grid-template-columns: repeat(2, minmax(140px, 1fr)); }
          .files-roots { grid-template-columns: 1fr; }
          .files-row { flex-direction: column; }
        }
      `}</style>
    </main>
  );
}

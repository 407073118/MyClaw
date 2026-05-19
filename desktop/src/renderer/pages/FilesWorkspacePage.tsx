import { useEffect, useMemo, useState } from "react";

import type { ArtifactRecord } from "@shared/contracts";

import { useWorkspaceStore } from "../stores/workspace";
import { Check, ExternalLink, FileText, FolderOpen, MapPin, Pencil, RefreshCw, X } from "lucide-react";

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
  const updateArtifactsRootPath = useWorkspaceStore((state) => state.updateArtifactsRootPath);
  const recentArtifacts = useWorkspaceStore((state) => state.recentArtifacts);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const artifactsRootPath = useWorkspaceStore((state) => state.artifactsRootPath);
  const cacheRootPath = useWorkspaceStore((state) => state.cacheRootPath);
  const [isEditingArtifactsPath, setIsEditingArtifactsPath] = useState(false);
  const [artifactsPathDraft, setArtifactsPathDraft] = useState("");
  const [artifactsPathSaving, setArtifactsPathSaving] = useState(false);
  const [artifactsPathError, setArtifactsPathError] = useState<string | null>(null);

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

  const rootEntries = useMemo(
    () =>
      [
        { id: "workspace", label: "工作区目录", path: workspaceRootPath, openLabel: "打开工作区目录文件夹" },
        { id: "artifact", label: "产物目录", path: artifactsRootPath, openLabel: "打开产物目录文件夹" },
        { id: "cache", label: "缓存目录", path: cacheRootPath, openLabel: "打开缓存目录文件夹" },
      ].filter((entry): entry is { id: string; label: string; path: string; openLabel: string } => Boolean(entry.path)),
    [artifactsRootPath, cacheRootPath, workspaceRootPath],
  );

  /** 开始编辑产物目录，使用当前展示路径作为草稿。 */
  function startEditArtifactsPath(path: string): void {
    setArtifactsPathDraft(path);
    setArtifactsPathError(null);
    setIsEditingArtifactsPath(true);
  }

  /** 取消产物目录编辑，保留当前已经生效的运行时路径。 */
  function cancelEditArtifactsPath(): void {
    setArtifactsPathDraft("");
    setArtifactsPathError(null);
    setIsEditingArtifactsPath(false);
  }

  /** 保存新的产物目录，并同步给主进程运行时和持久化设置。 */
  async function saveArtifactsPath(): Promise<void> {
    const nextPath = artifactsPathDraft.trim();
    if (!nextPath) {
      setArtifactsPathError("产物目录路径不能为空。");
      return;
    }

    setArtifactsPathSaving(true);
    setArtifactsPathError(null);
    try {
      await updateArtifactsRootPath(nextPath);
      setIsEditingArtifactsPath(false);
    } catch (error) {
      setArtifactsPathError(error instanceof Error ? error.message : String(error));
    } finally {
      setArtifactsPathSaving(false);
    }
  }

  return (
    <div data-testid="files-workspace-view" className="page-shell files-workspace">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <FileText size={14} />
            <span>Files</span>
          </div>
          <h2 className="page-header__title">工作文件</h2>
          <p className="page-header__subtitle">查看最近产出的文件、草稿、交付物，以及支撑文件体系的本地目录。</p>
        </div>
        <div className="page-header__actions files-header-actions" aria-label="文件工作台统计">
          <span className="files-summary-chip"><strong>{stats.total}</strong><span>最近文件</span></span>
          <span className="files-summary-chip"><strong>{stats.finalCount}</strong><span>最终稿</span></span>
          <span className="files-summary-chip"><strong>{stats.workingCount}</strong><span>处理中</span></span>
          <span className="files-summary-chip"><strong>{stats.failedCount}</strong><span>失败</span></span>
          <button type="button" className="btn-toolbar" onClick={() => void loadRecentArtifacts({ limit: 60 })}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </header>

      <main className="page-content files-content">
        {rootEntries.length > 0 && (
          <section className="files-section" aria-labelledby="files-roots-title">
            <header className="files-section-header">
              <div>
                <h3 id="files-roots-title">本地目录</h3>
                <p>这些目录用于落盘、索引和回看受管文件。</p>
              </div>
            </header>
            <div className="list-rows">
              {rootEntries.map((entry) => {
                const isArtifactEntry = entry.id === "artifact";
                const isEditingThisEntry = isArtifactEntry && isEditingArtifactsPath;
                return (
                  <article key={entry.id} className="list-row list-row--with-description">
                    <div className="list-row__lead">
                      <FolderOpen size={16} className="files-row-icon" />
                    </div>
                    <div className="list-row__main">
                      <div className="list-row__title-row">
                        <span className="list-row__title">{entry.label}</span>
                        <span className="tag tag--muted">{entry.id}</span>
                      </div>
                      {isEditingThisEntry ? (
                        <div className="files-path-editor">
                          <label className="files-path-editor__label" htmlFor="files-artifacts-path-input">产物目录路径</label>
                          <input
                            id="files-artifacts-path-input"
                            className="files-path-input"
                            value={artifactsPathDraft}
                            onChange={(event) => setArtifactsPathDraft(event.currentTarget.value)}
                            disabled={artifactsPathSaving}
                          />
                          {artifactsPathError && <div className="files-path-error" role="alert">{artifactsPathError}</div>}
                        </div>
                      ) : (
                        <code className="files-path">{entry.path}</code>
                      )}
                    </div>
                    <div className="list-row__trailing files-row-actions">
                      <button
                        type="button"
                        className="btn-toolbar"
                        aria-label={entry.openLabel}
                        onClick={() => void window.myClawAPI.openLocalDirectory(entry.path)}
                      >
                        <FolderOpen size={14} />
                        打开文件夹
                      </button>
                      {isArtifactEntry && (
                        isEditingThisEntry ? (
                          <>
                            <button
                              type="button"
                              className="btn-toolbar"
                              aria-label="保存产物目录"
                              onClick={() => void saveArtifactsPath()}
                              disabled={artifactsPathSaving}
                            >
                              <Check size={14} />
                              保存
                            </button>
                            <button
                              type="button"
                              className="btn-toolbar"
                              aria-label="取消修改产物目录"
                              onClick={cancelEditArtifactsPath}
                              disabled={artifactsPathSaving}
                            >
                              <X size={14} />
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn-toolbar"
                            aria-label="修改产物目录"
                            onClick={() => startEditArtifactsPath(entry.path)}
                          >
                            <Pencil size={14} />
                            修改
                          </button>
                        )
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <section className="files-section" aria-labelledby="files-recent-title">
          <header className="files-section-header">
            <div>
              <h3 id="files-recent-title">最近输出</h3>
              <p>聊天、工作流或硅基员工产生受管文件后，会自动显示在这里。</p>
            </div>
          </header>

          {recentArtifacts.length === 0 ? (
            <section className="empty-state empty-state--minimal">
              <FileText size={32} className="empty-state__icon" />
              <h3 className="empty-state__title">暂时还没有已索引的输出</h3>
              <p className="empty-state__body">产生受管文件后，会自动显示在这里。</p>
            </section>
          ) : (
            <div className="list-rows">
              {recentArtifacts.map((artifact) => {
                const dotVariant = artifact.lifecycle === "failed" ? "red" : artifact.lifecycle === "final" ? "green" : "accent";
                const tagVariant = artifact.lifecycle === "failed" ? "red" : artifact.lifecycle === "final" ? "green" : "accent";
                return (
                <article key={artifact.id} className="list-row list-row--with-description">
                  <div className="list-row__lead">
                    <span className={`status-dot status-dot--${dotVariant}`} />
                  </div>
                  <div className="list-row__main">
                    <div className="list-row__title-row">
                      <span className="list-row__title">{artifact.title}</span>
                      <span className={`tag tag--${tagVariant}`}>{artifactLifecycleLabel(artifact.lifecycle)}</span>
                    </div>
                    <div className="list-row__description">{artifact.relativePath}</div>
                    <div className="list-row__meta-row">
                      <span className="list-row__meta">{artifactKindLabel(artifact.kind)}</span>
                      <span className="list-row__meta-sep" />
                      <span className="list-row__meta">{artifactStorageClassLabel(artifact.storageClass)}</span>
                      <span className="list-row__meta-sep" />
                      <span className="list-row__meta">更新于 {artifact.updatedAt}</span>
                      {artifact.lastOpenedAt && (
                        <>
                          <span className="list-row__meta-sep" />
                          <span className="list-row__meta">上次打开：{artifact.lastOpenedAt}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="list-row__trailing files-row-actions">
                    <button type="button" className="btn-toolbar" onClick={() => void openArtifact(artifact.id)}>
                      <ExternalLink size={14} />
                      打开
                    </button>
                    <button type="button" className="btn-toolbar" onClick={() => void revealArtifact(artifact.id)}>
                      <MapPin size={14} />
                      定位
                    </button>
                  </div>
                </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <style>{`
        .files-header-actions { flex-wrap: wrap; justify-content: flex-end; }
        .files-summary-chip { display: inline-flex; align-items: baseline; gap: 6px; padding: 6px 9px; border: 1px solid var(--row-border); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-muted); font-size: 11px; font-weight: 700; }
        .files-summary-chip strong { color: var(--text-primary); font-size: 15px; }
        .files-content { display: flex; flex-direction: column; gap: 24px; }
        .files-section { display: flex; flex-direction: column; gap: 12px; }
        .files-section-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
        .files-section-header h3 { margin: 0; color: var(--text-primary); font-size: 15px; font-weight: 700; }
        .files-section-header p { margin: 4px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
        .files-row-icon { color: var(--text-muted); }
        .files-path { color: var(--text-muted); font-size: 12px; white-space: pre-wrap; word-break: break-all; font-family: "Cascadia Code", "Fira Code", ui-monospace, monospace; }
        .files-path-editor { display: flex; flex-direction: column; gap: 6px; max-width: 760px; }
        .files-path-editor__label { color: var(--text-muted); font-size: 11px; font-weight: 700; }
        .files-path-input { width: 100%; min-height: 34px; border: 1px solid var(--row-border); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text-primary); padding: 7px 9px; font-family: "Cascadia Code", "Fira Code", ui-monospace, monospace; font-size: 12px; }
        .files-path-error { color: #f87171; font-size: 12px; line-height: 1.45; }
        .files-row-actions { gap: 8px; }
        @media (max-width: 1100px) {
          .files-header-actions { justify-content: flex-start; }
          .files-row-actions { flex-direction: column; align-items: stretch; }
        }
      `}</style>
    </div>
  );
}

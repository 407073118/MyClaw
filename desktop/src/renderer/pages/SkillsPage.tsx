import React, { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import type { SkillDefinition, SkillDetail } from "@shared/contracts";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { renderSafeSkillMarkdown } from "../utils/skill-preview";

// ── Helper ────────────────────────────────────────────────────────────────────

/** 基于 Skill 根目录拼出默认的 SKILL.md 路径预览。 */
function buildFallbackEntryPath(skillPath: string): string {
  return `${skillPath}/SKILL.md`;
}

/** 把标准 skill 包结构整理成稳定展示顺序，便于用户理解包能力。 */
function describeSkillPackage(skill: SkillDefinition): string[] {
  const features = ["SKILL.md"];
  if (skill.hasScriptsDirectory) features.push("scripts");
  if (skill.hasReferencesDirectory) features.push("references");
  if (skill.hasAssetsDirectory) features.push("assets");
  if (skill.hasTestsDirectory) features.push("tests");
  if (skill.hasAgentsDirectory) features.push("agents");
  if (skill.viewFiles?.length) features.push(...skill.viewFiles);
  return features;
}

// ── SkillsPage ────────────────────────────────────────────────────────────────

export default function SkillsPage() {
  const skills = useWorkspaceStore((s) => s.skills);
  const skillDetails = useWorkspaceStore((s) => s.skillDetails);
  const refreshSkills = useWorkspaceStore((s) => s.refreshSkills);
  const openSkillsFolder = useWorkspaceStore((s) => s.openSkillsFolder);
  const loadSkillDetail = useWorkspaceStore((s) => s.loadSkillDetail);
  const navigate = useNavigate();

  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null);
  const [selectedSkillDetail, setSelectedSkillDetail] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const detailModalRef = useRef<HTMLElement>(null);

  const selectedEntryPath = selectedSkill
    ? selectedSkillDetail?.entryPath ?? buildFallbackEntryPath(selectedSkill.path)
    : "";

  /** 关闭 Skill 详情弹层，并清理当前错误与加载状态。 */
  const closeSkillDetail = useCallback(() => {
    setSelectedSkill(null);
    setSelectedSkillDetail(null);
    setDetailLoading(false);
    setDetailError(null);
  }, []);

  const { captureTrigger: captureDialogTrigger } = useDialogA11y({
    isOpen: Boolean(selectedSkill),
    onClose: closeSkillDetail,
    initialFocusRef: detailModalRef,
    dialogName: "skills-detail",
  });

  /** 重新扫描磁盘上的 Skills 目录。 */
  async function handleRefresh() {
    setRefreshing(true);
    console.info("[skills-view] 刷新本地 Skills 列表");
    try {
      await refreshSkills();
    } catch (error) {
      console.error("[skills-view] 刷新 Skills 失败", { detail: String(error) });
    } finally {
      setRefreshing(false);
    }
  }

  /** 在系统文件管理器中打开 Skills 目录，方便用户手动放入 Skill 文件夹。 */
  function handleOpenFolder() {
    console.info("[skills-view] 打开 Skills 目录");
    openSkillsFolder();
  }

  /** 打开指定 Skill 的详情弹层，并按需加载完整的 SKILL.md。 */
  async function openSkillDetail(skill: SkillDefinition, trigger?: HTMLElement | null) {
    captureDialogTrigger(trigger);
    setSelectedSkill(skill);
    setSelectedSkillDetail((skillDetails[skill.id] as SkillDetail | undefined) ?? null);
    setDetailLoading(true);
    setDetailError(null);
    console.info("[skills-view] 加载 Skill 详情", { skillId: skill.id, skillName: skill.name });

    try {
      const detail = await loadSkillDetail(skill.id);
      setSelectedSkillDetail(detail as SkillDetail);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "加载 Skill 详情失败";
      setDetailError(msg);
      console.error("[skills-view] Skill 详情加载失败", { skillId: skill.id, detail: msg });
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <main className="page-container" style={{ height: "100%", overflowY: "auto" }}>
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">Managed Skills</span>
          <h2 className="page-title">技能管理</h2>
          <p className="page-subtitle">
            本地 Skills 列表。点击卡片查看详情，在详情页中按需打开 HTML 面板。
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-premium"
            onClick={handleOpenFolder}
          >
            打开目录
          </button>
          <button
            type="button"
            className="btn-premium accent"
            disabled={refreshing}
            onClick={handleRefresh}
          >
            {refreshing ? "刷新中..." : "刷新"}
          </button>
        </div>
      </header>

      {skills.length === 0 ? (
        <p className="skill-empty-copy">当前还没有可用 Skill。</p>
      ) : (
        <section className="glass-grid glass-grid--sm">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="glass-card glass-card--accent"
              data-testid={`skill-card-${skill.id}`}
            >
              <button
                type="button"
                className="skill-header-button"
                aria-label={`打开 ${skill.name} 详情`}
                onClick={(event) => void openSkillDetail(skill, event.currentTarget)}
              >
                <div className="glass-card__header" style={{ paddingBottom: 0 }}>
                  <h3 className="skill-card-title">{skill.name}</h3>
                  <span className={`glass-pill glass-pill--${skill.enabled ? "green" : "muted"}`}>
                    {skill.enabled ? "已启用" : "已停用"}
                  </span>
                </div>
                <div className="glass-card__body" style={{ paddingTop: 8 }}>
                  <p className="skill-desc">{skill.description}</p>
                </div>
              </button>

              <div className="glass-card__footer skill-actions-footer">
                <button
                  type="button"
                  className="glass-action-btn"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={() => navigate(`/skills/${skill.id}`)}
                >
                  查看详情
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {selectedSkill && (
        <div className="skill-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeSkillDetail(); }}>
          <section
            ref={detailModalRef}
            className="skill-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-detail-title"
            tabIndex={-1}
          >
            <header className="skill-detail-header">
              <div style={{ minWidth: 0 }}>
                <span className="eyebrow">Skill Detail</span>
                <h3 id="skill-detail-title" className="skill-detail-title" data-testid="skill-detail-title">{selectedSkill.name}</h3>
                <p className="skill-detail-summary">{selectedSkill.description}</p>
              </div>
              <button
                type="button"
                className="skill-icon-button"
                aria-label="Close skill detail"
                onClick={closeSkillDetail}
              >
                x
              </button>
            </header>

            <div className="skill-detail-meta-grid">
              <div className="skill-detail-meta-item">
                <span className="skill-meta-label">入口文件</span>
                <code className="skill-entry-path" data-testid="skill-detail-entry-path">{selectedEntryPath}</code>
              </div>
              <div className="skill-detail-meta-item">
                <span className="skill-meta-label">标准目录</span>
                <div className="skill-chip-list">
                  {describeSkillPackage(selectedSkill).map((feature) => (
                    <span key={`detail-${selectedSkill.id}-${feature}`} className="skill-package-chip">
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {detailError ? (
              <p className="skill-detail-error">{detailError}</p>
            ) : detailLoading ? (
              <div className="skill-detail-loading">正在加载 SKILL.md...</div>
            ) : selectedSkillDetail?.content ? (
              <div
                className="skill-detail-content markdown-preview"
                data-testid="skill-detail-content"
                dangerouslySetInnerHTML={{ __html: renderSafeSkillMarkdown(selectedSkillDetail.content) }}
              />
            ) : selectedSkillDetail ? (
              <p className="skill-detail-loading">该 Skill 没有 SKILL.md 文件</p>
            ) : null}
          </section>
        </div>
      )}

      <style>{`
        /* ── Skill Card Inner ── */
        .skill-header-button {
          width: 100%;
          border: none;
          background: transparent;
          text-align: left;
          appearance: none;
          color: inherit;
          font: inherit;
          cursor: pointer;
          padding: 0;
        }

        .skill-header-button:focus-visible {
          outline: 2px solid rgba(16, 163, 127, 0.65);
          outline-offset: -2px;
        }

        .skill-card-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .skill-desc {
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.55;
          margin: 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .skill-package-chip {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--glass-border);
          background: var(--bg-base);
          color: var(--text-muted);
          font-size: 11px;
          line-height: 1;
          font-family: "Cascadia Code", "Fira Code", monospace;
        }

        .skill-actions-footer {
          display: flex;
          gap: 0;
        }

        .skill-actions-footer .glass-action-btn {
          border-radius: 0;
          border: none;
          border-top: none;
          height: auto;
          padding: 10px 0;
        }

        .skill-actions-footer .glass-action-btn + .glass-action-btn {
          border-left: 1px solid var(--glass-border);
        }

        /* ── Empty State ── */
        .skill-empty-copy {
          color: var(--text-secondary);
          font-size: 14px;
          text-align: center;
          padding: 48px;
          background: color-mix(in srgb, var(--bg-card) 40%, transparent);
          border: 1px dashed var(--glass-border);
          border-radius: var(--radius-xl);
        }

        /* ── Detail Modal ── */
        .skill-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(4px);
          display: grid;
          place-items: center;
          padding: 24px;
        }

        .skill-detail-modal {
          width: min(920px, 100%);
          max-height: min(80vh, 900px);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background: var(--bg-card);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-xl);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.38);
        }

        .skill-detail-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 24px;
          border-bottom: 1px solid var(--glass-border);
        }

        .skill-detail-title {
          margin: 0;
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .skill-detail-summary {
          margin: 8px 0 0;
          color: var(--text-secondary);
          line-height: 1.6;
        }

        .skill-icon-button {
          background: transparent;
          border: 1px solid var(--glass-border);
          color: var(--text-secondary);
          cursor: pointer;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-md);
          display: grid;
          place-items: center;
          transition: all 0.2s;
          font-size: 18px;
        }

        .skill-icon-button:hover {
          color: var(--text-primary);
          border-color: var(--glass-border-hover);
        }

        .skill-detail-meta-grid {
          display: grid;
          grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
          gap: 16px;
          padding: 20px 24px 0;
        }

        .skill-detail-meta-item {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .skill-meta-label {
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 700;
        }

        .skill-chip-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .skill-entry-path {
          font-size: 12px;
          color: var(--text-primary);
          word-break: break-all;
        }

        .skill-detail-loading, .skill-detail-error {
          margin: 20px 24px 24px;
          font-size: 14px;
          color: var(--text-secondary);
        }

        .skill-detail-error { color: var(--status-red); }

        .skill-detail-content {
          flex: 1;
          overflow: auto;
          padding: 20px 24px;
          border-radius: var(--radius-lg);
          background: var(--bg-base);
          border: 1px solid var(--glass-border);
          margin: 20px 24px 24px;
          line-height: 1.65;
          color: var(--text-primary);
          font-size: 13px;
        }

        .skill-detail-content.markdown-preview h1 {
          font-size: 22px; font-weight: 700; margin: 0 0 12px;
          padding-bottom: 8px; border-bottom: 1px solid var(--glass-border);
        }
        .skill-detail-content.markdown-preview h2 {
          font-size: 18px; font-weight: 600; margin: 24px 0 8px;
        }
        .skill-detail-content.markdown-preview h3 {
          font-size: 15px; font-weight: 600; margin: 20px 0 6px;
        }
        .skill-detail-content.markdown-preview p { margin: 0 0 10px; }
        .skill-detail-content.markdown-preview a {
          color: var(--accent-cyan); text-decoration: none;
        }
        .skill-detail-content.markdown-preview a:hover { text-decoration: underline; }
        .skill-detail-content.markdown-preview code {
          font-family: "Cascadia Code", "Fira Code", monospace;
          font-size: 0.9em; background: rgba(255,255,255,0.06);
          padding: 2px 6px; border-radius: var(--radius-sm);
        }
        .skill-detail-content.markdown-preview pre {
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md); padding: 12px 14px;
          overflow-x: auto; margin: 0 0 12px;
        }
        .skill-detail-content.markdown-preview pre code {
          background: none; padding: 0; font-size: 12px; line-height: 1.6;
        }
        .skill-detail-content.markdown-preview ul, .skill-detail-content.markdown-preview ol {
          margin: 0 0 10px; padding-left: 24px;
        }
        .skill-detail-content.markdown-preview li { margin-bottom: 4px; }
        .skill-detail-content.markdown-preview blockquote {
          margin: 0 0 10px; padding: 8px 14px;
          border-left: 3px solid var(--accent-cyan);
          background: rgba(255,255,255,0.02);
          color: var(--text-secondary);
        }
        .skill-detail-content.markdown-preview table {
          width: 100%; border-collapse: collapse; margin: 0 0 12px;
        }
        .skill-detail-content.markdown-preview th, .skill-detail-content.markdown-preview td {
          border: 1px solid var(--glass-border);
          padding: 6px 10px; text-align: left; font-size: 12px;
        }
        .skill-detail-content.markdown-preview th {
          background: rgba(255,255,255,0.04); font-weight: 600;
        }

        @media (max-width: 700px) {
          .skill-detail-meta-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </main>
  );
}

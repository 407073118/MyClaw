import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import type { SkillDefinition, SkillDetail } from "@shared/contracts";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { renderSafeSkillMarkdown } from "../utils/skill-preview";
import { FileText, FolderOpen, RefreshCw, Settings2, Wrench, X } from "lucide-react";

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
    <div className="page-shell" data-testid="skills-page">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <Wrench size={14} />
            <span>Managed Skills</span>
          </div>
          <h2 className="page-header__title">技能管理</h2>
          <p className="page-header__subtitle">
            本地 Skills 列表。点击名称进入详情，预览图标查看 SKILL.md 原文。
          </p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn-toolbar" onClick={handleOpenFolder}>
            <FolderOpen size={14} />
            打开目录
          </button>
          <button
            type="button"
            className="btn-toolbar"
            disabled={refreshing}
            onClick={handleRefresh}
          >
            <RefreshCw size={14} />
            {refreshing ? "刷新中..." : "刷新"}
          </button>
        </div>
      </header>

      <main className="page-content">
        {skills.length === 0 ? (
          <section className="empty-state">
            <Wrench size={32} className="empty-state__icon" />
            <h3 className="empty-state__title">尚未发现可用 Skill</h3>
            <p className="empty-state__body">
              在 Skills 目录中放入包含 SKILL.md 的文件夹，然后点击「刷新」载入。
            </p>
            <button type="button" className="btn-primary" onClick={handleOpenFolder}>
              <FolderOpen size={14} />
              打开 Skills 目录
            </button>
          </section>
        ) : (
          <div className="list-rows">
            {skills.map((skill) => (
              <article
                key={skill.id}
                className="list-row list-row--with-description"
                data-testid={`skill-card-${skill.id}`}
              >
                <div className="list-row__lead">
                  <span
                    className={`status-dot status-dot--${skill.enabled ? "green" : "muted"}`}
                    title={skill.enabled ? "已启用" : "已停用"}
                  />
                </div>

                <div className="list-row__main">
                  <div className="list-row__title-row">
                    <Link to={`/skills/${skill.id}`} className="list-row__title">
                      {skill.name}
                    </Link>
                    <span className={`tag tag--${skill.enabled ? "green" : "muted"}`}>
                      {skill.enabled ? "已启用" : "已停用"}
                    </span>
                  </div>
                  <div className="list-row__description">{skill.description}</div>
                </div>

                <div className="list-row__trailing">
                  <button
                    type="button"
                    className="icon-btn"
                    title="预览 SKILL.md"
                    aria-label={`预览 ${skill.name} 的 SKILL.md`}
                    onClick={(event) => void openSkillDetail(skill, event.currentTarget)}
                  >
                    <FileText size={14} />
                  </button>
                  <Link to={`/skills/${skill.id}`} className="btn-toolbar">
                    <Settings2 size={14} />
                    详情
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {selectedSkill && (
        <div
          className="skill-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSkillDetail();
          }}
        >
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
                <div className="page-header__eyebrow" style={{ marginBottom: 6 }}>
                  <span>Skill Detail</span>
                </div>
                <h3
                  id="skill-detail-title"
                  className="skill-detail-title"
                  data-testid="skill-detail-title"
                >
                  {selectedSkill.name}
                </h3>
                <p className="skill-detail-summary">{selectedSkill.description}</p>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="关闭 Skill 详情"
                onClick={closeSkillDetail}
              >
                <X size={16} />
              </button>
            </header>

            <div className="skill-detail-meta-grid">
              <div className="skill-detail-meta-item">
                <span className="skill-meta-label">入口文件</span>
                <code
                  className="skill-entry-path"
                  data-testid="skill-detail-entry-path"
                >
                  {selectedEntryPath}
                </code>
              </div>
              <div className="skill-detail-meta-item">
                <span className="skill-meta-label">标准目录</span>
                <div className="skill-chip-list">
                  {describeSkillPackage(selectedSkill).map((feature) => (
                    <span
                      key={`detail-${selectedSkill.id}-${feature}`}
                      className="skill-package-chip"
                    >
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
                dangerouslySetInnerHTML={{
                  __html: renderSafeSkillMarkdown(selectedSkillDetail.content),
                }}
              />
            ) : selectedSkillDetail ? (
              <p className="skill-detail-loading">该 Skill 没有 SKILL.md 文件</p>
            ) : null}

            <footer className="skill-detail-footer">
              <button
                type="button"
                className="btn-toolbar"
                onClick={closeSkillDetail}
              >
                关闭
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  closeSkillDetail();
                  navigate(`/skills/${selectedSkill.id}`);
                }}
              >
                <Settings2 size={14} />
                打开详情页
              </button>
            </footer>
          </section>
        </div>
      )}

      <style>{`
        /* ── Skill 详情模态（页面专属：markdown 预览需要 920px 宽，未走 drawer） ── */
        .skill-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
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
          border-radius: var(--radius-2xl);
          box-shadow: var(--shadow-modal);
        }

        .skill-detail-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 20px 24px;
          border-bottom: 1px solid var(--glass-border);
        }

        .skill-detail-title {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .skill-detail-summary {
          margin: 6px 0 0;
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.55;
        }

        .skill-detail-meta-grid {
          display: grid;
          grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
          gap: 16px;
          padding: 16px 24px 0;
        }

        .skill-detail-meta-item {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
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
          font-family: "Cascadia Code", "Fira Code", ui-monospace, monospace;
        }

        .skill-entry-path {
          font-size: 12px;
          color: var(--text-primary);
          word-break: break-all;
          font-family: "Cascadia Code", "Fira Code", ui-monospace, monospace;
        }

        .skill-detail-loading,
        .skill-detail-error {
          margin: 20px 24px 0;
          font-size: 13px;
          color: var(--text-secondary);
        }
        .skill-detail-error { color: var(--status-red); }

        .skill-detail-content {
          flex: 1;
          overflow: auto;
          padding: 16px 20px;
          margin: 16px 24px;
          border-radius: var(--radius-lg);
          background: var(--bg-base);
          border: 1px solid var(--glass-border);
          line-height: 1.65;
          color: var(--text-primary);
          font-size: 13px;
        }

        .skill-detail-footer {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          padding: 16px 24px;
          border-top: 1px solid var(--glass-border);
          background: rgba(0, 0, 0, 0.20);
        }

        /* Markdown rendering inside the modal */
        .markdown-preview h1 {
          font-size: 20px; font-weight: 700; margin: 0 0 12px;
          padding-bottom: 8px; border-bottom: 1px solid var(--glass-border);
        }
        .markdown-preview h2 { font-size: 16px; font-weight: 600; margin: 20px 0 8px; }
        .markdown-preview h3 { font-size: 14px; font-weight: 600; margin: 16px 0 6px; }
        .markdown-preview p { margin: 0 0 10px; }
        .markdown-preview a { color: var(--accent-cyan); text-decoration: none; }
        .markdown-preview a:hover { text-decoration: underline; }
        .markdown-preview code {
          font-family: "Cascadia Code", "Fira Code", ui-monospace, monospace;
          font-size: 0.9em; background: rgba(255, 255, 255, 0.06);
          padding: 2px 6px; border-radius: var(--radius-sm);
        }
        .markdown-preview pre {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md); padding: 12px 14px;
          overflow-x: auto; margin: 0 0 12px;
        }
        .markdown-preview pre code {
          background: none; padding: 0; font-size: 12px; line-height: 1.6;
        }
        .markdown-preview ul, .markdown-preview ol {
          margin: 0 0 10px; padding-left: 24px;
        }
        .markdown-preview li { margin-bottom: 4px; }
        .markdown-preview blockquote {
          margin: 0 0 10px; padding: 8px 14px;
          border-left: 3px solid var(--accent-cyan);
          background: rgba(255, 255, 255, 0.02);
          color: var(--text-secondary);
        }
        .markdown-preview table {
          width: 100%; border-collapse: collapse; margin: 0 0 12px;
        }
        .markdown-preview th, .markdown-preview td {
          border: 1px solid var(--glass-border);
          padding: 6px 10px; text-align: left; font-size: 12px;
        }
        .markdown-preview th {
          background: rgba(255, 255, 255, 0.04); font-weight: 600;
        }

        @media (max-width: 700px) {
          .skill-detail-meta-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

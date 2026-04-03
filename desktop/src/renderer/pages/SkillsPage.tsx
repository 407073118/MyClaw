import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { marked } from "marked";
import { useWorkspaceStore } from "../stores/workspace";
import type { SkillDefinition, SkillDetail } from "@shared/contracts";

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
  if (skill.hasViewFile) features.push("view.html");
  return features;
}

// ── SkillsPage ────────────────────────────────────────────────────────────────

export default function SkillsPage() {
  const workspace = useWorkspaceStore();
  const navigate = useNavigate();

  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null);
  const [selectedSkillDetail, setSelectedSkillDetail] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const selectedEntryPath = selectedSkill
    ? selectedSkillDetail?.entryPath ?? buildFallbackEntryPath(selectedSkill.path)
    : "";

  /** 打开指定 Skill 的详情弹层，并按需加载完整的 SKILL.md。 */
  async function openSkillDetail(skill: SkillDefinition) {
    setSelectedSkill(skill);
    setSelectedSkillDetail((workspace.skillDetails[skill.id] as SkillDetail | undefined) ?? null);
    setDetailLoading(true);
    setDetailError(null);
    console.info("[skills-view] 加载 Skill 详情", { skillId: skill.id, skillName: skill.name });

    try {
      const detail = await workspace.loadSkillDetail(skill.id);
      setSelectedSkillDetail(detail as SkillDetail);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "加载 Skill 详情失败";
      setDetailError(msg);
      console.error("[skills-view] Skill 详情加载失败", { skillId: skill.id, detail: msg });
    } finally {
      setDetailLoading(false);
    }
  }

  /** 关闭 Skill 详情弹层，并清理当前错误与加载状态。 */
  function closeSkillDetail() {
    setSelectedSkill(null);
    setSelectedSkillDetail(null);
    setDetailLoading(false);
    setDetailError(null);
  }

  /** 为带有 view.html 的 Skill 打开 WebPanel。 */
  async function handleOpenSkillView(skill: SkillDefinition) {
    const viewPath = await window.myClawAPI.webPanelResolveView(skill.id);
    if (!viewPath) {
      console.warn("[skills-view] No view.html found for skill", skill.id);
      return;
    }
    workspace.openWebPanel(viewPath, skill.name, { skillId: skill.id, skillName: skill.name });
  }

  return (
    <main className="page-container">
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">Managed Skills</span>
          <h2 className="page-title">技能管理</h2>
          <p className="page-subtitle">
            本地 Skills 列表。点击卡片查看详情，点击「预览」在右侧面板中打开。
          </p>
        </div>
      </header>

      {workspace.skills.length === 0 ? (
        <p className="empty-copy">当前还没有可用 Skill。</p>
      ) : (
        <section className="skills-grid">
          {workspace.skills.map((skill) => (
            <div
              key={skill.id}
              className="skill-card"
              data-testid={`skill-card-${skill.id}`}
            >
              <div className="skill-header" onClick={() => openSkillDetail(skill)}>
                <div className="skill-title-block">
                  <h3>{skill.name}</h3>
                  <span className={`status-badge${skill.enabled ? " enabled" : ""}`}>
                    {skill.enabled ? "已启用" : "已停用"}
                  </span>
                </div>
                <p className="skill-desc">{skill.description}</p>
              </div>

              <div className="skill-chips">
                {describeSkillPackage(skill).map((feature) => (
                  <span key={`${skill.id}-${feature}`} className="package-chip">
                    {feature}
                  </span>
                ))}
              </div>

              <div className="skill-actions">
                <button
                  type="button"
                  className="btn-detail"
                  onClick={() => navigate(`/skills/${skill.id}`)}
                >
                  查看详情
                </button>
                {skill.hasViewFile && (
                  <button
                    type="button"
                    className="btn-open-panel"
                    onClick={() => handleOpenSkillView(skill)}
                  >
                    ▶ 预览
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {selectedSkill && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeSkillDetail(); }}>
          <section className="detail-modal">
            <header className="detail-header">
              <div className="detail-header-copy">
                <span className="eyebrow">Skill Detail</span>
                <h3 className="detail-title" data-testid="skill-detail-title">{selectedSkill.name}</h3>
                <p className="detail-summary">{selectedSkill.description}</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close skill detail"
                onClick={closeSkillDetail}
              >
                ×
              </button>
            </header>

            <div className="detail-meta-grid">
              <div className="detail-meta-item">
                <span className="meta-label">入口文件</span>
                <code className="entry-path" data-testid="skill-detail-entry-path">{selectedEntryPath}</code>
              </div>
              <div className="detail-meta-item">
                <span className="meta-label">标准目录</span>
                <div className="package-chip-list">
                  {describeSkillPackage(selectedSkill).map((feature) => (
                    <span key={`detail-${selectedSkill.id}-${feature}`} className="package-chip">
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {detailError ? (
              <p className="detail-error">{detailError}</p>
            ) : detailLoading ? (
              <div className="detail-loading">正在加载 SKILL.md…</div>
            ) : selectedSkillDetail?.content ? (
              <div
                className="detail-content markdown-preview"
                data-testid="skill-detail-content"
                dangerouslySetInnerHTML={{ __html: marked.parse(selectedSkillDetail.content) as string }}
              />
            ) : selectedSkillDetail ? (
              <p className="detail-loading">该 Skill 没有 SKILL.md 文件</p>
            ) : null}
          </section>
        </div>
      )}

      <style>{`
        .page-container {
          height: 100%;
          overflow-y: auto;
        }

        .page-header {
          margin-bottom: 24px;
        }

        .eyebrow {
          display: inline-block;
          margin-bottom: 8px;
          color: var(--accent-cyan, #67e8f9);
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .page-title {
          margin: 0;
          color: var(--text-primary, #fff);
          font-size: 24px;
        }

        .page-subtitle {
          margin: 8px 0 0;
          color: var(--text-secondary, #b0b0b8);
          font-size: 13px;
          line-height: 1.6;
        }

        /* ---- 卡片网格 ---- */
        .skills-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }

        .empty-copy {
          color: var(--text-secondary);
          font-size: 14px;
          text-align: center;
          padding: 48px;
          background: color-mix(in srgb, var(--bg-card, #1e1e24) 40%, transparent);
          border: 1px dashed var(--glass-border, #333338);
          border-radius: 12px;
        }

        /* ---- Skill 卡片 ---- */
        .skill-card {
          display: flex;
          flex-direction: column;
          border-radius: var(--radius-xl);
          background: var(--bg-card);
          border: 1px solid var(--glass-border);
          backdrop-filter: var(--blur-std);
          -webkit-backdrop-filter: var(--blur-std);
          box-shadow: var(--shadow-card), var(--glass-inner-glow);
          transition: border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease;
        }

        .skill-card:hover {
          border-color: var(--glass-border-hover);
          box-shadow: var(--shadow-card-hover), var(--glass-inner-glow);
          transform: translateY(-2px);
        }

        .skill-header {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 16px 16px 12px;
          cursor: pointer;
          flex: 1;
        }

        .skill-title-block {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .skill-title-block h3 {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .status-badge {
          flex-shrink: 0;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 600;
          background: var(--bg-base);
          border: 1px solid var(--glass-border);
          color: var(--text-muted);
        }

        .status-badge.enabled {
          background: rgba(46, 160, 67, 0.1);
          border-color: rgba(46, 160, 67, 0.2);
          color: #2ea043;
        }

        .skill-desc {
          color: var(--text-secondary);
          font-size: 12px;
          line-height: 1.5;
          margin: 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* ---- 结构标签 ---- */
        .skill-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 0 16px 12px;
        }

        .package-chip {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid var(--glass-border);
          background: var(--bg-base);
          color: var(--text-muted);
          font-size: 11px;
          line-height: 1;
          font-family: "Cascadia Code", "Fira Code", monospace;
        }

        /* ---- 操作按钮 ---- */
        .skill-actions {
          display: flex;
          border-top: 1px solid var(--glass-border);
        }

        .skill-actions button {
          flex: 1;
          padding: 9px 0;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          transition: background 0.15s;
        }

        .btn-detail {
          color: var(--text-secondary);
        }

        .btn-detail:hover {
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-primary);
        }

        .btn-open-panel {
          color: var(--accent-cyan, #67e8f9);
          border-left: 1px solid var(--glass-border) !important;
        }

        .btn-open-panel:hover {
          background: rgba(103, 232, 249, 0.08);
        }

        /* ---- 详情弹层 ---- */
        .modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(4px);
          display: grid;
          place-items: center;
          padding: 24px;
        }

        .detail-modal {
          width: min(920px, 100%);
          max-height: min(80vh, 900px);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background: var(--bg-card, #18181b);
          border: 1px solid var(--glass-border, #27272a);
          border-radius: 16px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.38);
        }

        .detail-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 24px;
          border-bottom: 1px solid var(--glass-border, #27272a);
        }

        .detail-header-copy { min-width: 0; }

        .detail-title {
          margin: 0;
          font-size: 22px;
          color: var(--text-primary);
        }

        .detail-summary {
          margin: 8px 0 0;
          color: var(--text-secondary);
          line-height: 1.6;
        }

        .icon-button {
          background: transparent;
          border: 1px solid var(--glass-border, #3f3f46);
          color: var(--text-secondary, #a1a1aa);
          cursor: pointer;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: grid;
          place-items: center;
          transition: all 0.2s;
          font-size: 18px;
        }

        .icon-button:hover {
          color: var(--text-primary);
          border-color: var(--text-primary);
        }

        .detail-meta-grid {
          display: grid;
          grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
          gap: 16px;
          padding: 20px 24px 0;
        }

        .detail-meta-item {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .meta-label {
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .package-chip-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .entry-path {
          font-size: 12px;
          color: var(--text-primary);
          word-break: break-all;
        }

        .detail-loading, .detail-error {
          margin: 20px 24px 24px;
        }

        .detail-loading, .detail-error {
          font-size: 14px;
          color: var(--text-secondary);
        }

        .detail-error { color: #ef4444; }

        .detail-content {
          flex: 1;
          overflow: auto;
          padding: 20px 24px;
          border-radius: 12px;
          background: var(--bg-base, #121214);
          border: 1px solid var(--glass-border, #27272a);
          margin: 20px 24px 24px;
          line-height: 1.65;
          color: var(--text-primary);
          font-size: 13px;
        }

        .detail-content.markdown-preview h1 {
          font-size: 22px; font-weight: 700; margin: 0 0 12px;
          padding-bottom: 8px; border-bottom: 1px solid var(--glass-border, #333338);
        }
        .detail-content.markdown-preview h2 {
          font-size: 18px; font-weight: 600; margin: 24px 0 8px;
        }
        .detail-content.markdown-preview h3 {
          font-size: 15px; font-weight: 600; margin: 20px 0 6px;
        }
        .detail-content.markdown-preview p { margin: 0 0 10px; }
        .detail-content.markdown-preview a {
          color: var(--accent-cyan, #67e8f9); text-decoration: none;
        }
        .detail-content.markdown-preview a:hover { text-decoration: underline; }
        .detail-content.markdown-preview code {
          font-family: "Cascadia Code", "Fira Code", monospace;
          font-size: 0.9em; background: rgba(255,255,255,0.06);
          padding: 2px 6px; border-radius: 4px;
        }
        .detail-content.markdown-preview pre {
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--glass-border, #333338);
          border-radius: 6px; padding: 12px 14px;
          overflow-x: auto; margin: 0 0 12px;
        }
        .detail-content.markdown-preview pre code {
          background: none; padding: 0; font-size: 12px; line-height: 1.6;
        }
        .detail-content.markdown-preview ul, .detail-content.markdown-preview ol {
          margin: 0 0 10px; padding-left: 24px;
        }
        .detail-content.markdown-preview li { margin-bottom: 4px; }
        .detail-content.markdown-preview blockquote {
          margin: 0 0 10px; padding: 8px 14px;
          border-left: 3px solid var(--accent-cyan, #67e8f9);
          background: rgba(255,255,255,0.02);
          color: var(--text-secondary, #b0b0b8);
        }
        .detail-content.markdown-preview table {
          width: 100%; border-collapse: collapse; margin: 0 0 12px;
        }
        .detail-content.markdown-preview th, .detail-content.markdown-preview td {
          border: 1px solid var(--glass-border, #333338);
          padding: 6px 10px; text-align: left; font-size: 12px;
        }
        .detail-content.markdown-preview th {
          background: rgba(255,255,255,0.04); font-weight: 600;
        }

        @media (max-width: 700px) {
          .detail-meta-grid { grid-template-columns: 1fr; }
          .skills-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </main>
  );
}

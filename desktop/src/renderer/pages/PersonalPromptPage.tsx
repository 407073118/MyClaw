import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { UNSAFE_NavigationContext, useBeforeUnload } from "react-router-dom";

import { useWorkspaceStore } from "../stores/workspace";
import {
  buildExampleDescriptor,
  isSaveShortcut,
  shouldApplyExamplePrompt,
} from "../utils/personal-prompt-ui";

const EXAMPLE_PROMPTS = [
  "我是黑盒测试，主要负责需求测试、回归测试和上线验证。平时会看 PRD、原型、接口文档，输出测试点、测试用例和缺陷单。我希望你先帮我补齐测试思路，再帮我整理输出。",
  "我是产品经理，主要负责需求梳理、方案评审和跨团队推进。我希望你先帮我提炼目标与风险，再整理成会议纪要、需求说明或推进清单。",
  "我是前端开发，主要负责桌面端和后台页面开发。我希望你先结合现有代码和组件约束思考方案，再给我能直接落地的修改建议。",
];

/** 个人长期 Prompt 页面，用户只维护一段长期工作说明。 */
export default function PersonalPromptPage() {
  const workspace = useWorkspaceStore();
  const savedProfile = workspace.personalPrompt;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const navigationContext = useContext(UNSAFE_NavigationContext);

  const [draft, setDraft] = useState(savedProfile.prompt);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");

  useEffect(() => {
    void workspace.loadPersonalPrompt();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDraft(savedProfile.prompt);
  }, [savedProfile.prompt]);

  const isDirty = draft.trim() !== savedProfile.prompt.trim();
  const updatedAtLabel = useMemo(() => {
    if (!savedProfile.updatedAt) return "尚未保存";
    return new Date(savedProfile.updatedAt).toLocaleString("zh-CN", {
      hour12: false,
    });
  }, [savedProfile.updatedAt]);
  const exampleDescriptors = useMemo(
    () => EXAMPLE_PROMPTS.map((example) => ({ example, ...buildExampleDescriptor(example) })),
    [],
  );

  useBeforeUnload((event) => {
    if (!isDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  useEffect(() => {
    if (!isDirty) return;

    const navigator = navigationContext.navigator as {
      block?: (blocker: (tx: { retry: () => void }) => void) => () => void;
    };

    if (typeof navigator.block !== "function") {
      console.info("[personal-prompt-page] 当前路由器不支持导航拦截，跳过页面内离开确认");
      return;
    }

    /** 使用 history block 拦截 HashRouter 内部跳转，避免 useBlocker 在非 data router 中崩溃。 */
    const unblock = navigator.block((tx) => {
      const shouldLeave = window.confirm("当前有未保存内容，确认离开此页面？");
      console.info("[personal-prompt-page] 处理页面内离开确认", {
        shouldLeave,
        isDirty: true,
      });

      if (!shouldLeave) return;
      unblock();
      tx.retry();
    });

    return unblock;
  }, [isDirty, navigationContext]);

  useEffect(() => {
    if (savedProfile.prompt.trim()) return;
    textareaRef.current?.focus();
  }, [savedProfile.prompt]);

  useEffect(() => {
    /** 监听保存快捷键，支持 macOS 与 Windows 桌面习惯。 */
    function handleKeydown(event: KeyboardEvent) {
      if (!isSaveShortcut(event) || isSaving || !isDirty) return;
      event.preventDefault();
      console.info("[personal-prompt-page] 触发快捷键保存个人长期 Prompt");
      void handleSave();
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [isDirty, isSaving, draft, savedProfile.prompt]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 将示例内容填充到编辑框，帮助用户更快起步。 */
  function applyExample(example: string) {
    const allowed = shouldApplyExamplePrompt(
      isDirty,
      () => window.confirm("套用示例覆盖草稿: 当前有未保存内容，将用示例替换当前草稿。确认继续？"),
    );
    if (!allowed) {
      console.info("[personal-prompt-page] 用户取消用示例覆盖未保存草稿");
      return;
    }
    console.info("[personal-prompt-page] 应用长期 Prompt 示例模版", {
      exampleLength: example.length,
      dirtyBeforeApply: isDirty,
    });
    setDraft(example);
    setSaveError("");
    setSaveSuccess("");
  }

  /** 保存当前长期 Prompt，并触发主进程提炼摘要与标签。 */
  async function handleSave() {
    setSaveError("");
    setSaveSuccess("");
    setIsSaving(true);
    console.info("[personal-prompt-page] 开始保存个人长期 Prompt", {
      draftLength: draft.trim().length,
    });
    try {
      await workspace.updatePersonalPrompt(draft);
      setSaveSuccess("已保存，你的个性设置会用于后续对话理解。");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main data-testid="personal-prompt-view" className="page-container personal-prompt-page">
      <header className="page-header personal-prompt-header">
        <div className="header-text personal-prompt-header-text">
          <p className="eyebrow">Personality</p>
          <div className="title-row">
            <h2 className="page-title">我的个性</h2>
            <span className={`header-status-chip${isDirty ? " is-dirty" : ""}`}>
              {isDirty ? "未保存" : "已同步"}
            </span>
          </div>
          <p className="page-subtitle personal-prompt-subtitle">
            维护一段长期说明，让助手持续理解你的角色、职责和协作方式。
          </p>
          <div className="header-meta-inline">
            <span className="meta-inline-item">最近更新: {updatedAtLabel}</span>
            <span className="meta-inline-item">系统会自动提炼摘要和标签</span>
          </div>
        </div>
      </header>

      <section className="prompt-layout">
        <article className="prompt-editor-card">
          <div className="section-head compact">
            <div className="section-head-copy">
              <p className="section-eyebrow">长期原文</p>
              <h3>你的长期工作说明</h3>
              <p className="section-helper">建议直接写角色、主要职责、常见产出，以及你希望助手如何配合你。</p>
            </div>
            <div className="section-head-actions">
              <span className="char-count">{draft.trim().length} 字</span>
              <button
                data-testid="personal-prompt-save"
                className="primary save-button"
                type="button"
                disabled={isSaving || !isDirty}
                onClick={() => void handleSave()}
              >
                {isSaving ? "保存中..." : "保存个性"}
              </button>
            </div>
          </div>

          <textarea
            ref={textareaRef}
            data-testid="personal-prompt-textarea"
            className="prompt-textarea"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSaveSuccess("");
            }}
            placeholder="例如：我是黑盒测试，主要负责需求测试、回归测试和上线验证。平时会看 PRD、原型、接口文档，输出测试点、测试用例和缺陷单。我希望你先帮我补齐测试思路，再帮我整理输出。"
            rows={16}
          />

          <div className="editor-footer">
            <div className="status-copy" role="status" aria-live="polite">
              {saveError && <span className="error-copy">保存失败，未能更新个性设置。请重试；如果仍失败，请检查本地运行状态或重新打开工作区。</span>}
              {!saveError && saveSuccess && <span className="success-copy">{saveSuccess}</span>}
              {!saveError && !saveSuccess && (
                <span className="hint-copy">支持 `Cmd/Ctrl + S` 快速保存。</span>
              )}
            </div>
          </div>
        </article>

        <aside className="prompt-sidebar">
          <section className="sidebar-card">
            <p className="section-eyebrow">系统理解</p>
            <h3>已提炼摘要</h3>
            <p className="summary-copy">
              {savedProfile.summary || "保存后，系统会自动生成一段简短摘要，供运行时理解使用。"}
            </p>
          </section>

          <section className="sidebar-card">
            <p className="section-eyebrow">自动标签</p>
            <h3>识别到的工作标签</h3>
            <div className="tag-list">
              {savedProfile.tags.length > 0 ? (
                savedProfile.tags.map((tag) => (
                  <span key={tag} className="tag-pill">{tag}</span>
                ))
              ) : (
                <span className="empty-pill">保存后自动生成</span>
              )}
            </div>
          </section>

          <section className="sidebar-card">
            <p className="section-eyebrow">参考示例</p>
            <h3>快速起步</h3>
            <div className="example-list">
              {exampleDescriptors.map(({ example, title, preview }) => (
                <button
                  key={example}
                  type="button"
                  className="example-card"
                  onClick={() => applyExample(example)}
                >
                  <span className="example-title">{title}</span>
                  <span className="example-preview">{preview}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <style>{`
        .personal-prompt-page {
          display: flex;
          flex: 1;
          flex-direction: column;
          gap: 24px;
          background: var(--bg-base);
          width: 100%;
          max-width: none;
          margin: 0;
          min-height: 0;
          overflow: hidden;
          container-type: inline-size;
        }

        .personal-prompt-header {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 24px;
        }

        .personal-prompt-header-text {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .title-row {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .section-head h3,
        .sidebar-card h3 {
          margin: 0;
          color: var(--text-primary);
          letter-spacing: -0.02em;
        }

        .personal-prompt-subtitle {
          max-width: 760px;
        }

        .prompt-editor-card,
        .sidebar-card {
          border-radius: var(--radius-xl, 16px);
          border: 1px solid rgba(255,255,255,0.06);
          background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%);
          box-shadow: 0 12px 32px rgba(0,0,0,0.2);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }

        .header-meta-inline {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .meta-inline-item,
        .header-status-chip {
          display: inline-flex;
          align-items: center;
          height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid var(--glass-border);
          background: rgba(255,255,255,0.03);
          color: var(--text-secondary);
          font-size: 12px;
        }

        .header-status-chip {
          color: var(--accent-cyan);
          border-color: rgba(16, 163, 127, 0.2);
          background: rgba(16, 163, 127, 0.08);
        }

        .header-status-chip.is-dirty {
          color: #f59e0b;
          border-color: rgba(245, 158, 11, 0.22);
          background: rgba(245, 158, 11, 0.08);
        }

        .prompt-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.55fr) minmax(280px, 360px);
          grid-template-rows: minmax(0, 1fr);
          gap: 18px;
          min-height: 0;
          flex: 1;
          align-items: stretch;
          overflow: hidden;
        }

        .prompt-editor-card {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          min-height: 0;
          height: 100%;
          overflow: hidden;
        }

        .section-head.compact {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .section-head-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .section-helper {
          margin: 0;
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.5;
        }

        .section-head-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .char-count {
          flex-shrink: 0;
          height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--glass-border);
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 400;
          display: inline-flex;
          align-items: center;
        }

        .prompt-textarea {
          flex: 1;
          min-height: 120px;
          height: 100%;
          resize: none;
          width: 100%;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          background: rgba(0, 0, 0, 0.25);
          color: rgba(255,255,255,0.95);
          padding: 20px;
          font: 400 15px/1.8 "Inter", "SF Pro Text", "PingFang SC", sans-serif;
          outline: none;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: inset 0 2px 8px rgba(0,0,0,0.2);
        }

        .prompt-textarea:focus {
          border-color: rgba(52, 211, 153, 0.4);
          background: rgba(0, 0, 0, 0.35);
          box-shadow: inset 0 2px 8px rgba(0,0,0,0.2), 0 0 0 4px rgba(52, 211, 153, 0.1);
        }

        .editor-footer {
          display: flex;
          justify-content: flex-start;
          gap: 8px;
          align-items: center;
          min-height: 24px;
        }

        .status-copy {
          min-height: 20px;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.5;
        }

        .hint-copy {
          color: var(--text-muted);
        }

        .error-copy {
          color: #f87171;
        }

        .success-copy {
          color: #34d399;
        }

        .save-button {
          min-width: 132px;
          height: 32px;
          padding: 0 12px;
          border-radius: var(--radius-md);
          font-size: 12px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .prompt-sidebar {
          display: flex;
          flex-direction: column;
          gap: 12px;
          height: 100%;
          min-height: 0;
          overflow: auto;
          padding-right: 2px;
        }

        .sidebar-card {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .section-head h3,
        .sidebar-card h3 {
          font-size: 17px;
          line-height: 1.4;
          font-weight: 600;
        }

        .summary-copy {
          margin: 0;
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.6;
        }

        .tag-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .tag-pill,
        .empty-pill {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
        }

        .tag-pill {
          border: 1px solid rgba(16, 163, 127, 0.22);
          background: rgba(16, 163, 127, 0.08);
          color: var(--accent-cyan);
        }

        .empty-pill {
          border: 1px dashed rgba(255,255,255,0.12);
          color: var(--text-muted);
        }

        .example-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .example-card {
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.02);
          color: var(--text-secondary);
          border-radius: 12px;
          padding: 14px;
          text-align: left;
          font: inherit;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .example-card:hover {
          border-color: rgba(52, 211, 153, 0.3);
          background: rgba(52, 211, 153, 0.05);
          color: var(--text-primary);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        .example-title {
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 600;
          line-height: 1.4;
        }

        .example-preview {
          color: var(--text-secondary);
          font-size: 12px;
          line-height: 1.5;
        }

        @container (max-width: 1180px) {
          .prompt-layout {
            grid-template-columns: minmax(0, 1fr) minmax(240px, 300px);
          }

          .personal-prompt-header,
          .section-head.compact {
            align-items: flex-start;
            flex-direction: column;
          }

          .header-meta-inline {
            justify-content: flex-start;
          }

          .prompt-editor-card {
            height: 100%;
          }
        }

        @container (max-width: 860px) {
          .personal-prompt-page {
            padding: 24px;
          }

          .section-head-actions {
            width: 100%;
            justify-content: space-between;
          }
        }
      `}</style>
    </main>
  );
}

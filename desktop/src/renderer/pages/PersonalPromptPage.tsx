import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Save, Sparkles, Tag, UserRound } from "lucide-react";
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
    <div data-testid="personal-prompt-view" className="page-shell personal-prompt-page">
      <header className="page-header page-header--sticky personal-prompt-header">
        <div className="page-header__lead personal-prompt-header-text">
          <div className="page-header__eyebrow">
            <Sparkles size={14} />
            <span>Personality</span>
          </div>
          <div className="title-row">
            <h2 className="page-header__title">我的个性</h2>
            <span className={`tag ${isDirty ? "tag--yellow" : "tag--green"}`}>
              {isDirty ? "未保存" : "已同步"}
            </span>
          </div>
          <p className="page-header__subtitle personal-prompt-subtitle">
            维护一段长期说明，让助手持续理解你的角色、职责和协作方式。
          </p>
          <div className="header-meta-inline">
            <span className="meta-inline-item">最近更新: {updatedAtLabel}</span>
            <span className="meta-inline-item">系统会自动提炼摘要和标签</span>
          </div>
        </div>
        <div className="page-header__actions personal-prompt-actions">
          <span className="char-count">{draft.trim().length} 字</span>
          <button
            data-testid="personal-prompt-save"
            className="btn-primary save-button"
            type="button"
            disabled={isSaving || !isDirty}
            onClick={() => void handleSave()}
          >
            <Save size={14} />
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </header>

      <main className="page-content personal-prompt-content">
        <section className="prompt-layout">
          <article className="prompt-editor-panel">
            <div className="section-head compact">
              <div className="section-head-copy">
                <div className="section-title-row">
                  <FileText size={15} />
                  <h3>你的长期工作说明</h3>
                </div>
                <p className="section-helper">建议直接写角色、主要职责、常见产出，以及你希望助手如何配合你。</p>
              </div>
            </div>

            <textarea
              ref={textareaRef}
              data-testid="personal-prompt-textarea"
              className="textarea prompt-textarea"
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
                  <span className="hint-copy">草稿保存后会用于后续对话理解。</span>
                )}
              </div>
            </div>
          </article>

          <aside className="prompt-side-panel">
            <section className="prompt-info-panel">
              <div className="section-title-row">
                <UserRound size={15} />
                <h3>已提炼摘要</h3>
              </div>
              <p className="summary-copy">
                {savedProfile.summary || "保存后，系统会自动生成一段简短摘要，供运行时理解使用。"}
              </p>
            </section>

            <section className="prompt-info-panel">
              <div className="section-title-row">
                <Tag size={15} />
                <h3>识别到的工作标签</h3>
              </div>
              <div className="tag-list">
                {savedProfile.tags.length > 0 ? (
                  savedProfile.tags.map((tag) => (
                    <span key={tag} className="tag tag--accent">{tag}</span>
                  ))
                ) : (
                  <span className="tag tag--muted">保存后自动生成</span>
                )}
              </div>
            </section>

            <section className="prompt-info-panel prompt-examples-panel">
              <div className="section-title-row">
                <Sparkles size={15} />
                <h3>快速起步</h3>
              </div>
              <div className="list-rows example-list">
                {exampleDescriptors.map(({ example, title, preview }) => (
                  <button
                    key={example}
                    type="button"
                    className="list-row example-card"
                    onClick={() => applyExample(example)}
                  >
                    <span className="list-row__main">
                      <span className="list-row__title">{title}</span>
                      <span className="list-row__description">{preview}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </main>

      <style>{`
        .personal-prompt-page {
          container-type: inline-size;
        }

        .personal-prompt-header {
          align-items: flex-end;
        }

        .personal-prompt-header-text {
          gap: 8px;
        }

        .title-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .personal-prompt-actions {
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .personal-prompt-subtitle {
          max-width: 760px;
        }

        .header-meta-inline {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .meta-inline-item {
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 3px 8px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--glass-border);
          background: rgba(255,255,255,0.03);
          color: var(--text-secondary);
          font-size: 12px;
        }

        .personal-prompt-content {
          min-height: 0;
          overflow: hidden;
        }

        .prompt-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
          grid-template-rows: minmax(0, 1fr);
          gap: 16px;
          height: 100%;
          min-height: 0;
          align-items: stretch;
          overflow: hidden;
        }

        .prompt-editor-panel,
        .prompt-info-panel {
          background: var(--bg-surface);
          border: 1px solid var(--row-border);
          border-radius: var(--radius-lg);
        }

        .prompt-editor-panel {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          min-height: 0;
          overflow: hidden;
        }

        .section-head.compact {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .section-head-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .section-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-secondary);
          min-width: 0;
        }

        .section-title-row h3 {
          margin: 0;
          color: var(--text-primary);
          font-size: 15px;
          line-height: 1.4;
          font-weight: 600;
          letter-spacing: 0;
        }

        .section-helper {
          margin: 0;
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.5;
        }

        .char-count {
          flex-shrink: 0;
          height: 32px;
          padding: 0 10px;
          border-radius: var(--radius-md);
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
          min-height: 280px;
          resize: none;
          width: 100%;
          padding: 14px;
          font: 400 14px/1.8 "Inter", "SF Pro Text", "PingFang SC", sans-serif;
        }

        .prompt-textarea:focus {
          border-color: var(--accent-cyan);
          box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.14);
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
          flex-shrink: 0;
        }

        .prompt-side-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
          height: 100%;
          min-height: 0;
          overflow: auto;
          padding-right: 2px;
        }

        .prompt-info-panel {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
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

        .example-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .example-card {
          width: 100%;
          min-height: 64px;
          text-align: left;
          font: inherit;
          cursor: pointer;
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

          .personal-prompt-actions {
            width: 100%;
            justify-content: flex-start;
          }

          .header-meta-inline {
            justify-content: flex-start;
          }
        }

        @container (max-width: 860px) {
          .personal-prompt-content {
            overflow-y: auto;
            padding: 20px 24px 24px;
          }

          .prompt-layout {
            grid-template-columns: minmax(0, 1fr);
            height: auto;
            overflow: visible;
          }

          .prompt-side-panel {
            overflow: visible;
          }

          .prompt-textarea {
            min-height: 320px;
          }
        }
      `}</style>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SiliconPersonApprovalMode } from "@shared/contracts";
import { useWorkspaceStore } from "../stores/workspace";

type CreateStep = "identity" | "capabilities";

export default function SiliconPersonCreatePage() {
  const workspace = useWorkspaceStore();
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // 从已有员工复制
  const [templateSourceId, setTemplateSourceId] = useState("");

  // Step 1: 身份
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Step 2: 能力绑定
  const [approvalMode, setApprovalMode] = useState<SiliconPersonApprovalMode>("inherit");
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([]);
  const [inheritModel, setInheritModel] = useState(false);
  const [currentStep, setCurrentStep] = useState<CreateStep>("identity");

  const workflows = useMemo(() => workspace.workflows ?? [], [workspace.workflows]);

  useEffect(() => {
    if (workflows.length > 0) return;
    workspace.loadWorkflows?.().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 从已有员工复制身份字段到创建表单。 */
  function handleTemplateChange(siliconPersonId: string) {
    setTemplateSourceId(siliconPersonId);
    if (!siliconPersonId) return;
    const source = workspace.siliconPersons.find((item) => item.id === siliconPersonId);
    if (!source) return;
    setName(`${source.name}(副本)`);
    setTitle(source.title);
    setDescription(source.description);
  }

  function handleNextStep(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !description.trim()) {
      setCreateError("名称和职责描述不能为空。");
      return;
    }
    setCreateError("");
    setCurrentStep("capabilities");
  }

  function handleBackToIdentity() {
    setCurrentStep("identity");
    setCreateError("");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError("");
    setIsCreating(true);
    try {
      const currentModel = workspace.models.find((m) => m.id === workspace.defaultModelProfileId);
      const modelBindingSnapshot = inheritModel && currentModel ? {
        modelProfileId: currentModel.id,
        modelName: currentModel.name,
        frozenAt: new Date().toISOString(),
      } : null;
      const created = await workspace.createSiliconPerson({
        name: name.trim(),
        title: (title.trim() || name.trim()),
        description: description.trim(),
        modelBindingSnapshot,
      });
      // 创建后立即更新能力配置
      if (created?.id && (approvalMode !== "inherit" || selectedWorkflowIds.length > 0)) {
        await workspace.updateSiliconPerson(created.id, {
          approvalMode,
          workflowIds: selectedWorkflowIds,
        });
      }
      navigate("/employees");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "创建硅基员工失败。");
    } finally {
      setIsCreating(false);
    }
  }

  function toggleWorkflow(workflowId: string) {
    setSelectedWorkflowIds((prev) =>
      prev.includes(workflowId) ? prev.filter((id) => id !== workflowId) : [...prev, workflowId],
    );
  }

  return (
    <main data-testid="silicon-person-create-view" className="page-container" style={{ height: "100%", overflowY: "auto" }}>
      <header className="spc-page-header">
        <button className="glass-action-btn" onClick={() => navigate("/employees")}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          返回
        </button>
        <div className="header-text" style={{ marginTop: 16 }}>
          <span className="eyebrow">New Silicon Person</span>
          <h2 className="page-title">新建硅基员工</h2>
        </div>
      </header>

      <section className="glass-card glass-card--flat spc-form-card">
        {/* 步骤指示器 */}
        <div className="spc-step-indicator">
          <span className={`spc-step-dot${currentStep === "identity" ? " active" : " done"}`}>1</span>
          <span className="spc-step-line" />
          <span className={`spc-step-dot${currentStep === "capabilities" ? " active" : ""}`}>2</span>
        </div>
        <p className="spc-step-label">
          {currentStep === "identity" ? "第 1 步：创建身份" : "第 2 步：绑定能力"}
        </p>

        {currentStep === "identity" ? (
          <form data-testid="silicon-person-create-form" className="spc-form" onSubmit={handleNextStep}>
            {workspace.siliconPersons.length > 0 && (
              <label className="spc-field">
                <span>从已有员工复制</span>
                <select
                  value={templateSourceId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  data-testid="silicon-person-template-select"
                >
                  <option value="">不复制，从空白创建</option>
                  {workspace.siliconPersons.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="spc-field">
              <span>名称</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="silicon-person-create-name"
                type="text"
                placeholder="Ada"
              />
            </label>
            <label className="spc-field">
              <span>职位头衔</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="silicon-person-create-title"
                type="text"
                placeholder="研究搭档"
              />
            </label>
            <label className="spc-field">
              <span>职责描述</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="silicon-person-create-description"
                rows={3}
                placeholder="负责承接主聊天分发，并在私域空间内持续推进任务。"
              />
            </label>
            {createError && <p className="spc-error">{createError}</p>}
            <button className="btn-premium accent" type="submit" style={{ alignSelf: "stretch", justifyContent: "center" }}>
              下一步：绑定能力
            </button>
          </form>
        ) : (
          <form className="spc-form" data-testid="silicon-person-capabilities-form" onSubmit={handleCreate}>
            <div className="spc-identity-preview">
              <strong>{name}</strong>
              <span>{title || name}</span>
            </div>

            <label className="spc-field">
              <span>审批模式</span>
              <select
                value={approvalMode}
                onChange={(e) => setApprovalMode(e.target.value as SiliconPersonApprovalMode)}
                data-testid="silicon-person-create-approval-mode"
              >
                <option value="inherit">继承全局策略</option>
                <option value="always_ask">每次都问</option>
                <option value="auto_approve">自动批准</option>
              </select>
            </label>

            {workflows.length > 0 && (
              <fieldset className="spc-workflow-picker">
                <legend>绑定工作流（可选）</legend>
                {workflows.map((workflow) => (
                  <label key={workflow.id} className="spc-workflow-option">
                    <input
                      type="checkbox"
                      checked={selectedWorkflowIds.includes(workflow.id)}
                      onChange={() => toggleWorkflow(workflow.id)}
                    />
                    <span>{workflow.name}</span>
                  </label>
                ))}
              </fieldset>
            )}

            <label className="spc-model-toggle" data-testid="silicon-person-inherit-model">
              <input
                type="checkbox"
                checked={inheritModel}
                onChange={(e) => setInheritModel(e.target.checked)}
              />
              <span>集成当前模型配置</span>
              <p className="spc-toggle-hint">快照当前默认模型，创建后不随全局配置变化</p>
            </label>

            {createError && <p className="spc-error">{createError}</p>}
            <div className="spc-step-actions">
              <button type="button" className="glass-action-btn" onClick={handleBackToIdentity} style={{ height: 36, padding: "0 18px" }}>
                上一步
              </button>
              <button className="btn-premium accent" type="submit" disabled={isCreating} style={{ flex: 1, justifyContent: "center" }}>
                {isCreating ? "创建中..." : "创建硅基员工"}
              </button>
            </div>
          </form>
        )}
      </section>

      <style>{`
        .spc-page-header {
          margin-bottom: -8px;
        }

        .spc-form-card {
          max-width: 520px;
          padding: 28px;
        }

        .spc-step-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        .spc-step-dot {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 2px solid var(--glass-border);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-muted);
          transition: all 0.2s;
        }

        .spc-step-dot.active {
          border-color: var(--accent-cyan);
          color: var(--accent-cyan);
          background: rgba(16, 163, 127, 0.1);
        }

        .spc-step-dot.done {
          border-color: var(--status-green);
          color: var(--status-green);
          background: rgba(34, 197, 94, 0.1);
        }

        .spc-step-line {
          flex: 1;
          height: 2px;
          background: var(--glass-border);
        }

        .spc-step-label {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0 0 16px;
        }

        .spc-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .spc-identity-preview {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 10px 12px;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
        }

        .spc-identity-preview strong {
          color: var(--text-primary);
          font-size: 14px;
        }

        .spc-identity-preview span {
          color: var(--text-muted);
          font-size: 12px;
        }

        .spc-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
          color: var(--text-secondary);
          font-size: 13px;
        }

        .spc-field input, .spc-field textarea, .spc-field select {
          width: 100%;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 10px 12px;
          font: inherit;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .spc-field input:focus, .spc-field textarea:focus, .spc-field select:focus {
          border-color: var(--accent-cyan);
          box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.14);
          outline: none;
        }

        .spc-workflow-picker {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          padding: 12px;
          margin: 0;
        }

        .spc-workflow-picker legend {
          font-size: 13px;
          color: var(--text-secondary);
          padding: 0 4px;
        }

        .spc-workflow-option {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
          color: var(--text-primary);
          font-size: 14px;
          cursor: pointer;
        }

        .spc-workflow-option input[type="checkbox"] {
          accent-color: var(--accent-cyan);
        }

        .spc-model-toggle {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          color: var(--text-primary);
          font-size: 14px;
          cursor: pointer;
        }

        .spc-model-toggle input[type="checkbox"] {
          accent-color: var(--accent-cyan);
        }

        .spc-toggle-hint {
          width: 100%;
          margin: 0;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.5;
        }

        .spc-step-actions {
          display: flex;
          gap: 8px;
        }

        .spc-error {
          margin: 0;
          color: var(--status-red);
          font-size: 13px;
        }
      `}</style>
    </main>
  );
}

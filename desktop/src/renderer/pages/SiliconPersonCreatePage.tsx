import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ModelProfile, SiliconPersonApprovalMode } from "@shared/contracts";
import ReasoningPresetPanel from "../components/ReasoningPresetPanel";
import { useWorkspaceStore } from "../stores/workspace";
import { buildModelRuntimeStatusItems } from "../utils/model-profile-display";
import { resolveReasoningControlSpec } from "../utils/reasoning-controls";

/** 从“身份与人格”中提取一段稳定摘要，兼容现有列表页和工作台概览。 */
function deriveDescriptionFromSoul(input: string, fallbackName: string): string {
  const normalized = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  if (!normalized) {
    return `${fallbackName} 的初始人格设定`;
  }

  return normalized.length > 72 ? `${normalized.slice(0, 72).trim()}...` : normalized;
}

export default function SiliconPersonCreatePage() {
  const workspace = useWorkspaceStore();
  const siliconPersons = useWorkspaceStore((state) => state.siliconPersons);
  const models = useWorkspaceStore((state) => state.models);
  const defaultModelProfileId = useWorkspaceStore((state) => state.defaultModelProfileId);
  const loadSiliconPersons = useWorkspaceStore((state) => state.loadSiliconPersons);
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // 从已有员工复制
  const [templateSourceId, setTemplateSourceId] = useState("");

  // 基础资料
  const [name, setName] = useState("");
  const [soul, setSoul] = useState("");

  // 执行配置
  const [approvalMode, setApprovalMode] = useState<SiliconPersonApprovalMode>("inherit");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [reasoningEnabled, setReasoningEnabled] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState<"low" | "medium" | "high" | "xhigh">("medium");

  const personList = useMemo(() => siliconPersons ?? [], [siliconPersons]);
  const modelList = useMemo(() => models ?? [], [models]);
  const activeModelProfile = useMemo<ModelProfile | null>(
    () => modelList.find((model) => model.id === (selectedModelId || defaultModelProfileId || "")) ?? null,
    [defaultModelProfileId, modelList, selectedModelId],
  );
  const reasoningControlSpec = useMemo(
    () => resolveReasoningControlSpec(activeModelProfile),
    [activeModelProfile],
  );
  const runtimeModelStatusItems = useMemo(
    () => buildModelRuntimeStatusItems(activeModelProfile),
    [activeModelProfile],
  );

  const canCreate = Boolean(name.trim() && soul.trim());

  useEffect(() => {
    if (personList.length === 0) {
      loadSiliconPersons?.().catch(() => {});
    }
  }, [personList.length, loadSiliconPersons]);

  /** 从已有员工复制创建时仍然需要的字段。 */
  function handleTemplateChange(siliconPersonId: string) {
    setTemplateSourceId(siliconPersonId);
    if (!siliconPersonId) return;
    const source = personList.find((item) => item.id === siliconPersonId);
    if (!source) return;
    setName(`${source.name}(副本)`);
    setSoul(source.soul ?? "");
    setApprovalMode(source.approvalMode ?? "inherit");
    setSelectedModelId(source.modelProfileId ?? "");
    setReasoningEnabled(source.reasoningEnabled ?? true);
    setReasoningEffort(source.reasoningEffort ?? "medium");
  }

  /** 提交创建请求，并在创建后补写模型、审批与推理配置。 */
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !soul.trim()) {
      setCreateError("名称和身份与人格不能为空。");
      return;
    }

    setCreateError("");
    setIsCreating(true);

    try {
      const trimmedName = name.trim();
      const trimmedSoul = soul.trim();
      const created = await workspace.createSiliconPerson({
        name: trimmedName,
        title: trimmedName,
        description: deriveDescriptionFromSoul(trimmedSoul, trimmedName),
        soul: trimmedSoul,
      });

      // 创建接口当前只负责基础资料，扩展策略字段在创建后补写。
      if (
        created?.id &&
        (
          approvalMode !== "inherit" ||
          Boolean(selectedModelId) ||
          reasoningEnabled !== true ||
          reasoningEffort !== "medium"
        )
      ) {
        await workspace.updateSiliconPerson(created.id, {
          approvalMode,
          modelProfileId: selectedModelId || undefined,
          reasoningEnabled,
          reasoningEffort,
        });
      }

      navigate("/employees");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "创建硅基员工失败。");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main data-testid="silicon-person-create-view" className="page-container" style={{ height: "100%", overflowY: "auto" }}>
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">Silicon Person</span>
          <h2 className="page-title">新建硅基员工</h2>
          <p className="page-subtitle">只保留必要输入，创建后直接进入工作区。</p>
        </div>

        <div className="header-actions">
          <button type="button" className="glass-action-btn spc-back-btn" onClick={() => navigate("/employees")}>
            取消
          </button>
          <button
            className="btn-premium accent spc-submit-btn"
            type="submit"
            form="silicon-person-create-form"
            disabled={!canCreate || isCreating}
          >
            {isCreating ? "正在创建..." : "创建"}
          </button>
        </div>
      </header>

      {createError && <p className="spc-error">{createError}</p>}

      <form
        id="silicon-person-create-form"
        data-testid="silicon-person-create-form"
        className="spc-form"
        onSubmit={handleCreate}
      >
        {personList.length > 0 && (
          <section className="spc-copy-strip" aria-label="复制已有员工配置">
            <div className="spc-copy-strip-copy">
              <span className="spc-pane-title">快速开始</span>
              <p>可以先复制一个已有员工，再替换名字和人格提示词。</p>
            </div>
            <label className="spc-field spc-field--compact spc-copy-select">
              <span>从已有员工复制</span>
              <select
                value={templateSourceId}
                onChange={(e) => handleTemplateChange(e.target.value)}
                data-testid="silicon-person-template-select"
              >
                <option value="">不复制，从空白创建</option>
                {personList.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}

        <div className="spc-layout">
          <section className="spc-editor-pane">
            <div className="spc-pane-head">
              <div>
                <span className="spc-pane-title">身份设定</span>
                <p className="spc-pane-description">名称用于列表识别，身份与人格决定它的默认协作方式。</p>
              </div>
            </div>

            <label className="spc-field">
              <span>名称</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="silicon-person-create-name"
                type="text"
                placeholder="例如：Ada"
                autoFocus
              />
            </label>

            <label className="spc-field spc-field--grow">
              <span>身份与人格</span>
              <textarea
                value={soul}
                onChange={(e) => setSoul(e.target.value)}
                data-testid="silicon-person-create-soul"
                rows={10}
                placeholder="定义这个硅基员工的角色身份、行为风格与个性特征。"
              />
            </label>
          </section>

          <aside className="spc-config-pane">
            <div className="spc-pane-head">
              <div>
                <span className="spc-pane-title">执行策略</span>
                <p className="spc-pane-description">这些设置只定义默认行为，后续仍可在工作区继续调整。</p>
              </div>
            </div>

            <label className="spc-field spc-field--compact">
              <span>使用模型</span>
              <select
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                data-testid="silicon-person-create-model"
              >
                <option value="">跟随全局默认{defaultModelProfileId ? "（当前默认）" : ""}</option>
                {modelList.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>

            {runtimeModelStatusItems.length > 0 && (
              <div className="spc-model-status" data-testid="silicon-person-create-model-status">
                {runtimeModelStatusItems.map((item) => (
                  <span key={item.key} className={`spc-model-status-pill spc-model-status-pill--${item.tone}`}>
                    {item.label}
                  </span>
                ))}
              </div>
            )}

            <label className="spc-field spc-field--compact">
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

            <div className="spc-field spc-field--compact">
              <span>推理等级</span>
              <ReasoningPresetPanel
                spec={reasoningControlSpec}
                enabled={reasoningEnabled}
                effort={reasoningEffort}
                onEnabledChange={setReasoningEnabled}
                onEffortChange={setReasoningEffort}
                effortTestId="silicon-person-create-reasoning-effort"
              />
            </div>
          </aside>
        </div>
      </form>

      <style>{`
        .spc-back-btn {
          height: 38px;
          padding: 0 16px;
          font-size: 13px;
        }

        .spc-submit-btn {
          min-width: 132px;
          height: 40px;
          font-weight: 600;
        }

        .spc-form {
          display: flex;
          flex-direction: column;
          gap: 18px;
          width: 100%;
          min-height: calc(100vh - 258px);
        }

        .spc-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.5fr) minmax(300px, 0.78fr);
          gap: 18px;
          width: 100%;
          min-height: 0;
        }

        .spc-copy-strip {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
          gap: 18px;
          align-items: end;
          padding: 16px 18px;
          border-radius: 16px;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.015));
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .spc-copy-strip-copy {
          min-width: 0;
        }

        .spc-copy-strip-copy p {
          margin: 8px 0 0;
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.55;
        }

        .spc-copy-select {
          margin-left: auto;
          width: 100%;
        }

        .spc-editor-pane,
        .spc-config-pane {
          min-width: 0;
          min-height: 0;
          padding: 20px 22px 22px;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .spc-editor-pane {
          display: flex;
          flex-direction: column;
          gap: 16px;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.015));
        }

        .spc-config-pane {
          display: flex;
          flex-direction: column;
          gap: 16px;
          background:
            linear-gradient(180deg, rgba(16, 163, 127, 0.055), rgba(255, 255, 255, 0.015));
        }

        .spc-pane-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        .spc-pane-title {
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .spc-pane-description {
          margin: 8px 0 0;
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.55;
        }

        .spc-field {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
        }

        .spc-model-status {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: -2px;
        }

        .spc-model-status-pill {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-secondary);
          font-size: 12px;
          line-height: 1;
          white-space: nowrap;
        }

        .spc-model-status-pill--vendor,
        .spc-model-status-pill--protocol {
          color: var(--accent-strong);
          border-color: rgba(16, 163, 127, 0.26);
          background: rgba(16, 163, 127, 0.08);
        }

        .spc-field--full {
          grid-column: 1 / -1;
        }

        .spc-field--grow {
          flex: 1;
          min-height: 0;
        }

        .spc-field--compact {
          gap: 6px;
        }

        .spc-field > span {
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.01em;
        }

        .spc-field input,
        .spc-field textarea,
        .spc-field select {
          width: 100%;
          padding: 12px 14px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          background: rgba(6, 8, 10, 0.26);
          color: var(--text-primary);
          font: inherit;
          transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
        }

        .spc-field input:focus,
        .spc-field textarea:focus,
        .spc-field select:focus {
          border-color: var(--accent-cyan);
          background: rgba(8, 12, 14, 0.34);
          box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.09);
          outline: none;
        }

        .spc-field textarea {
          flex: 1;
          min-height: 332px;
          resize: vertical;
          line-height: 1.7;
        }

        .spc-error {
          margin: 0;
          color: var(--status-red);
          font-size: 13px;
        }

        @media (max-width: 760px) {
          .spc-copy-strip {
            grid-template-columns: 1fr;
            gap: 14px;
          }

          .spc-layout {
            grid-template-columns: 1fr;
            gap: 14px;
          }

          .spc-config-pane {
            padding-top: 20px;
          }

          .header-actions {
            width: 100%;
          }

          .header-actions > * {
            flex: 1;
          }

          .spc-form {
            min-height: auto;
          }

          .spc-field textarea {
            min-height: 220px;
          }
        }
      `}</style>
    </main>
  );
}

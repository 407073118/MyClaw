import React, { useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowDefinition, WorkflowRunSummary, WorkflowVariableDefinition } from "@shared/contracts";
import { Play } from "lucide-react";

import WorkflowCheckpointTimeline from "./WorkflowCheckpointTimeline";
import { getWorkflowRun } from "../../services/runtime-client";
import { useShellStore } from "../../stores/shell";
import { useWorkspaceStore } from "../../stores/workspace";

interface WorkflowRunPanelProps {
  workflowId: string;
  definition: WorkflowDefinition;
}

/** 将运行状态转成业务用户能理解的中文状态。 */
function formatRunStatus(status: string): string {
  switch (status) {
    case "succeeded":
      return "已成功";
    case "running":
      return "运行中";
    case "failed":
      return "已失败";
    case "waiting-input":
      return "等待输入";
    case "retry-scheduled":
      return "等待重试";
    case "canceled":
      return "已取消";
    default:
      return status;
  }
}

/** 生成运行历史的人话标题，避免用 runId 作为主展示内容。 */
function formatRunHistoryTitle(index: number, total: number): string {
  return `第 ${total - index} 次运行`;
}

/** 将节点输出转成适合 Run 面板直接阅读的文本。 */
function formatNodeReturnValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const primary = record.content ?? record.output ?? record.body ?? record.result;
    if (primary !== undefined) return formatNodeReturnValue(primary);
  }
  return JSON.stringify(value, null, 2);
}

/** 展示工作流运行记录、详情和检查点时间线。 */
export default function WorkflowRunPanel({ workflowId, definition }: WorkflowRunPanelProps) {
  const workspace = useWorkspaceStore();
  const shell = useShellStore();

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeRunDetail, setActiveRunDetail] = useState<Awaited<ReturnType<typeof getWorkflowRun>> | null>(null);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [panelError, setPanelError] = useState("");
  const [runInputValues, setRunInputValues] = useState<Record<string, string>>({});

  const nodeLabels = useMemo(
    () => new Map(definition.nodes.map((node) => [node.id, node.label] as const)),
    [definition.nodes],
  );

  const stateSchemaLabels = useMemo(
    () => new Map(definition.stateSchema.map((field) => [field.key, field.label || field.key] as const)),
    [definition.stateSchema],
  );

  const startInputVariables = useMemo<WorkflowVariableDefinition[]>(() => {
    const explicitInputs = (definition.variables ?? [])
      .filter((item) => item.scope === "input")
      .filter((item, index, list) => item.key && list.findIndex((other) => other.key === item.key) === index);
    if (explicitInputs.length > 0) return explicitInputs;
    return definition.stateSchema
      .filter((field) => field.required && field.producerNodeIds.length === 0)
      .map((field) => ({
        id: `state-input-${field.key}`,
        key: field.key,
        label: field.label || field.key,
        description: field.description,
        scope: "input",
        valueType: field.valueType,
        required: field.required,
      }));
  }, [definition.stateSchema, definition.variables]);

  const runs = useMemo(
    () =>
      (Object.values(workspace.workflowRuns) as WorkflowRunSummary[])
        .filter((run) => run.workflowId === workflowId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [workspace.workflowRuns, workflowId],
  );

  const currentNodeLabels = useMemo(() => {
    const currentNodeIds = activeRunDetail?.run.currentNodeIds ?? [];
    return currentNodeIds.map((nodeId) => nodeLabels.get(nodeId) ?? nodeId);
  }, [activeRunDetail, nodeLabels]);

  const lastError = useMemo(() => activeRunDetail?.run.error ?? "", [activeRunDetail]);

  /** 提取运行态，优先使用 checkpoint，其次使用 run.state，最后用 run.outputs 兜底。 */
  function extractRunState() {
    const checkpoints = activeRunDetail?.checkpoints ?? [];
    const latestCheckpointState = [...checkpoints]
      .reverse()
      .find((checkpoint) => checkpoint.interruptPayload)?.interruptPayload?.currentState;
    const runState = (activeRunDetail?.run as Record<string, unknown> | undefined)?.state;
    const runOutputs = (activeRunDetail?.run as Record<string, unknown> | undefined)?.outputs;
    if (latestCheckpointState) return latestCheckpointState;
    if (runState && typeof runState === "object") return runState as Record<string, unknown>;
    if (runOutputs && typeof runOutputs === "object" && !Array.isArray(runOutputs)) {
      return { outputs: runOutputs };
    }
    return {};
  }

  /** 提取最终输出，优先展示后端保存的 run.outputs。 */
  function extractRunOutputs() {
    const runOutputs = (activeRunDetail?.run as Record<string, unknown> | undefined)?.outputs;
    if (runOutputs && typeof runOutputs === "object" && !Array.isArray(runOutputs)) {
      return runOutputs as Record<string, unknown>;
    }
    const state = extractRunState();
    const outputs = state.outputs;
    if (outputs && typeof outputs === "object" && !Array.isArray(outputs)) {
      return outputs as Record<string, unknown>;
    }
    if (state.lastLlmOutput !== undefined) {
      return { output: state.lastLlmOutput };
    }
    return {};
  }

  const currentStateFields = useMemo(() => {
    const state = extractRunState();
    return Object.entries(state).map(([key, value]) => ({
      key,
      label: stateSchemaLabels.get(key) ?? key,
      value: typeof value === "string" ? value : JSON.stringify(value),
    }));
  }, [activeRunDetail, stateSchemaLabels]);

  const finalOutputFields = useMemo(() => {
    return Object.entries(extractRunOutputs()).map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    }));
  }, [activeRunDetail]);

  const nodeReturnFields = useMemo(() => {
    const state = extractRunState();
    const nodes = state.nodes;
    const byNodeId: Record<string, unknown> = {};
    if (nodes && typeof nodes === "object" && !Array.isArray(nodes)) {
      Object.assign(byNodeId, nodes as Record<string, unknown>);
    }
    for (const checkpoint of activeRunDetail?.checkpoints ?? []) {
      Object.assign(byNodeId, checkpoint.nodeOutputs ?? {});
    }
    const orderedNodeIds = [
      ...definition.nodes.map((node) => node.id),
      ...Object.keys(byNodeId).filter((nodeId) => !definition.nodes.some((node) => node.id === nodeId)),
    ];
    return orderedNodeIds
      .filter((nodeId, index, list) => list.indexOf(nodeId) === index && byNodeId[nodeId] !== undefined)
      .map((nodeId) => ({
        nodeId,
        label: nodeLabels.get(nodeId) ?? "已删除节点",
        value: formatNodeReturnValue(byNodeId[nodeId]),
      }));
  }, [activeRunDetail, definition.nodes, nodeLabels]);

  const stateFields = useMemo(() => {
    const lastInterrupt = [...(activeRunDetail?.checkpoints ?? [])]
      .reverse()
      .find((checkpoint) => checkpoint.interruptPayload)?.interruptPayload;
    const state = lastInterrupt?.currentState ?? {};
    return Object.entries(state).map(([key, value]) => ({
      key,
      label: stateSchemaLabels.get(key) ?? key,
      value: typeof value === "string" ? value : JSON.stringify(value),
    }));
  }, [activeRunDetail, stateSchemaLabels]);

  const canResume = useMemo(() => {
    if (!activeRunDetail) return false;
    return activeRunDetail.run.status === "waiting-input" || activeRunDetail.run.status === "retry-scheduled";
  }, [activeRunDetail]);

  const prevRunsRef = useRef<typeof runs | null>(null);
  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null);
      setActiveRunDetail(null);
      return;
    }
    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0]!.id);
    }
    prevRunsRef.current = runs;
  }, [runs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedRunId) {
      setActiveRunDetail(null);
      return;
    }
    loadRunDetail(selectedRunId);
  }, [selectedRunId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setIsLoadingRuns(true);
    workspace
      .loadWorkflowRuns()
      .catch(() => {
        setPanelError("加载运行记录失败。");
      })
      .finally(() => {
        setIsLoadingRuns(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const nextInputs: Record<string, string> = {};
    for (const variable of startInputVariables) {
      const defaultValue = variable.defaultValue;
      nextInputs[variable.key] =
        defaultValue === undefined || defaultValue === null
          ? ""
          : typeof defaultValue === "string"
            ? defaultValue
            : JSON.stringify(defaultValue);
    }
    setRunInputValues(nextInputs);
  }, [startInputVariables]);

  /** 加载指定运行的详情信息。*/
  async function loadRunDetail(runId: string) {
    setIsLoadingDetail(true);
    setPanelError("");
    try {
      const detail = await getWorkflowRun(shell.runtimeBaseUrl, runId);
      if (!detail) throw new Error("详情加载失败。");
      setActiveRunDetail(detail);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "详情加载失败。");
      setActiveRunDetail(null);
    } finally {
      setIsLoadingDetail(false);
    }
  }

  /** 启动一条新的工作流运行，并自动切到新运行详情。*/
  async function handleStartRun() {
    setIsStarting(true);
    setPanelError("");
    try {
      const initialState = buildInitialStateFromInputs();
      console.info("[workflow] 从运行面板启动 workflow", {
        workflowId,
        inputKeys: Object.keys(initialState ?? {}),
      });
      const result = await workspace.startWorkflowRun(workflowId, initialState);
      if (result.runId) {
        setSelectedRunId(result.runId);
        await loadRunDetail(result.runId);
      }
    } catch {
      setPanelError("启动失败。");
    } finally {
      setIsStarting(false);
    }
  }

  /** 将运行前表单转换为 workflow initialState。 */
  function buildInitialStateFromInputs(): Record<string, unknown> | undefined {
    if (startInputVariables.length === 0) return undefined;
    const initialState: Record<string, unknown> = {};
    for (const variable of startInputVariables) {
      const rawValue = runInputValues[variable.key] ?? "";
      if (!rawValue.trim() && !variable.required) continue;
      initialState[variable.key] = parseInputValue(rawValue, variable.valueType);
    }
    return initialState;
  }

  /** 按变量类型解析运行前输入，避免所有值都被当成字符串。 */
  function parseInputValue(rawValue: string, valueType: WorkflowVariableDefinition["valueType"]): unknown {
    if (valueType === "number") {
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) ? parsed : rawValue;
    }
    if (valueType === "boolean") {
      return rawValue === "true";
    }
    if (valueType === "object" || valueType === "array") {
      try {
        return JSON.parse(rawValue);
      } catch {
        return rawValue;
      }
    }
    return rawValue;
  }

  /** 更新运行前输入框的值，并记录字段名方便定位问题。 */
  function handleRunInputChange(key: string, value: string) {
    console.info("[workflow] 更新运行输入变量", { workflowId, key, valueLength: value.length });
    setRunInputValues((prev) => ({ ...prev, [key]: value }));
  }

  /** 恢复等待人工输入的运行。*/
  async function handleResumeRun() {
    const runId = selectedRunId ?? activeRunDetail?.run.id ?? null;
    if (!runId) return;
    setIsResuming(true);
    try {
      await workspace.resumeWorkflowRun(runId);
      await loadRunDetail(runId);
    } catch {
      setPanelError("恢复失败。");
    } finally {
      setIsResuming(false);
    }
  }

  return (
    <section data-testid="workflow-run-panel" className="run-panel">
      <header className="panel-header">
        <div className="header-left">
          <h3 className="panel-title">运行结果</h3>
          <span className="panel-desc">按节点查看返回内容、最终输出和执行过程。</span>
        </div>
        <div className="header-right">
          {panelError && <p className="error-toast">{panelError}</p>}
          <button
            data-testid="workflow-run-start"
            type="button"
            className="btn-primary-run"
            disabled={isStarting}
            onClick={handleStartRun}
          >
            <Play size={14} />
            启动运行
          </button>
        </div>
      </header>

      {startInputVariables.length > 0 && (
        <section className="run-inputs" data-testid="workflow-run-inputs">
          <div className="run-inputs__title">启动输入</div>
          <div className="run-inputs__grid">
            {startInputVariables.map((variable) => {
              const inputId = `workflow-run-input-${variable.key}`;
              return (
                <label key={variable.key} className="run-inputs__field" htmlFor={inputId}>
                  <span>{variable.label || variable.key}</span>
                  <input
                    id={inputId}
                    value={runInputValues[variable.key] ?? ""}
                    required={Boolean(variable.required)}
                    onChange={(event) => handleRunInputChange(variable.key, event.target.value)}
                  />
                </label>
              );
            })}
          </div>
        </section>
      )}

      <div className="panel-content">
        <aside className="runs-sidebar">
          <header className="sidebar-header">运行历史 ({runs.length})</header>
          {isLoadingRuns ? (
            <div className="empty-state">加载中...</div>
          ) : runs.length === 0 ? (
            <div className="empty-state">暂无记录</div>
          ) : (
            <div className="run-scroll">
              {runs.map((run, index) => (
                <button
                  key={run.id}
                  className={`run-item${run.id === selectedRunId ? " active" : ""}`}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <div className="run-item-top">
                    <span className="run-title">{formatRunHistoryTitle(index, runs.length)}</span>
                    <span className="run-status-dot" data-status={run.status}></span>
                  </div>
                  <div className="run-item-meta">{formatRunStatus(run.status)} · {run.updatedAt}</div>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="run-detail">
          {activeRunDetail ? (
            <>
              <header className="detail-header">
                <div className="detail-status">
                  <span className="status-pill" data-status={activeRunDetail.run.status}>
                    {formatRunStatus(activeRunDetail.run.status)}
                  </span>
                  <span className="detail-run-title">本次运行</span>
                </div>
                <details className="run-technical">
                  <summary>技术信息</summary>
                  <code>{activeRunDetail.run.id}</code>
                </details>
                {canResume && (
                  <button
                    data-testid="workflow-run-resume"
                    className="btn-resume"
                    disabled={isResuming}
                    onClick={handleResumeRun}
                  >
                    继续执行
                  </button>
                )}
              </header>

              <div className="detail-grid">
                {finalOutputFields.length > 0 && (
                  <div className="detail-card final-output">
                    <div className="card-title">最终输出</div>
                    <div className="card-body final-output-list">
                      {finalOutputFields.map((field) => (
                        <div key={field.key} className="final-output-row">
                          <span>{field.key}</span>
                          <pre>{field.value}</pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {currentNodeLabels.length > 0 && (
                  <div className="detail-card">
                    <div className="card-title">当前活跃节点</div>
                    <div className="card-body active-nodes">
                      {currentNodeLabels.join(", ")}
                    </div>
                  </div>
                )}

                <div className="detail-card node-returns">
                  <div className="card-title card-title--primary">
                    <span>节点返回</span>
                    {nodeReturnFields.length > 0 && (
                      <small>{nodeReturnFields.length} 个节点</small>
                    )}
                  </div>
                  <div className="card-body node-return-list">
                    {nodeReturnFields.length === 0 ? (
                      <div className="muted">暂无节点返回</div>
                    ) : (
                      nodeReturnFields.map((field, index) => (
                        <section key={field.nodeId} className="node-return-row">
                          <div className="node-return-heading">
                            <span className="node-return-index">{String(index + 1).padStart(2, "0")}</span>
                            <span className="node-return-name">{field.label}</span>
                          </div>
                          <pre>{field.value}</pre>
                        </section>
                      ))
                    )}
                  </div>
                </div>

                {lastError && (
                  <div className="detail-card error">
                    <div className="card-title">错误信息</div>
                    <div className="card-body">{lastError}</div>
                  </div>
                )}

                <details className="technical-state">
                  <summary>技术状态</summary>
                  <div className="state-grid">
                    {[...currentStateFields, ...stateFields].length === 0 ? (
                      <div className="muted">无状态数据</div>
                    ) : (
                      [...currentStateFields, ...stateFields].map((field, index) => (
                        <div key={`${field.key}-${index}`} className="state-row">
                          <span className="field-key">{field.label}:</span>
                          <span className="field-val">{field.value}</span>
                        </div>
                      ))
                    )}
                  </div>
                </details>

                <div className="detail-card timeline">
                  <div className="card-title">执行时间线</div>
                  <div className="card-body">
                    <WorkflowCheckpointTimeline
                      definition={definition}
                      checkpoints={activeRunDetail.checkpoints}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-detail">
              {isLoadingDetail ? "加载详情中..." : "选择一条运行记录查看详情。"}
            </div>
          )}
        </section>
      </div>

      <style>{`
        .run-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #0b0b0d;
          color: #a1a1aa;
        }
        .run-panel .panel-header {
          height: 52px;
          min-height: 52px;
          border-bottom: 1px solid #27272a;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          background: #111113;
        }
        .run-panel .header-left {
          display: flex;
          align-items: baseline;
          white-space: nowrap;
          overflow: hidden;
          flex: 1;
        }
        .run-panel .panel-title {
          font-size: 14px;
          color: #f4f4f5;
          font-weight: 700;
          margin: 0;
          margin-right: 12px;
          flex-shrink: 0;
        }
        .run-panel .panel-desc {
          font-size: 12px;
          color: #71717a;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .run-panel .header-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .run-panel .run-inputs {
          border-bottom: 1px solid #27272a;
          padding: 10px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          background: #101013;
        }
        .run-panel .run-inputs__title {
          flex: 0 0 auto;
          color: #f4f4f5;
          font-size: 12px;
          font-weight: 700;
        }
        .run-panel .run-inputs__grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 8px;
          width: 100%;
        }
        .run-panel .run-inputs__field {
          display: grid;
          grid-template-columns: minmax(56px, auto) minmax(0, 1fr);
          align-items: center;
          gap: 8px;
          color: #a1a1aa;
          font-size: 12px;
        }
        .run-panel .run-inputs__field input {
          width: 100%;
          min-width: 0;
          border: 1px solid #27272a;
          border-radius: 4px;
          background: #0d0d0f;
          color: #f4f4f5;
          padding: 5px 8px;
          font: inherit;
        }
        .run-panel .btn-primary-run {
          background: #f4f4f5;
          color: #09090b;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .run-panel .btn-primary-run:hover:not(:disabled) { background: #ffffff; }
        .run-panel .btn-primary-run:disabled { opacity: 0.5; }
        .run-panel .panel-content {
          flex: 1;
          display: flex;
          overflow: hidden;
        }
        .run-panel .runs-sidebar {
          width: 196px;
          border-right: 1px solid #27272a;
          display: flex;
          flex-direction: column;
          background: #0d0d0f;
        }
        .run-panel .sidebar-header {
          padding: 10px 12px 8px;
          font-size: 11px;
          font-weight: 700;
          color: #a1a1aa;
        }
        .run-panel .run-scroll {
          flex: 1;
          overflow-y: auto;
        }
        .run-panel .run-item {
          width: 100%;
          padding: 11px 12px;
          border: none;
          background: transparent;
          border-bottom: 1px solid #1c1c1f;
          text-align: left;
          cursor: pointer;
          transition: all 0.2s;
        }
        .run-panel .run-item:hover { background: #18181b; }
        .run-panel .run-item.active {
          background: #1a1a1e;
          box-shadow: inset 3px 0 0 #e4e4e7;
        }
        .run-panel .run-title { font-size: 12px; font-weight: 700; color: #e4e4e7; }
        .run-panel .run-item-top { display: flex; align-items: center; justify-content: space-between; }
        .run-panel .run-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #52525b; }
        .run-panel .run-status-dot[data-status="succeeded"] { background: #10b981; }
        .run-panel .run-status-dot[data-status="running"] { background: #2563eb; }
        .run-panel .run-status-dot[data-status="failed"] { background: #ef4444; }
        .run-panel .run-item-meta { font-size: 10px; color: #52525b; margin-top: 4px; }
        .run-panel .run-detail {
          flex: 1;
          overflow-y: auto;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .run-panel .detail-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid #27272a;
          border-radius: 8px;
          background: #111113;
        }
        .run-panel .status-pill {
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          background: #27272a;
          color: #a1a1aa;
        }
        .run-panel .status-pill[data-status="succeeded"] { background: rgba(16, 185, 129, 0.1); color: #10b981; }
        .run-panel .status-pill[data-status="failed"] { background: rgba(239, 68, 68, 0.1); color: #f87171; }
        .run-panel .detail-run-title { font-size: 12px; color: #a1a1aa; margin-left: 12px; }
        .run-panel .run-technical {
          margin-left: auto;
          font-size: 11px;
          color: #52525b;
        }
        .run-panel .run-technical summary {
          cursor: pointer;
          user-select: none;
        }
        .run-panel .run-technical code {
          display: block;
          margin-top: 4px;
          font-family: monospace;
        }
        .run-panel .btn-resume { background: #10b981; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; }
        .run-panel .detail-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 12px;
        }
        .run-panel .detail-card {
          background: #141416;
          border: 1px solid #27272a;
          border-radius: 8px;
          padding: 12px;
        }
        .run-panel .detail-card.final-output {
          grid-column: 1 / -1;
          border-color: rgba(16, 185, 129, 0.26);
          background: rgba(16, 185, 129, 0.055);
        }
        .run-panel .detail-card.error { border-color: #ef4444; background: rgba(239, 68, 68, 0.05); }
        .run-panel .detail-card.timeline { grid-column: 1 / -1; }
        .run-panel .detail-card.node-returns {
          grid-column: 1 / -1;
          border-color: #333338;
          background: #121214;
          padding: 0;
          overflow: hidden;
        }
        .run-panel .card-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          font-size: 12px;
          font-weight: 700;
          color: #a1a1aa;
          margin-bottom: 8px;
        }
        .run-panel .card-title small {
          color: #71717a;
          font-size: 11px;
          font-weight: 600;
        }
        .run-panel .card-title--primary {
          margin: 0;
          padding: 12px 14px;
          border-bottom: 1px solid #27272a;
          color: #f4f4f5;
          background: #17171a;
        }
        .run-panel .card-body { font-size: 12px; color: #d4d4d8; }
        .run-panel .node-return-list {
          display: grid;
          gap: 0;
        }
        .run-panel .node-return-row {
          display: grid;
          grid-template-columns: minmax(132px, 0.28fr) minmax(0, 1fr);
          gap: 14px;
          align-items: start;
          border-bottom: 1px solid #242428;
          padding: 13px 14px;
          background: #101012;
        }
        .run-panel .node-return-row:last-child {
          border-bottom: 0;
        }
        .run-panel .node-return-row:hover {
          background: #151518;
        }
        .run-panel .node-return-heading {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .run-panel .node-return-index {
          flex: 0 0 auto;
          width: 24px;
          color: #71717a;
          font-size: 11px;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
        }
        .run-panel .node-return-name {
          min-width: 0;
          color: #e4e4e7;
          font-size: 12px;
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .run-panel .node-return-row pre {
          margin: 0;
          min-width: 0;
          color: #f4f4f5;
          font-size: 13px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .run-panel .state-grid { display: flex; flex-direction: column; gap: 4px; }
        .run-panel .state-row { display: flex; gap: 8px; border-bottom: 1px solid #1c1c1f; padding-bottom: 4px; }
        .run-panel .field-key { color: #52525b; font-weight: 600; width: 100px; flex-shrink: 0; }
        .run-panel .field-val { color: #a1a1aa; word-break: break-all; }
        .run-panel .technical-state {
          grid-column: 1 / -1;
          border: 1px dashed #303036;
          border-radius: 7px;
          padding: 9px 11px;
          background: #101012;
          color: #71717a;
          font-size: 12px;
        }
        .run-panel .technical-state summary {
          cursor: pointer;
          user-select: none;
          font-weight: 700;
        }
        .run-panel .technical-state .state-grid {
          margin-top: 10px;
        }
        .run-panel .final-output-list { display: grid; gap: 8px; }
        .run-panel .final-output-row { display: grid; gap: 5px; }
        .run-panel .final-output-row span { color: #34d399; font-size: 12px; font-weight: 700; }
        .run-panel .final-output-row pre {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          border: 1px solid rgba(16, 185, 129, 0.18);
          border-radius: 6px;
          padding: 8px;
          background: #0d0d0f;
          color: #d4d4d8;
          font-size: 12px;
          line-height: 1.5;
        }
        .run-panel .empty-detail { flex: 1; display: grid; place-items: center; font-size: 12px; color: #52525b; }
        .run-panel .error-toast { color: #ef4444; font-size: 11px; margin: 0; }
        .run-panel .empty-state { padding: 12px; font-size: 12px; color: #52525b; }
      `}</style>
    </section>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowDefinition, WorkflowRunSummary } from "@shared/contracts";
import { Play } from "lucide-react";

import WorkflowCheckpointTimeline from "./WorkflowCheckpointTimeline";
import { getWorkflowRun, type GetWorkflowRunPayload } from "../../services/runtime-client";
import { useShellStore } from "../../stores/shell";
import { useWorkspaceStore } from "../../stores/workspace";

interface WorkflowRunPanelProps {
  workflowId: string;
  definition: WorkflowDefinition;
}

export default function WorkflowRunPanel({ workflowId, definition }: WorkflowRunPanelProps) {
  const workspace = useWorkspaceStore();
  const shell = useShellStore();

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeRunDetail, setActiveRunDetail] = useState<GetWorkflowRunPayload | null>(null);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [panelError, setPanelError] = useState("");

  const nodeLabels = useMemo(
    () => new Map(definition.nodes.map((node) => [node.id, node.label] as const)),
    [definition.nodes],
  );

  const stateSchemaLabels = useMemo(
    () => new Map(definition.stateSchema.map((field) => [field.key, field.label || field.key] as const)),
    [definition.stateSchema],
  );

  const runs = useMemo(
    () =>
      (Object.values(workspace.workflowRuns) as WorkflowRunSummary[])
        .filter((run) => run.workflowId === workflowId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [workspace.workflowRuns, workflowId],
  );

  const latestCheckpoint = useMemo(() => {
    const checkpoints = activeRunDetail?.checkpoints ?? [];
    return checkpoints.length ? checkpoints[checkpoints.length - 1] : null;
  }, [activeRunDetail]);

  const currentNodeLabels = useMemo(() => {
    const currentNodeIds = activeRunDetail?.run.currentNodeIds ?? [];
    return currentNodeIds.map((nodeId) => nodeLabels.get(nodeId) ?? nodeId);
  }, [activeRunDetail, nodeLabels]);

  const lastError = useMemo(() => {
    const checkpoints = activeRunDetail?.checkpoints ?? [];
    return [...checkpoints].reverse().find((checkpoint) => checkpoint.error)?.error ?? "";
  }, [activeRunDetail]);

  const stateFields = useMemo(() => {
    const state = activeRunDetail?.run.state ?? {};
    return Object.entries(state).map(([key, value]) => ({
      key,
      label: stateSchemaLabels.get(key) ?? key,
      value: typeof value === "string" ? value : JSON.stringify(value),
    }));
  }, [activeRunDetail, stateSchemaLabels]);

  const canResume = useMemo(() => {
    if (!activeRunDetail) return false;
    const latestStatus = latestCheckpoint?.status;
    return activeRunDetail.run.status === "waiting-input" || latestStatus === "waiting-human-input";
  }, [activeRunDetail, latestCheckpoint]);

  // Sync selectedRunId when runs change
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

  // Load detail when selectedRunId changes
  useEffect(() => {
    if (!selectedRunId) {
      setActiveRunDetail(null);
      return;
    }
    loadRunDetail(selectedRunId);
  }, [selectedRunId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load runs on mount
  useEffect(() => {
    setIsLoadingRuns(true);
    workspace
      .loadWorkflowRuns()
      .catch(() => {
        setPanelError("加载运行记录失败");
      })
      .finally(() => {
        setIsLoadingRuns(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRunDetail(runId: string) {
    setIsLoadingDetail(true);
    setPanelError("");
    try {
      const detail = await getWorkflowRun(shell.runtimeBaseUrl, runId);
      setActiveRunDetail(detail);
    } catch {
      setPanelError("详情加载失败");
      setActiveRunDetail(null);
    } finally {
      setIsLoadingDetail(false);
    }
  }

  async function handleStartRun() {
    setIsStarting(true);
    setPanelError("");
    try {
      const run = await workspace.startWorkflowRun(workflowId) as WorkflowRunSummary;
      setSelectedRunId(run.id);
      await loadRunDetail(run.id);
    } catch {
      setPanelError("启动失败");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleResumeRun() {
    const runId = selectedRunId ?? activeRunDetail?.run.id ?? null;
    if (!runId) return;
    setIsResuming(true);
    try {
      await workspace.resumeWorkflowRun(runId);
      await loadRunDetail(runId);
    } catch {
      setPanelError("恢复失败");
    } finally {
      setIsResuming(false);
    }
  }

  return (
    <section data-testid="workflow-run-panel" className="run-panel">
      <header className="panel-header">
        <div className="header-left">
          <h3 className="panel-title">运行调试</h3>
          <span className="panel-desc">查看运行记录、状态预览及 Checkpoints 时间轴</span>
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

      <div className="panel-content">
        <aside className="runs-sidebar">
          <header className="sidebar-header">运行历史 ({runs.length})</header>
          {isLoadingRuns ? (
            <div className="empty-state">加载中...</div>
          ) : runs.length === 0 ? (
            <div className="empty-state">暂无记录</div>
          ) : (
            <div className="run-scroll">
              {runs.map((run) => (
                <button
                  key={run.id}
                  className={`run-item${run.id === selectedRunId ? " active" : ""}`}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <div className="run-item-top">
                    <span className="run-id-short">ID: {run.id.slice(0, 8)}</span>
                    <span className="run-status-dot" data-status={run.status}></span>
                  </div>
                  <div className="run-item-meta">{run.updatedAt}</div>
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
                    {activeRunDetail.run.status}
                  </span>
                  <span className="detail-run-id">ID: {activeRunDetail.run.id}</span>
                </div>
                {canResume && (
                  <button
                    className="btn-resume"
                    disabled={isResuming}
                    onClick={handleResumeRun}
                  >
                    继续执行
                  </button>
                )}
              </header>

              <div className="detail-grid">
                {currentNodeLabels.length > 0 && (
                  <div className="detail-card">
                    <div className="card-title">当前活跃节点</div>
                    <div className="card-body active-nodes">
                      {currentNodeLabels.join(", ")}
                    </div>
                  </div>
                )}

                {lastError && (
                  <div className="detail-card error">
                    <div className="card-title">错误信息</div>
                    <div className="card-body">{lastError}</div>
                  </div>
                )}

                <div className="detail-card">
                  <div className="card-title">状态预览 (State)</div>
                  <div className="card-body state-grid">
                    {stateFields.length === 0 ? (
                      <div className="muted">无状态数据</div>
                    ) : (
                      stateFields.map((field) => (
                        <div key={field.key} className="state-row">
                          <span className="field-key">{field.label}:</span>
                          <span className="field-val">{field.value}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="detail-card timeline">
                  <div className="card-title">执行时间轴</div>
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
              {isLoadingDetail ? "加载详情中..." : "选择一条运行记录查看详情"}
            </div>
          )}
        </section>
      </div>

      <style>{`
        .run-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #0d0d0f;
          color: #a1a1aa;
        }
        .run-panel .panel-header {
          height: 48px;
          min-height: 48px;
          border-bottom: 1px solid #27272a;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          background: #121214;
        }
        .run-panel .header-left {
          display: flex;
          align-items: baseline;
          white-space: nowrap;
          overflow: hidden;
          flex: 1;
        }
        .run-panel .panel-title {
          font-size: 13px;
          color: #f4f4f5;
          font-weight: 700;
          margin: 0;
          margin-right: 12px;
          flex-shrink: 0;
        }
        .run-panel .panel-desc {
          font-size: 11px;
          color: #52525b;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .run-panel .header-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .run-panel .btn-primary-run {
          background: #2563eb;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 4px 12px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .run-panel .btn-primary-run:hover:not(:disabled) { background: #3b82f6; }
        .run-panel .btn-primary-run:disabled { opacity: 0.5; }
        .run-panel .panel-content {
          flex: 1;
          display: flex;
          overflow: hidden;
        }
        .run-panel .runs-sidebar {
          width: 180px;
          border-right: 1px solid #27272a;
          display: flex;
          flex-direction: column;
          background: #0d0d0f;
        }
        .run-panel .sidebar-header {
          padding: 8px 12px;
          font-size: 11px;
          font-weight: 700;
          color: #71717a;
          text-transform: uppercase;
        }
        .run-panel .run-scroll {
          flex: 1;
          overflow-y: auto;
        }
        .run-panel .run-item {
          width: 100%;
          padding: 10px 12px;
          border: none;
          background: transparent;
          border-bottom: 1px solid #1c1c1f;
          text-align: left;
          cursor: pointer;
          transition: all 0.2s;
        }
        .run-panel .run-item:hover { background: #18181b; }
        .run-panel .run-item.active { background: #1e1e24; border-left: 2px solid #2563eb; }
        .run-panel .run-id-short { font-size: 11px; font-family: monospace; color: #a1a1aa; }
        .run-panel .run-item-top { display: flex; align-items: center; justify-content: space-between; }
        .run-panel .run-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #52525b; }
        .run-panel .run-status-dot[data-status="success"] { background: #10b981; }
        .run-panel .run-status-dot[data-status="running"] { background: #2563eb; }
        .run-panel .run-status-dot[data-status="failed"] { background: #ef4444; }
        .run-panel .run-item-meta { font-size: 10px; color: #52525b; margin-top: 4px; }
        .run-panel .run-detail {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .run-panel .detail-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 12px;
          border-bottom: 1px solid #27272a;
        }
        .run-panel .status-pill {
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          background: #27272a;
          color: #a1a1aa;
        }
        .run-panel .status-pill[data-status="success"] { background: rgba(16, 185, 129, 0.1); color: #10b981; }
        .run-panel .status-pill[data-status="failed"] { background: rgba(239, 68, 68, 0.1); color: #f87171; }
        .run-panel .detail-run-id { font-size: 11px; color: #52525b; margin-left: 12px; font-family: monospace; }
        .run-panel .btn-resume { background: #10b981; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; }
        .run-panel .detail-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 16px;
        }
        .run-panel .detail-card {
          background: #161618;
          border: 1px solid #27272a;
          border-radius: 8px;
          padding: 12px;
        }
        .run-panel .detail-card.error { border-color: #ef4444; background: rgba(239, 68, 68, 0.05); }
        .run-panel .detail-card.timeline { grid-column: 1 / -1; }
        .run-panel .card-title { font-size: 11px; font-weight: 700; color: #71717a; text-transform: uppercase; margin-bottom: 8px; }
        .run-panel .card-body { font-size: 12px; color: #d4d4d8; }
        .run-panel .state-grid { display: flex; flex-direction: column; gap: 4px; }
        .run-panel .state-row { display: flex; gap: 8px; border-bottom: 1px solid #1c1c1f; padding-bottom: 4px; }
        .run-panel .field-key { color: #52525b; font-weight: 600; width: 100px; flex-shrink: 0; }
        .run-panel .field-val { color: #a1a1aa; word-break: break-all; }
        .run-panel .empty-detail { flex: 1; display: grid; place-items: center; font-size: 12px; color: #52525b; }
        .run-panel .error-toast { color: #ef4444; font-size: 11px; margin: 0; }
        .run-panel .empty-state { padding: 12px; font-size: 12px; color: #52525b; }
      `}</style>
    </section>
  );
}

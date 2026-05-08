import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, Play, Plus, Settings2, Trash2, Workflow, X } from "lucide-react";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { useWorkspaceStore } from "../stores/workspace";
import { useWorkflowRunsStore } from "../stores/workflow-runs";
import type { WorkflowSummary } from "@shared/contracts";

// ── 筛选类型 ──────────────────────────────────────────────────────────────────

interface WorkflowLibraryFilterState {
  query: string;
  status: "all" | "draft" | "active" | "archived";
  sort: "updated-desc" | "name-asc" | "nodes-desc";
}

// ── 排序与筛选辅助方法 ────────────────────────────────────────────────────────

/** 生成可安全比较的名称字段。 */
function safeComparableName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** 生成可安全比较的更新时间戳。 */
function safeComparableUpdatedAt(value: unknown): number {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : -1;
}

/** 生成可安全比较的节点数量。 */
function safeComparableNodeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : -1;
}

// ── 运行状态与时间辅助方法 ────────────────────────────────────────────────────

/** 将 ISO 时间字符串转换为相对时间描述（中文）。 */
function timeAgo(isoString: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
  return `${Math.floor(seconds / 86400)}天前`;
}

/** 计算运行时长的可读描述。 */
function formatDuration(startedAt: string, finishedAt?: string): string {
  if (!finishedAt) return "进行中";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

// ── WorkflowsPage 页面 ────────────────────────────────────────────────────────

/** 渲染工作流资源库，并负责创建、筛选与运行入口。 */
export default function WorkflowsPage() {
  const workspace = useWorkspaceStore();
  const { runHistory, loadRunHistory } = useWorkflowRunsStore();
  const navigate = useNavigate();

  const [isCreating, setIsCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const createNameInputRef = useRef<HTMLInputElement>(null);
  const [filters, setFilters] = useState<WorkflowLibraryFilterState>({
    query: "",
    status: "all",
    sort: "updated-desc",
  });

  /** 关闭工作流创建弹窗。 */
  const closeCreateModal = useCallback(() => {
    setShowCreateModal(false);
  }, []);

  const { captureTrigger: captureCreateTrigger } = useDialogA11y({
    isOpen: showCreateModal,
    onClose: closeCreateModal,
    initialFocusRef: createNameInputRef,
    dialogName: "workflow-create",
  });

  /** 打开工作流创建弹窗，并记录触发按钮。 */
  const openCreateModal = useCallback((trigger?: HTMLElement | null) => {
    captureCreateTrigger(trigger);
    setShowCreateModal(true);
  }, [captureCreateTrigger]);

  useEffect(() => {
    if (
      workspace.workflows.length > 0 ||
      Object.keys(workspace.workflowSummaries ?? {}).length > 0
    ) {
      return;
    }
    workspace.loadWorkflows().catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "Load workflows failed.");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 加载最近运行记录。 */
  useEffect(() => {
    loadRunHistory();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 归一化工作流摘要来源，优先使用 summary map。 */
  function normalizeSummaries(): WorkflowSummary[] {
    const values = Object.values(workspace.workflowSummaries ?? {}) as WorkflowSummary[];
    const cleaned = values.filter(
      (item: WorkflowSummary) => item && typeof item.id === "string" && item.id.trim().length > 0,
    );
    if (cleaned.length > 0) return cleaned;
    return (workspace.workflows as unknown as WorkflowSummary[]).filter(
      (item: WorkflowSummary) => item && typeof item.id === "string" && item.id.trim().length > 0,
    );
  }

  /** 根据 workflowId 查找工作流名称。 */
  const workflowNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of normalizeSummaries()) {
      if (s.id && s.name) map[s.id] = s.name;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.workflowSummaries, workspace.workflows]);

  /** 取最近 20 条运行记录用于展示。 */
  const recentRuns = useMemo(() => {
    return runHistory.slice(0, 20);
  }, [runHistory]);

  const filteredWorkflows = useMemo(() => {
    const list = normalizeSummaries();
    const query = filters.query.trim().toLowerCase();
    const status = filters.status;
    const sort = filters.sort;

    const filtered = list.filter((summary) => {
      if (status !== "all" && summary.status !== status) return false;
      if (!query) return true;
      const haystack = `${summary.name ?? ""} ${summary.description ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });

    return [...filtered].sort((a, b) => {
      if (sort === "name-asc") {
        return safeComparableName(a.name).localeCompare(safeComparableName(b.name));
      }
      if (sort === "nodes-desc") {
        return safeComparableNodeCount(b.nodeCount) - safeComparableNodeCount(a.nodeCount);
      }
      return safeComparableUpdatedAt(b.updatedAt) - safeComparableUpdatedAt(a.updatedAt);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.workflowSummaries, workspace.workflows, filters]);

  /** 启动指定工作流运行，并在失败时提示原因。runId 缺失视为启动失败。 */
  async function handleExecute(workflowId: string) {
    try {
      const result = await workspace.startWorkflowRun(workflowId);
      if (!result?.runId) {
        throw new Error("启动失败：未返回 runId");
      }
      console.info("[workflows] 已启动工作流运行", { workflowId, runId: result.runId });
      // 刷新运行历史，让新运行立即可见
      loadRunHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : "执行失败。";
      alert(`启动工作流失败：${message}`);
    }
  }

  /** 处理工作流删除：调用 IPC 真正落盘删除，store 会自动从列表中剔除。 */
  async function handleDelete(workflowId: string) {
    if (!confirm("确认删除该工作流？此操作不可撤销。")) return;
    try {
      await workspace.deleteWorkflow(workflowId);
      console.info("[workflows] 已删除工作流", { workflowId });
      // workspace.deleteWorkflow 已自动从 workflows / workflowSummaries / workflowDefinitions 中剔除该项；
      // 不在此弹出成功提示，列表条目消失即视觉反馈。
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败。";
      alert(`删除工作流失败：${message}`);
    }
  }

  /** 创建新工作流，并写入一个最小可用的起止节点图。 */
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isCreating) return;

    const name = draftName.trim();
    const description = draftDescription.trim();

    if (!name || !description) {
      setCreateError("Name and description are required.");
      return;
    }

    setCreateError("");
    setIsCreating(true);
    let createdWorkflowId = "";
    try {
      console.info("[workflows] Creating workflow", { name });
      const created = await workspace.createWorkflow({ name, description }) as { id: string };
      createdWorkflowId = created.id;
      console.info("[workflows] Workflow created, bootstrapping starter graph", {
        workflowId: created.id,
      });

      await workspace.updateWorkflow(created.id, {
        entryNodeId: "node-start",
        nodes: [
          { id: "node-start", kind: "start", label: "Start" },
          { id: "node-end", kind: "end", label: "End" },
        ],
        edges: [
          {
            id: "edge-start-end",
            fromNodeId: "node-start",
            toNodeId: "node-end",
            kind: "normal",
          },
        ],
      });

      setDraftCode("");
      setDraftName("");
      setDraftDescription("");
      setShowCreateModal(false);

      navigate(`/workflows/${encodeURIComponent(createdWorkflowId)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Create workflow failed.";
      setCreateError(
        createdWorkflowId
          ? `Workflow created but starter graph setup failed: ${message}`
          : message,
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="page-shell" data-testid="workflows-view">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <Workflow size={14} />
            <span>Workflows</span>
          </div>
          <h2 className="page-header__title">本地工作流库</h2>
          <p className="page-header__subtitle">
            在本地 Runtime 上设计、管理和执行可复用的 AI 代理与自动化流程。
          </p>
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className="btn-primary"
            onClick={(event) => openCreateModal(event.currentTarget)}
          >
            <Plus size={14} />
            新建工作流
          </button>
        </div>
      </header>

      <main className="page-content">
        {loadError ? (
          <div className="banner banner--error">
            <AlertCircle size={16} />
            <span>{loadError}</span>
          </div>
        ) : (
          <>
            <div className="toolbar">
              <input
                className="input toolbar__search"
                type="text"
                placeholder="搜索工作流…"
                value={filters.query}
                onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              />
              <select
                className="select"
                value={filters.status}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value as WorkflowLibraryFilterState["status"] })
                }
              >
                <option value="all">全部状态</option>
                <option value="draft">草稿</option>
                <option value="active">已启用</option>
                <option value="archived">已归档</option>
              </select>
              <select
                className="select"
                value={filters.sort}
                onChange={(e) =>
                  setFilters({ ...filters, sort: e.target.value as WorkflowLibraryFilterState["sort"] })
                }
              >
                <option value="updated-desc">最近更新</option>
                <option value="name-asc">名称 A→Z</option>
                <option value="nodes-desc">节点最多</option>
              </select>
              <span className="toolbar__count">{filteredWorkflows.length} 条</span>
            </div>

            {filteredWorkflows.length === 0 ? (
              <section className="empty-state">
                <Workflow size={32} className="empty-state__icon" />
                <h3 className="empty-state__title">当前空间内暂无工作流</h3>
                <p className="empty-state__body">创建一个新工作流来开始吧。</p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={(event) => openCreateModal(event.currentTarget)}
                >
                  <Plus size={14} />
                  新建工作流
                </button>
              </section>
            ) : (
              <div className="list-rows" aria-label="Workflow summaries">
                {filteredWorkflows.map((summary) => {
                  const statusLabel: Record<string, string> = {
                    draft: "草稿",
                    active: "已启用",
                    archived: "已归档",
                  };
                  const status = summary.status ?? "draft";
                  const variant: "green" | "yellow" | "muted" =
                    status === "active" ? "green" : status === "archived" ? "muted" : "yellow";
                  return (
                    <article key={summary.id} className="list-row">
                      <div className="list-row__lead">
                        <span
                          className={`status-dot status-dot--${variant}`}
                          title={statusLabel[status]}
                        />
                      </div>
                      <div className="list-row__main">
                        <div className="list-row__title-row">
                          <Link
                            to={`/workflows/${encodeURIComponent(summary.id)}`}
                            className="list-row__title"
                          >
                            {summary.name}
                          </Link>
                          <span className={`tag tag--${variant}`}>{statusLabel[status]}</span>
                        </div>
                        <div className="list-row__meta-row">
                          {summary.nodeCount != null && (
                            <>
                              <span className="list-row__meta">{summary.nodeCount} 节点</span>
                              <span className="list-row__meta-sep" />
                            </>
                          )}
                          {summary.updatedAt && (
                            <span className="list-row__meta">
                              {new Date(summary.updatedAt).toLocaleDateString("zh-CN")}
                            </span>
                          )}
                          {summary.description && (
                            <>
                              <span className="list-row__meta-sep" />
                              <span className="list-row__meta" title={summary.description}>
                                {summary.description}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="list-row__trailing">
                        <button
                          type="button"
                          className="icon-btn"
                          title="运行"
                          onClick={() => handleExecute(summary.id)}
                        >
                          <Play size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="删除"
                          onClick={() => handleDelete(summary.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                        <Link
                          to={`/workflows/${encodeURIComponent(summary.id)}`}
                          className="btn-toolbar"
                        >
                          <Settings2 size={14} />
                          详情
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {/* 最近运行 */}
            {recentRuns.length > 0 && (
              <section className="recent-runs-section">
                <h3 className="recent-runs-title">最近运行</h3>
                <div className="list-rows">
                  {recentRuns.map((run) => {
                    const wfName = workflowNameById[run.workflowId] ?? run.workflowId;
                    const dot: "green" | "red" | "accent" | "yellow" | "muted" =
                      run.status === "succeeded"
                        ? "green"
                        : run.status === "failed"
                        ? "red"
                        : run.status === "running"
                        ? "accent"
                        : run.status === "waiting-input"
                        ? "yellow"
                        : "muted";
                    const label =
                      run.status === "running"
                        ? "运行中"
                        : run.status === "succeeded"
                        ? "成功"
                        : run.status === "failed"
                        ? "失败"
                        : run.status === "waiting-input"
                        ? "等待输入"
                        : run.status === "canceled"
                        ? "已取消"
                        : run.status === "queued"
                        ? "排队中"
                        : run.status;
                    return (
                      <article key={run.id} className="list-row">
                        <div className="list-row__lead">
                          <span
                            className={`status-dot status-dot--${dot}`}
                            title={label}
                          />
                        </div>
                        <div className="list-row__main">
                          <div className="list-row__title-row">
                            <Link
                              to={`/workflows/${encodeURIComponent(run.workflowId)}`}
                              className="list-row__title"
                              title={wfName}
                            >
                              {wfName}
                            </Link>
                            <span className={`tag tag--${dot}`}>{label}</span>
                          </div>
                          <div className="list-row__meta-row">
                            <span className="list-row__meta">{timeAgo(run.startedAt)}</span>
                            <span className="list-row__meta-sep" />
                            <span className="list-row__meta list-row__meta--mono">
                              {formatDuration(run.startedAt, run.finishedAt)}
                            </span>
                          </div>
                        </div>
                        <div className="list-row__trailing">
                          <Link
                            to={`/workflows/${encodeURIComponent(run.workflowId)}`}
                            className="btn-toolbar"
                          >
                            进入
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* Create Modal */}
      {showCreateModal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCreateModal();
          }}
        >
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-create-dialog-title"
          >
            <header className="modal-header">
              <h3 id="workflow-create-dialog-title">新建工作流</h3>
              <button
                type="button"
                className="icon-btn"
                aria-label="关闭新建工作流弹窗"
                onClick={closeCreateModal}
              >
                <X size={18} />
              </button>
            </header>
            <form
              data-testid="workflow-create-form"
              className="create-form"
              onSubmit={handleCreate}
            >
              <label className="field">
                <span>代码 ID (可选)</span>
                <input
                  value={draftCode}
                  onChange={(e) => setDraftCode(e.target.value)}
                  type="text"
                  placeholder="weekly-review"
                />
              </label>
              <label className="field">
                <span>名称</span>
                <input
                  ref={createNameInputRef}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  data-testid="workflow-create-name"
                  type="text"
                  placeholder="我的周报工作流"
                />
              </label>
              <label className="field">
                <span>描述</span>
                <textarea
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  data-testid="workflow-create-description"
                  rows={3}
                  placeholder="自动整理每周待办事项并检查状态。"
                />
              </label>
              {createError && (
                <div className="banner banner--error">
                  <AlertCircle size={16} />
                  <span>{createError}</span>
                </div>
              )}
              <footer className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={closeCreateModal}
                >
                  取消
                </button>
                <button type="submit" className="btn-primary" disabled={isCreating}>
                  确认创建
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      <style>{`
        /* Toolbar (page-local until promoted to global.css) */
        .toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }

        .toolbar__search {
          flex: 1;
          min-width: 180px;
        }

        .toolbar__count {
          margin-left: auto;
          font-size: 12px;
          color: var(--text-muted);
        }

        /* Form controls used by the toolbar and create modal (page-local) */
        .input,
        .select {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 8px 12px;
          font-size: 13px;
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .input:hover,
        .select:hover {
          border-color: var(--glass-border-hover);
        }

        .input:focus,
        .select:focus {
          border-color: var(--accent-cyan);
          box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.14);
        }

        .select {
          cursor: pointer;
        }

        /* Recent runs section heading */
        .recent-runs-section {
          margin-top: 36px;
        }

        .recent-runs-title {
          margin: 0 0 16px;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }

        /* Modal (page-local) */
        .modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          display: grid;
          place-items: center;
          padding: 24px;
        }

        .modal-content {
          background: var(--bg-card, #18181b);
          border: 1px solid var(--glass-border, #27272a);
          border-radius: var(--radius-2xl);
          width: 100%;
          max-width: 460px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
          overflow: hidden;
          animation: modal-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes modal-pop {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid var(--glass-border, #27272a);
        }

        .modal-header h3 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary, #ffffff);
        }

        .create-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
          padding: 24px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .field span {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary, #a1a1aa);
        }

        .field input,
        .field textarea {
          width: 100%;
          border: 1px solid var(--glass-border, #3f3f46);
          border-radius: var(--radius-md);
          background: var(--bg-base, #121214);
          color: var(--text-primary, #ffffff);
          padding: 10px 14px;
          font: inherit;
          font-size: 14px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
          outline: none;
        }

        .field input:focus,
        .field textarea:focus {
          border-color: var(--accent-cyan);
          box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.14);
        }

        .field textarea { resize: vertical; min-height: 80px; }

        .modal-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 12px;
        }
      `}</style>
    </div>
  );
}

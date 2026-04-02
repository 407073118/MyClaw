import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspace";
import type { WorkflowSummary } from "@shared/contracts";

// ── Filter types ──────────────────────────────────────────────────────────────

interface WorkflowLibraryFilterState {
  query: string;
  status: "all" | "draft" | "active" | "archived";
  sort: "updated-desc" | "name-asc" | "nodes-desc";
}

// ── WorkflowLibraryFilters ────────────────────────────────────────────────────

interface FiltersProps {
  filters: WorkflowLibraryFilterState;
  onChange: (filters: WorkflowLibraryFilterState) => void;
}

function WorkflowLibraryFilters({ filters, onChange }: FiltersProps) {
  return (
    <div className="filters-bar">
      <input
        className="filter-search"
        type="text"
        placeholder="搜索工作流…"
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
      />
      <select
        className="filter-select"
        value={filters.status}
        onChange={(e) =>
          onChange({ ...filters, status: e.target.value as WorkflowLibraryFilterState["status"] })
        }
      >
        <option value="all">全部状态</option>
        <option value="draft">草稿</option>
        <option value="active">已启用</option>
        <option value="archived">已归档</option>
      </select>
      <select
        className="filter-select"
        value={filters.sort}
        onChange={(e) =>
          onChange({ ...filters, sort: e.target.value as WorkflowLibraryFilterState["sort"] })
        }
      >
        <option value="updated-desc">最近更新</option>
        <option value="name-asc">名称 A→Z</option>
        <option value="nodes-desc">节点最多</option>
      </select>
    </div>
  );
}

// ── WorkflowLibraryCard ───────────────────────────────────────────────────────

interface WorkflowLibraryCardProps {
  summary: WorkflowSummary;
  onExecute: () => void;
  onDelete: () => void;
}

function WorkflowLibraryCard({ summary, onExecute, onDelete }: WorkflowLibraryCardProps) {
  const navigate = useNavigate();
  const statusLabel: Record<string, string> = {
    draft: "草稿",
    active: "已启用",
    archived: "已归档",
  };

  return (
    <article
      className="workflow-card"
      onClick={() => navigate(`/workflows/${encodeURIComponent(summary.id)}`)}
    >
      <div className="wf-card-header">
        <span className="wf-card-name">{summary.name}</span>
        <span className={`wf-status-chip wf-status-${summary.status ?? "draft"}`}>
          {statusLabel[summary.status ?? "draft"] ?? summary.status}
        </span>
      </div>
      {summary.description && <p className="wf-card-desc">{summary.description}</p>}
      <div className="wf-card-meta">
        {summary.nodeCount != null && (
          <span className="wf-meta-pill">{summary.nodeCount} 节点</span>
        )}
        {summary.updatedAt && (
          <span className="wf-meta-pill">
            {new Date(summary.updatedAt).toLocaleDateString("zh-CN")}
          </span>
        )}
      </div>
      <div className="wf-card-footer" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="wf-action-btn" onClick={onExecute}>
          运行
        </button>
        <button type="button" className="wf-action-btn wf-action-danger" onClick={onDelete}>
          删除
        </button>
      </div>
    </article>
  );
}

// ── Helper sort/filter functions ──────────────────────────────────────────────

function safeComparableName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function safeComparableUpdatedAt(value: unknown): number {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : -1;
}

function safeComparableNodeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : -1;
}

// ── WorkflowsPage ─────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const workspace = useWorkspaceStore();
  const navigate = useNavigate();

  const [isCreating, setIsCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [filters, setFilters] = useState<WorkflowLibraryFilterState>({
    query: "",
    status: "all",
    sort: "updated-desc",
  });

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

  async function handleExecute(workflowId: string) {
    try {
      const run = await workspace.startWorkflowRun(workflowId) as { id: string };
      console.info(`[workflows] Started workflow run ${run.id}`);
      alert(
        `Successfully started workflow run: ${run.id}\nYou can monitor it from runtime terminal or logs.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution failed.";
      alert(`Failed to execute workflow: ${message}`);
    }
  }

  async function handleDelete(workflowId: string) {
    if (
      !confirm(
        "Are you sure you want to delete this workflow? (Not fully supported by runtime yet)",
      )
    )
      return;
    alert(`Delete operation for ${workflowId} called. UI update only for now.`);
  }

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
    <main data-testid="workflows-view" className="page-container">
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">工作流</span>
          <h2 className="page-title">本地工作流库</h2>
          <p className="page-subtitle">
            在本地 Runtime 上设计、管理和执行可复用的 AI 代理与自动化流程。
          </p>
        </div>
        <div className="header-actions">
          <button
            className="btn-premium accent new-workflow-btn"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={18} className="icon-plus" />
            <span>新建工作流</span>
          </button>
        </div>
      </header>

      <section className="library-content">
        {loadError ? (
          <p className="error-copy">{loadError}</p>
        ) : (
          <div className="library-list">
            <WorkflowLibraryFilters filters={filters} onChange={setFilters} />
            {filteredWorkflows.length === 0 ? (
              <p className="empty-copy">当前空间内暂无工作流。创建一个新工作流来开始吧。</p>
            ) : (
              <ul className="card-grid" aria-label="Workflow summaries">
                {filteredWorkflows.map((summary) => (
                  <li key={summary.id} className="card-item">
                    <WorkflowLibraryCard
                      summary={summary}
                      onExecute={() => handleExecute(summary.id)}
                      onDelete={() => handleDelete(summary.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Create Modal */}
      {showCreateModal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreateModal(false);
          }}
        >
          <div className="modal-content">
            <header className="modal-header">
              <h3>新建工作流</h3>
              <button
                className="icon-button close-btn"
                onClick={() => setShowCreateModal(false)}
              >
                <X size={20} />
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
              {createError && <p className="error-copy">{createError}</p>}
              <footer className="modal-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                >
                  取消
                </button>
                <button className="primary" type="submit" disabled={isCreating}>
                  确认创建
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .page-container {
          height: 100%;
          overflow-y: auto;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 28px;
        }

        .header-text { min-width: 0; }

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
          font-size: 28px;
        }

        .page-subtitle {
          margin: 10px 0 0;
          max-width: 620px;
          color: var(--text-secondary, #b0b0b8);
          line-height: 1.7;
        }

        .header-actions { flex-shrink: 0; }

        .new-workflow-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .library-content { width: 100%; }

        .library-list {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .filters-bar {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }

        .filter-search {
          flex: 1;
          min-width: 180px;
          padding: 8px 12px;
          border: 1px solid var(--glass-border, #3f3f46);
          border-radius: 8px;
          background: var(--bg-base, #121214);
          color: var(--text-primary, #fff);
          font-size: 13px;
          outline: none;
        }

        .filter-select {
          padding: 8px 12px;
          border: 1px solid var(--glass-border, #3f3f46);
          border-radius: 8px;
          background: var(--bg-base, #121214);
          color: var(--text-primary, #fff);
          font-size: 13px;
          outline: none;
          cursor: pointer;
        }

        .card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 24px;
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .card-item { margin: 0; }

        .workflow-card {
          padding: 20px;
          border-radius: var(--radius-lg, 16px);
          background: var(--bg-card, #18181b);
          border: 1px solid var(--glass-border, #27272a);
          display: flex;
          flex-direction: column;
          gap: 12px;
          cursor: pointer;
          transition: border-color 0.2s, transform 0.2s;
        }

        .workflow-card:hover {
          border-color: var(--text-muted, #52525b);
          transform: translateY(-2px);
        }

        .wf-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .wf-card-name {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary, #fff);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .wf-status-chip {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 4px;
          flex-shrink: 0;
        }

        .wf-status-draft { background: rgba(245,158,11,0.1); color: #f59e0b; border: 1px solid rgba(245,158,11,0.2); }
        .wf-status-active { background: rgba(16,185,129,0.1); color: #10b981; border: 1px solid rgba(16,185,129,0.2); }
        .wf-status-archived { background: rgba(113,113,122,0.1); color: #71717a; border: 1px solid rgba(113,113,122,0.2); }

        .wf-card-desc {
          font-size: 13px;
          color: var(--text-secondary, #b0b0b8);
          margin: 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .wf-card-meta {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .wf-meta-pill {
          font-size: 11px;
          color: var(--text-muted, #71717a);
          border: 1px solid var(--glass-border, #27272a);
          border-radius: 999px;
          padding: 2px 8px;
        }

        .wf-card-footer {
          display: flex;
          gap: 8px;
          padding-top: 12px;
          border-top: 1px solid var(--glass-border, #27272a);
        }

        .wf-action-btn {
          height: 28px;
          padding: 0 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid var(--glass-border, #3f3f46);
          background: transparent;
          color: var(--text-primary, #fff);
          transition: all 0.2s;
        }

        .wf-action-btn:hover { background: rgba(255,255,255,0.06); }

        .wf-action-danger { color: #f87171; border-color: rgba(248,113,113,0.2); }
        .wf-action-danger:hover { background: rgba(239,68,68,0.1); }

        .empty-copy {
          color: var(--text-secondary);
          font-size: 14px;
          text-align: center;
          padding: 48px;
          background: color-mix(in srgb, var(--bg-card, #1e1e24) 40%, transparent);
          border: 1px dashed var(--glass-border, #333338);
          border-radius: 12px;
        }

        .error-copy {
          margin: 0;
          color: #ef4444;
          font-size: 14px;
        }

        .modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(4px);
          display: grid;
          place-items: center;
          padding: 24px;
        }

        .modal-content {
          background: var(--bg-card, #18181b);
          border: 1px solid var(--glass-border, #27272a);
          border-radius: 16px;
          width: 100%;
          max-width: 460px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.4);
          overflow: hidden;
          animation: modal-pop 0.3s cubic-bezier(0.34,1.56,0.64,1);
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

        .icon-button {
          background: transparent;
          border: none;
          color: var(--text-secondary, #a1a1aa);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: grid;
          place-items: center;
          transition: all 0.2s;
        }

        .icon-button:hover {
          background: color-mix(in srgb, var(--text-secondary) 15%, transparent);
          color: var(--text-primary);
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

        .field input, .field textarea {
          width: 100%;
          border: 1px solid var(--glass-border, #3f3f46);
          border-radius: 8px;
          background: var(--bg-base, #121214);
          color: var(--text-primary, #ffffff);
          padding: 12px 14px;
          font: inherit;
          font-size: 14px;
          transition: border-color 0.2s, box-shadow 0.2s;
          outline: none;
        }

        .field input:focus, .field textarea:focus {
          border-color: var(--accent-primary, #3b82f6);
          box-shadow: 0 0 0 2px rgba(59,130,246,0.2);
        }

        .field textarea { resize: vertical; min-height: 80px; }

        .modal-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 12px;
        }

        .secondary {
          border: 1px solid var(--glass-border, #3f3f46);
          background: transparent;
          color: var(--text-primary, #ffffff);
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .secondary:hover {
          background: color-mix(in srgb, var(--glass-border) 40%, transparent);
        }

        .primary {
          border: none;
          border-radius: 8px;
          padding: 10px 18px;
          background: var(--accent-primary, #3b82f6);
          color: var(--accent-text, #ffffff);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .primary:hover:not(:disabled) {
          background: color-mix(in srgb, var(--accent-primary, #3b82f6) 85%, white);
        }

        .primary:disabled { opacity: 0.5; cursor: not-allowed; }

        @media (max-width: 900px) {
          .page-header { flex-direction: column; align-items: flex-start; }
        }
      `}</style>
    </main>
  );
}

import React from "react";

export type WorkflowLibraryFilterState = {
  query: string;
  status: "all" | "draft" | "active" | "archived";
  sort: "updated-desc" | "name-asc" | "nodes-desc";
};

interface WorkflowLibraryFiltersProps {
  modelValue: WorkflowLibraryFilterState;
  onUpdateModelValue: (value: WorkflowLibraryFilterState) => void;
}

export default function WorkflowLibraryFilters({ modelValue, onUpdateModelValue }: WorkflowLibraryFiltersProps) {
  function handleQueryInput(event: React.ChangeEvent<HTMLInputElement>) {
    onUpdateModelValue({
      ...modelValue,
      query: event.target.value,
    });
  }

  function handleStatusChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    onUpdateModelValue({
      ...modelValue,
      status: value === "draft" || value === "active" || value === "archived" ? value : "all",
    });
  }

  function handleSortChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    onUpdateModelValue({
      ...modelValue,
      sort: value === "name-asc" || value === "nodes-desc" ? value : "updated-desc",
    });
  }

  return (
    <form className="workflow-library-filters" onSubmit={(e) => e.preventDefault()}>
      <label className="field">
        <span className="label">搜索</span>
        <input
          value={modelValue.query}
          data-testid="workflow-library-filter-query"
          type="search"
          placeholder="搜索工作流..."
          onChange={handleQueryInput}
        />
      </label>

      <label className="field">
        <span className="label">状态</span>
        <select
          value={modelValue.status}
          data-testid="workflow-library-filter-status"
          onChange={handleStatusChange}
        >
          <option value="all">全部</option>
          <option value="draft">草稿</option>
          <option value="active">已启用</option>
          <option value="archived">已归档</option>
        </select>
      </label>

      <label className="field">
        <span className="label">排序</span>
        <select
          value={modelValue.sort}
          data-testid="workflow-library-filter-sort"
          onChange={handleSortChange}
        >
          <option value="updated-desc">最后修改</option>
          <option value="name-asc">名称</option>
          <option value="nodes-desc">节点数</option>
        </select>
      </label>

      <style>{`
        .workflow-library-filters {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 150px 160px;
          gap: 12px;
          padding: 12px;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
        }
        .workflow-library-filters .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        .workflow-library-filters .label {
          color: var(--text-muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .workflow-library-filters input,
        .workflow-library-filters select {
          width: 100%;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-card);
          color: var(--text-primary);
          padding: 8px 10px;
          font: inherit;
        }
        @media (max-width: 900px) {
          .workflow-library-filters {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </form>
  );
}

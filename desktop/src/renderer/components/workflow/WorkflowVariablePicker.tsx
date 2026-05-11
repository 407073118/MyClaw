import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";

export type WorkflowVariablePickerItem = {
  label: string;
  token: string;
  group: string;
  hint?: string;
};

interface WorkflowVariablePickerProps {
  variables: WorkflowVariablePickerItem[];
  onInsert: (token: string) => void;
  onCopy?: (token: string) => void;
  compact?: boolean;
}

/** 渲染按来源分组的变量选择器，点击后插入成熟产品常见的模板 token。 */
export default function WorkflowVariablePicker({
  variables,
  onInsert,
  onCopy,
  compact = false,
}: WorkflowVariablePickerProps) {
  const [query, setQuery] = useState("");

  const groupedVariables = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? variables.filter((item) => {
          const haystack = `${item.group} ${item.label} ${item.token} ${item.hint ?? ""}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        })
      : variables;
    const groups = new Map<string, WorkflowVariablePickerItem[]>();
    for (const item of filtered) {
      const list = groups.get(item.group) ?? [];
      list.push(item);
      groups.set(item.group, list);
    }
    return [...groups.entries()];
  }, [query, variables]);

  /** 根据搜索框输入刷新候选变量列表。 */
  function handleQueryInput(event: React.ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
  }

  /** 插入指定变量 token，并记录用户选择的变量来源。 */
  function handleInsert(item: WorkflowVariablePickerItem) {
    console.info("[workflow] 插入变量引用", {
      group: item.group,
      label: item.label,
      token: item.token,
    });
    onInsert(item.token);
  }

  /** 处理变量插入按钮点击，阻止事件向外层候选行重复冒泡。 */
  function handleInsertClick(item: WorkflowVariablePickerItem, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    handleInsert(item);
  }

  /** 复制指定变量 token，保留插入和复制两种成熟工作流产品常见操作。 */
  function handleCopy(item: WorkflowVariablePickerItem, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    console.info("[workflow] 复制变量引用", {
      group: item.group,
      label: item.label,
      token: item.token,
    });
    if (onCopy) {
      onCopy(item.token);
      return;
    }
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard) {
      void clipboard.writeText(item.token);
    }
  }

  return (
    <section className={`wf-variable-picker${compact ? " wf-variable-picker--compact" : ""}`}>
      <label className="wf-variable-picker__search">
        <Search size={13} />
        <input
          value={query}
          onChange={handleQueryInput}
          placeholder="搜索变量"
          aria-label="搜索变量"
        />
      </label>
      <div className="wf-variable-picker__groups">
        {groupedVariables.length === 0 ? (
          <div className="wf-variable-picker__empty">没有匹配变量</div>
        ) : (
          groupedVariables.map(([group, items]) => (
            <div key={group} className="wf-variable-picker__group">
              <div className="wf-variable-picker__group-title">{group}</div>
              <div className="wf-variable-picker__items">
                {items.map((item) => (
                  <div
                    key={`${item.group}-${item.token}`}
                    className="wf-variable-picker__item"
                    title={item.token}
                    onClick={() => handleInsert(item)}
                  >
                    <button
                      type="button"
                      className="wf-variable-picker__insert"
                      onClick={(event) => handleInsertClick(item, event)}
                    >
                      <span className="wf-variable-picker__item-label">{item.label}</span>
                      <code>{item.token}</code>
                    </button>
                    <button
                      type="button"
                      className="wf-variable-picker__copy"
                      onClick={(event) => handleCopy(item, event)}
                      aria-label={`复制变量 ${item.label}`}
                    >
                      复制
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <style>{`
        .wf-variable-picker {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 220px;
          color: var(--text-primary);
        }
        .wf-variable-picker__search {
          display: flex;
          align-items: center;
          gap: 6px;
          border: 1px solid var(--glass-border);
          border-radius: 6px;
          padding: 6px 8px;
          background: color-mix(in srgb, var(--bg-base) 92%, transparent);
          color: var(--text-secondary);
        }
        .wf-variable-picker__search input {
          width: 100%;
          min-width: 0;
          border: 0;
          outline: 0;
          background: transparent;
          color: var(--text-primary);
          font: inherit;
          font-size: 12px;
        }
        .wf-variable-picker__groups {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 260px;
          overflow: auto;
        }
        .wf-variable-picker--compact .wf-variable-picker__groups {
          max-height: 180px;
        }
        .wf-variable-picker__group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .wf-variable-picker__group-title {
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 700;
        }
        .wf-variable-picker__items {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .wf-variable-picker__item {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px;
          width: 100%;
          border: 1px solid color-mix(in srgb, var(--glass-border) 78%, transparent);
          border-radius: 6px;
          padding: 4px;
          background: color-mix(in srgb, var(--bg-card) 78%, transparent);
          color: var(--text-primary);
          text-align: left;
        }
        .wf-variable-picker__item:hover {
          border-color: var(--accent-primary);
          background: color-mix(in srgb, var(--accent-primary) 12%, var(--bg-card));
        }
        .wf-variable-picker__insert {
          min-width: 0;
          display: grid;
          grid-template-columns: minmax(64px, 0.8fr) minmax(0, 1.4fr);
          align-items: center;
          gap: 8px;
          border: 0;
          border-radius: 4px;
          padding: 4px;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }
        .wf-variable-picker__insert:hover {
          background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
        }
        .wf-variable-picker__item-label {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          font-weight: 600;
        }
        .wf-variable-picker__item code {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-secondary);
          font-size: 11px;
        }
        .wf-variable-picker__copy {
          border: 1px solid color-mix(in srgb, var(--accent-primary) 34%, var(--glass-border));
          border-radius: 999px;
          padding: 3px 8px;
          background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
          color: var(--text-secondary);
          font: inherit;
          font-size: 11px;
          cursor: pointer;
        }
        .wf-variable-picker__copy:hover {
          color: var(--text-primary);
          background: color-mix(in srgb, var(--accent-primary) 18%, transparent);
        }
        .wf-variable-picker__empty {
          padding: 12px;
          color: var(--text-muted);
          font-size: 12px;
        }
      `}</style>
    </section>
  );
}

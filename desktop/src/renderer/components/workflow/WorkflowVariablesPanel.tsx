import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import type {
  WorkflowDefinition,
  WorkflowStateValueType,
  WorkflowVariableDefinition,
} from "@shared/contracts";

type VariableRowScope = "variables" | "outputs" | "schema";

type VariableRow = {
  id: string;
  scope: VariableRowScope;
  chineseName: string;
  englishName: string;
  fieldType: WorkflowStateValueType | "file";
};

type FieldTypeMenuState = {
  rowId: string;
  top: number;
  left: number;
  width: number;
};

interface WorkflowVariablesPanelProps {
  definition: WorkflowDefinition;
  runState?: Record<string, unknown> | null;
  onUpdateDefinition?: (updates: Partial<WorkflowDefinition>) => Promise<void> | void;
}

const fieldTypeOptions: Array<{ value: WorkflowStateValueType | "file"; label: string }> = [
  { value: "string", label: "文本" },
  { value: "number", label: "数字" },
  { value: "boolean", label: "布尔" },
  { value: "object", label: "对象" },
  { value: "array", label: "列表" },
  { value: "file", label: "文件" },
  { value: "unknown", label: "未知" },
];

const fieldTypeMenuMargin = 8;
const fieldTypeMenuMinWidth = 128;
const fieldTypeMenuEstimatedHeight = fieldTypeOptions.length * 30 + 12;

/** 返回字段类型的中文名称，变量中心不暴露底层类型枚举。 */
function getFieldTypeLabel(value: WorkflowStateValueType | "file"): string {
  return fieldTypeOptions.find((option) => option.value === value)?.label ?? value;
}

/** 生成适合系统保存的英文变量名，避免空 key 进入 workflow definition。 */
function createVariableKey(): string {
  return `variable_${Date.now().toString(36)}`;
}

/** 根据触发按钮位置计算浮层坐标，底部空间不足时自动向上展开。 */
function computeFieldTypeMenuPosition(rect: DOMRect): Omit<FieldTypeMenuState, "rowId"> {
  const viewportHeight = window.innerHeight || 720;
  const viewportWidth = window.innerWidth || 1024;
  const width = Math.max(rect.width, fieldTypeMenuMinWidth);
  const hasEnoughSpaceBelow = viewportHeight - rect.bottom >= fieldTypeMenuEstimatedHeight + fieldTypeMenuMargin;
  const belowTop = rect.bottom + 4;
  const aboveTop = rect.top - fieldTypeMenuEstimatedHeight - 4;
  const top = hasEnoughSpaceBelow
    ? Math.min(belowTop, viewportHeight - fieldTypeMenuEstimatedHeight - fieldTypeMenuMargin)
    : Math.max(fieldTypeMenuMargin, aboveTop);
  const left = Math.max(
    fieldTypeMenuMargin,
    Math.min(rect.left, viewportWidth - width - fieldTypeMenuMargin),
  );
  return { top, left, width };
}

/** 把 workflow definition 里的变量定义压平成简单字段表。 */
function collectVariableRows(definition: WorkflowDefinition): VariableRow[] {
  const rows: VariableRow[] = [];
  const seen = new Set<string>();

  function addRow(row: VariableRow) {
    const identity = `${row.scope}:${row.id}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    rows.push(row);
  }

  for (const variable of definition.variables ?? []) {
    addRow({
      id: variable.id || `variable-${variable.key}`,
      scope: "variables",
      chineseName: variable.label || variable.key,
      englishName: variable.key,
      fieldType: variable.valueType,
    });
  }

  for (const output of definition.outputs ?? []) {
    addRow({
      id: output.id || `output-${output.key}`,
      scope: "outputs",
      chineseName: output.label || output.key,
      englishName: output.key,
      fieldType: output.valueType,
    });
  }

  for (const field of definition.stateSchema ?? []) {
    addRow({
      id: `schema-${field.key}`,
      scope: "schema",
      chineseName: field.label || field.key,
      englishName: field.key,
      fieldType: field.valueType,
    });
  }

  return rows;
}

/** 渲染变量中心：只维护中文名、英文名和字段类型。 */
export default function WorkflowVariablesPanel({
  definition,
  runState: _runState,
  onUpdateDefinition,
}: WorkflowVariablesPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [fieldTypeMenu, setFieldTypeMenu] = useState<FieldTypeMenuState | null>(null);

  const rows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return collectVariableRows(definition).filter((row) => {
      if (!query) return true;
      return `${row.chineseName} ${row.englishName}`.toLowerCase().includes(query);
    });
  }, [definition, searchQuery]);

  /** 监听外部滚动、窗口变化和外部点击，避免浮层停留在错误坐标。 */
  useEffect(() => {
    if (!fieldTypeMenu) return;

    function closeFloatingMenu() {
      console.info("[workflow] 关闭变量字段类型浮层", {
        workflowId: definition.id,
        rowId: fieldTypeMenu?.rowId,
      });
      setFieldTypeMenu(null);
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".workflow-variables-panel__type-menu")) return;
      if (target?.closest(".workflow-variables-panel__type-trigger")) return;
      closeFloatingMenu();
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    window.addEventListener("resize", closeFloatingMenu);
    window.addEventListener("scroll", closeFloatingMenu, true);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      window.removeEventListener("resize", closeFloatingMenu);
      window.removeEventListener("scroll", closeFloatingMenu, true);
    };
  }, [definition.id, fieldTypeMenu]);

  /** 新增一条普通变量，默认只需要用户改中文名和英文名。 */
  function handleCreateVariable() {
    const key = createVariableKey();
    console.info("[workflow] 从变量中心新增变量字段", {
      workflowId: definition.id,
      key,
    });
    const nextVariables: WorkflowVariableDefinition[] = [
      ...(definition.variables ?? []),
      {
        id: `var-${key}`,
        key,
        label: "新变量",
        scope: "run",
        valueType: "string",
      },
    ];
    void onUpdateDefinition?.({ variables: nextVariables });
  }

  /** 更新普通变量定义，保持变量中心只承担字段表编辑职责。 */
  function patchVariableRow(row: VariableRow, patch: Partial<Pick<VariableRow, "chineseName" | "englishName" | "fieldType">>) {
    if (!onUpdateDefinition) return;
    console.info("[workflow] 更新变量字段", {
      workflowId: definition.id,
      rowId: row.id,
      scope: row.scope,
      patchKeys: Object.keys(patch),
    });

    if (row.scope === "variables") {
      const nextVariables = (definition.variables ?? []).map((variable) => {
        const id = variable.id || `variable-${variable.key}`;
        if (id !== row.id) return variable;
        return {
          ...variable,
          label: patch.chineseName ?? variable.label,
          key: patch.englishName ?? variable.key,
          valueType: patch.fieldType ?? variable.valueType,
        };
      });
      void onUpdateDefinition({ variables: nextVariables });
      return;
    }

    if (row.scope === "outputs") {
      const nextOutputs = (definition.outputs ?? []).map((output) => {
        const id = output.id || `output-${output.key}`;
        if (id !== row.id) return output;
        return {
          ...output,
          label: patch.chineseName ?? output.label,
          key: patch.englishName ?? output.key,
          valueType: patch.fieldType ?? output.valueType,
        };
      });
      void onUpdateDefinition({ outputs: nextOutputs });
      return;
    }

    const nextSchema = (definition.stateSchema ?? []).map((field) => {
      if (`schema-${field.key}` !== row.id) return field;
      return {
        ...field,
        label: patch.chineseName ?? field.label,
        key: patch.englishName ?? field.key,
        valueType: patch.fieldType === "file" ? field.valueType : patch.fieldType ?? field.valueType,
      };
    });
    void onUpdateDefinition({ stateSchema: nextSchema });
  }

  /** 切换字段类型菜单，避免原生 select 在深色弹窗里使用系统浅色下拉样式。 */
  function handleToggleFieldTypeMenu(row: VariableRow, trigger: HTMLElement) {
    const nextMenu = fieldTypeMenu?.rowId === row.id
      ? null
      : {
          rowId: row.id,
          ...computeFieldTypeMenuPosition(trigger.getBoundingClientRect()),
        };
    console.info("[workflow] 切换变量字段类型菜单", {
      workflowId: definition.id,
      rowId: row.id,
      scope: row.scope,
      opened: Boolean(nextMenu),
    });
    setFieldTypeMenu(nextMenu);
  }

  /** 选择字段类型后复用字段表更新流程，并关闭自绘下拉菜单。 */
  function handleFieldTypeChange(row: VariableRow, fieldType: WorkflowStateValueType | "file") {
    console.info("[workflow] 从变量中心选择字段类型", {
      workflowId: definition.id,
      rowId: row.id,
      scope: row.scope,
      fieldType,
    });
    patchVariableRow(row, { fieldType });
    setFieldTypeMenu(null);
  }

  /** 删除变量字段；变量中心只删除字段定义，不处理运行时历史值。 */
  function handleDeleteVariable(row: VariableRow) {
    if (!onUpdateDefinition) return;
    console.info("[workflow] 删除变量字段", {
      workflowId: definition.id,
      rowId: row.id,
      scope: row.scope,
    });

    if (row.scope === "variables") {
      void onUpdateDefinition({
        variables: (definition.variables ?? []).filter((variable) => {
          const id = variable.id || `variable-${variable.key}`;
          return id !== row.id;
        }),
      });
      return;
    }

    if (row.scope === "outputs") {
      void onUpdateDefinition({
        outputs: (definition.outputs ?? []).filter((output) => {
          const id = output.id || `output-${output.key}`;
          return id !== row.id;
        }),
      });
      return;
    }

    void onUpdateDefinition({
      stateSchema: (definition.stateSchema ?? []).filter((field) => `schema-${field.key}` !== row.id),
    });
  }

  return (
    <section className="workflow-variables-panel" data-testid="workflow-variables-panel">
      <header className="workflow-variables-panel__header">
        <p>只维护字段表：中文名、英文名和字段类型。</p>
        {onUpdateDefinition && (
          <button type="button" className="workflow-variables-panel__add" onClick={handleCreateVariable}>
            新增变量
          </button>
        )}
      </header>

      <label className="workflow-variables-panel__search">
        <Search size={14} />
        <input
          data-testid="workflow-variables-search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="搜索中文名或英文名"
          aria-label="搜索变量"
        />
      </label>

      <div className="workflow-variables-panel__table" role="table" aria-label="变量字段表">
        <div className="workflow-variables-panel__row workflow-variables-panel__row--head" role="row">
          <span role="columnheader">中文名</span>
          <span role="columnheader">英文名</span>
          <span role="columnheader">字段类型</span>
          <span role="columnheader">操作</span>
        </div>
        {rows.length === 0 ? (
          <p className="workflow-variables-panel__empty">暂无变量</p>
        ) : (
          rows.map((row) => (
            <div key={`${row.scope}-${row.id}`} className="workflow-variables-panel__row" role="row">
              <input
                role="cell"
                data-testid={`workflow-variable-chinese-name-${row.id}`}
                value={row.chineseName}
                disabled={!onUpdateDefinition}
                onChange={(event) => patchVariableRow(row, { chineseName: event.target.value })}
                aria-label="中文名"
              />
              <input
                role="cell"
                data-testid={`workflow-variable-english-name-${row.id}`}
                value={row.englishName}
                disabled={!onUpdateDefinition}
                onChange={(event) => patchVariableRow(row, { englishName: event.target.value })}
                aria-label="英文名"
              />
              {onUpdateDefinition ? (
                <span
                  role="cell"
                  className="workflow-variables-panel__type-cell"
                >
                  <button
                    type="button"
                    className="workflow-variables-panel__type-trigger"
                    data-testid={`workflow-variable-field-type-${row.id}`}
                    aria-label="字段类型"
                    aria-haspopup="listbox"
                    aria-expanded={fieldTypeMenu?.rowId === row.id}
                    onClick={(event) => handleToggleFieldTypeMenu(row, event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setFieldTypeMenu(null);
                      }
                    }}
                  >
                    <span>{getFieldTypeLabel(row.fieldType)}</span>
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  {fieldTypeMenu?.rowId === row.id && createPortal(
                    <div
                      className="workflow-variables-panel__type-menu"
                      role="listbox"
                      aria-label="字段类型"
                      style={{
                        position: "fixed",
                        top: fieldTypeMenu.top,
                        left: fieldTypeMenu.left,
                        width: fieldTypeMenu.width,
                        zIndex: 500,
                      }}
                    >
                      {fieldTypeOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={option.value === row.fieldType}
                          className={`workflow-variables-panel__type-option${option.value === row.fieldType ? " is-selected" : ""}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleFieldTypeChange(row, option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>,
                    document.body,
                  )}
                </span>
              ) : (
                <span role="cell">{getFieldTypeLabel(row.fieldType)}</span>
              )}
              <span role="cell" className="workflow-variables-panel__actions-cell">
                {onUpdateDefinition && (
                  <button
                    type="button"
                    className="workflow-variables-panel__delete"
                    onClick={() => handleDeleteVariable(row)}
                  >
                    删除
                  </button>
                )}
              </span>
            </div>
          ))
        )}
      </div>

      <style>{`
        .workflow-variables-panel {
          display: flex;
          flex-direction: column;
          gap: 14px;
          color: var(--text-primary);
        }
        .workflow-variables-panel__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .workflow-variables-panel__header p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.5;
        }
        .workflow-variables-panel__add {
          flex: 0 0 auto;
          border: 1px solid var(--glass-border);
          border-radius: 7px;
          background: color-mix(in srgb, var(--bg-base) 86%, var(--accent-cyan));
          color: var(--text-primary);
          padding: 7px 10px;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        .workflow-variables-panel__add:hover {
          border-color: color-mix(in srgb, var(--accent-cyan) 45%, var(--glass-border));
          background: color-mix(in srgb, var(--bg-base) 74%, var(--accent-cyan));
        }
        .workflow-variables-panel__search {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border: 1px solid var(--glass-border);
          border-radius: 9px;
          background: color-mix(in srgb, var(--bg-base) 92%, transparent);
          color: var(--text-secondary);
        }
        .workflow-variables-panel__search input {
          width: 100%;
          min-width: 0;
          border: 0;
          outline: 0;
          background: transparent;
          color: var(--text-primary);
          font: inherit;
          font-size: 13px;
        }
        .workflow-variables-panel__table {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--glass-border);
          border-radius: 10px;
          overflow: visible;
          background: color-mix(in srgb, var(--bg-base) 92%, transparent);
        }
        .workflow-variables-panel__row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 140px 82px;
          gap: 0;
          min-height: 42px;
          border-top: 1px solid var(--glass-border);
        }
        .workflow-variables-panel__row:first-child {
          border-top: 0;
        }
        .workflow-variables-panel__row--head {
          min-height: 34px;
          background: color-mix(in srgb, var(--bg-card) 82%, transparent);
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 700;
        }
        .workflow-variables-panel__row > span,
        .workflow-variables-panel__row > input {
          min-width: 0;
          display: flex;
          align-items: center;
          border: 0;
          border-left: 1px solid var(--glass-border);
          padding: 0 10px;
          background: transparent;
          color: var(--text-primary);
          font: inherit;
          font-size: 13px;
        }
        .workflow-variables-panel__type-cell {
          position: relative;
          overflow: visible;
        }
        .workflow-variables-panel__type-trigger {
          width: 100%;
          min-width: 0;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          border: 1px solid transparent;
          border-radius: 7px;
          background: rgba(4, 18, 16, 0.72);
          color: var(--text-primary);
          padding: 0 9px;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        .workflow-variables-panel__type-trigger:hover,
        .workflow-variables-panel__type-trigger[aria-expanded="true"] {
          border-color: color-mix(in srgb, var(--accent-cyan) 42%, var(--glass-border));
          background: color-mix(in srgb, var(--bg-base) 76%, var(--accent-cyan));
        }
        .workflow-variables-panel__type-trigger svg {
          flex: 0 0 auto;
          color: var(--text-secondary);
        }
        .workflow-variables-panel__type-menu {
          display: flex;
          flex-direction: column;
          padding: 5px;
          border: 1px solid color-mix(in srgb, var(--accent-cyan) 34%, var(--glass-border));
          border-radius: 8px;
          background: #07120f;
          box-shadow: 0 16px 34px rgba(0, 0, 0, 0.42);
        }
        .workflow-variables-panel__type-option {
          width: 100%;
          min-height: 30px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--text-primary);
          padding: 0 10px;
          text-align: left;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        .workflow-variables-panel__type-option:hover,
        .workflow-variables-panel__type-option:focus {
          outline: 0;
          background: rgba(45, 212, 191, 0.13);
          color: #ecfeff;
        }
        .workflow-variables-panel__type-option.is-selected {
          background: rgba(45, 212, 191, 0.19);
          color: #ccfbf1;
        }
        .workflow-variables-panel__actions-cell {
          justify-content: center;
        }
        .workflow-variables-panel__delete {
          border: 1px solid rgba(239, 68, 68, 0.28);
          border-radius: 6px;
          background: rgba(239, 68, 68, 0.08);
          color: #fca5a5;
          padding: 5px 8px;
          font: inherit;
          font-size: 12px;
          cursor: pointer;
        }
        .workflow-variables-panel__delete:hover {
          border-color: rgba(239, 68, 68, 0.55);
          background: rgba(239, 68, 68, 0.16);
          color: #fecaca;
        }
        .workflow-variables-panel__row > span:first-child,
        .workflow-variables-panel__row > input:first-child {
          border-left: 0;
        }
        .workflow-variables-panel__row--head > span {
          color: var(--text-secondary);
        }
        .workflow-variables-panel__row > input:focus,
        .workflow-variables-panel__type-trigger:focus {
          outline: 0;
          background: color-mix(in srgb, var(--accent-cyan) 10%, transparent);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-cyan) 44%, transparent);
        }
        .workflow-variables-panel__row > input:disabled {
          opacity: 1;
          cursor: default;
        }
        .workflow-variables-panel__empty {
          margin: 0;
          padding: 16px;
          color: var(--text-muted);
          font-size: 13px;
        }
      `}</style>
    </section>
  );
}

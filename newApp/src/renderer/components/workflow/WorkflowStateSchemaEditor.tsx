import React, { useEffect, useRef, useState } from "react";
import type { WorkflowMergeStrategy, WorkflowStateSchemaField, WorkflowStateValueType } from "@shared/contracts";

interface WorkflowStateSchemaEditorProps {
  modelValue: WorkflowStateSchemaField[];
  onUpdateModelValue: (value: WorkflowStateSchemaField[]) => void;
  onValidation: (payload: { errors: string[] }) => void;
  className?: string;
}

/** 创建默认字段，保证后续编辑结构稳定。 */
function createDefaultField(): WorkflowStateSchemaField {
  return {
    key: "",
    label: "",
    description: "",
    valueType: "string",
    mergeStrategy: "replace",
    required: false,
    producerNodeIds: [],
    consumerNodeIds: [],
  };
}

/** 校验 stateSchema（UI 层），用于禁用保存并提示用户。 */
function validateStateSchema(fields: WorkflowStateSchemaField[]): string[] {
  const errors: string[] = [];
  const keyCount = new Map<string, number>();

  for (const field of fields) {
    const key = field.key.trim();
    if (!key) {
      errors.push("key: required");
      continue;
    }
    keyCount.set(key, (keyCount.get(key) ?? 0) + 1);

    if (!field.label.trim()) {
      errors.push("label: required");
    }

    if (!field.description.trim()) {
      errors.push("description: required");
    }

    // 最小实现：object-merge 只能用于 object。
    if (field.mergeStrategy === "object-merge" && field.valueType !== "object") {
      errors.push("mergeStrategy: object-merge requires valueType=object");
    }
  }

  for (const [key, count] of keyCount.entries()) {
    if (count > 1) {
      errors.push(`key: duplicate "${key}"`);
    }
  }

  return errors;
}

export default function WorkflowStateSchemaEditor({
  modelValue,
  onUpdateModelValue,
  onValidation,
  className,
}: WorkflowStateSchemaEditorProps) {
  const [localErrors, setLocalErrors] = useState<string[]>([]);
  const errorText = localErrors.length ? localErrors.join("; ") : "";

  // Run validation when modelValue changes (like Vue's watch with immediate)
  const prevModelValueRef = useRef<WorkflowStateSchemaField[] | null>(null);
  useEffect(() => {
    const errors = validateStateSchema(modelValue);
    setLocalErrors(errors);
    onValidation({ errors });
    prevModelValueRef.current = modelValue;
  }, [modelValue]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 新增 schema field。 */
  function handleAddField() {
    console.info("[workflow] 新增 state schema 字段");
    const next = [...modelValue, createDefaultField()];
    const errors = validateStateSchema(next);
    setLocalErrors(errors);
    onUpdateModelValue(next);
    onValidation({ errors });
  }

  /** 更新字段片段，避免整行重写。 */
  function handleFieldPatch(index: number, patch: Partial<WorkflowStateSchemaField>) {
    const next = modelValue.map((field, idx) => (idx === index ? { ...field, ...patch } : field));
    console.info("[workflow] 更新 state schema 字段", { index, patch });
    const errors = validateStateSchema(next);
    setLocalErrors(errors);
    onUpdateModelValue(next);
    onValidation({ errors });
  }

  function handleValueTypeChange(index: number, event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value as WorkflowStateValueType | undefined;
    const nextValue: WorkflowStateValueType =
      value === "number" ||
      value === "boolean" ||
      value === "object" ||
      value === "array" ||
      value === "null" ||
      value === "unknown"
        ? value
        : "string";
    handleFieldPatch(index, { valueType: nextValue });
  }

  function handleMergeStrategyChange(index: number, event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value as WorkflowMergeStrategy | undefined;
    const nextValue: WorkflowMergeStrategy =
      value === "append" || value === "union" || value === "object-merge" || value === "custom" ? value : "replace";
    handleFieldPatch(index, { mergeStrategy: nextValue });
  }

  return (
    <section className={`schema-editor${className ? ` ${className}` : ""}`} data-testid="workflow-state-schema-editor">
      <header className="header">
        <h4 className="title">State Schema</h4>
        <button data-testid="workflow-state-schema-add-field" type="button" className="ghost" onClick={handleAddField}>
          Add field
        </button>
      </header>

      {errorText && (
        <p data-testid="workflow-state-schema-error" className="error">{errorText}</p>
      )}

      {modelValue.map((field, index) => (
        <div key={`${field.key}:${index}`} className="row">
          <label className="field">
            <span>Key</span>
            <input
              data-testid={`workflow-state-schema-key-${index}`}
              type="text"
              value={field.key}
              onChange={(e) => handleFieldPatch(index, { key: e.target.value })}
            />
          </label>

          <label className="field">
            <span>Label</span>
            <input
              data-testid={`workflow-state-schema-label-${index}`}
              type="text"
              value={field.label}
              onChange={(e) => handleFieldPatch(index, { label: e.target.value })}
            />
          </label>

          <label className="field">
            <span>Description</span>
            <input
              data-testid={`workflow-state-schema-description-${index}`}
              type="text"
              value={field.description}
              onChange={(e) => handleFieldPatch(index, { description: e.target.value })}
            />
          </label>

          <label className="field">
            <span>Value type</span>
            <select
              data-testid={`workflow-state-schema-valueType-${index}`}
              value={field.valueType}
              onChange={(e) => handleValueTypeChange(index, e)}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="object">object</option>
              <option value="array">array</option>
              <option value="null">null</option>
              <option value="unknown">unknown</option>
            </select>
          </label>

          <label className="field">
            <span>Merge strategy</span>
            <select
              data-testid={`workflow-state-schema-mergeStrategy-${index}`}
              value={field.mergeStrategy}
              onChange={(e) => handleMergeStrategyChange(index, e)}
            >
              <option value="replace">replace</option>
              <option value="append">append</option>
              <option value="union">union</option>
              <option value="object-merge">object-merge</option>
              <option value="custom">custom</option>
            </select>
          </label>
        </div>
      ))}

      <style>{`
        .schema-editor {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          padding: 12px;
          background: var(--bg-card);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .schema-editor .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .schema-editor .title {
          margin: 0;
          color: var(--text-primary);
          font-size: 14px;
        }
        .schema-editor .ghost {
          border: 1px solid var(--glass-border);
          border-radius: 999px;
          padding: 6px 10px;
          background: color-mix(in srgb, var(--bg-base) 86%, transparent);
          color: var(--text-primary);
          font: inherit;
          cursor: pointer;
        }
        .schema-editor .row {
          display: grid;
          grid-template-columns: 1.1fr 1.1fr 1.3fr 1fr 1fr;
          gap: 10px;
        }
        @media (max-width: 1100px) {
          .schema-editor .row {
            grid-template-columns: 1fr 1fr;
          }
        }
        .schema-editor .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          color: var(--text-secondary);
        }
        .schema-editor input,
        .schema-editor select {
          width: 100%;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 8px 10px;
          font: inherit;
        }
        .schema-editor .error {
          margin: 0;
          color: #b83333;
        }
      `}</style>
    </section>
  );
}

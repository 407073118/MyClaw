import React, { useEffect, useRef, useState } from "react";
import type { WorkflowMergeStrategy, WorkflowStateSchemaField, WorkflowStateValueType } from "@shared/contracts";

interface WorkflowStateSchemaEditorProps {
  modelValue: WorkflowStateSchemaField[];
  onUpdateModelValue: (value: WorkflowStateSchemaField[]) => void;
  onValidation: (payload: { errors: string[] }) => void;
  className?: string;
  nodeOptions?: string[];
}

/** 创建默认字段，保证后续编辑结构稳定。*/
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

/** 校验运行数据字段，禁止空 key、重复 key 和不合法的合并策略组合。*/
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

/** 渲染工作流状态字段编辑器，并负责字段级校验。*/
export default function WorkflowStateSchemaEditor({
  modelValue,
  onUpdateModelValue,
  onValidation,
  className,
  nodeOptions = [],
}: WorkflowStateSchemaEditorProps) {
  const [localErrors, setLocalErrors] = useState<string[]>([]);
  const errorText = localErrors.length ? localErrors.join("; ") : "";

  const prevModelValueRef = useRef<WorkflowStateSchemaField[] | null>(null);
  useEffect(() => {
    const errors = validateStateSchema(modelValue);
    setLocalErrors(errors);
    onValidation({ errors });
    prevModelValueRef.current = modelValue;
  }, [modelValue]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 新增运行数据字段。*/
  function handleAddField() {
    console.info("[workflow] 新增运行数据字段");
    const next = [...modelValue, createDefaultField()];
    const errors = validateStateSchema(next);
    setLocalErrors(errors);
    onUpdateModelValue(next);
    onValidation({ errors });
  }

  /** 更新指定字段的局部内容。*/
  function handleFieldPatch(index: number, patch: Partial<WorkflowStateSchemaField>) {
    const next = modelValue.map((field, idx) => (idx === index ? { ...field, ...patch } : field));
    console.info("[workflow] 更新运行数据字段", { index, patch });
    const errors = validateStateSchema(next);
    setLocalErrors(errors);
    onUpdateModelValue(next);
    onValidation({ errors });
  }

  /** 处理字段值类型切换。*/
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

  /** 处理合并策略切换。*/
  function handleMergeStrategyChange(index: number, event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value as WorkflowMergeStrategy | undefined;
    const nextValue: WorkflowMergeStrategy =
      value === "append" || value === "union" || value === "object-merge" || value === "custom" ? value : "replace";
    handleFieldPatch(index, { mergeStrategy: nextValue });
  }

  /** 更新字段生产者节点，显式记录谁会把值写入这个状态字段。*/
  function handleProducerChange(index: number, event: React.ChangeEvent<HTMLSelectElement>) {
    const raw = event.target.value;
    handleFieldPatch(index, {
      producerNodeIds: raw ? [raw] : [],
    });
  }

  /** 更新字段消费者节点，显式记录谁会读取这个状态字段。*/
  function handleConsumerChange(index: number, event: React.ChangeEvent<HTMLSelectElement>) {
    const raw = event.target.value;
    handleFieldPatch(index, {
      consumerNodeIds: raw ? [raw] : [],
    });
  }

  return (
    <section className={`schema-editor${className ? ` ${className}` : ""}`} data-testid="workflow-state-schema-editor">
      <header className="header">
        <h4 className="title">运行数据字段</h4>
        <button data-testid="workflow-state-schema-add-field" type="button" className="ghost" onClick={handleAddField}>
          新增字段
        </button>
      </header>

      {errorText && (
        <p data-testid="workflow-state-schema-error" className="error">{errorText}</p>
      )}

      {modelValue.map((field, index) => (
        <div key={index} className="row">
          <label className="field">
            <span>字段标识</span>
            <input
              data-testid={`workflow-state-schema-key-${index}`}
              type="text"
              value={field.key}
              onChange={(e) => handleFieldPatch(index, { key: e.target.value })}
            />
          </label>

          <label className="field">
            <span>显示名称</span>
            <input
              data-testid={`workflow-state-schema-label-${index}`}
              type="text"
              value={field.label}
              onChange={(e) => handleFieldPatch(index, { label: e.target.value })}
            />
          </label>

          <label className="field">
            <span>用途说明</span>
            <input
              data-testid={`workflow-state-schema-description-${index}`}
              type="text"
              value={field.description}
              onChange={(e) => handleFieldPatch(index, { description: e.target.value })}
            />
          </label>

          <label className="field">
            <span>值类型</span>
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
            <span>合并方式</span>
            <select
              data-testid={`workflow-state-schema-mergeStrategy-${index}`}
              value={field.mergeStrategy}
              onChange={(e) => handleMergeStrategyChange(index, e)}
            >
              <option value="replace">覆盖 replace</option>
              <option value="append">追加 append</option>
              <option value="union">去重合并 union</option>
              <option value="object-merge">对象合并 object-merge</option>
              <option value="custom">自定义 custom</option>
            </select>
          </label>

          <label className="field">
            <span>写入节点</span>
            <select
              data-testid={`workflow-state-schema-producer-${index}`}
              value={field.producerNodeIds[0] ?? ""}
              onChange={(e) => handleProducerChange(index, e)}
            >
              <option value="">不指定</option>
              {nodeOptions.map((nodeId) => (
                <option key={nodeId} value={nodeId}>{nodeId}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>读取节点</span>
            <select
              data-testid={`workflow-state-schema-consumer-${index}`}
              value={field.consumerNodeIds[0] ?? ""}
              onChange={(e) => handleConsumerChange(index, e)}
            >
              <option value="">不指定</option>
              {nodeOptions.map((nodeId) => (
                <option key={nodeId} value={nodeId}>{nodeId}</option>
              ))}
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
          font-size: 15px;
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
          grid-template-columns: 1.1fr 1.1fr 1.3fr 1fr 1fr 1fr 1fr;
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

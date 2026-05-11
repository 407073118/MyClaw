import React from "react";
import {
  WorkflowTransitionConditionOperator,
  type WorkflowConditionalEdge,
  type WorkflowEdge,
  type WorkflowEdgeKind,
  type WorkflowTransitionCondition,
} from "@shared/contracts";

interface WorkflowEdgeEditorProps {
  edge: WorkflowEdge;
  onUpdateEdge: (value: WorkflowEdge) => void;
}

const conditionOperatorOptions = Object.values(WorkflowTransitionConditionOperator);

/** 这些算子不需要右侧值，仅做存在性判断。*/
const NO_RHS_OPERATORS = new Set<string>([
  WorkflowTransitionConditionOperator.Exists,
  WorkflowTransitionConditionOperator.NotExists,
]);

function defaultCondition(): WorkflowTransitionCondition {
  return {
    operator: WorkflowTransitionConditionOperator.Equals,
    leftPath: "",
  };
}

function normalizeOperator(value: string): WorkflowTransitionCondition["operator"] {
  return (conditionOperatorOptions.includes(value as WorkflowTransitionCondition["operator"])
    ? value
    : WorkflowTransitionConditionOperator.Equals) as WorkflowTransitionCondition["operator"];
}

function formatRightValue(value: WorkflowTransitionCondition["rightValue"]): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** 解析右侧值字符串，保持与 condition 节点一致的弱类型推断。*/
function parseRightValue(text: string, operator: WorkflowTransitionCondition["operator"]) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (operator === WorkflowTransitionConditionOperator.In || operator === WorkflowTransitionConditionOperator.NotIn) {
    return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  const parsedNumber = Number(trimmed);
  if (!Number.isNaN(parsedNumber) && trimmed === String(parsedNumber)) return parsedNumber;
  return trimmed;
}

export default function WorkflowEdgeEditor({ edge, onUpdateEdge }: WorkflowEdgeEditorProps) {
  const isConditional = edge.kind === "conditional";
  const condition: WorkflowTransitionCondition | undefined = isConditional ? edge.condition : undefined;
  const operator = condition?.operator ?? WorkflowTransitionConditionOperator.Equals;
  const isRightValueHidden = NO_RHS_OPERATORS.has(operator);

  /** 切换 edge.kind，并同步补齐对应 payload。*/
  function handleKindChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value as WorkflowEdgeKind | undefined;
    const kind = value === "parallel" || value === "conditional" ? value : "normal";

    if (kind === edge.kind) {
      return;
    }

    console.info("[workflow] 更新连线类型", { edgeId: edge.id, kind });

    if (kind === "conditional") {
      onUpdateEdge({
        id: edge.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        kind: "conditional",
        condition: defaultCondition(),
      });
      return;
    }

    onUpdateEdge({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      kind,
    } as WorkflowEdge);
  }

  function updateCondition(patch: Partial<WorkflowTransitionCondition>) {
    if (!isConditional) return;
    const baseCondition: WorkflowTransitionCondition = condition ?? defaultCondition();
    const nextCondition: WorkflowTransitionCondition = {
      ...baseCondition,
      ...patch,
    };
    if (NO_RHS_OPERATORS.has(nextCondition.operator)) {
      delete nextCondition.rightValue;
    }
    console.info("[workflow] 更新条件连线规则", {
      edgeId: edge.id,
      operator: nextCondition.operator,
      leftPath: nextCondition.leftPath,
    });
    const nextEdge: WorkflowConditionalEdge = {
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      kind: "conditional",
      condition: nextCondition,
    };
    onUpdateEdge(nextEdge);
  }

  function handleOperatorChange(event: React.ChangeEvent<HTMLSelectElement>) {
    updateCondition({ operator: normalizeOperator(event.target.value) });
  }

  function handleLeftPathInput(event: React.ChangeEvent<HTMLInputElement>) {
    updateCondition({ leftPath: event.target.value });
  }

  function handleRightValueInput(event: React.ChangeEvent<HTMLInputElement>) {
    if (isRightValueHidden) {
      updateCondition({ rightValue: undefined });
      return;
    }
    updateCondition({ rightValue: parseRightValue(event.target.value, operator) });
  }

  return (
    <section className="edge-editor" data-testid="workflow-edge-editor">
      <h4 className="title">连线配置</h4>

      <label className="field">
        <span>类型</span>
        <select
          data-testid="workflow-edge-editor-kind"
          value={edge.kind}
          onChange={handleKindChange}
        >
          <option value="normal">normal</option>
          <option value="parallel">parallel</option>
          <option value="conditional">conditional</option>
        </select>
      </label>

      {isConditional && (
        <>
          <label className="field">
            <span>运算符</span>
            <select
              data-testid="workflow-edge-editor-operator"
              value={operator}
              onChange={handleOperatorChange}
            >
              {conditionOperatorOptions.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>左侧路径</span>
            <input
              data-testid="workflow-edge-editor-left-path"
              type="text"
              placeholder="$.state.status"
              value={condition?.leftPath ?? ""}
              onChange={handleLeftPathInput}
            />
          </label>

          {!isRightValueHidden && (
            <label className="field">
              <span>右侧值</span>
              <input
                data-testid="workflow-edge-editor-right-value"
                type="text"
                placeholder="approved"
                value={formatRightValue(condition?.rightValue)}
                onChange={handleRightValueInput}
              />
            </label>
          )}
        </>
      )}

      <style>{`
        .edge-editor {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          padding: 12px;
          background: var(--bg-card);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .edge-editor .title {
          margin: 0;
          color: var(--text-primary);
          font-size: 14px;
        }
        .edge-editor .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          color: var(--text-secondary);
          font-size: 12px;
        }
        .edge-editor select,
        .edge-editor input {
          width: 100%;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 8px 10px;
          font: inherit;
        }
      `}</style>
    </section>
  );
}

import React from "react";
import type { WorkflowEdge, WorkflowEdgeKind } from "@shared/contracts";

interface WorkflowEdgeEditorProps {
  edge: WorkflowEdge;
  onUpdateEdge: (value: WorkflowEdge) => void;
}

export default function WorkflowEdgeEditor({ edge, onUpdateEdge }: WorkflowEdgeEditorProps) {
  /** 更新 edge.kind，并保持 payload 结构合法。 */
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
        condition: {
          operator: "exists",
          leftPath: "$.state",
        },
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

  return (
    <section className="edge-editor" data-testid="workflow-edge-editor">
      <h4 className="title">Edge</h4>
      <p className="meta">From {edge.fromNodeId} to {edge.toNodeId}</p>

      <label className="field">
        <span>Kind</span>
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
        .edge-editor .meta {
          margin: 0;
          color: var(--text-secondary);
          font-size: 12px;
        }
        .edge-editor .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          color: var(--text-secondary);
        }
        .edge-editor select {
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

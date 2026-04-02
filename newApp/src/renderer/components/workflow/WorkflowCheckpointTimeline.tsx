import React, { useMemo } from "react";
import type { WorkflowDefinition } from "@shared/contracts";
import type { WorkflowRunCheckpoint } from "../../services/runtime-client";

interface WorkflowCheckpointTimelineProps {
  checkpoints: WorkflowRunCheckpoint[];
  definition: WorkflowDefinition;
}

export default function WorkflowCheckpointTimeline({ checkpoints, definition }: WorkflowCheckpointTimelineProps) {
  const nodeLabels = useMemo(
    () => new Map(definition.nodes.map((node) => [node.id, node.label] as const)),
    [definition.nodes],
  );

  const orderedCheckpoints = useMemo(() => [...checkpoints].reverse(), [checkpoints]);

  function resolveNodeLabel(nodeId: string): string {
    return nodeLabels.get(nodeId) ?? nodeId;
  }

  function hasState(state: Record<string, unknown>): boolean {
    return Object.keys(state).length > 0;
  }

  function formatValue(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value, null, 2);
  }

  return (
    <section data-testid="workflow-checkpoint-timeline" className="timeline">
      <header className="timeline-header">
        <h4>{`Checkpoint Timeline`}</h4>
        <span className="count">{checkpoints.length} events</span>
      </header>

      {checkpoints.length === 0 ? (
        <p className="empty">No checkpoints yet.</p>
      ) : (
        <ol className="items">
          {orderedCheckpoints.map((checkpoint) => (
            <li key={checkpoint.id} className="item">
              <div className="item-top">
                <span className="status">{checkpoint.status}</span>
                <strong>{resolveNodeLabel(checkpoint.nodeId)}</strong>
                <time>{checkpoint.createdAt}</time>
              </div>
              {checkpoint.error && <p className="error">{checkpoint.error}</p>}
              {checkpoint.retryAt && <p className="meta">Retry at {checkpoint.retryAt}</p>}
              {hasState(checkpoint.state) && (
                <pre className="state">{formatValue(checkpoint.state)}</pre>
              )}
            </li>
          ))}
        </ol>
      )}

      <style>{`
        .timeline {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .timeline-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .timeline h4 {
          margin: 0;
          color: var(--text-primary);
          font-size: 15px;
        }
        .timeline .count,
        .timeline .meta,
        .timeline .empty,
        .timeline time {
          color: var(--text-secondary);
          font-size: 12px;
        }
        .timeline .items {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .timeline .item {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .timeline .item-top {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .timeline .status {
          border-radius: 999px;
          padding: 4px 8px;
          background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
          color: var(--text-primary);
          font-size: 12px;
        }
        .timeline strong {
          color: var(--text-primary);
          font-size: 13px;
        }
        .timeline .error {
          margin: 0;
          color: #b83333;
          font-size: 12px;
        }
        .timeline .state {
          margin: 0;
          border-radius: var(--radius-md);
          background: color-mix(in srgb, var(--bg-base) 88%, #0d1520);
          padding: 10px;
          color: var(--text-primary);
          font-size: 12px;
          white-space: pre-wrap;
          word-break: break-word;
        }
      `}</style>
    </section>
  );
}

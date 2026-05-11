import React, { useMemo } from "react";
import type { WorkflowCheckpointSummary, WorkflowDefinition } from "@shared/contracts";

interface WorkflowCheckpointTimelineProps {
  checkpoints: WorkflowCheckpointSummary[];
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

  function formatValue(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value, null, 2);
  }

  /** 优先展示节点最关键的返回字段，避免时间线被原始 JSON 淹没。 */
  function formatNodeOutput(value: unknown): string {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const primary = record.content ?? record.output ?? record.body ?? record.result;
      if (primary !== undefined) return formatValue(primary);
    }
    return formatValue(value);
  }

  return (
    <section data-testid="workflow-checkpoint-timeline" className="timeline">
      <header className="timeline-header">
        <h4>步骤明细</h4>
        <span className="count">{checkpoints.length} 条记录</span>
      </header>

      {checkpoints.length === 0 ? (
        <p className="empty">暂无 checkpoint。</p>
      ) : (
        <ol className="items">
          {orderedCheckpoints.map((checkpoint) => {
            const triggered = checkpoint.triggeredNodes.length > 0
              ? checkpoint.triggeredNodes.map(resolveNodeLabel).join(", ")
              : "(no nodes)";
            return (
              <li key={checkpoint.checkpointId} className="item">
                <div className="item-top">
                  <span className="status">{checkpoint.status}</span>
                  <strong>{triggered}</strong>
                  <time>{checkpoint.createdAt}</time>
                </div>
                {checkpoint.triggeredNodes.length > 0 && (
                  <div className="node-output-list">
                    {checkpoint.triggeredNodes.map((nodeId) => {
                      const output = checkpoint.nodeOutputs?.[nodeId];
                      return (
                        <section key={nodeId} className="node-output-row">
                          <span className="node-output-name">{resolveNodeLabel(nodeId)}</span>
                          {output === undefined ? (
                            <span className="node-output-empty">暂无返回</span>
                          ) : (
                            <pre className="node-output-value">{formatNodeOutput(output)}</pre>
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}
                {checkpoint.interruptPayload && (
                  <p className="meta">
                    {`等待 ${checkpoint.interruptPayload.type} · ${checkpoint.interruptPayload.prompt}`}
                  </p>
                )}
                {checkpoint.interruptPayload && Object.keys(checkpoint.interruptPayload.currentState).length > 0 && (
                  <pre className="state">{formatValue(checkpoint.interruptPayload.currentState)}</pre>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <style>{`
        .timeline {
          display: flex;
          flex-direction: column;
          gap: 10px;
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
          font-size: 13px;
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
          gap: 8px;
        }
        .timeline .item {
          border: 1px solid color-mix(in srgb, var(--glass-border) 86%, transparent);
          border-radius: 8px;
          background: color-mix(in srgb, var(--bg-base) 94%, transparent);
          padding: 10px;
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
          border-radius: 6px;
          padding: 3px 7px;
          background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
          color: var(--text-secondary);
          font-size: 11px;
          font-weight: 700;
        }
        .timeline strong {
          color: var(--text-primary);
          font-size: 13px;
        }
        .timeline .node-output-list {
          display: grid;
          gap: 0;
          border-top: 1px solid color-mix(in srgb, var(--glass-border) 72%, transparent);
        }
        .timeline .node-output-row {
          display: grid;
          grid-template-columns: minmax(96px, 0.28fr) minmax(0, 1fr);
          gap: 10px;
          align-items: start;
          border-bottom: 1px solid color-mix(in srgb, var(--glass-border) 54%, transparent);
          padding: 9px 0;
          background: transparent;
        }
        .timeline .node-output-row:last-child {
          border-bottom: 0;
          padding-bottom: 0;
        }
        .timeline .node-output-name {
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .timeline .node-output-empty {
          color: var(--text-muted);
          font-size: 12px;
        }
        .timeline .node-output-value {
          margin: 0;
          min-width: 0;
          color: var(--text-primary);
          font-size: 13px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
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

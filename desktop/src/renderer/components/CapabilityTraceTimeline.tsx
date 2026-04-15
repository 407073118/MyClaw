import React from "react";

import type { CapabilityEvent } from "@shared/contracts";

/** 将统一 capability trace 渲染成紧凑时间线，供用户观察本轮能力执行轨迹。 */
export function CapabilityTraceTimeline({ events }: { events: CapabilityEvent[] }) {
  if (events.length === 0) {
    return null;
  }

  return (
    <section className="capability-card" data-testid="capability-trace-timeline">
      <div className="capability-card-eyebrow">能力轨迹</div>
      <div className="capability-card-title">最近一轮执行轨迹</div>
      <ol className="capability-trace-list">
        {events.map((event, index) => {
          const payload = event.payload ?? {};
          const queries = Array.isArray(payload.queries)
            ? payload.queries.filter((item): item is string => typeof item === "string")
            : [];
          const detail = queries[0]
            ?? (typeof payload.actionType === "string" ? payload.actionType : null)
            ?? (typeof payload.action === "string" ? payload.action : null)
            ?? (typeof payload.reason === "string" ? payload.reason : null)
            ?? (typeof payload.status === "string" ? payload.status : null)
            ?? event.capabilityId;
          return (
            <li key={`${event.type}-${event.createdAt}-${index}`} className="capability-trace-item">
              <div className="capability-trace-type">{event.type}</div>
              <div className="capability-trace-detail">{detail}</div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

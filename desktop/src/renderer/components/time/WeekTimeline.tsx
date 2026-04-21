import React from "react";

import type { CalendarEvent, SuggestedTimebox } from "../../../../shared/contracts";

type WeekTimelineProps = {
  events: CalendarEvent[];
  suggestions?: SuggestedTimebox[];
};

/** 渲染时间中心的周视图时间线，首版同时展示固定事件和规划建议。 */
export default function WeekTimeline({ events, suggestions = [] }: WeekTimelineProps) {
  return (
    <div className="time-timeline" data-testid="time-week-timeline">
      <section>
        <h3>Events</h3>
        {events.length > 0 ? (
          <ul className="time-list">
            {events.slice(0, 7).map((event) => (
              <li key={event.id} className="time-list-item">
                <strong>{event.title}</strong>
                <span>{formatWindow(event.startsAt, event.endsAt, event.timezone)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="time-empty-state">本周还没有日历事件。</p>
        )}
      </section>

      <section>
        <h3>Suggested Blocks</h3>
        {suggestions.length > 0 ? (
          <ul className="time-list">
            {suggestions.slice(0, 5).map((suggestion) => (
              <li key={`${suggestion.commitmentId}-${suggestion.startsAt}`} className="time-list-item">
                <strong>{suggestion.title}</strong>
                <span>{formatWindow(suggestion.startsAt, suggestion.endsAt, suggestion.timezone)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="time-empty-state">当前还没有可展示的时间块建议。</p>
        )}
      </section>
    </div>
  );
}

/** 格式化事件开始与结束时间，供周视图列表摘要使用。 */
function formatWindow(startsAt: string, endsAt: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${formatter.format(new Date(startsAt))} - ${formatter.format(new Date(endsAt))}`;
}

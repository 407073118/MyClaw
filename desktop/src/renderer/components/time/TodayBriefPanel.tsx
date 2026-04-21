import React from "react";

import type { Reminder, TodayBrief } from "../../../../shared/contracts";

type TodayBriefPanelProps = {
  todayBrief: TodayBrief | null;
  reminders: Reminder[];
  timezone: string;
};

/** 渲染时间规划的今日摘要面板，集中展示今日事项与最近提醒。 */
export default function TodayBriefPanel({
  todayBrief,
  reminders,
  timezone,
}: TodayBriefPanelProps) {
  const items = todayBrief?.items ?? [];
  const upcomingReminders = reminders.slice(0, 3);

  return (
    <section className="glass-card" data-testid="time-today-panel">
      <div className="glass-card__header">
        <div>
          <h3 style={{ margin: 0 }}>Today</h3>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>桌面端本地时间编排摘要，按当前时区展示。</p>
        </div>
        <span className="glass-pill glass-pill--muted">{timezone}</span>
      </div>

      <div className="glass-card__body time-subsection-stack">

        <div style={{ display: "flex", gap: "12px", marginBottom: "8px" }}>
          <article className="time-summary-card" style={{ flex: 1, padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", gap: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <span className="time-summary-label" style={{ fontSize: "12px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Items</span>
            <strong style={{ fontSize: "28px", lineHeight: 1, color: "var(--text-primary)" }}>{items.length}</strong>
          </article>
          <article className="time-summary-card" style={{ flex: 1, padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", gap: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <span className="time-summary-label" style={{ fontSize: "12px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Reminders</span>
            <strong style={{ fontSize: "28px", lineHeight: 1, color: "var(--text-primary)" }}>{reminders.length}</strong>
          </article>
        </div>

      <div className="time-subsection-stack">
        <section>
          <h4 style={{ margin: "0 0 12px 0", fontSize: 14, color: "var(--text-primary)" }}>Agenda</h4>
          {items.length > 0 ? (
            <ul className="time-list">
              {items.slice(0, 5).map((item) => (
                <li key={item.id} className="time-list-item">
                  <strong>{item.title}</strong>
                  <span>{item.summary}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="time-empty-state">今天还没有进入时间摘要的事项。</p>
          )}
        </section>

        <section>
          <h4 style={{ margin: "0 0 12px 0", fontSize: 14, color: "var(--text-primary)" }}>Reminders</h4>
          {upcomingReminders.length > 0 ? (
            <ul className="time-list">
              {upcomingReminders.map((reminder) => (
                <li key={reminder.id} className="time-list-item">
                  <strong>{reminder.title}</strong>
                  <span>{formatTime(reminder.triggerAt, reminder.timezone)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="time-empty-state">还没有待触发的提醒。</p>
          )}
        </section>
      </div>
      </div>
    </section>
  );
}

/** 格式化提醒触发时间，避免页面直接暴露 ISO 字符串。 */
function formatTime(value: string | undefined, timezone: string): string {
  if (!value) {
    return "时间待定";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

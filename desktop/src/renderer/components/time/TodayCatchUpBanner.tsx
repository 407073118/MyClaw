import React from "react";

import type { ExecutionRun, ScheduleJob } from "@shared/contracts";

/** 回看小时数：覆盖"昨晚下班 ~ 今天打开"自然段。 */
const LOOKBACK_HOURS = 16;

/** 判断给定 ISO 时间是否落在最近 LOOKBACK_HOURS 小时内。 */
function isWithinLookback(iso: string | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= LOOKBACK_HOURS * 60 * 60 * 1000 && nowMs - t >= 0;
}

/** 把 ISO 时间格式化成本地时区的 HH:MM；解析失败返回原串。 */
function formatTime(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type Props = {
  executionRuns: ExecutionRun[];
  scheduleJobs: ScheduleJob[];
  timezone: string;
  /** 用户点失败链接时的回调，主页可滚动到对应运行卡片或打开详情。 */
  onInspectRun?: (runId: string) => void;
};

/**
 * 渲染今日入口的 Catch-up 状态条：用 receipts 而非 advice 报告"昨夜 N 完成 / N 失败"。
 *
 * 设计来源见 desktop/docs/plans/2026-05-07-today-first-redesign.md §2 原则 5。
 */
export default function TodayCatchUpBanner({ executionRuns, scheduleJobs, timezone, onInspectRun }: Props) {
  const nowMs = Date.now();
  const recentRuns = executionRuns.filter((run) => isWithinLookback(run.finishedAt ?? run.startedAt, nowMs));
  const succeededCount = recentRuns.filter((r) => r.status === "succeeded").length;
  const failedRuns = recentRuns.filter((r) => r.status === "failed");
  const failedCount = failedRuns.length;
  const cancelledCount = recentRuns.filter((r) => r.status === "cancelled").length;
  const lastFailedRun = failedRuns
    .slice()
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];

  const jobById = new Map(scheduleJobs.map((j) => [j.id, j]));
  const failedJobTitle = lastFailedRun
    ? jobById.get(lastFailedRun.jobId)?.title ?? "(已删除任务)"
    : null;

  if (recentRuns.length === 0) {
    return (
      <section className="catchup-banner catchup-banner--empty" data-testid="today-catchup-banner">
        <span className="catchup-banner__eyebrow">CATCH UP</span>
        <span className="catchup-banner__copy">夜间没有自动任务在跑，今天从干净的一页开始。</span>
        <style>{styles}</style>
      </section>
    );
  }

  return (
    <section className="catchup-banner" data-testid="today-catchup-banner">
      <div className="catchup-banner__head">
        <span className="catchup-banner__eyebrow">CATCH UP</span>
        <span className="catchup-banner__title">最近 {LOOKBACK_HOURS} 小时 receipts</span>
      </div>
      <div className="catchup-banner__metrics">
        <div className="catchup-metric catchup-metric--success">
          <span className="catchup-metric__value">{succeededCount}</span>
          <span className="catchup-metric__label">完成</span>
        </div>
        <div
          className={[
            "catchup-metric",
            failedCount > 0 ? "catchup-metric--alert" : "catchup-metric--muted",
          ].join(" ")}
        >
          <span className="catchup-metric__value">{failedCount}</span>
          <span className="catchup-metric__label">失败</span>
        </div>
        {cancelledCount > 0 ? (
          <div className="catchup-metric catchup-metric--muted">
            <span className="catchup-metric__value">{cancelledCount}</span>
            <span className="catchup-metric__label">取消</span>
          </div>
        ) : null}
        {lastFailedRun ? (
          <button
            type="button"
            className="catchup-banner__failure-link"
            onClick={() => onInspectRun?.(lastFailedRun.id)}
            data-testid="today-catchup-banner__failure-link"
          >
            <span className="catchup-banner__failure-title">「{failedJobTitle}」</span>
            <span className="catchup-banner__failure-meta">
              {formatTime(lastFailedRun.startedAt, timezone)}
              {lastFailedRun.errorMessage ? ` · ${lastFailedRun.errorMessage}` : " · 查看详情"}
            </span>
          </button>
        ) : null}
      </div>
      <style>{styles}</style>
    </section>
  );
}

const styles = `
  .catchup-banner {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 14px 18px;
    border-radius: var(--radius-xl, 14px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    background:
      radial-gradient(circle at top left, rgba(59, 130, 246, 0.10), transparent 58%),
      rgba(255, 255, 255, 0.04);
    flex-wrap: wrap;
  }

  .catchup-banner--empty {
    justify-content: flex-start;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .catchup-banner__head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 132px;
  }

  .catchup-banner__eyebrow {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .catchup-banner__title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .catchup-banner__copy {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .catchup-banner__metrics {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }

  .catchup-metric {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
  }

  .catchup-metric__value {
    font-size: 18px;
    font-weight: 800;
    line-height: 1;
    color: var(--text-primary);
  }

  .catchup-metric__label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .catchup-metric--success .catchup-metric__value {
    color: #b6f3df;
  }

  .catchup-metric--alert {
    border-color: rgba(248, 113, 113, 0.32);
    background: rgba(248, 113, 113, 0.10);
  }

  .catchup-metric--alert .catchup-metric__value {
    color: #fca5a5;
  }

  .catchup-banner__failure-link {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 6px 14px;
    border-radius: var(--radius-md, 7px);
    border: 1px solid rgba(248, 113, 113, 0.24);
    background: rgba(248, 113, 113, 0.06);
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: all 0.18s ease;
    max-width: 100%;
    overflow: hidden;
  }

  .catchup-banner__failure-link:hover {
    background: rgba(248, 113, 113, 0.12);
    border-color: rgba(248, 113, 113, 0.36);
  }

  .catchup-banner__failure-title {
    font-size: 13px;
    font-weight: 700;
    color: #fca5a5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 360px;
  }

  .catchup-banner__failure-meta {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 420px;
  }
`;

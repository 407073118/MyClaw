import React, { useEffect, useState } from "react";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { ExecutionRun, ScheduleJobExecutor } from "@shared/contracts";

import { useWorkspaceStore } from "../stores/workspace";
import { formatJobFrequency } from "../utils/frequency";

/** 单个定时任务的独立详情页：header 元信息 + 触发记录。
 *  对话本身不在此页承载——点击触发记录行跳到对应 ChatPage session。 */
export default function TimeJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const job = useWorkspaceStore((state) => state.time.scheduleJobs.find((item) => item.id === id) ?? null);
  const allRuns = useWorkspaceStore((state) => state.time.executionRuns);

  const sessionMode = job?.sessionMode ?? "per_run";
  const isShared = sessionMode === "shared";

  const runs = useMemo(
    () =>
      allRuns
        .filter((run) => run.jobId === id)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    [allRuns, id],
  );

  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    void useWorkspaceStore.getState().refreshExecutionRuns();
  }, [id]);

  if (!job) {
    return (
      <main className="time-job-detail-page" data-testid="time-job-detail-not-found">
        <header className="time-job-detail__topbar">
          <button type="button" className="time-job-detail__back" onClick={() => navigate("/time")}>← 日程规划</button>
        </header>
        <div className="time-job-detail__missing">
          <h2>找不到这个定时任务</h2>
          <p>它可能已经被删除，或者你刷新过页面。</p>
        </div>
        <style>{styles}</style>
      </main>
    );
  }

  async function handleRunNow() {
    if (!job || running) return;
    setRunning(true);
    setFeedback(null);
    try {
      await useWorkspaceStore.getState().executeScheduleJobNow(job.id);
      setFeedback(`已触发立即执行：${job.title}`);
    } catch (error) {
      setFeedback(`执行失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  }

  function handleEdit() {
    if (!job) return;
    void navigate("/time", { state: { editJobId: job.id } });
  }

  async function handleTogglePause() {
    if (!job) return;
    const nextStatus = job.status === "paused" ? "scheduled" : "paused";
    await useWorkspaceStore.getState().updateScheduleJob({ ...job, status: nextStatus });
    setFeedback(nextStatus === "paused" ? `已暂停：${job.title}` : `已恢复：${job.title}`);
  }

  async function handleDelete() {
    if (!job) return;
    if (!window.confirm(`确认删除定时任务「${job.title}」？此操作不可撤销。`)) return;
    await useWorkspaceStore.getState().deleteScheduleJob(job.id);
    void navigate("/time");
  }

  function handleOpenRunSession(sessionId: string) {
    void navigate(`/chat?sessionId=${encodeURIComponent(sessionId)}`);
  }

  const supportsChat = job.executor === "assistant_prompt";
  const lastRun = runs[0] ?? null;
  // shared 模式：所有触发都汇入同一 session（job.sessionId）；提供一个直达按钮即可。
  const sharedSessionId = isShared && supportsChat ? job.sessionId ?? null : null;

  return (
    <main className="time-job-detail-page" data-testid="time-job-detail">
      <header className="time-job-detail__topbar">
        <button type="button" className="time-job-detail__back" onClick={() => navigate("/time")}>← 日程规划</button>
      </header>

      <section className="time-job-detail__header">
        <div className="time-job-detail__heading">
          <div className="time-job-detail__title-row">
            <h1>{job.title}</h1>
            <span className={`job-type-chip job-type-chip--${job.executor}`}>{formatExecutorLabel(job.executor)}</span>
            <span
              className={
                job.status === "paused"
                  ? "status-badge status-badge--muted"
                  : job.status === "failed"
                  ? "status-badge status-badge--danger"
                  : "status-badge status-badge--active"
              }
            >
              {formatStatusLabel(job.status)}
            </span>
            {supportsChat ? (
              <span
                className={`session-mode-chip session-mode-chip--${sessionMode}`}
                title={isShared
                  ? "累积会话：所有触发拼到同一 session（重构前老行为）"
                  : "每次新会话：每次到点触发产生独立 session，token 干净"}
              >
                {isShared ? "累积会话" : "每次新会话"}
              </span>
            ) : null}
          </div>
          <p className="time-job-detail__meta">
            {formatJobFrequency(job, (iso) => formatLocal(iso, job.timezone))}
            {lastRun
              ? ` · 上次${formatRunStatusZh(lastRun.status)} ${formatLocal(lastRun.startedAt, job.timezone)}`
              : " · 尚未执行"}
          </p>
          {job.description && job.executor !== "assistant_prompt" ? (
            <p className="time-job-detail__description">{job.description}</p>
          ) : null}
        </div>
        <div className="time-job-detail__actions">
          <button type="button" className="time-job-detail__btn is-primary" onClick={handleRunNow} disabled={running}>
            {running ? "执行中…" : "立即执行"}
          </button>
          {sharedSessionId ? (
            <button
              type="button"
              className="time-job-detail__btn"
              onClick={() => handleOpenRunSession(sharedSessionId)}
              title="在聊天页打开这个累积会话"
            >
              打开会话
            </button>
          ) : null}
          <button type="button" className="time-job-detail__btn" onClick={handleEdit}>编辑</button>
          <button type="button" className="time-job-detail__btn" onClick={handleTogglePause}>
            {job.status === "paused" ? "恢复" : "暂停"}
          </button>
          <button type="button" className="time-job-detail__btn is-danger" onClick={handleDelete}>删除</button>
        </div>
        {feedback ? <p className="time-job-detail__feedback">{feedback}</p> : null}
      </section>

      <section className="time-job-detail__runs">
        <header className="time-job-detail__section-head">
          <h2>触发记录</h2>
          <span>{runs.length} 次{supportsChat ? " · 点击行进入对应聊天" : ""}</span>
        </header>
        {runs.length === 0 ? (
          <p className="time-job-detail__empty-hint">这个任务还没有执行过。</p>
        ) : (
          <ol className="time-job-detail__run-list">
            {runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                timezone={job.timezone}
                onOpenSession={handleOpenRunSession}
              />
            ))}
          </ol>
        )}
      </section>

      <style>{styles}</style>
    </main>
  );
}

type RunRowProps = {
  run: ExecutionRun;
  timezone: string;
  onOpenSession: (sessionId: string) => void;
};

function RunRow({ run, timezone, onOpenSession }: RunRowProps) {
  const summaryPreview = run.outputSummary
    ? run.outputSummary.replace(/\s+/g, " ").trim().slice(0, 160)
    : "";
  const canOpen = Boolean(run.sessionId);

  return (
    <li className={`run-row run-row--${run.status}${canOpen ? " run-row--openable" : ""}`}>
      <button
        type="button"
        className="run-row__btn-row"
        onClick={canOpen && run.sessionId ? () => onOpenSession(run.sessionId!) : undefined}
        disabled={!canOpen}
        aria-label={canOpen ? `打开这次触发的聊天会话` : `本次触发没有关联会话`}
      >
        <span className="run-row__bullet" aria-hidden="true">{run.status === "succeeded" ? "✓" : run.status === "failed" ? "✗" : run.status === "running" ? "…" : "•"}</span>
        <div className="run-row__body">
          <div className="run-row__head">
            <span className="run-row__time">
              {formatLocal(run.startedAt, timezone)}
              {run.finishedAt ? ` → ${formatClock(run.finishedAt, timezone)}` : ""}
            </span>
            <span className={`status-badge status-badge--${run.status === "succeeded" ? "active" : run.status === "failed" ? "danger" : run.status === "running" ? "normal" : "muted"}`}>
              {formatRunStatusZh(run.status)}
            </span>
            {canOpen ? <span className="run-row__open-hint" aria-hidden="true">打开聊天 →</span> : null}
          </div>
          {summaryPreview ? <p className="run-row__summary">{summaryPreview}{(run.outputSummary?.length ?? 0) > 160 ? "…" : ""}</p> : null}
          {run.errorMessage ? <pre className="run-row__error">{run.errorMessage}</pre> : null}
        </div>
      </button>
    </li>
  );
}

function formatExecutorLabel(executor: ScheduleJobExecutor): string {
  if (executor === "assistant_prompt") return "Prompt";
  if (executor === "workflow") return "Workflow";
  return "员工";
}

function formatStatusLabel(status: string): string {
  switch (status) {
    case "scheduled": return "已排期";
    case "running": return "运行中";
    case "paused": return "已暂停";
    case "completed": return "已完成";
    case "failed": return "失败";
    case "cancelled": return "已取消";
    default: return status;
  }
}

function formatRunStatusZh(status: string): string {
  switch (status) {
    case "succeeded": return "成功";
    case "failed": return "失败";
    case "running": return "运行中";
    case "cancelled": return "已取消";
    default: return status;
  }
}

function formatLocal(iso: string, timezone: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatClock(iso: string, timezone: string): string {
  if (!iso) return "";
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

const styles = `
  .time-job-detail-page {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-base);
    color: var(--text-primary);
    overflow-y: auto;
  }

  .time-job-detail__topbar {
    padding: 14px 24px 0;
  }

  .time-job-detail__back {
    background: transparent;
    border: 0;
    padding: 4px 0;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .time-job-detail__back:hover {
    color: var(--accent-cyan);
  }

  .time-job-detail__header {
    margin: 12px 24px 0;
    padding: 20px 24px;
    background: var(--bg-card);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-xl);
    display: flex;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
  }

  .time-job-detail__heading {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .time-job-detail__title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .time-job-detail__title-row h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .time-job-detail__meta {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .time-job-detail__description {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.6;
  }

  .time-job-detail__actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .time-job-detail__btn {
    height: 32px;
    padding: 0 14px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }

  .time-job-detail__btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--glass-border-hover);
    background: var(--bg-surface-hover);
  }

  .time-job-detail__btn.is-primary {
    color: var(--accent-cyan);
    border-color: rgba(16, 163, 127, 0.5);
  }

  .time-job-detail__btn.is-primary:hover:not(:disabled) {
    background: rgba(16, 163, 127, 0.12);
    border-color: var(--accent-cyan);
  }

  .time-job-detail__btn.is-danger {
    color: var(--status-red);
    border-color: rgba(239, 68, 68, 0.32);
  }

  .time-job-detail__btn.is-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
    border-color: var(--status-red);
  }

  .time-job-detail__btn:disabled {
    opacity: 0.55;
    cursor: progress;
  }

  .time-job-detail__feedback {
    flex-basis: 100%;
    margin: 0;
    padding: 8px 12px;
    background: rgba(16, 163, 127, 0.1);
    border: 1px solid rgba(16, 163, 127, 0.3);
    border-radius: var(--radius-md);
    color: var(--accent-cyan);
    font-size: 12px;
  }

  .time-job-detail__runs {
    margin: 16px 24px;
    background: var(--bg-card);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-xl);
    display: flex;
    flex-direction: column;
  }

  .time-job-detail__section-head {
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .time-job-detail__section-head h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .time-job-detail__section-head span {
    color: var(--text-muted);
    font-size: 12px;
  }

  .time-job-detail__empty-hint {
    margin: 0;
    padding: 24px;
    color: var(--text-muted);
    text-align: center;
    font-size: 13px;
    line-height: 1.7;
  }

  .time-job-detail__run-list {
    list-style: none;
    margin: 0;
    padding: 12px 20px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .run-row {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    overflow: hidden;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .run-row.run-row--openable:hover {
    border-color: var(--glass-border-hover);
    background: var(--bg-surface-hover);
  }

  .run-row__btn-row {
    all: unset;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 10px;
    padding: 10px 12px;
    width: 100%;
    cursor: pointer;
  }

  .run-row__btn-row:disabled {
    cursor: default;
  }

  .run-row__btn-row:focus-visible {
    outline: 1px solid var(--accent-cyan);
    outline-offset: -2px;
  }

  .run-row__bullet {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
  }

  .run-row__open-hint {
    margin-left: auto;
    font-size: 11px;
    color: var(--accent-cyan);
    font-weight: 600;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .run-row.run-row--openable:hover .run-row__open-hint,
  .run-row__btn-row:focus-visible .run-row__open-hint {
    opacity: 1;
  }

  .session-mode-chip {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .session-mode-chip--per_run {
    border-color: rgba(16, 163, 127, 0.45);
    color: var(--accent-cyan);
  }

  .session-mode-chip--shared {
    border-color: rgba(245, 158, 11, 0.45);
    color: var(--status-yellow);
  }

  .run-row--succeeded .run-row__bullet { background: rgba(34, 197, 94, 0.18); color: var(--status-green); }
  .run-row--failed .run-row__bullet { background: rgba(239, 68, 68, 0.18); color: var(--status-red); }
  .run-row--running .run-row__bullet { background: rgba(59, 130, 246, 0.18); color: #60a5fa; }
  .run-row--cancelled .run-row__bullet { background: rgba(255, 255, 255, 0.06); color: var(--text-muted); }

  .run-row__body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .run-row__head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .run-row__time {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .run-row__summary {
    margin: 0;
    color: var(--text-primary);
    font-size: 12px;
    line-height: 1.55;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .run-row__error {
    margin: 0;
    padding: 8px 10px;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.22);
    border-radius: var(--radius-sm);
    color: var(--status-red);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .time-job-detail__missing {
    margin: 80px auto;
    text-align: center;
    color: var(--text-muted);
  }

  .time-job-detail__missing h2 {
    color: var(--text-secondary);
    font-weight: 600;
  }
`;

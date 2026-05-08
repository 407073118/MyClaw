import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  textOfContent,
  type ChatMessage,
  type ExecutionRun,
  type ScheduleJob,
  type ScheduleJobExecutor,
} from "@shared/contracts";

import MarkdownView from "../components/MarkdownView";
import { useWorkspaceStore } from "../stores/workspace";
import { formatJobFrequency } from "../utils/frequency";

/** 单个定时任务的独立详情页：header 元信息 + Prompt 类型对话流 + 执行记录。 */
export default function TimeJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const job = useWorkspaceStore((state) => state.time.scheduleJobs.find((item) => item.id === id) ?? null);
  const sessions = useWorkspaceStore((state) => state.sessions);
  const allRuns = useWorkspaceStore((state) => state.time.executionRuns);

  const session = useMemo(
    () => (job?.sessionId ? sessions.find((item) => item.id === job.sessionId) ?? null : null),
    [job?.sessionId, sessions],
  );
  const runs = useMemo(
    () =>
      allRuns
        .filter((run) => run.jobId === id)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    [allRuns, id],
  );
  const visibleMessages = useMemo(
    () => (session?.messages ?? []).filter((message) => message.role !== "system"),
    [session?.messages],
  );

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // 进入页面时自动选中该 session，让 sendMessage / cancelSessionRun 能命中
  useEffect(() => {
    if (job?.sessionId) {
      useWorkspaceStore.getState().selectSession(job.sessionId);
    }
  }, [job?.sessionId]);

  // 进入后刷一次执行记录，确保看到最新一次执行
  useEffect(() => {
    void useWorkspaceStore.getState().refreshExecutionRuns();
  }, [id]);

  // 消息更新后滚到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleMessages.length]);

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

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (!session) return;
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const ws = useWorkspaceStore.getState();
      ws.selectSession(session.id);
      await ws.sendMessage(trimmed);
      setDraft("");
    } catch (error) {
      setFeedback(`发送失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
    }
  }

  const supportsChat = job.executor === "assistant_prompt";
  const lastRun = runs[0] ?? null;

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
          <button type="button" className="time-job-detail__btn" onClick={handleEdit}>编辑</button>
          <button type="button" className="time-job-detail__btn" onClick={handleTogglePause}>
            {job.status === "paused" ? "恢复" : "暂停"}
          </button>
          <button type="button" className="time-job-detail__btn is-danger" onClick={handleDelete}>删除</button>
        </div>
        {feedback ? <p className="time-job-detail__feedback">{feedback}</p> : null}
      </section>

      {supportsChat ? (
        <section className="time-job-detail__chat">
          <header className="time-job-detail__section-head">
            <h2>对话</h2>
            <span>{visibleMessages.length} 条消息 · 继续聊或等待下次到点触发</span>
          </header>
          <div className="time-job-detail__messages">
            {visibleMessages.length === 0 ? (
              <div className="time-job-detail__empty-hint">
                <p>这个任务还没产生过对话。</p>
                <p>到点触发或点「立即执行」会生成第一条消息。</p>
              </div>
            ) : (
              visibleMessages.map((message) => (
                <ChatBubble key={message.id} message={message} timezone={job.timezone} />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
          <form className="time-job-detail__compose" onSubmit={handleSend}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void handleSend(event);
                }
              }}
              placeholder={session ? "继续往下聊…（⌘ / Ctrl + Enter 发送）" : "首次执行后才能开始对话"}
              rows={3}
              disabled={sending || !session}
            />
            <button type="submit" className="time-job-detail__btn is-primary" disabled={sending || !draft.trim() || !session}>
              {sending ? "发送中…" : "发送"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="time-job-detail__runs">
        <header className="time-job-detail__section-head">
          <h2>执行记录</h2>
          <span>{runs.length} 次</span>
        </header>
        {runs.length === 0 ? (
          <p className="time-job-detail__empty-hint">这个任务还没有执行过。</p>
        ) : (
          <ol className="time-job-detail__run-list">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} timezone={job.timezone} />
            ))}
          </ol>
        )}
      </section>

      <style>{styles}</style>
    </main>
  );
}

function ChatBubble({ message, timezone }: { message: ChatMessage; timezone: string }) {
  if (message.role === "tool") {
    const text = textOfContent(message.content);
    const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
    return (
      <div className="bubble bubble--tool">
        <div className="bubble__meta">
          <span className="bubble__role">工具结果</span>
          <span className="bubble__time">{formatLocal(message.createdAt, timezone)}</span>
        </div>
        <details className="bubble__tool-details">
          <summary>{preview || "（空输出）"}</summary>
          <pre>{text}</pre>
        </details>
      </div>
    );
  }
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "bubble bubble--user" : "bubble bubble--assistant"}>
      <div className="bubble__meta">
        <span className="bubble__role">{isUser ? "我" : "助手"}</span>
        <span className="bubble__time">{formatLocal(message.createdAt, timezone)}</span>
      </div>
      <MarkdownView source={textOfContent(message.content)} className="bubble__markdown" />
    </div>
  );
}

function RunRow({ run, timezone }: { run: ExecutionRun; timezone: string }) {
  const summaryPreview = run.outputSummary
    ? run.outputSummary.replace(/\s+/g, " ").trim().slice(0, 120)
    : "";
  return (
    <li className={`run-row run-row--${run.status}`}>
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
        </div>
        {summaryPreview ? <p className="run-row__summary">{summaryPreview}{(run.outputSummary?.length ?? 0) > 120 ? "…" : ""}</p> : null}
        {run.errorMessage ? <pre className="run-row__error">{run.errorMessage}</pre> : null}
      </div>
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

  .time-job-detail__chat,
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

  .time-job-detail__messages {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: 580px;
    overflow-y: auto;
  }

  .time-job-detail__empty-hint {
    margin: 0;
    padding: 24px;
    color: var(--text-muted);
    text-align: center;
    font-size: 13px;
    line-height: 1.7;
  }

  .bubble {
    max-width: 78%;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .bubble__meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .bubble__role {
    font-weight: 700;
  }

  .bubble--user {
    align-self: flex-end;
    align-items: flex-end;
  }

  .bubble--assistant,
  .bubble--tool {
    align-self: flex-start;
    align-items: flex-start;
  }

  .bubble__markdown {
    margin: 0;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: 13px;
    line-height: 1.65;
    word-break: break-word;
  }

  .bubble--user .bubble__markdown {
    background: rgba(16, 163, 127, 0.1);
    border-color: rgba(16, 163, 127, 0.3);
  }

  .bubble--assistant .bubble__markdown,
  .bubble--user .bubble__markdown {
    /* Markdown 元素继承 execution-history-row__markdown 已加载的 typography？
       这里不依赖外部，自己写常用元素的样式。 */
  }

  .bubble__markdown > *:first-child { margin-top: 0; }
  .bubble__markdown > *:last-child { margin-bottom: 0; }
  .bubble__markdown h1,
  .bubble__markdown h2,
  .bubble__markdown h3 {
    margin: 12px 0 6px;
    font-weight: 600;
  }
  .bubble__markdown h1 { font-size: 17px; }
  .bubble__markdown h2 { font-size: 15px; }
  .bubble__markdown h3 { font-size: 14px; }
  .bubble__markdown p { margin: 6px 0; }
  .bubble__markdown ul,
  .bubble__markdown ol { margin: 6px 0; padding-left: 22px; }
  .bubble__markdown li { margin: 2px 0; }
  .bubble__markdown a { color: var(--accent-cyan); text-decoration: none; border-bottom: 1px solid rgba(16, 163, 127, 0.35); }
  .bubble__markdown a:hover { border-bottom-color: var(--accent-cyan); }
  .bubble__markdown code {
    padding: 1px 5px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-sm);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px;
  }
  .bubble__markdown pre {
    margin: 8px 0;
    padding: 10px 12px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    overflow-x: auto;
    font-size: 12px;
  }
  .bubble__markdown pre code {
    padding: 0;
    background: transparent;
  }
  .bubble__markdown blockquote {
    margin: 8px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--glass-border-strong);
    color: var(--text-secondary);
  }

  .bubble--tool {
    max-width: 92%;
    color: var(--text-muted);
    font-size: 12px;
  }

  .bubble__tool-details {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    padding: 8px 12px;
    width: 100%;
  }

  .bubble__tool-details summary {
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
  }

  .bubble__tool-details pre {
    margin: 8px 0 0;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.35);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 240px;
    overflow-y: auto;
  }

  .time-job-detail__compose {
    padding: 12px 20px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    gap: 10px;
    align-items: flex-end;
  }

  .time-job-detail__compose textarea {
    flex: 1;
    min-height: 60px;
    padding: 10px 12px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.55;
    resize: vertical;
  }

  .time-job-detail__compose textarea:focus {
    outline: none;
    border-color: rgba(16, 163, 127, 0.55);
  }

  .time-job-detail__compose textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
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

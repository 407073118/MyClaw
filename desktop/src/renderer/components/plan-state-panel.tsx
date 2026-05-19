import React, { useEffect, useRef, useState } from "react";
import type { Task, TaskInterruptRequest, TaskResumeInput } from "@shared/contracts";
import { buildTaskDisplayItems } from "@shared/task-logical";

type PlanStatePanelProps = {
  tasks?: Task[];
  interrupts?: TaskInterruptRequest[];
  onDismiss?: () => void;
  onResumeInterrupt?: (input: TaskResumeInput) => void | Promise<void>;
};

type InterruptInputField = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "boolean" | "select";
  required?: boolean;
  choices?: Array<{ label: string; value: string }>;
};

/** 从轻量 inputSchema 中提取 renderer 能稳定渲染的字段定义。 */
function getInterruptInputFields(schema: TaskInterruptRequest["inputSchema"]): InterruptInputField[] {
  const fields = schema && Array.isArray(schema.fields) ? schema.fields : [];
  return fields
    .filter((field): field is Record<string, unknown> =>
      !!field && typeof field === "object" && typeof field.name === "string" && typeof field.label === "string",
    )
    .map((field) => {
      const name = field.name as string;
      const label = field.label as string;
      const rawType = typeof field.type === "string" ? field.type : "text";
      const type = ["text", "textarea", "number", "boolean", "select"].includes(rawType)
        ? rawType as InterruptInputField["type"]
        : "text";
      const choices = Array.isArray(field.choices)
        ? field.choices
          .filter((choice): choice is Record<string, unknown> =>
            !!choice && typeof choice === "object" && typeof choice.label === "string" && typeof choice.value === "string",
          )
          .map((choice) => ({ label: choice.label as string, value: choice.value as string }))
        : undefined;
      return {
        name,
        label,
        type,
        required: field.required === true,
        ...(choices && choices.length > 0 ? { choices } : {}),
      };
    });
}

/** 根据字段类型创建恢复表单的初始值。 */
function buildInitialFieldValues(fields: InterruptInputField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => {
    if (field.type === "boolean") return [field.name, false];
    if (field.type === "select") return [field.name, field.choices?.[0]?.value ?? ""];
    return [field.name, ""];
  }));
}

const TASK_V2_STATUS_ICONS: Record<string, string> = {
  pending: "o",
  in_progress: "~",
  waiting_user: "!",
  blocked: "!",
  failed: "x",
  completed: "+",
  cancelled: "x",
};

const TASK_V2_STYLES = `
  .task-v2-bar { flex-shrink: 0; padding: 0 24px 4px; }
  .task-v2-bar-inner { max-width: 800px; margin: 0 auto; border: 1px solid var(--glass-border); border-radius: var(--radius-lg); background: var(--bg-card); overflow: hidden; }

  .task-v2-summary { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; list-style: none; user-select: none; }
  .task-v2-summary::-webkit-details-marker { display: none; }
  .task-v2-summary::marker { display: none; content: ""; }

  .task-v2-chevron { width: 16px; height: 16px; flex-shrink: 0; color: var(--text-muted); transition: transform 0.2s ease; }
  .task-v2-details[open] .task-v2-chevron { transform: rotate(180deg); }

  .task-v2-progress-label { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; }
  .task-v2-progress-bar { flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden; min-width: 60px; }
  .task-v2-progress-fill { height: 100%; border-radius: 2px; background: var(--accent-cyan); transition: width 0.3s ease; }

  .task-v2-dismiss { flex-shrink: 0; width: 22px; height: 22px; border: none; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; line-height: 1; padding: 0; transition: background 0.15s ease, color 0.15s ease; }
  .task-v2-dismiss:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); }

  .task-v2-body { padding: 0 14px 12px; max-height: 240px; overflow-y: auto; }
  .task-v2-interrupt-card { margin: 2px 0 10px; padding: 10px; border: 1px solid color-mix(in srgb, var(--status-yellow) 40%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--status-yellow) 10%, transparent); display: grid; gap: 8px; }
  .task-v2-interrupt-label { font-size: 11px; font-weight: 700; color: var(--status-yellow); }
  .task-v2-interrupt-question { margin: 0; color: var(--text-primary); font-size: 13px; line-height: 18px; }
  .task-v2-interrupt-reason { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 17px; }
  .task-v2-interrupt-choices { display: flex; flex-wrap: wrap; gap: 6px; }
  .task-v2-choice { border: 1px solid var(--glass-border); border-radius: 6px; background: rgba(255,255,255,0.04); color: var(--text-secondary); padding: 5px 8px; font-size: 12px; cursor: pointer; }
  .task-v2-choice[data-selected="true"] { border-color: var(--accent-cyan); color: var(--text-primary); background: rgba(68, 204, 255, 0.12); }
  .task-v2-interrupt-fields { display: grid; gap: 8px; }
  .task-v2-interrupt-field { display: grid; gap: 4px; }
  .task-v2-interrupt-field label { font-size: 12px; color: var(--text-secondary); }
  .task-v2-interrupt-input { width: 100%; border: 1px solid var(--glass-border); border-radius: 6px; background: rgba(0,0,0,0.18); color: var(--text-primary); padding: 7px 8px; font-size: 12px; line-height: 18px; outline: none; }
  .task-v2-interrupt-input:focus { border-color: var(--accent-cyan); }
  .task-v2-interrupt-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .task-v2-interrupt-action { border: 1px solid var(--glass-border); border-radius: 6px; background: rgba(255,255,255,0.06); color: var(--text-primary); padding: 6px 9px; font-size: 12px; cursor: pointer; }
  .task-v2-interrupt-action:hover, .task-v2-choice:hover { background: rgba(255,255,255,0.1); }
  .task-v2-interrupt-action:disabled, .task-v2-choice:disabled, .task-v2-interrupt-input:disabled { opacity: 0.55; cursor: not-allowed; }
  .task-v2-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .task-v2-task { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border-radius: var(--radius-md); font-size: 13px; }
  .task-v2-task-order { flex-shrink: 0; min-width: 22px; color: var(--text-muted); font-variant-numeric: tabular-nums; line-height: 20px; }
  .task-v2-task-icon { flex-shrink: 0; width: 18px; text-align: center; font-size: 12px; line-height: 20px; }
  .task-v2-task-icon[data-status="pending"] { color: var(--text-muted); }
  .task-v2-task-icon[data-status="in_progress"] { color: var(--accent-cyan); }
  .task-v2-task-icon[data-status="waiting_user"] { color: var(--status-yellow); }
  .task-v2-task-icon[data-status="blocked"], .task-v2-task-icon[data-status="failed"], .task-v2-task-icon[data-status="cancelled"] { color: var(--status-red); }
  .task-v2-task-icon[data-status="completed"] { color: var(--status-green); }
  .task-v2-task-title { color: var(--text-primary); line-height: 20px; }
  .task-v2-task-title[data-status="waiting_user"] { color: var(--text-secondary); }
  .task-v2-task-title[data-status="cancelled"], .task-v2-task-title[data-status="failed"] { color: var(--text-muted); text-decoration: line-through; }
  .task-v2-task-title[data-status="completed"] { color: var(--text-muted); text-decoration: line-through; }
  .task-v2-task-status { flex-shrink: 0; margin-left: auto; font-size: 11px; color: var(--text-muted); }
`;

/** 展示会话级任务进度，并对重复逻辑任务做归并显示。 */
export function PlanStatePanel({ tasks, interrupts, onDismiss, onResumeInterrupt }: PlanStatePanelProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const items = buildTaskDisplayItems(tasks ?? []);
  const prevCountRef = useRef(items.length);
  const [autoCollapsed, setAutoCollapsed] = useState(false);

  const total = items.length;
  const completed = items.filter((item) => item.task.status === "completed").length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const activeTask = items.find((item) => item.task.status === "in_progress")?.task;
  const waitingTask = items.find((item) => item.task.status === "waiting_user")?.task;
  const summaryTask = activeTask ?? waitingTask;
  const taskById = new Map(items.map((item) => [item.task.id, item.task]));
  const activeInterrupt = (interrupts ?? []).find((request) => {
    if (request.status !== "active") return false;
    const task = taskById.get(request.taskId);
    return task?.status === "waiting_user" || task?.metadata?.interruptRequestId === request.requestId || !task;
  });
  const interruptFields = getInterruptInputFields(activeInterrupt?.inputSchema);
  const [selectedChoice, setSelectedChoice] = useState<string | undefined>(
    activeInterrupt?.choices?.[0]?.value,
  );
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>(
    buildInitialFieldValues(interruptFields),
  );
  const [isSubmittingInterrupt, setIsSubmittingInterrupt] = useState(false);
  const submittingInterruptRef = useRef(false);

  /** 切换 active interrupt 时同步默认选项，保证按钮提交的是当前请求。 */
  useEffect(() => {
    setSelectedChoice(activeInterrupt?.choices?.[0]?.value);
    setFieldValues(buildInitialFieldValues(getInterruptInputFields(activeInterrupt?.inputSchema)));
    submittingInterruptRef.current = false;
    setIsSubmittingInterrupt(false);
  }, [activeInterrupt?.requestId, activeInterrupt?.choices, activeInterrupt?.inputSchema]);

  /** 将等待卡片动作封装成结构化 resume 输入。 */
  const hasMissingRequiredField = interruptFields.some((field) => {
    if (!field.required) return false;
    const value = fieldValues[field.name];
    if (field.type === "boolean") return value == null;
    return String(value ?? "").trim() === "";
  });
  const buildResumePayload = (): Record<string, unknown> | undefined => {
    const payload: Record<string, unknown> = {};
    for (const field of interruptFields) {
      payload[field.name] = fieldValues[field.name];
    }
    if (activeInterrupt?.choices?.length) {
      payload.choice = selectedChoice ?? activeInterrupt.choices[0]?.value ?? "";
    }
    return Object.keys(payload).length > 0 ? payload : undefined;
  };
  const resumeInterrupt = async (action: TaskResumeInput["action"]) => {
    if (!activeInterrupt || !onResumeInterrupt) return;
    if (submittingInterruptRef.current) return;
    if (action === "submit" && hasMissingRequiredField) return;
    submittingInterruptRef.current = true;
    setIsSubmittingInterrupt(true);
    try {
      const payload = buildResumePayload();
      await onResumeInterrupt({
        requestId: activeInterrupt.requestId,
        taskId: activeInterrupt.taskId,
        resumeToken: activeInterrupt.resumeToken,
        action,
        ...(payload ? { payload } : {}),
      });
    } catch {
      submittingInterruptRef.current = false;
      setIsSubmittingInterrupt(false);
    }
  };

  /** 有新逻辑任务加入时自动展开，确保用户能看到新的执行顺序。 */
  useEffect(() => {
    if (items.length > prevCountRef.current && detailsRef.current) {
      detailsRef.current.open = true;
      setAutoCollapsed(false);
    }
    prevCountRef.current = items.length;
  }, [items.length]);

  /** 全部完成后自动折叠，避免面板持续占据聊天输入上方空间。 */
  useEffect(() => {
    if (total > 0 && completed === total && !autoCollapsed) {
      const timer = setTimeout(() => {
        if (detailsRef.current) {
          detailsRef.current.open = false;
        }
        setAutoCollapsed(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [total, completed, autoCollapsed]);

  if (total === 0) return null;

  return (
    <>
      <div className="task-v2-bar">
        <details ref={detailsRef} className="task-v2-bar-inner task-v2-details" data-testid="task-v2-panel" open>
          <summary className="task-v2-summary">
            <svg className="task-v2-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>

            <span className="task-v2-progress-label">
              {completed}/{total} 已完成
            </span>

            <div className="task-v2-progress-bar">
              <div className="task-v2-progress-fill" style={{ width: `${pct}%` }} />
            </div>

            {summaryTask && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 200,
                }}
              >
                {summaryTask.activeForm ?? summaryTask.subject}
              </span>
            )}

            {onDismiss && !activeInterrupt && (
              <button
                className="task-v2-dismiss"
                title="关闭任务面板"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDismiss();
                }}
              >
                x
              </button>
            )}
          </summary>

          <div className="task-v2-body">
            {activeInterrupt && (
              <div className="task-v2-interrupt-card" data-testid="task-v2-interrupt-card">
                <span className="task-v2-interrupt-label">需要你回复</span>
                <p className="task-v2-interrupt-question">{activeInterrupt.question}</p>
                {activeInterrupt.reason && (
                  <p className="task-v2-interrupt-reason">{activeInterrupt.reason}</p>
                )}
                {activeInterrupt.choices && activeInterrupt.choices.length > 0 && (
                  <div className="task-v2-interrupt-choices">
                    {activeInterrupt.choices.map((choice) => (
                      <button
                        key={choice.value}
                        type="button"
                        className="task-v2-choice"
                        data-selected={selectedChoice === choice.value}
                        aria-pressed={selectedChoice === choice.value}
                        disabled={isSubmittingInterrupt}
                        title={choice.description ?? choice.label}
                        onClick={() => setSelectedChoice(choice.value)}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                )}
                {interruptFields.length > 0 && (
                  <div className="task-v2-interrupt-fields">
                    {interruptFields.map((field) => {
                      const fieldId = `task-v2-interrupt-${activeInterrupt.requestId}-${field.name}`;
                      const value = fieldValues[field.name];
                      return (
                        <div key={field.name} className="task-v2-interrupt-field">
                          <label htmlFor={fieldId}>{field.label}</label>
                          {field.type === "textarea" ? (
                            <textarea
                              id={fieldId}
                              className="task-v2-interrupt-input"
                              value={String(value ?? "")}
                              required={field.required}
                              disabled={isSubmittingInterrupt}
                              onChange={(event) => setFieldValues((current) => ({
                                ...current,
                                [field.name]: event.target.value,
                              }))}
                            />
                          ) : field.type === "boolean" ? (
                            <input
                              id={fieldId}
                              type="checkbox"
                              checked={Boolean(value)}
                              disabled={isSubmittingInterrupt}
                              onChange={(event) => setFieldValues((current) => ({
                                ...current,
                                [field.name]: event.target.checked,
                              }))}
                            />
                          ) : field.type === "select" ? (
                            <select
                              id={fieldId}
                              className="task-v2-interrupt-input"
                              value={String(value ?? "")}
                              required={field.required}
                              disabled={isSubmittingInterrupt}
                              onChange={(event) => setFieldValues((current) => ({
                                ...current,
                                [field.name]: event.target.value,
                              }))}
                            >
                              {(field.choices ?? []).map((choice) => (
                                <option key={choice.value} value={choice.value}>{choice.label}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={fieldId}
                              className="task-v2-interrupt-input"
                              type={field.type === "number" ? "number" : "text"}
                              value={String(value ?? "")}
                              required={field.required}
                              disabled={isSubmittingInterrupt}
                              onChange={(event) => setFieldValues((current) => ({
                                ...current,
                                [field.name]: field.type === "number" && event.target.value !== ""
                                  ? Number(event.target.value)
                                  : event.target.value,
                              }))}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="task-v2-interrupt-actions">
                  <button type="button" className="task-v2-interrupt-action" disabled={isSubmittingInterrupt || hasMissingRequiredField} onClick={() => void resumeInterrupt("submit")}>
                    提交并继续
                  </button>
                  <button type="button" className="task-v2-interrupt-action" disabled={isSubmittingInterrupt} onClick={() => void resumeInterrupt("approve")}>
                    批准并继续
                  </button>
                  <button type="button" className="task-v2-interrupt-action" disabled={isSubmittingInterrupt} onClick={() => void resumeInterrupt("reject")}>
                    拒绝并停止
                  </button>
                  <button type="button" className="task-v2-interrupt-action" disabled={isSubmittingInterrupt} onClick={() => void resumeInterrupt("cancel")}>
                    取消任务
                  </button>
                </div>
              </div>
            )}
            <ol className="task-v2-list">
              {items.map((item) => {
                const task = item.task;
                return (
                  <li key={task.id} className="task-v2-task" data-testid={`task-v2-${task.id}`}>
                    <span className="task-v2-task-order">{item.sequence}.</span>
                    <span className="task-v2-task-icon" data-status={task.status}>
                      {TASK_V2_STATUS_ICONS[task.status] ?? "o"}
                    </span>
                    <span className="task-v2-task-title" data-status={task.status}>
                      {task.subject}
                    </span>
                    {task.status === "in_progress" && (
                      <span className="task-v2-task-status">进行中</span>
                    )}
                    {task.status === "waiting_user" && (
                      <span className="task-v2-task-status">需要你回复</span>
                    )}
                    {task.status === "blocked" && (
                      <span className="task-v2-task-status">已阻塞</span>
                    )}
                    {task.status === "failed" && (
                      <span className="task-v2-task-status">失败</span>
                    )}
                    {task.status === "cancelled" && (
                      <span className="task-v2-task-status">已取消</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </details>
      </div>
      <style>{TASK_V2_STYLES}</style>
    </>
  );
}

export default PlanStatePanel;

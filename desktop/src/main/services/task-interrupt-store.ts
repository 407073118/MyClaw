import { randomUUID } from "node:crypto";

import type {
  ChatMessage,
  ChatSession,
  Task,
  TaskInterruptAction,
  TaskInterruptRequest,
  TaskResumeInput,
  TaskStatus,
} from "@shared/contracts";
import { updateTask } from "./task-store";

const NON_INTERRUPTABLE_TASK_STATUSES = new Set<TaskStatus>([
  "completed",
  "blocked",
  "failed",
  "cancelled",
]);

const VALID_RESUME_ACTIONS = new Set<TaskInterruptAction>([
  "submit",
  "approve",
  "reject",
  "cancel",
]);

export type CreateTaskInterruptRequestInput = {
  taskId: string;
  question: string;
  reason: string;
  inputSchema?: Record<string, unknown>;
  choices?: Array<{ label: string; value: string; description?: string }>;
  expiresAt?: string;
  now?: string;
  requestId?: string;
  resumeToken?: string;
};

export type TaskInterruptMutationResult = {
  session: ChatSession;
  task: Task;
  request: TaskInterruptRequest;
};

export class TaskInterruptExpiredError extends Error {
  result: TaskInterruptMutationResult;

  /** 保留已经计算好的过期落库结果，让 IPC 层可以先保存再拒绝恢复。 */
  constructor(message: string, result: TaskInterruptMutationResult) {
    super(message);
    this.name = "TaskInterruptExpiredError";
    this.result = result;
  }
}

/** 解析中断时间字段，避免非法日期让过期判断失效。 */
function parseInterruptTime(value: string, fieldName: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    console.warn("[task-interrupt-store] 中断时间字段无效", { fieldName, value });
    throw new Error(`Invalid task interrupt ${fieldName}`);
  }
  return parsed;
}

/** 判断 interrupt 是否已经过期，避免过期 token 恢复旧任务。 */
function isRequestExpired(request: TaskInterruptRequest, now: string): boolean {
  if (!request.expiresAt) return false;
  return parseInterruptTime(request.expiresAt, "expiresAt") <= parseInterruptTime(now, "now");
}

/** 生成结构化恢复消息，让模型在下一轮明确看到用户的选择。 */
function buildTaskResumeMessage(input: TaskResumeInput, now: string): ChatMessage {
  return {
    id: randomUUID(),
    role: "system",
    createdAt: now,
    content: JSON.stringify({
      type: "task_resume",
      requestId: input.requestId,
      taskId: input.taskId,
      action: input.action,
      payload: input.payload ?? null,
    }),
  };
}

/** 校验 resume action，防止未知 action 被误当作取消任务。 */
function assertValidResumeAction(action: unknown): asserts action is TaskInterruptAction {
  if (typeof action !== "string" || !VALID_RESUME_ACTIONS.has(action as TaskInterruptAction)) {
    console.warn("[task-interrupt-store] 恢复中断失败：action 无效", { action });
    throw new Error("Invalid task resume action");
  }
}

/** 校验简单 choices / fields payload，复杂 JSON Schema 留给后续专门校验器。 */
function validateResumePayload(request: TaskInterruptRequest, input: TaskResumeInput): void {
  if (input.action !== "submit" && input.action !== "approve") return;

  const payload = input.payload && typeof input.payload === "object"
    ? input.payload as Record<string, unknown>
    : {};

  if (request.choices && request.choices.length > 0 && payload.choice != null) {
    const allowed = new Set(request.choices.map((choice) => choice.value));
    if (!allowed.has(String(payload.choice))) {
      console.warn("[task-interrupt-store] 恢复中断失败：choice 不在允许范围", {
        requestId: request.requestId,
        choice: payload.choice,
      });
      throw new Error("Invalid task resume choice");
    }
  }

  const fields = Array.isArray(request.inputSchema?.fields)
    ? request.inputSchema.fields.filter((field): field is Record<string, unknown> =>
      !!field && typeof field === "object" && typeof field.name === "string",
    )
    : [];
  for (const field of fields) {
    if (field.required !== true) continue;
    const value = payload[field.name as string];
    if (value == null || (typeof value === "string" && value.trim() === "")) {
      console.warn("[task-interrupt-store] 恢复中断失败：缺少必填字段", {
        requestId: request.requestId,
        field: field.name,
      });
      throw new Error(`Missing required task resume field: ${field.name}`);
    }
  }
}

/** 构造过期结果，调用方保存后再把错误返回给 UI。 */
function buildExpiredResult(
  session: ChatSession,
  task: Task,
  request: TaskInterruptRequest,
  now: string,
): TaskInterruptMutationResult {
  const updatedRequest: TaskInterruptRequest = {
    ...request,
    status: "expired",
    resolvedAt: now,
  };
  const updatedTask: Task = {
    ...task,
    status: "blocked",
    activeForm: `已过期：${task.subject}`,
    metadata: {
      ...(task.metadata ?? {}),
      awaitingUser: false,
      interruptRequestId: undefined,
      waitingReason: `用户输入请求已过期：${request.reason}`,
    },
  };
  const nextSession: ChatSession = {
    ...session,
    tasks: (session.tasks ?? []).map((item) => item.id === task.id ? updatedTask : item),
    taskInterrupts: (session.taskInterrupts ?? []).map((item) =>
      item.requestId === request.requestId ? updatedRequest : item,
    ),
  };
  return { session: nextSession, task: updatedTask, request: updatedRequest };
}

/** 创建 Task V2 用户中断请求，并把目标任务切换为 waiting_user。 */
export function createTaskInterruptRequest(
  session: ChatSession,
  input: CreateTaskInterruptRequestInput,
): TaskInterruptMutationResult {
  const now = input.now ?? new Date().toISOString();
  if (input.expiresAt) {
    parseInterruptTime(input.expiresAt, "expiresAt");
  }

  const tasks = session.tasks ?? [];
  const task = tasks.find((item) => item.id === input.taskId);
  if (!task) {
    console.warn("[task-interrupt-store] 创建中断失败：任务不存在", { taskId: input.taskId });
    throw new Error(`Task not found: ${input.taskId}`);
  }
  if (NON_INTERRUPTABLE_TASK_STATUSES.has(task.status)) {
    console.warn("[task-interrupt-store] 创建中断失败：任务不可中断", {
      taskId: input.taskId,
      status: task.status,
    });
    throw new Error(`Task is terminal: ${input.taskId}`);
  }

  const existingActive = (session.taskInterrupts ?? []).find(
    (request) => request.taskId === input.taskId && request.status === "active",
  );
  if (existingActive) {
    console.warn("[task-interrupt-store] 创建中断失败：任务已有 active 请求", {
      taskId: input.taskId,
      requestId: existingActive.requestId,
    });
    throw new Error("Task already has an active interrupt request");
  }

  const request: TaskInterruptRequest = {
    requestId: input.requestId ?? randomUUID(),
    taskId: input.taskId,
    status: "active",
    reason: input.reason,
    question: input.question,
    inputSchema: input.inputSchema,
    choices: input.choices,
    resumeToken: input.resumeToken ?? randomUUID(),
    schemaVersion: 1,
    createdAt: now,
    expiresAt: input.expiresAt,
  };
  const updatedTask: Task = {
    ...task,
    status: "waiting_user",
    activeForm: `需要你回复：${task.subject}`,
    metadata: {
      ...(task.metadata ?? {}),
      awaitingUser: true,
      interruptRequestId: request.requestId,
      waitingReason: input.reason,
    },
  };
  const nextSession: ChatSession = {
    ...session,
    tasks: tasks.map((item) => (item.id === input.taskId ? updatedTask : item)),
    taskInterrupts: [...(session.taskInterrupts ?? []), request],
  };

  console.info("[task-interrupt-store] 已创建 Task V2 用户中断请求", {
    sessionId: session.id,
    taskId: input.taskId,
    requestId: request.requestId,
  });
  return { session: nextSession, task: updatedTask, request };
}

/** 解析 Task V2 用户恢复输入，并按 action 推进任务状态。 */
export function resolveTaskInterruptRequest(
  session: ChatSession,
  input: TaskResumeInput,
  now = new Date().toISOString(),
): TaskInterruptMutationResult {
  assertValidResumeAction(input.action);

  const tasks = session.tasks ?? [];
  const task = tasks.find((item) => item.id === input.taskId);
  if (!task) {
    console.warn("[task-interrupt-store] 恢复中断失败：任务不存在", { taskId: input.taskId });
    throw new Error(`Task not found: ${input.taskId}`);
  }

  const request = (session.taskInterrupts ?? []).find((item) => item.requestId === input.requestId);
  if (!request) {
    console.warn("[task-interrupt-store] 恢复中断失败：请求不存在", {
      taskId: input.taskId,
      requestId: input.requestId,
    });
    throw new Error(`Task interrupt request not found: ${input.requestId}`);
  }
  if (request.taskId !== input.taskId) {
    console.warn("[task-interrupt-store] 恢复中断失败：请求任务不匹配", {
      inputTaskId: input.taskId,
      requestTaskId: request.taskId,
      requestId: input.requestId,
    });
    throw new Error("Task interrupt request task mismatch");
  }
  if (request.resumeToken !== input.resumeToken) {
    console.warn("[task-interrupt-store] 恢复中断失败：token 不匹配", {
      taskId: input.taskId,
      requestId: input.requestId,
    });
    throw new Error("Invalid task resume token");
  }
  if (request.status !== "active") {
    console.warn("[task-interrupt-store] 恢复中断失败：请求不是 active", {
      taskId: input.taskId,
      requestId: input.requestId,
      status: request.status,
    });
    throw new Error(`Task interrupt request is not active: ${input.requestId}`);
  }
  if (isRequestExpired(request, now)) {
    const expiredResult = buildExpiredResult(session, task, request, now);
    console.warn("[task-interrupt-store] 恢复中断失败：请求已过期", {
      taskId: input.taskId,
      requestId: input.requestId,
      expiresAt: request.expiresAt,
    });
    throw new TaskInterruptExpiredError(`Task interrupt request expired: ${input.requestId}`, expiredResult);
  }
  if (task.status !== "waiting_user") {
    console.warn("[task-interrupt-store] 恢复中断失败：任务不是 waiting_user", {
      taskId: input.taskId,
      status: task.status,
    });
    throw new Error(`Task is not waiting for user: ${input.taskId}`);
  }
  validateResumePayload(request, input);

  const nextTaskStatus: TaskStatus =
    input.action === "submit" || input.action === "approve"
      ? "in_progress"
      : input.action === "reject"
        ? "blocked"
        : "cancelled";
  const nextRequestStatus: TaskInterruptRequest["status"] =
    input.action === "cancel" ? "cancelled" : "resolved";

  const baseTaskUpdate = {
    status: nextTaskStatus,
    activeForm:
      nextTaskStatus === "in_progress"
        ? `继续执行：${task.subject}`
        : nextTaskStatus === "blocked"
          ? `已拒绝：${task.subject}`
          : `已取消：${task.subject}`,
    metadata: {
      awaitingUser: false,
      interruptRequestId: undefined,
      waitingReason:
        nextTaskStatus === "blocked" || nextTaskStatus === "cancelled"
          ? request.reason
          : undefined,
      completionEvidence:
        input.action === "submit" || input.action === "approve"
          ? {
              kind: "user_confirmation" as const,
              summary: "用户已通过结构化恢复输入继续任务",
              at: now,
            }
          : (task.metadata?.completionEvidence as unknown),
    },
  };

  const taskUpdate = input.action === "submit" || input.action === "approve"
    ? updateTask(tasks, input.taskId, baseTaskUpdate)
    : {
        tasks: tasks.map((item) =>
          item.id === input.taskId
            ? {
                ...item,
                ...baseTaskUpdate,
                metadata: {
                  ...(item.metadata ?? {}),
                  ...baseTaskUpdate.metadata,
                },
              }
            : item,
        ),
        updated: {
          ...task,
          ...baseTaskUpdate,
          metadata: {
            ...(task.metadata ?? {}),
            ...baseTaskUpdate.metadata,
          },
        },
      };

  const updatedRequest: TaskInterruptRequest = {
    ...request,
    status: nextRequestStatus,
    resolvedAt: now,
  };
  const nextSession: ChatSession = {
    ...session,
    tasks: taskUpdate.tasks,
    taskInterrupts: (session.taskInterrupts ?? []).map((item) =>
      item.requestId === input.requestId ? updatedRequest : item,
    ),
    messages: [...session.messages, buildTaskResumeMessage(input, now)],
  };

  console.info("[task-interrupt-store] 已解析 Task V2 用户恢复输入", {
    sessionId: session.id,
    taskId: input.taskId,
    requestId: input.requestId,
    action: input.action,
    nextTaskStatus,
  });
  return { session: nextSession, task: taskUpdate.updated, request: updatedRequest };
}

import { readdir, readFile } from "node:fs/promises";

import type { SiliconLogger } from "./employee-scaffold.js";
import { resolveEmployeeChildPath } from "./path-boundary.js";
import { assertEmployeeTodo, parseJsonRecord } from "./schema-guards.js";
import { writeUtf8FileAtomically } from "./safe-file.js";
import type { EmployeeTask, EmployeeTaskStatus } from "./task-store.js";

export type EmployeeTodoStatus =
  | "open"
  | "waiting_approval"
  | "running"
  | "done"
  | "failed"
  | "blocked"
  | "cancelled";

export type EmployeeTodo = {
  schemaVersion: 1;
  id: string;
  taskId: string;
  title: string;
  status: EmployeeTodoStatus;
  source: "inbox_task";
  createdAt: string;
  updatedAt: string;
  approvalId?: string;
  runId?: string;
  artifactPath?: string;
  reviewPath?: string;
  errorMessage?: string;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

const TASK_STATUS_TO_TODO_STATUS: Record<EmployeeTaskStatus, EmployeeTodoStatus> = {
  queued: "open",
  waiting_approval: "waiting_approval",
  running: "running",
  succeeded: "done",
  failed: "failed",
  blocked: "blocked",
  cancelled: "cancelled",
};

/** 计算员工 todo 投影的稳定 JSON 文件路径。 */
export function resolveEmployeeTodoPath(
  employeeDir: string,
  taskId: string,
  logger: SiliconLogger = noopLogger,
): string {
  return resolveEmployeeChildPath(employeeDir, ["todos", `${taskId}.json`], logger);
}

/** 读取员工 todos 中的任务投影 JSON。 */
export async function readEmployeeTodo(employeeDir: string, taskId: string): Promise<EmployeeTodo> {
  const raw = await readFile(resolveEmployeeTodoPath(employeeDir, taskId), "utf8");
  const parsed = parseJsonRecord(raw, "EmployeeTodo");
  assertEmployeeTodo(parsed);
  return parsed;
}

/** 列出员工 todos 目录中的全部任务投影。 */
export async function listEmployeeTodos(employeeDir: string, logger: SiliconLogger = noopLogger): Promise<EmployeeTodo[]> {
  const todosDir = resolveEmployeeChildPath(employeeDir, ["todos"], logger);
  const entries = await readdir(todosDir).catch(() => []);
  const todos: EmployeeTodo[] = [];
  for (const entry of entries.filter((item) => item.endsWith(".json")).sort()) {
    const todoPath = resolveEmployeeChildPath(employeeDir, ["todos", entry], logger);
    try {
      const raw = await readFile(todoPath, "utf8");
      const parsed = parseJsonRecord(raw, "EmployeeTodo");
      assertEmployeeTodo(parsed);
      todos.push(parsed);
    } catch (error) {
      logger.warn("读取硅基员工 todo 投影失败，已跳过坏投影文件", {
        employeeDir,
        todoPath,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return todos;
}

/** 根据任务状态创建或更新 todo 投影，保持员工工作面板可观测。 */
export async function upsertEmployeeTodoFromTask(
  employeeDir: string,
  task: EmployeeTask,
  logger: SiliconLogger = noopLogger,
): Promise<EmployeeTodo> {
  logger.info("开始同步硅基员工 todo 投影", {
    employeeDir,
    taskId: task.id,
    taskStatus: task.status,
  });
  const existing = await readEmployeeTodo(employeeDir, task.id).catch(() => null);
  const todo: EmployeeTodo = {
    schemaVersion: 1,
    id: `todo-${task.id}`,
    taskId: task.id,
    title: task.title,
    status: TASK_STATUS_TO_TODO_STATUS[task.status],
    source: "inbox_task",
    createdAt: existing?.createdAt ?? task.createdAt,
    updatedAt: task.updatedAt,
    approvalId: task.approvalId,
    runId: task.runId,
    artifactPath: task.artifactPath,
    reviewPath: task.reviewPath,
    errorMessage: task.errorMessage,
  };
  await writeUtf8FileAtomically(resolveEmployeeTodoPath(employeeDir, task.id, logger), `${JSON.stringify(todo, null, 2)}\n`, logger);
  logger.info("硅基员工 todo 投影已同步", {
    employeeDir,
    taskId: task.id,
    todoId: todo.id,
    todoStatus: todo.status,
  });
  return todo;
}

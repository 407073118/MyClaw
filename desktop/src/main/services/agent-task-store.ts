import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { AgentTask, AgentTaskCreateInput, AgentTaskMode } from "@shared/contracts";
import type { MyClawPaths } from "./directory-service";

type AgentTaskRecordOptions = {
  id?: string;
  now?: string;
};

const AGENT_TASKS_FILE = "agent-tasks.json";
const VALID_MODES = new Set<AgentTaskMode>(["speak", "delegate", "review", "broadcast"]);

/** 生成硅基员工任务标题，避免任务卡被超长指令撑开。 */
function buildAgentTaskTitle(input: AgentTaskCreateInput): string {
  const rawTitle = (input.title?.trim() || input.instruction.trim()).replace(/\s+/g, " ");
  if (!rawTitle) {
    throw new Error("Agent task instruction is required");
  }
  return rawTitle.length > 48 ? `${rawTitle.slice(0, 48)}...` : rawTitle;
}

/** 规范化硅基员工任务负责人，保证任务至少有一个明确 worker。 */
function normalizeAssigneeIds(input: AgentTaskCreateInput): string[] {
  const ids = Array.from(
    new Set(input.assigneeIds.map((item) => item.trim()).filter(Boolean)),
  );
  if (ids.length === 0) {
    throw new Error("Agent task assigneeIds is required");
  }
  return ids;
}

/** 创建可持久化的硅基员工任务记录，供 IPC 与测试共享同一套默认值。 */
export function createAgentTaskRecord(
  input: AgentTaskCreateInput,
  options: AgentTaskRecordOptions = {},
): AgentTask {
  const instruction = input.instruction.trim();
  if (!input.sourceSessionId.trim()) {
    throw new Error("Agent task sourceSessionId is required");
  }
  if (!instruction) {
    throw new Error("Agent task instruction is required");
  }
  const mode = input.mode && VALID_MODES.has(input.mode) ? input.mode : "delegate";
  const assigneeIds = normalizeAssigneeIds(input);
  const now = options.now ?? new Date().toISOString();
  const assigneeStatuses = Object.fromEntries(
    assigneeIds.map((id) => [id, "queued" as const]),
  );

  return {
    id: options.id ?? `task-${randomUUID()}`,
    sourceSessionId: input.sourceSessionId.trim(),
    title: buildAgentTaskTitle(input),
    instruction,
    mode,
    status: "queued",
    assigneeIds,
    assigneeStatuses,
    childSessionIds: {},
    createdAt: now,
    updatedAt: now,
  };
}

/** 解析硅基员工任务存储路径，集中约束磁盘文件位置。 */
function resolveAgentTaskStorePath(paths: MyClawPaths): string {
  return join(paths.myClawDir, AGENT_TASKS_FILE);
}

/** 从磁盘读取硅基员工任务列表，异常时返回空列表并写日志。 */
export async function loadAgentTasks(paths: MyClawPaths): Promise<AgentTask[]> {
  const filePath = resolveAgentTaskStorePath(paths);
  if (!existsSync(filePath)) {
    console.info("[agent-task-store] 未发现任务存储文件，使用空列表", { filePath });
    return [];
  }
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : (parsed as { items?: unknown[] } | null)?.items;
    if (!Array.isArray(items)) {
      console.warn("[agent-task-store] 任务存储格式无效，使用空列表", { filePath });
      return [];
    }
    return items.filter((item): item is AgentTask => {
      const task = item as Partial<AgentTask> | null;
      return Boolean(task?.id && task.sourceSessionId && task.instruction && Array.isArray(task.assigneeIds));
    });
  } catch (error) {
    console.error("[agent-task-store] 读取任务存储失败，使用空列表", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** 将硅基员工任务列表写回磁盘，保持 UTF-8 与稳定缩进。 */
export async function saveAgentTasks(paths: MyClawPaths, tasks: AgentTask[]): Promise<void> {
  const filePath = resolveAgentTaskStorePath(paths);
  await mkdir(paths.myClawDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(tasks, null, 2)}\n`, "utf8");
  console.info("[agent-task-store] 已持久化任务列表", {
    filePath,
    count: tasks.length,
  });
}

import type { Task, TaskStatus } from "./contracts";

const TASK_STATUS_PRIORITY: Record<TaskStatus, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
};

const ORDER_PREFIX_PATTERNS = [
  /^\s*\[\d+\s*\/\s*\d+\]\s*/u,
  /^\s*(?:task|step)\s*\d+\s*[:.)-]\s*/iu,
  /^\s*第\s*\d+\s*步\s*[:：、.-]?\s*/u,
  /^\s*\d+\s*[.)、:：-]\s*/u,
] as const;

export type TaskFingerprintInput = {
  subject: string;
  description: string;
  owner?: string;
  metadata?: Record<string, unknown>;
};

export type CoalescedTasksResult = {
  tasks: Task[];
  aliasMap: Record<string, string>;
};

export type TaskDisplayItem = {
  task: Task;
  sequence: number;
  total: number;
};

/** 去掉任务标题前面的序号前缀，避免“1. xxx”和“xxx”被当成两条不同任务。 */
function stripTaskOrderPrefix(value: string): string {
  let next = value;
  for (const pattern of ORDER_PREFIX_PATTERNS) {
    next = next.replace(pattern, "");
  }
  return next.trim();
}

/** 规范化任务文本，便于做逻辑去重与顺序识别。 */
function normalizeTaskText(value: string): string {
  return stripTaskOrderPrefix(value)
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

/** 为 workflow 任务保留稳定身份，避免不同节点因为同名而被误合并。 */
function buildWorkflowFingerprint(metadata?: Record<string, unknown>): string | null {
  if (!metadata || metadata.source !== "workflow") return null;
  const workflowId = typeof metadata.workflowId === "string" ? metadata.workflowId : "";
  const workflowNodeId = typeof metadata.workflowNodeId === "string" ? metadata.workflowNodeId : "";
  if (!workflowId || !workflowNodeId) return null;
  return `workflow:${workflowId}:${workflowNodeId}`;
}

/** 生成任务逻辑指纹，用于识别重复的同一步骤。 */
export function buildTaskFingerprint(input: TaskFingerprintInput): string {
  const workflowFingerprint = buildWorkflowFingerprint(input.metadata);
  if (workflowFingerprint) return workflowFingerprint;
  const owner = input.owner?.trim().toLocaleLowerCase() ?? "";
  const subject = normalizeTaskText(input.subject);
  const description = normalizeTaskText(input.description);
  return `manual:${owner}:${subject}:${description}`;
}

/** 合并两个字符串数组并去重，同时保留原始顺序。 */
function mergeTaskIdList(primary: string[], secondary: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...primary, ...secondary]) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    merged.push(value);
  }
  return merged;
}

/** 选择重复任务里进度更靠后的状态，防止重复创建把进度回退到 pending。 */
function pickHigherPriorityStatus(left: TaskStatus, right: TaskStatus): TaskStatus {
  return TASK_STATUS_PRIORITY[right] > TASK_STATUS_PRIORITY[left] ? right : left;
}

/** 合并重复任务，同时保留首个任务 ID，避免后续 update/get 找不到原始任务。 */
function mergeDuplicateTask(canonical: Task, duplicate: Task): Task {
  return {
    ...canonical,
    subject: canonical.subject || duplicate.subject,
    description: canonical.description || duplicate.description,
    activeForm: duplicate.activeForm ?? canonical.activeForm,
    owner: duplicate.owner ?? canonical.owner,
    status: pickHigherPriorityStatus(canonical.status, duplicate.status),
    blocks: mergeTaskIdList(canonical.blocks, duplicate.blocks),
    blockedBy: mergeTaskIdList(canonical.blockedBy, duplicate.blockedBy),
    metadata: {
      ...(canonical.metadata ?? {}),
      ...(duplicate.metadata ?? {}),
    },
  };
}

/** 将重复逻辑任务压缩成唯一列表，并返回旧 ID 到规范 ID 的映射。 */
export function coalesceTasks(tasks: Task[]): CoalescedTasksResult {
  const canonicalByFingerprint = new Map<string, Task>();
  const orderedFingerprints: string[] = [];
  const aliasMap: Record<string, string> = {};

  for (const task of tasks) {
    const fingerprint = buildTaskFingerprint(task);
    const existing = canonicalByFingerprint.get(fingerprint);
    if (!existing) {
      canonicalByFingerprint.set(fingerprint, { ...task });
      orderedFingerprints.push(fingerprint);
      aliasMap[task.id] = task.id;
      continue;
    }

    canonicalByFingerprint.set(fingerprint, mergeDuplicateTask(existing, task));
    aliasMap[task.id] = existing.id;
  }

  const compacted = orderedFingerprints
    .map((fingerprint) => canonicalByFingerprint.get(fingerprint))
    .filter((task): task is Task => !!task)
    .map((task) => {
      const blocks = mergeTaskIdList(
        task.blocks.map((id) => aliasMap[id] ?? id),
        [],
      ).filter((id) => id !== task.id);
      const blockedBy = mergeTaskIdList(
        task.blockedBy.map((id) => aliasMap[id] ?? id),
        [],
      ).filter((id) => id !== task.id);
      return {
        ...task,
        blocks,
        blockedBy,
      };
    });

  return {
    tasks: compacted,
    aliasMap,
  };
}

/** 构建稳定的展示序号，供 UI 和模型工具输出共享。 */
export function buildTaskDisplayItems(tasks: Task[]): TaskDisplayItem[] {
  const compacted = coalesceTasks(tasks).tasks;
  const total = compacted.length;
  return compacted.map((task, index) => ({
    task,
    sequence: index + 1,
    total,
  }));
}

import type { ChatSession, Task, WorkflowDefinition, WorkflowNode, WorkflowStreamEvent } from "@shared/contracts";
import { createTask, updateTask } from "./task-store";

type WorkflowTaskMetadata = {
  source: "workflow";
  workflowId: string;
  workflowRunId: string;
  workflowNodeId: string;
  workflowNodeKind: string;
  lastRunStatus?: string;
  lastError?: string;
};

/** 判断一个 workflow 节点是否应该投影到 session tasklist，避免把起止节点也变成任务。 */
function shouldProjectWorkflowNode(node: WorkflowNode): boolean {
  const shouldProject = node.kind !== "start" && node.kind !== "end";
  console.info("[silicon-person-workflow] 判断节点是否投影为任务", {
    nodeId: node.id,
    nodeKind: node.kind,
    shouldProject,
  });
  return shouldProject;
}

/** 从 task.metadata 中提取 workflow 投影信息，统一兼容未知结构。 */
function readWorkflowTaskMetadata(task: Task): WorkflowTaskMetadata | null {
  const metadata = task.metadata;
  if (!metadata || typeof metadata !== "object") {
    console.info("[silicon-person-workflow] 任务缺少 workflow 元数据，按普通任务处理", {
      taskId: task.id,
      subject: task.subject,
    });
    return null;
  }
  if (
    metadata.source !== "workflow"
    || typeof metadata.workflowId !== "string"
    || typeof metadata.workflowRunId !== "string"
    || typeof metadata.workflowNodeId !== "string"
    || typeof metadata.workflowNodeKind !== "string"
  ) {
    console.info("[silicon-person-workflow] 任务元数据不是 workflow 投影任务", {
      taskId: task.id,
      subject: task.subject,
    });
    return null;
  }
  return metadata as WorkflowTaskMetadata;
}

/** 按 workflowId + nodeId 定位投影任务，保证 workflow 驱动 task 但不替代整个 tasklist。 */
function findWorkflowTask(tasks: Task[], workflowId: string, nodeId: string): Task | null {
  const matched = tasks.find((task) => {
    const metadata = readWorkflowTaskMetadata(task);
    return metadata?.workflowId === workflowId && metadata.workflowNodeId === nodeId;
  }) ?? null;
  console.info("[silicon-person-workflow] 查找 workflow 投影任务", {
    workflowId,
    nodeId,
    matchedTaskId: matched?.id ?? null,
  });
  return matched;
}

/** 统一构建 workflow 投影任务的描述，便于后续在 UI 上识别来源。 */
function buildWorkflowTaskDescription(node: WorkflowNode, workflow: WorkflowDefinition): string {
  const description = `由工作流「${workflow.name}」节点「${node.label}」驱动`;
  console.info("[silicon-person-workflow] 构建 workflow 任务描述", {
    workflowId: workflow.id,
    nodeId: node.id,
    description,
  });
  return description;
}

/** 重置一个 workflow 投影任务到待办态，供每次新 run 启动前复用。 */
function resetWorkflowTask(tasks: Task[], task: Task, node: WorkflowNode, workflow: WorkflowDefinition, workflowRunId: string): Task[] {
  console.info("[silicon-person-workflow] 重置已有 workflow 投影任务", {
    taskId: task.id,
    workflowId: workflow.id,
    workflowRunId,
    nodeId: node.id,
  });
  return updateTask(tasks, task.id, {
    subject: node.label,
    description: buildWorkflowTaskDescription(node, workflow),
    status: "pending",
    metadata: {
      source: "workflow",
      workflowId: workflow.id,
      workflowRunId,
      workflowNodeId: node.id,
      workflowNodeKind: node.kind,
      lastRunStatus: "running",
      lastError: undefined,
    },
  }).tasks;
}

/** 首次把 workflow 节点投影为 session task，确保手工 task 原样保留。 */
function createWorkflowTask(tasks: Task[], node: WorkflowNode, workflow: WorkflowDefinition, workflowRunId: string): Task[] {
  console.info("[silicon-person-workflow] 创建新的 workflow 投影任务", {
    workflowId: workflow.id,
    workflowRunId,
    nodeId: node.id,
    nodeLabel: node.label,
  });
  return createTask(tasks, {
    subject: node.label,
    description: buildWorkflowTaskDescription(node, workflow),
    status: "pending",
    metadata: {
      source: "workflow",
      workflowId: workflow.id,
      workflowRunId,
      workflowNodeId: node.id,
      workflowNodeKind: node.kind,
      lastRunStatus: "running",
    },
  }).tasks;
}

/** 启动 workflow run 时，把节点增量投影到 session.tasks，且不覆盖已有手工任务。 */
export function seedWorkflowDrivenTasksForSession(input: {
  session: ChatSession;
  workflow: WorkflowDefinition;
  workflowRunId: string;
}): Task[] {
  console.info("[silicon-person-workflow] 启动 run 前同步 workflow 投影任务", {
    sessionId: input.session.id,
    workflowId: input.workflow.id,
    workflowRunId: input.workflowRunId,
    existingTaskCount: input.session.tasks?.length ?? 0,
  });
  let tasks = [...(input.session.tasks ?? [])];

  for (const node of input.workflow.nodes) {
    if (!shouldProjectWorkflowNode(node)) {
      continue;
    }
    const existing = findWorkflowTask(tasks, input.workflow.id, node.id);
    tasks = existing
      ? resetWorkflowTask(tasks, existing, node, input.workflow, input.workflowRunId)
      : createWorkflowTask(tasks, node, input.workflow, input.workflowRunId);
  }

  console.info("[silicon-person-workflow] workflow 投影任务同步完成", {
    sessionId: input.session.id,
    workflowId: input.workflow.id,
    workflowRunId: input.workflowRunId,
    nextTaskCount: tasks.length,
  });
  return tasks;
}

/** 把指定 workflow 节点的投影任务切到运行中，驱动硅基员工 tasklist 实时更新。 */
function markWorkflowNodeInProgress(tasks: Task[], workflow: WorkflowDefinition, nodeId: string): Task[] {
  const task = findWorkflowTask(tasks, workflow.id, nodeId);
  if (!task) {
    console.info("[silicon-person-workflow] 未找到待更新的运行中任务", {
      workflowId: workflow.id,
      nodeId,
    });
    return tasks;
  }
  console.info("[silicon-person-workflow] 标记 workflow 投影任务为进行中", {
    taskId: task.id,
    workflowId: workflow.id,
    nodeId,
  });
  return updateTask(tasks, task.id, {
    status: "in_progress",
    metadata: {
      lastRunStatus: "running",
      lastError: undefined,
    },
  }).tasks;
}

/** 把指定 workflow 节点的投影任务切到已完成，保证节点完成后 tasklist 一致。 */
function markWorkflowNodeCompleted(tasks: Task[], workflow: WorkflowDefinition, nodeId: string): Task[] {
  const task = findWorkflowTask(tasks, workflow.id, nodeId);
  if (!task) {
    console.info("[silicon-person-workflow] 未找到待更新的已完成任务", {
      workflowId: workflow.id,
      nodeId,
    });
    return tasks;
  }
  console.info("[silicon-person-workflow] 标记 workflow 投影任务为已完成", {
    taskId: task.id,
    workflowId: workflow.id,
    nodeId,
  });
  return updateTask(tasks, task.id, {
    status: "completed",
    metadata: {
      lastRunStatus: "succeeded",
      lastError: undefined,
    },
  }).tasks;
}

/** 运行异常时回写 workflow 投影任务，避免 tasklist 长期卡在进行中。 */
function markWorkflowNodeErrored(tasks: Task[], workflow: WorkflowDefinition, nodeId: string, error: string): Task[] {
  const task = findWorkflowTask(tasks, workflow.id, nodeId);
  if (!task) {
    console.info("[silicon-person-workflow] 未找到待更新的异常任务", {
      workflowId: workflow.id,
      nodeId,
      error,
    });
    return tasks;
  }
  console.info("[silicon-person-workflow] 标记 workflow 投影任务异常回退", {
    taskId: task.id,
    workflowId: workflow.id,
    nodeId,
    error,
  });
  return updateTask(tasks, task.id, {
    status: "pending",
    metadata: {
      lastRunStatus: "failed",
      lastError: error,
    },
  }).tasks;
}

/** 运行结束时统一回写同一 workflow 的投影任务，保持终态一致。 */
function settleWorkflowRunTasks(tasks: Task[], workflow: WorkflowDefinition, status: string): Task[] {
  console.info("[silicon-person-workflow] 统一回写 workflow run 终态", {
    workflowId: workflow.id,
    status,
  });
  return tasks.map((task) => {
    const metadata = readWorkflowTaskMetadata(task);
    if (!metadata || metadata.workflowId !== workflow.id) {
      return task;
    }
    if (status === "succeeded") {
      return {
        ...task,
        status: "completed",
        metadata: {
          ...metadata,
          lastRunStatus: status,
          lastError: undefined,
        },
      };
    }
    if (task.status === "in_progress") {
      return {
        ...task,
        status: "pending",
        metadata: {
          ...metadata,
          lastRunStatus: status,
        },
      };
    }
    return {
      ...task,
      metadata: {
        ...metadata,
        lastRunStatus: status,
      },
    };
  });
}

/** 根据 workflow stream 事件增量更新 session.tasks，只影响当前 workflow 投影出的任务。 */
export function applyWorkflowEventToSessionTasks(input: {
  session: ChatSession;
  workflow: WorkflowDefinition;
  event: WorkflowStreamEvent;
}): Task[] {
  console.info("[silicon-person-workflow] 按 workflow 事件更新 session 任务", {
    sessionId: input.session.id,
    workflowId: input.workflow.id,
    eventType: input.event.type,
    runId: input.event.runId,
  });
  const tasks = [...(input.session.tasks ?? [])];

  switch (input.event.type) {
    case "node-start":
      return markWorkflowNodeInProgress(tasks, input.workflow, input.event.nodeId);
    case "node-complete":
      return markWorkflowNodeCompleted(tasks, input.workflow, input.event.nodeId);
    case "node-error":
      return markWorkflowNodeErrored(tasks, input.workflow, input.event.nodeId, input.event.error);
    case "run-complete":
      return settleWorkflowRunTasks(tasks, input.workflow, input.event.status);
    default:
      console.info("[silicon-person-workflow] 当前事件不需要改写任务列表", {
        sessionId: input.session.id,
        workflowId: input.workflow.id,
        eventType: input.event.type,
      });
      return tasks;
  }
}

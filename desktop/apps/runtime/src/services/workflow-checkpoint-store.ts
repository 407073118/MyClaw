import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type WorkflowRunStatus = "running" | "paused" | "succeeded" | "failed";

export type WorkflowRunRecord = {
  id: string;
  definitionId: string;
  status: WorkflowRunStatus;
  state: Record<string, unknown>;
  attempts: Record<string, number>;
  pausedAtNodeId?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowCheckpointStatus =
  | "node-start"
  | "node-complete"
  | "node-error"
  | "retry-scheduled"
  | "waiting-human-input"
  | "run-complete";

export type WorkflowCheckpoint = {
  id: string;
  runId: string;
  createdAt: string;
  nodeId: string;
  status: WorkflowCheckpointStatus;
  state: Record<string, unknown>;
  attempts: Record<string, number>;
  error?: string;
  retryAt?: string;
};

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

type WorkflowCheckpointStoreOptions = {
  now: () => string;
  storageDir?: string;
  logger: Logger;
};

/**
 * 工作流运行检查点存储（桌面个人态，轻量可预测）。
 * 说明：
 * - 当前实现是内存存储，满足运行中创建/检查/恢复。
 * - 所有 id 都按递增计数生成，保证测试与执行的确定性。
 */
export class WorkflowCheckpointStore {
  private readonly runs = new Map<string, WorkflowRunRecord>();
  private readonly checkpointsByRunId = new Map<string, WorkflowCheckpoint[]>();
  private runCounter = 0;
  private checkpointCounter = 0;

  constructor(private readonly options: WorkflowCheckpointStoreOptions) {}

  /** 获取当前时间（ISO 8601），用于调度与检查点一致性。 */
  getNow(): string {
    return this.options.now();
  }

  /** 获取指定 run 的本地持久化目录（若未启用持久化则返回 null）。 */
  private getRunStorageDir(runId: string): string | null {
    if (!this.options.storageDir) {
      return null;
    }
    return join(this.options.storageDir, runId);
  }

  /** 将运行记录写入磁盘（仅当启用 storageDir）。 */
  private persistRun(run: WorkflowRunRecord): void {
    const runDir = this.getRunStorageDir(run.id);
    if (!runDir) {
      return;
    }
    try {
      mkdirSync(runDir, { recursive: true });
      mkdirSync(join(runDir, "checkpoints"), { recursive: true });
      writeFileSync(join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    } catch (error) {
      this.options.logger.error("持久化 run 失败", {
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 将检查点写入磁盘（仅当启用 storageDir）。 */
  private persistCheckpoint(checkpoint: WorkflowCheckpoint): void {
    const runDir = this.getRunStorageDir(checkpoint.runId);
    if (!runDir) {
      return;
    }
    try {
      mkdirSync(join(runDir, "checkpoints"), { recursive: true });
      writeFileSync(
        join(runDir, "checkpoints", `${checkpoint.id}.json`),
        `${JSON.stringify(checkpoint, null, 2)}\n`,
        "utf8",
      );
    } catch (error) {
      this.options.logger.error("持久化 checkpoint 失败", {
        runId: checkpoint.runId,
        checkpointId: checkpoint.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 创建一个新的工作流运行记录，并初始化其检查点序列。 */
  createRun(input: { definitionId: string; initialState: Record<string, unknown> }): WorkflowRunRecord {
    const now = this.options.now();
    const id = `run-${String(++this.runCounter).padStart(6, "0")}`;
    const run: WorkflowRunRecord = {
      id,
      definitionId: input.definitionId,
      status: "running",
      state: { ...(input.initialState ?? {}) },
      attempts: {},
      createdAt: now,
      updatedAt: now,
    };

    this.runs.set(id, run);
    this.checkpointsByRunId.set(id, []);
    this.persistRun(run);
    this.options.logger.info("创建工作流运行", { runId: id, definitionId: input.definitionId });
    return run;
  }

  /** 获取运行记录。 */
  getRun(runId: string): WorkflowRunRecord | undefined {
    return this.runs.get(runId);
  }

  /** 列出所有运行记录（按 id 递增排序，便于调试与 UI 列表渲染）。 */
  listRuns(): WorkflowRunRecord[] {
    return [...this.runs.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** 更新运行记录（保持确定性：只允许 patch 关键字段）。 */
  updateRun(runId: string, patch: Partial<Pick<WorkflowRunRecord, "status" | "state" | "attempts" | "pausedAtNodeId">>) {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`run_not_found:${runId}`);
    }
    const updated: WorkflowRunRecord = {
      ...run,
      ...patch,
      updatedAt: this.options.now(),
    };
    this.runs.set(runId, updated);
    this.persistRun(updated);
  }

  /** 创建检查点，用于恢复与审计。 */
  createCheckpoint(
    runId: string,
    input: Omit<WorkflowCheckpoint, "id" | "runId" | "createdAt">,
  ): WorkflowCheckpoint {
    if (!this.runs.has(runId)) {
      throw new Error(`run_not_found:${runId}`);
    }
    const now = this.options.now();
    const id = `cp-${String(++this.checkpointCounter).padStart(9, "0")}`;
    const checkpoint: WorkflowCheckpoint = {
      id,
      runId,
      createdAt: now,
      nodeId: input.nodeId,
      status: input.status,
      state: { ...(input.state ?? {}) },
      attempts: { ...(input.attempts ?? {}) },
      error: input.error,
      retryAt: input.retryAt,
    };

    const list = this.checkpointsByRunId.get(runId) ?? [];
    list.push(checkpoint);
    this.checkpointsByRunId.set(runId, list);
    this.persistCheckpoint(checkpoint);

    this.options.logger.info("写入检查点", {
      runId,
      checkpointId: id,
      nodeId: input.nodeId,
      status: input.status,
    });
    return checkpoint;
  }

  /** 列出所有检查点（按写入顺序）。 */
  listCheckpoints(runId: string): WorkflowCheckpoint[] {
    return [...(this.checkpointsByRunId.get(runId) ?? [])];
  }

  /** 获取最新检查点。 */
  getLatestCheckpoint(runId: string): WorkflowCheckpoint | undefined {
    const list = this.checkpointsByRunId.get(runId) ?? [];
    return list.length ? list[list.length - 1] : undefined;
  }
}

import type { WorkflowDefinition, WorkflowRunConfig, WorkflowNode } from "@shared/contracts";
import type { WorkflowRunStatus } from "@shared/contracts/workflow-run";
import type { WorkflowStreamEvent } from "@shared/contracts/workflow-stream";
import type { Channel } from "./channels";
import { LastValueChannel, compileChannels } from "./channels";
import type { CompiledGraph } from "./graph-compiler";
import { compileGraph } from "./graph-compiler";
import type { NodeExecutionResult, NodeWrite } from "./node-executor";
import { NodeExecutorRegistry } from "./node-executor";
import { WorkflowEventEmitter } from "./event-emitter";
import { GraphInterrupt, RecursionLimitError, isGraphInterrupt } from "./errors";

// ── Result type ──

export type WorkflowRunResult = {
  status: WorkflowRunStatus;
  finalState: Record<string, unknown>;
  totalSteps: number;
  durationMs: number;
  error?: string;
  interruptPayload?: unknown;
};

// ── Checkpointer interface ──

export type CheckpointData = {
  runId: string;
  checkpointId: string;
  parentId: string | null;
  step: number;
  status: "running" | "interrupted" | "succeeded" | "failed";
  channelVersions: Record<string, number>;
  versionsSeen: Record<string, Record<string, number>>;
  triggeredNodes: string[];
  durationMs: number;
  interruptPayload?: unknown;
  channelData: Map<string, { version: number; value: unknown }>;
};

export interface WorkflowCheckpointer {
  /** 创建运行记录 */
  createRun(run: { id: string; workflowId: string; workflowVersion: number; status: WorkflowRunStatus; startedAt: string }): Promise<void>;
  /** 更新运行状态 */
  updateRunStatus(runId: string, status: WorkflowRunStatus, extra: { totalSteps?: number; error?: string; finishedAt?: string }): Promise<void>;
  /** 保存 checkpoint 快照 */
  saveCheckpoint(data: CheckpointData): Promise<void>;
  /** 加载最近一次 checkpoint（用于冷恢复） */
  loadLatestCheckpoint(runId: string): Promise<CheckpointData | null>;
}

// ── Internal bookkeeping ──

type NodeVersionMap = Map<string, number>;

// ── PregelRunner constructor options ──

export type PregelRunnerDeps = {
  executorRegistry: NodeExecutorRegistry;
  /** 可选的 checkpoint 持久化，启用后每步自动保存状态快照 */
  checkpointer?: WorkflowCheckpointer;
  /** 可选的自定义 runId（冷恢复时复用之前的 runId） */
  runId?: string;
};

// ── PregelRunner ──

export class PregelRunner {
  readonly emitter = new WorkflowEventEmitter();

  private readonly definition: WorkflowDefinition;
  private readonly config: WorkflowRunConfig;
  private readonly executorRegistry: NodeExecutorRegistry;
  private readonly checkpointer?: WorkflowCheckpointer;
  private readonly graph: CompiledGraph;
  private channels: Map<string, Channel>;
  private _runId: string;

  private abortController = new AbortController();
  private step = 0;
  private status: WorkflowRunStatus = "running";
  private lastCheckpointId: string | null = null;
  /** Tracks the channel version each node last observed */
  private lastSeenVersions: Map<string, NodeVersionMap> = new Map();
  /** Nodes that executed in the previous step (used for adjacency-based activation) */
  private executedPreviousStep = new Set<string>();
  /** All nodes that have ever executed (used to prevent re-running entry node) */
  private executedEver = new Set<string>();

  constructor(
    definition: WorkflowDefinition,
    config: WorkflowRunConfig,
    opts: PregelRunnerDeps,
  ) {
    this.definition = definition;
    this.config = config;
    this.executorRegistry = opts.executorRegistry;
    this.checkpointer = opts.checkpointer;
    this.graph = compileGraph(definition);
    this.channels = compileChannels(definition.stateSchema);
    this._runId = opts.runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Initialize lastSeenVersions for every node
    for (const node of definition.nodes) {
      this.lastSeenVersions.set(node.id, new Map());
    }
  }

  get runId(): string {
    return this._runId;
  }

  // ── Public API ──

  async run(input?: Record<string, unknown>): Promise<WorkflowRunResult> {
    const runStart = Date.now();
    this.status = "running";

    // 1. Write initial input to channels
    if (input) {
      this.writeInputToChannels(input);
    }

    // 2. Emit run-start
    this.emitter.emit({
      type: "run-start",
      runId: this.runId,
      workflowId: this.definition.id,
    });

    // 3. Create run record in checkpointer if available
    if (this.checkpointer) {
      await this.checkpointer.createRun({
        id: this.runId,
        workflowId: this.definition.id,
        workflowVersion: this.definition.version ?? 1,
        status: "running",
        startedAt: new Date().toISOString(),
      }).catch((err) => {
        console.error("[PregelRunner] 创建运行记录失败", { runId: this.runId, error: String(err) });
      });
    }

    let error: string | undefined;
    let interruptPayload: unknown | undefined;

    try {
      // 4. Superstep loop
      while (this.step < this.config.recursionLimit) {
        if (this.abortController.signal.aborted) {
          this.status = "canceled";
          break;
        }

        // Check __done__
        const doneChannel = this.channels.get("__done__");
        if (doneChannel && doneChannel.get() === true) {
          this.status = "succeeded";
          break;
        }

        // Plan next nodes (reads __route__ from previous step before it gets reset)
        const readyNodes = this.planNextNodes();

        // Reset route/interrupt channels after planning consumed them
        // NOTE: __resume__ is NOT reset here — it's reset after execution
        // so HumanInputNodeExecutor can read it during this step
        if (this.step > 0) {
          const routeCh = this.channels.get("__route__");
          if (routeCh) routeCh.reset();
          const interruptCh = this.channels.get("__interrupt__");
          if (interruptCh) interruptCh.reset();
        }
        if (readyNodes.length === 0) {
          // No nodes to execute — natural termination
          this.status = "succeeded";
          break;
        }

        // Emit step-start
        this.emitter.emit({
          type: "step-start",
          runId: this.runId,
          step: this.step,
          nodes: readyNodes.map((n) => n.id),
        });

        const stepStart = Date.now();

        // Execute all ready nodes in parallel
        const results = await this.executeNodes(readyNodes);

        // Collect writes, handle errors and interrupts
        const allWrites: NodeWrite[] = [];
        let hasError = false;

        for (const { node, result } of results) {
          if (result.status === "rejected") {
            const reason = result.reason;
            if (isGraphInterrupt(reason)) {
              interruptPayload = reason.payload;
              this.emitter.emit({
                type: "interrupt-requested",
                runId: this.runId,
                nodeId: node.id,
                payload: reason.payload,
              });
              this.status = "waiting-input";
              hasError = true;
              break;
            }
            // Regular error
            const errMsg = reason instanceof Error ? reason.message : String(reason);
            this.emitter.emit({
              type: "node-error",
              runId: this.runId,
              nodeId: node.id,
              error: errMsg,
              willRetry: false,
              attempt: 1,
            });
            error = errMsg;
            this.status = "failed";
            hasError = true;
            break;
          }

          // Fulfilled
          const execResult = result.value;
          allWrites.push(...execResult.writes);

          // Emit node-complete
          this.emitter.emit({
            type: "node-complete",
            runId: this.runId,
            nodeId: node.id,
            outputs: execResult.outputs,
            durationMs: execResult.durationMs,
          });
        }

        if (hasError) {
          // Save interrupt checkpoint before breaking
          if (this.checkpointer && this.status === "waiting-input") {
            await this.saveCheckpoint(readyNodes.map((n) => n.id), Date.now() - stepStart, interruptPayload);
          }
          break;
        }

        // Apply writes atomically
        const updatedChannels = this.applyWrites(allWrites);

        // Reset __resume__ after execution consumed it
        const resumeCh = this.channels.get("__resume__");
        if (resumeCh) resumeCh.reset();

        // Mark executed nodes' version-seen
        for (const { node } of results) {
          this.markNodeVersionsSeen(node.id);
        }

        const stepDuration = Date.now() - stepStart;

        // Emit step-complete
        this.emitter.emit({
          type: "step-complete",
          runId: this.runId,
          step: this.step,
          updatedChannels,
          durationMs: stepDuration,
        });

        // Track which nodes ran this step for adjacency-based activation next step
        this.executedPreviousStep = new Set(results.map(({ node }) => node.id));
        for (const nodeId of this.executedPreviousStep) {
          this.executedEver.add(nodeId);
        }

        // Save checkpoint after successful superstep
        if (this.checkpointer) {
          await this.saveCheckpoint(readyNodes.map((n) => n.id), stepDuration);
        }

        this.step++;
      }

      // Recursion limit check
      if (this.step >= this.config.recursionLimit && this.status === "running") {
        error = `Recursion limit ${this.config.recursionLimit} reached at step ${this.step}`;
        this.status = "failed";
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      this.status = "failed";
    }

    const durationMs = Date.now() - runStart;
    const finalState = this.getCurrentState();

    // Update run record in checkpointer
    if (this.checkpointer) {
      await this.checkpointer.updateRunStatus(this.runId, this.status, {
        totalSteps: this.step,
        error,
        finishedAt: this.status !== "waiting-input" ? new Date().toISOString() : undefined,
      }).catch((err) => {
        console.error("[PregelRunner] 更新运行状态失败", { runId: this.runId, error: String(err) });
      });
    }

    // Emit run-complete
    this.emitter.emit({
      type: "run-complete",
      runId: this.runId,
      status: this.status,
      finalState,
      totalSteps: this.step,
      durationMs,
    });

    return {
      status: this.status,
      finalState,
      totalSteps: this.step,
      durationMs,
      error,
      interruptPayload,
    };
  }

  abort(): void {
    this.abortController.abort();
  }

  /**
   * 恢复中断的工作流执行（热恢复）。
   *
   * 将 resumeValue 写入 __resume__ channel，然后重新进入超步循环。
   * human-input 节点在下一次调度时读取 __resume__ 值，把它写入 formKey channel
   * 并正常完成，而不是再次抛出 GraphInterrupt。
   */
  async resume(resumeValue: unknown): Promise<WorkflowRunResult> {
    if (this.status !== "waiting-input") {
      throw new Error(
        `Cannot resume run ${this.runId}: status is "${this.status}", expected "waiting-input"`,
      );
    }

    // Write the resume value to the __resume__ channel
    const resumeChannel = this.channels.get("__resume__");
    if (resumeChannel) {
      resumeChannel.update([resumeValue]);
    } else {
      throw new Error(`[PregelRunner] __resume__ channel not found for run ${this.runId}`);
    }

    // Reset abort controller for the new execution phase
    this.abortController = new AbortController();
    this.status = "running";

    // Continue the superstep loop from current step
    return this.run();
  }

  /**
   * 从 checkpoint 数据恢复引擎状态（冷恢复）。
   *
   * 在进程重启后，先创建一个新的 PregelRunner（带相同的 runId），
   * 然后调用 restoreFromCheckpoint() 还原所有通道与版本状态，
   * 最后调用 resume(resumeValue) 继续执行。
   */
  restoreFromCheckpoint(checkpoint: CheckpointData): void {
    // Restore step counter
    this.step = checkpoint.step;

    // Restore channel data from checkpoint
    for (const [name, data] of checkpoint.channelData) {
      const channel = this.channels.get(name);
      if (channel) {
        channel.fromCheckpoint({ value: data.value, version: data.version });
      }
    }

    // Restore channel versions for internal channels from channelVersions
    for (const [name, version] of Object.entries(checkpoint.channelVersions)) {
      const channel = this.channels.get(name);
      if (channel && !checkpoint.channelData.has(name)) {
        // For internal/ephemeral channels not in channelData, just sync version
        channel.version = version;
      }
    }

    // Restore versionsSeenByNode
    this.lastSeenVersions = new Map();
    for (const [nodeId, seen] of Object.entries(checkpoint.versionsSeen)) {
      this.lastSeenVersions.set(nodeId, new Map(Object.entries(seen)));
    }

    // Restore executedEver from versionsSeen — any node with entries has executed
    this.executedEver = new Set<string>();
    for (const [nodeId, seen] of this.lastSeenVersions) {
      if (seen.size > 0) {
        this.executedEver.add(nodeId);
      }
    }

    // Restore executedPreviousStep from triggeredNodes
    this.executedPreviousStep = new Set(checkpoint.triggeredNodes);

    // Set status to interrupted so resume() can validate
    this.status = checkpoint.status === "interrupted" ? "waiting-input" : (checkpoint.status as WorkflowRunStatus);

    // Track the last checkpoint id for parent chaining
    this.lastCheckpointId = checkpoint.checkpointId;

    console.info("[PregelRunner] 从 checkpoint 恢复完成", {
      runId: this.runId,
      step: this.step,
      status: this.status,
      channelCount: checkpoint.channelData.size,
    });
  }

  getCurrentState(): Record<string, unknown> {
    const state: Record<string, unknown> = {};
    for (const [name, channel] of this.channels) {
      // Skip internal channels
      if (name.startsWith("__")) continue;
      state[name] = channel.get();
    }
    return state;
  }

  // ── Planning ──

  private planNextNodes(): WorkflowNode[] {
    const ready: WorkflowNode[] = [];

    if (this.step === 0) {
      // Step 0: always return entry node only
      const entryNode = this.graph.nodeMap.get(this.graph.entryNodeId);
      if (entryNode) ready.push(entryNode);
      return ready;
    }

    // Dynamic routing: check __route__ channel first
    const routeChannel = this.channels.get("__route__");
    const routeTarget = routeChannel?.get() as string | undefined;
    const alreadyAdded = new Set<string>();

    // If a route target is set, include it unconditionally
    if (routeTarget) {
      const routeNode = this.graph.nodeMap.get(routeTarget);
      if (routeNode) {
        ready.push(routeNode);
        alreadyAdded.add(routeTarget);
      }
    }

    for (const [nodeId, node] of this.graph.nodeMap) {
      if (alreadyAdded.has(nodeId)) continue;
      if (this.executedEver.has(nodeId) && nodeId === this.graph.entryNodeId) continue;

      // 1. Check subscribed channel versions — if any subscribed channel has new data
      const subscriptions = this.graph.nodeSubscriptions.get(nodeId) ?? [];
      const nodeVersions = this.lastSeenVersions.get(nodeId) ?? new Map();

      let triggeredByChannel = false;
      for (const channelName of subscriptions) {
        const channel = this.channels.get(channelName);
        if (!channel) continue;
        const lastSeen = nodeVersions.get(channelName) ?? 0;
        if (channel.version > lastSeen) {
          triggeredByChannel = true;
          break;
        }
      }

      if (triggeredByChannel) {
        ready.push(node);
        alreadyAdded.add(nodeId);
        continue;
      }

      // 2. Adjacency fallback: if an upstream node ran in the previous step,
      //    activate this node (handles nodes like start that produce no channel writes).
      //    Skip conditional edges when a __route__ target is active (condition node
      //    already selected its target via __route__).
      const incomingEdges = this.definition.edges.filter((e) => e.toNodeId === nodeId);

      const upstreamRanLastStep = incomingEdges.some((edge) => {
        if (!this.executedPreviousStep.has(edge.fromNodeId)) return false;
        // If route target is set and this edge is conditional, only activate the route target
        if (routeTarget && edge.kind === "conditional") {
          return nodeId === routeTarget;
        }
        return true;
      });

      if (upstreamRanLastStep) {
        ready.push(node);
        alreadyAdded.add(nodeId);
      }
    }

    return ready;
  }

  // ── Execution ──

  private async executeNodes(
    nodes: WorkflowNode[],
  ): Promise<Array<{ node: WorkflowNode; result: PromiseSettledResult<NodeExecutionResult> }>> {
    // Build a read-only state snapshot for executors
    // Include __resume__ so HumanInputNodeExecutor can read the resume value
    const stateSnapshot = new Map<string, unknown>();
    for (const [name, channel] of this.channels) {
      if (name === "__resume__" || !name.startsWith("__")) {
        stateSnapshot.set(name, channel.get());
      }
    }

    const promises = nodes.map(async (node) => {
      // Emit node-start
      this.emitter.emit({
        type: "node-start",
        runId: this.runId,
        nodeId: node.id,
        nodeKind: node.kind,
      });

      const executor = this.executorRegistry.get(node.kind);
      const result = await executor.execute({
        node,
        state: stateSnapshot,
        config: {
          recursionLimit: this.config.recursionLimit,
          workingDirectory: this.config.workingDirectory,
          modelProfileId: this.config.modelProfileId,
          checkpointPolicy: this.config.checkpointPolicy,
          maxParallelNodes: this.config.maxParallelNodes,
          variables: this.config.variables,
        },
        emitter: this.emitter,
        signal: this.abortController.signal,
        runId: this.runId,
      });
      return result;
    });

    const settled = await Promise.allSettled(promises);

    return nodes.map((node, i) => ({
      node,
      result: settled[i],
    }));
  }

  // ── Channel writes ──

  private writeInputToChannels(input: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(input)) {
      let channel = this.channels.get(key);
      if (!channel) {
        // Auto-create a LastValueChannel for unknown keys
        channel = new LastValueChannel(key, undefined);
        this.channels.set(key, channel);
      }
      channel.update([value]);
    }
  }

  private applyWrites(writes: NodeWrite[]): string[] {
    // Group writes by channel name
    const grouped = new Map<string, unknown[]>();
    for (const w of writes) {
      const list = grouped.get(w.channelName) ?? [];
      list.push(w.value);
      grouped.set(w.channelName, list);
    }

    const updatedChannels: string[] = [];
    for (const [channelName, values] of grouped) {
      let channel = this.channels.get(channelName);
      if (!channel) {
        // Auto-create a LastValueChannel for unknown channel
        channel = new LastValueChannel(channelName, undefined);
        this.channels.set(channelName, channel);
      }
      const changed = channel.update(values);
      if (changed) {
        updatedChannels.push(channelName);
        // Emit state-updated for non-internal channels
        if (!channelName.startsWith("__")) {
          this.emitter.emit({
            type: "state-updated",
            runId: this.runId,
            channelName,
            value: channel.get(),
            version: channel.version,
          });
        }
      }
    }

    return updatedChannels;
  }

  private markNodeVersionsSeen(nodeId: string): void {
    const nodeVersions = this.lastSeenVersions.get(nodeId);
    if (!nodeVersions) return;
    for (const [name, channel] of this.channels) {
      nodeVersions.set(name, channel.version);
    }
  }

  private resetEphemeralChannels(): void {
    // Reset __route__ and __interrupt__ after each step, but keep __done__
    // NOTE: __resume__ is reset after execution in the main loop, not here
    const routeCh = this.channels.get("__route__");
    if (routeCh) routeCh.reset();

    const interruptCh = this.channels.get("__interrupt__");
    if (interruptCh) interruptCh.reset();
  }

  // ── Checkpoint persistence ──

  private async saveCheckpoint(
    triggeredNodes: string[],
    durationMs: number,
    interruptPayload?: unknown,
  ): Promise<void> {
    if (!this.checkpointer) return;

    const checkpointId = `ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const channelData = new Map<string, { version: number; value: unknown }>();
    for (const [name, ch] of this.channels) {
      if (!name.startsWith("__")) {
        channelData.set(name, { version: ch.version, value: ch.get() });
      }
    }

    const checkpointStatus: CheckpointData["status"] =
      this.status === "waiting-input" ? "interrupted" :
      this.status === "succeeded" ? "succeeded" :
      this.status === "failed" ? "failed" :
      "running";

    const data: CheckpointData = {
      runId: this.runId,
      checkpointId,
      parentId: this.lastCheckpointId,
      step: this.step,
      status: checkpointStatus,
      channelVersions: Object.fromEntries(
        [...this.channels].map(([name, ch]) => [name, ch.version]),
      ),
      versionsSeen: Object.fromEntries(
        [...this.lastSeenVersions].map(([nodeId, seen]) => [
          nodeId,
          Object.fromEntries(seen),
        ]),
      ),
      triggeredNodes,
      durationMs,
      interruptPayload,
      channelData,
    };

    try {
      await this.checkpointer.saveCheckpoint(data);
      this.lastCheckpointId = checkpointId;
    } catch (err) {
      console.error("[PregelRunner] 保存 checkpoint 失败", {
        runId: this.runId,
        step: this.step,
        error: String(err),
      });
    }
  }
}

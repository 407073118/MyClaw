import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { ModelProfile, WorkflowDefinition, WorkflowRunSummary, WorkflowSummary } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import { saveWorkflow, saveWorkflowRun, deleteWorkflowFile } from "../services/state-persistence";
import { callModel } from "../services/model-client";
import { BuiltinToolExecutor } from "../services/builtin-tool-executor";
import {
  PregelRunner,
  NodeExecutorRegistry,
  StartNodeExecutor,
  EndNodeExecutor,
  ConditionNodeExecutor,
  LlmNodeExecutor,
  ToolNodeExecutor,
  HumanInputNodeExecutor,
  JoinNodeExecutor,
} from "../services/workflow-engine";
import type { ModelCaller, ModelProfileResolver, WorkflowCheckpointer, CheckpointData } from "../services/workflow-engine";
import type { ToolExecutorFn, McpToolCallerFn } from "../services/workflow-engine";
import { SqliteCheckpointer } from "../services/workflow-engine/sqlite-checkpointer";

type UpdateWorkflowInput = Partial<WorkflowDefinition>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 广播事件到所有渲染窗口 */
function broadcastToRenderers(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    } catch {
      // 窗口可能在遍历过程中被销毁
    }
  }
}

/** 归一化工作流定义，确保渲染层依赖的数组字段始终存在。 */
function normalizeWorkflowDefinition(
  summary: WorkflowSummary,
  raw: Partial<WorkflowDefinition> | null | undefined,
): WorkflowDefinition {
  const merged = {
    ...summary,
    ...(raw ?? {}),
    id: summary.id,
  } as Partial<WorkflowDefinition>;

  return {
    ...merged,
    id: summary.id,
    entryNodeId: typeof merged.entryNodeId === "string" ? merged.entryNodeId : "",
    nodes: Array.isArray(merged.nodes) ? merged.nodes : [],
    edges: Array.isArray(merged.edges) ? merged.edges : [],
    stateSchema: Array.isArray(merged.stateSchema) ? merged.stateSchema : [],
  } as WorkflowDefinition;
}

/** 将 workflow run 写回内存注册表，保持 bootstrap / IPC 看到同一份状态。 */
function upsertWorkflowRun(ctx: RuntimeContext, run: WorkflowRunSummary): WorkflowRunSummary {
  const index = ctx.state.workflowRuns.findIndex((item) => item.id === run.id);
  if (index >= 0) {
    ctx.state.workflowRuns[index] = run;
  } else {
    ctx.state.workflowRuns.push(run);
  }
  return run;
}

/**
 * 创建桥接真实基础设施的节点执行器注册表。
 *
 * Phase 2A：LLM 节点使用 callModel，工具节点使用 BuiltinToolExecutor
 * 和 McpServerManager，替代之前的 stub 占位实现。
 */
function createRealExecutorRegistry(ctx: RuntimeContext): NodeExecutorRegistry {
  const registry = new NodeExecutorRegistry();

  // ── Start / End ──
  registry.register(new StartNodeExecutor());
  registry.register(new EndNodeExecutor());

  // ── Condition ──
  registry.register(new ConditionNodeExecutor());

  // ── LLM — 桥接 callModel ──
  const profileResolver: ModelProfileResolver = (id?: string): ModelProfile | Record<string, never> => {
    if (!id) {
      // 回退到默认模型
      const defaultId = ctx.state.getDefaultModelProfileId();
      if (defaultId) {
        const found = ctx.state.models.find((m) => m.id === defaultId);
        if (found) return found;
      }
      // 若无默认模型，返回列表中第一个
      return ctx.state.models[0] ?? {};
    }
    return ctx.state.models.find((m) => m.id === id) ?? {};
  };

  const modelCaller: ModelCaller = async (opts) => {
    const profile = opts.profile as ModelProfile;
    if (!profile.baseUrl || !profile.model) {
      throw new Error(
        "[workflow] 模型配置不完整，无法调用 LLM。请在设置中配置至少一个模型。",
      );
    }

    const result = await callModel({
      profile,
      messages: opts.messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant" | "tool",
        content: m.content,
      })),
      tools: opts.tools as any[] | undefined,
      onDelta: opts.onDelta,
      signal: opts.signal,
    });

    return {
      content: result.content,
      usage: result.usage,
    };
  };
  registry.register(new LlmNodeExecutor(modelCaller, profileResolver));

  // ── Tool — 桥接 BuiltinToolExecutor ──
  const toolExecutor = new BuiltinToolExecutor();
  toolExecutor.setSkills(ctx.state.skills);

  const toolExecFn: ToolExecutorFn = async (toolId, label, workingDir) => {
    const result = await toolExecutor.execute(toolId, label, workingDir);
    return {
      success: result.success,
      output: result.output,
      error: result.error,
    };
  };

  // ── MCP — 桥接 McpServerManager ──
  const mcpCallerFn: McpToolCallerFn | null = ctx.services.mcpManager
    ? async (serverId, toolName, args) => {
        return ctx.services.mcpManager!.callTool(serverId, toolName, args);
      }
    : null;

  registry.register(new ToolNodeExecutor(toolExecFn, mcpCallerFn));

  // ── Human Input ──
  registry.register(new HumanInputNodeExecutor());

  // ── Join ──
  registry.register(new JoinNodeExecutor());

  return registry;
}

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

export function registerWorkflowHandlers(ctx: RuntimeContext): void {
  // ── Checkpointer 初始化 ──────────────────────────────────────────────────

  const checkpointer = new SqliteCheckpointer(
    join(ctx.runtime.paths.myClawDir, "workflow-runs.db"),
  );
  let checkpointerReady: Promise<void> | undefined = checkpointer.init().catch((err) => {
    console.error("[workflow] 初始化 checkpointer 失败", err);
  }) as Promise<void>;

  /**
   * 将 SqliteCheckpointer（同步 API）适配为 PregelRunner 所需的
   * WorkflowCheckpointer 异步接口。
   */
  const checkpointerAdapter: WorkflowCheckpointer = {
    async createRun(run) {
      await checkpointerReady;
      checkpointer.createRun({
        id: run.id,
        workflowId: run.workflowId,
        workflowVersion: run.workflowVersion,
        config: { status: run.status, startedAt: run.startedAt },
      });
    },
    async updateRunStatus(runId, status, extra) {
      await checkpointerReady;
      checkpointer.updateRunStatus(runId, status, extra);
    },
    async saveCheckpoint(data: CheckpointData) {
      await checkpointerReady;
      checkpointer.saveCheckpoint({
        runId: data.runId,
        checkpointId: data.checkpointId,
        parentId: data.parentId,
        step: data.step,
        status: data.status,
        channelVersions: data.channelVersions,
        versionsSeen: data.versionsSeen,
        triggeredNodes: data.triggeredNodes,
        durationMs: data.durationMs,
        interruptPayload: data.interruptPayload,
        channelData: data.channelData,
      });
    },
    async loadLatestCheckpoint(runId) {
      await checkpointerReady;
      const cp = checkpointer.getLatestCheckpoint(runId);
      if (!cp) return null;
      // 从 SQLite 还原 channel data
      const channelData = checkpointer.restoreChannelData(runId, cp.channelVersions);
      const restoredChannelData = new Map<string, { version: number; value: unknown }>();
      for (const [name, value] of channelData) {
        const version = cp.channelVersions[name] ?? 0;
        restoredChannelData.set(name, { version, value });
      }
      return {
        runId,
        checkpointId: cp.checkpointId,
        parentId: cp.parentId,
        step: cp.step,
        status: cp.status as CheckpointData["status"],
        channelVersions: cp.channelVersions,
        versionsSeen: cp.versionsSeen,
        triggeredNodes: cp.triggeredNodes,
        durationMs: cp.durationMs,
        interruptPayload: cp.interruptPayload,
        channelData: restoredChannelData,
      };
    },
  };

  // ── CRUD ─────────────────────────────────────────────────────────────────

  ipcMain.handle("workflow:list", async (): Promise<WorkflowSummary[]> => {
    return ctx.state.getWorkflows();
  });

  ipcMain.handle(
    "workflow:get",
    async (_event, workflowId: string): Promise<WorkflowDefinition | null> => {
      const summary = ctx.state.getWorkflows().find((w) => w.id === workflowId);
      const definition = ctx.state.workflowDefinitions[workflowId];
      if (definition && summary) {
        console.info("[workflow:get] 返回归一化后的工作流定义", { workflowId });
        return normalizeWorkflowDefinition(summary, definition);
      }
      if (!summary) {
        return null;
      }
      console.info("[workflow:get] 仅存在摘要，返回最小工作流定义", { workflowId });
      return normalizeWorkflowDefinition(summary, null);
    },
  );

  ipcMain.handle(
    "workflow:create",
    async (
      _event,
      input: { name: string; description?: string },
    ): Promise<{ workflow: WorkflowSummary; items: WorkflowSummary[] }> => {
      const now = new Date().toISOString();
      const workflow: WorkflowSummary = {
        id: randomUUID(),
        name: input.name,
        description: input.description ?? "",
        status: "draft",
        source: "personal",
        version: 1,
        nodeCount: 0,
        edgeCount: 0,
        libraryRootId: "",
        updatedAt: now,
      };
      ctx.state.getWorkflows().push(workflow);

      const definition: WorkflowDefinition = {
        ...workflow,
        entryNodeId: "",
        nodes: [],
        edges: [],
        stateSchema: [],
      };
      saveWorkflow(ctx.runtime.paths, definition).catch((err) => {
        console.error("[workflow:create] failed to persist workflow", workflow.id, err);
      });

      return { workflow, items: [...ctx.state.getWorkflows()] };
    },
  );

  ipcMain.handle(
    "workflow:update",
    async (
      _event,
      workflowId: string,
      updates: UpdateWorkflowInput,
    ): Promise<{ workflow: WorkflowSummary; items: WorkflowSummary[] }> => {
      const workflows = ctx.state.getWorkflows();
      const existing = workflows.find((w) => w.id === workflowId);
      if (!existing) {
        throw new Error(`Workflow not found: ${workflowId}`);
      }
      const existingDefinition = ctx.state.workflowDefinitions[workflowId] as Partial<WorkflowDefinition> | undefined;
      ctx.state.workflowDefinitions[workflowId] = normalizeWorkflowDefinition(existing, {
        ...existingDefinition,
        ...updates,
        id: workflowId,
      });
      console.info("[workflow:update] 已归一化并保存工作流定义", {
        workflowId,
        nodes: ctx.state.workflowDefinitions[workflowId].nodes.length,
        edges: ctx.state.workflowDefinitions[workflowId].edges.length,
        stateSchema: ctx.state.workflowDefinitions[workflowId].stateSchema.length,
      });
      const updated: WorkflowSummary = {
        ...existing,
        updatedAt: new Date().toISOString(),
        nodeCount: (updates as { nodes?: unknown[] }).nodes?.length ?? existing.nodeCount,
        edgeCount: (updates as { edges?: unknown[] }).edges?.length ?? existing.edgeCount,
      };

      const idx = workflows.findIndex((w) => w.id === workflowId);
      if (idx !== -1) {
        workflows[idx] = updated;
      }

      saveWorkflow(ctx.runtime.paths, ctx.state.workflowDefinitions[workflowId]).catch((err) => {
        console.error("[workflow:update] failed to persist workflow", workflowId, err);
      });

      return { workflow: updated, items: workflows.map((w) => (w.id === workflowId ? updated : w)) };
    },
  );

  ipcMain.handle(
    "workflow:delete",
    async (_event, workflowId: string): Promise<{ success: boolean }> => {
      const workflows = ctx.state.getWorkflows();
      const idx = workflows.findIndex((w) => w.id === workflowId);
      if (idx !== -1) {
        workflows.splice(idx, 1);
      }
      delete ctx.state.workflowDefinitions[workflowId];

      deleteWorkflowFile(ctx.runtime.paths, workflowId).catch((err) => {
        console.error("[workflow:delete] failed to delete workflow file", workflowId, err);
      });

      return { success: true };
    },
  );

  // ── Runs ─────────────────────────────────────────────────────────────────

  ipcMain.handle("workflow:list-runs", async (): Promise<WorkflowRunSummary[]> => {
    // 优先从 SQLite 读取持久化运行记录，覆盖内存中可能过时的数据
    try {
      await checkpointerReady;
      const persisted = checkpointer.listRuns();
      if (persisted.length > 0) {
        // 用活跃运行的实时状态覆盖持久化数据
        return persisted.map((run) => {
          const active = ctx.state.activeWorkflowRuns.get(run.id);
          if (active) {
            return { ...run, status: "running" as const, updatedAt: new Date().toISOString() };
          }
          return run;
        });
      }
    } catch (err) {
      console.error("[workflow:list-runs] 从 checkpointer 读取失败，回退到内存数据", err);
    }
    return [...ctx.state.workflowRuns];
  });

  ipcMain.handle(
    "workflow:start-run",
    async (
      _event,
      input: { workflowId: string; initialState?: Record<string, unknown> },
    ): Promise<{ runId: string }> => {
      const workflow = ctx.state.getWorkflows().find((w) => w.id === input.workflowId);
      if (!workflow) {
        throw new Error(`Workflow not found: ${input.workflowId}`);
      }

      const definition = ctx.state.workflowDefinitions[input.workflowId];
      if (!definition) {
        throw new Error(`Workflow definition not found: ${input.workflowId}`);
      }

      // 创建执行器注册表（Phase 2A：桥接真实 callModel / BuiltinToolExecutor / MCP）
      const executorRegistry = createRealExecutorRegistry(ctx);

      // 创建 PregelRunner（注入 checkpointer adapter 以持久化运行状态）
      const runner = new PregelRunner(definition, {
        recursionLimit: 50,
        workingDirectory: ctx.runtime.myClawRootPath,
        modelProfileId: ctx.state.getDefaultModelProfileId() ?? "",
        checkpointPolicy: "every-step",
      }, { executorRegistry, checkpointer: checkpointerAdapter });

      // 桥接事件流到渲染层
      runner.emitter.on((event) => {
        broadcastToRenderers("workflow:stream", event);
      });

      // 注册 runner 到活跃运行表
      const runId = runner.runId;
      ctx.state.activeWorkflowRuns.set(runId, runner);

      // 创建运行记录
      const now = new Date().toISOString();
      const runSummary: WorkflowRunSummary = {
        id: runId,
        workflowId: workflow.id,
        workflowVersion: workflow.version ?? 1,
        status: "running",
        currentNodeIds: [],
        startedAt: now,
        updatedAt: now,
      };
      upsertWorkflowRun(ctx, runSummary);
      saveWorkflowRun(ctx.runtime.paths, runSummary).catch((err) => {
        console.error("[workflow:start-run] failed to persist run", runId, err);
      });

      // 异步执行 — 不 await，立即返回 runId
      runner.run(input.initialState).then((result) => {
        // 执行完成，更新运行记录
        const completedRun: WorkflowRunSummary = {
          ...runSummary,
          status: result.status,
          updatedAt: new Date().toISOString(),
        };
        upsertWorkflowRun(ctx, completedRun);
        saveWorkflowRun(ctx.runtime.paths, completedRun).catch((err) => {
          console.error("[workflow:start-run] failed to persist completed run", runId, err);
        });

        // 清理活跃运行
        ctx.state.activeWorkflowRuns.delete(runId);
        console.info("[workflow:start-run] 工作流执行完成", {
          runId,
          status: result.status,
          totalSteps: result.totalSteps,
          durationMs: result.durationMs,
        });
      }).catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failedRun: WorkflowRunSummary = {
          ...runSummary,
          status: "failed",
          updatedAt: new Date().toISOString(),
        };
        upsertWorkflowRun(ctx, failedRun);
        saveWorkflowRun(ctx.runtime.paths, failedRun).catch(() => {});
        ctx.state.activeWorkflowRuns.delete(runId);
        console.error("[workflow:start-run] 工作流执行异常", { runId, error: errorMsg });
      });

      return { runId };
    },
  );

  ipcMain.handle(
    "workflow:interrupt-resume",
    async (
      _event,
      input: { runId: string; resumeValue?: unknown },
    ): Promise<{ success: boolean }> => {
      const runner = ctx.state.activeWorkflowRuns.get(input.runId) as PregelRunner | undefined;

      if (runner) {
        // ── 热恢复：runner 仍在内存中 ──
        console.info("[workflow:interrupt-resume] 热恢复工作流", { runId: input.runId });

        // 更新运行记录状态为 running
        const existingRun = ctx.state.workflowRuns.find((r) => r.id === input.runId);
        if (existingRun) {
          const resumedRun: WorkflowRunSummary = {
            ...existingRun,
            status: "running",
            updatedAt: new Date().toISOString(),
          };
          upsertWorkflowRun(ctx, resumedRun);
        }

        // 异步执行 resume — 不 await，立即返回
        runner.resume(input.resumeValue).then((result) => {
          const completedRun: WorkflowRunSummary = {
            ...(ctx.state.workflowRuns.find((r) => r.id === input.runId) ?? {
              id: input.runId,
              workflowId: "",
              workflowVersion: 1,
              currentNodeIds: [],
              startedAt: new Date().toISOString(),
            }),
            status: result.status,
            updatedAt: new Date().toISOString(),
            totalSteps: result.totalSteps,
            error: result.error,
          };
          upsertWorkflowRun(ctx, completedRun);
          saveWorkflowRun(ctx.runtime.paths, completedRun).catch((err) => {
            console.error("[workflow:interrupt-resume] 保存完成记录失败", input.runId, err);
          });

          // 若非等待输入状态，清理活跃运行
          if (result.status !== "waiting-input") {
            ctx.state.activeWorkflowRuns.delete(input.runId);
          }

          console.info("[workflow:interrupt-resume] 工作流恢复执行完成", {
            runId: input.runId,
            status: result.status,
            totalSteps: result.totalSteps,
            durationMs: result.durationMs,
          });
        }).catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const existingForError = ctx.state.workflowRuns.find((r) => r.id === input.runId);
          if (existingForError) {
            const failedRun: WorkflowRunSummary = {
              ...existingForError,
              status: "failed",
              updatedAt: new Date().toISOString(),
              error: errorMsg,
            };
            upsertWorkflowRun(ctx, failedRun);
            saveWorkflowRun(ctx.runtime.paths, failedRun).catch(() => {});
          }
          ctx.state.activeWorkflowRuns.delete(input.runId);
          console.error("[workflow:interrupt-resume] 工作流恢复异常", { runId: input.runId, error: errorMsg });
        });

        return { success: true };
      }

      // ── 冷恢复：进程重启后 runner 已丢失 ──
      // Phase 3B 暂不实现完整冷恢复，需要 checkpointer 持久化层就绪后支持
      throw new Error(
        `No active workflow run found for runId: ${input.runId}. Cold resume from checkpoint is not yet supported — the process may have restarted.`,
      );
    },
  );

  ipcMain.handle(
    "workflow:cancel-run",
    async (_event, runId: string): Promise<{ success: boolean }> => {
      const runner = ctx.state.activeWorkflowRuns.get(runId) as PregelRunner | undefined;
      if (!runner) {
        throw new Error(`No active workflow run found for runId: ${runId}`);
      }

      runner.abort();
      ctx.state.activeWorkflowRuns.delete(runId);

      // 更新运行记录
      const existing = ctx.state.workflowRuns.find((r) => r.id === runId);
      if (existing) {
        const canceled: WorkflowRunSummary = {
          ...existing,
          status: "canceled",
          updatedAt: new Date().toISOString(),
        };
        upsertWorkflowRun(ctx, canceled);
        saveWorkflowRun(ctx.runtime.paths, canceled).catch((err) => {
          console.error("[workflow:cancel-run] failed to persist canceled run", runId, err);
        });
      }

      return { success: true };
    },
  );

  ipcMain.handle(
    "workflow:get-run-detail",
    async (_event, runId: string): Promise<WorkflowRunSummary | null> => {
      // 优先查看活跃运行
      const runner = ctx.state.activeWorkflowRuns.get(runId) as PregelRunner | undefined;
      if (runner) {
        const existing = ctx.state.workflowRuns.find((r) => r.id === runId);
        if (existing) {
          return {
            ...existing,
            status: "running",
            updatedAt: new Date().toISOString(),
          };
        }
      }

      // 从 SQLite checkpointer 读取持久化数据（含 checkpoint 元信息）
      try {
        await checkpointerReady;
        const persisted = checkpointer.getRun(runId);
        if (persisted) {
          const checkpoint = checkpointer.getLatestCheckpoint(runId);
          if (checkpoint) {
            return {
              ...persisted,
              currentNodeIds: checkpoint.triggeredNodes,
              totalSteps: checkpoint.step,
            };
          }
          return persisted;
        }
      } catch (err) {
        console.error("[workflow:get-run-detail] 从 checkpointer 读取失败，回退到内存数据", err);
      }

      // 回退到内存数据
      return ctx.state.workflowRuns.find((r) => r.id === runId) ?? null;
    },
  );

  // ── 保留旧的 resume-run 通道兼容（废弃，转发到 interrupt-resume） ──────

  ipcMain.handle(
    "workflow:resume-run",
    async (_event, runId: string): Promise<{ run: WorkflowRunSummary; items: WorkflowRunSummary[] }> => {
      const existing = ctx.state.workflowRuns.find((run) => run.id === runId);
      if (!existing) {
        throw new Error(`Workflow run not found: ${runId}`);
      }
      if (existing.status !== "waiting-input" && existing.status !== "retry-scheduled") {
        throw new Error(`Workflow run ${runId} cannot be resumed from status ${existing.status}`);
      }

      const now = new Date().toISOString();
      const run: WorkflowRunSummary = {
        ...existing,
        status: "running",
        updatedAt: now,
      };

      await saveWorkflowRun(ctx.runtime.paths, run);
      upsertWorkflowRun(ctx, run);
      return { run, items: [...ctx.state.workflowRuns] };
    },
  );
}

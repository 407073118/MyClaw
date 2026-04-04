import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";

import type { WorkflowDefinition, WorkflowSummary } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import { saveWorkflow } from "../services/state-persistence";

type UpdateWorkflowInput = Partial<WorkflowDefinition>;

type WorkflowRun = {
  id: string;
  workflowId: string;
  status: "running" | "completed" | "failed" | "paused";
  startedAt: string;
  completedAt: string | null;
};

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

export function registerWorkflowHandlers(ctx: RuntimeContext): void {
  // List all workflow summaries
  ipcMain.handle("workflow:list", async (): Promise<WorkflowSummary[]> => {
    return ctx.state.getWorkflows();
  });

  // Get a single workflow definition by ID
  ipcMain.handle(
    "workflow:get",
    async (_event, workflowId: string): Promise<WorkflowDefinition | null> => {
      const summary = ctx.state.getWorkflows().find((w) => w.id === workflowId);
      const definition = ctx.state.workflowDefinitions[workflowId];
      if (definition && summary) {
        console.info("[workflow:get] 返回归一化后的工作流定义", { workflowId });
        return normalizeWorkflowDefinition(summary, definition);
      }
      // Fall back to summary if no full definition stored
      if (!summary) {
        return null;
      }
      console.info("[workflow:get] 仅存在摘要，返回最小工作流定义", { workflowId });
      return normalizeWorkflowDefinition(summary, null);
    },
  );

  // Create a new workflow
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
      // Add to the in-memory list
      ctx.state.getWorkflows().push(workflow);

      // Persist a minimal definition to disk
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

  // Update a workflow definition
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
      // Store the definition update
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

      // Also update in-memory summary list
      const idx = workflows.findIndex((w) => w.id === workflowId);
      if (idx !== -1) {
        workflows[idx] = updated;
      }

      // Persist the full definition
      saveWorkflow(ctx.runtime.paths, ctx.state.workflowDefinitions[workflowId]).catch((err) => {
        console.error("[workflow:update] failed to persist workflow", workflowId, err);
      });

      return { workflow: updated, items: workflows.map((w) => (w.id === workflowId ? updated : w)) };
    },
  );

  // List all workflow runs
  ipcMain.handle("workflow:list-runs", async (): Promise<WorkflowRun[]> => {
    // Stub: real impl reads from runtime state
    console.log("[workflow:list-runs] stub");
    return [];
  });

  // Start a new workflow run
  ipcMain.handle(
    "workflow:start-run",
    async (_event, input: { workflowId: string }): Promise<{ run: WorkflowRun; items: WorkflowRun[] }> => {
      const workflows = ctx.state.getWorkflows();
      const exists = workflows.some((w) => w.id === input.workflowId);
      if (!exists) {
        throw new Error(`Workflow not found: ${input.workflowId}`);
      }
      const run: WorkflowRun = {
        id: randomUUID(),
        workflowId: input.workflowId,
        status: "running",
        startedAt: new Date().toISOString(),
        completedAt: null,
      };
      console.log("[workflow:start-run] stub", input);
      return { run, items: [run] };
    },
  );

  // Resume a paused workflow run
  ipcMain.handle(
    "workflow:resume-run",
    async (_event, runId: string): Promise<{ run: WorkflowRun; items: WorkflowRun[] }> => {
      // Stub: real impl resumes run in runtime
      console.log("[workflow:resume-run] stub", runId);
      const run: WorkflowRun = {
        id: runId,
        workflowId: "",
        status: "running",
        startedAt: new Date().toISOString(),
        completedAt: null,
      };
      return { run, items: [run] };
    },
  );
}

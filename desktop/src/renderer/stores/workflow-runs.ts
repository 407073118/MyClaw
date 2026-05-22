import { create } from "zustand";

import type {
  WorkflowRunSummary,
  WorkflowRunStatus,
  WorkflowNodeKind,
  WorkflowInterruptPayload,
  WorkflowStreamEvent,
} from "@shared/contracts";

// ---------------------------------------------------------------------------
// Node-level live status
// ---------------------------------------------------------------------------

export type NodeLiveStatus =
  | { phase: "idle" }
  | { phase: "running"; startedAt: number }
  | { phase: "streaming"; content: string }
  | { phase: "completed"; durationMs: number; outputs: Record<string, unknown> }
  | { phase: "error"; error: string; willRetry: boolean; attempt: number }
  | { phase: "interrupted"; payload: unknown };

// ---------------------------------------------------------------------------
// Per-run live state
// ---------------------------------------------------------------------------

export type LiveRunState = {
  runId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  currentStep: number;
  activeNodes: string[];
  completedNodes: Set<string>;
  nodeStatuses: Map<string, NodeLiveStatus>;
  streamingContent: Map<string, string>;
  state: Record<string, unknown>;
  interruptPayload?: WorkflowInterruptPayload;
  events: Array<{ type: string; timestamp: number; [key: string]: unknown }>;
};

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

type WorkflowRunsState = {
  /** Live runs indexed by runId */
  liveRuns: Map<string, LiveRunState>;
  /** Completed / historical run summaries */
  runHistory: WorkflowRunSummary[];

  // ---- Actions ----
  startRun: (workflowId: string, initialState?: Record<string, unknown>) => Promise<string | null>;
  cancelRun: (runId: string) => Promise<void>;
  resumeRun: (runId: string, resumeValue: unknown) => Promise<void>;
  loadRunHistory: (workflowId?: string) => Promise<void>;
  getLiveRun: (runId: string) => LiveRunState | undefined;

  /** Central event dispatcher, wired to onWorkflowStream in the renderer. */
  handleStreamEvent: (event: WorkflowStreamEvent) => void;

  /** Remove a finished live run from the map (e.g. after the UI navigates away). */
  clearLiveRun: (runId: string) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_WORKFLOW_DEBUG_EVENT_LIMIT = 300;
const WORKFLOW_STATE_EVENT_SUMMARY_LIMIT = 4096;
const WORKFLOW_STREAMING_EVENT_PREVIEW_LIMIT = 4096;
const WORKFLOW_RUNS_DEBUG_LOGGING = resolveWorkflowRunsDebugLogging();

type WorkflowDebugEvent = LiveRunState["events"][number];

/** 读取 workflow 调试日志开关，默认关闭以避免高频流式事件拖慢渲染进程。 */
function resolveWorkflowRunsDebugLogging(): boolean {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    if (env?.MYCLAW_DEBUG_WORKFLOW_RUNS === "1") {
      return true;
    }
    return globalThis.localStorage?.getItem("MYCLAW_DEBUG_WORKFLOW_RUNS") === "1";
  } catch {
    return false;
  }
}

/** 输出 workflow 调试日志，默认不进入热路径 console。 */
function logWorkflowRunsDebug(message: string, detail: Record<string, unknown>): void {
  if (!WORKFLOW_RUNS_DEBUG_LOGGING) {
    return;
  }
  console.debug(message, detail);
}

/** 读取 workflow debug 事件保留上限，设置为 0 时保留旧的无限列表行为。 */
function resolveWorkflowDebugEventLimit(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = env?.MYCLAW_WORKFLOW_DEBUG_EVENT_LIMIT;
  if (raw === "0") return 0;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_WORKFLOW_DEBUG_EVENT_LIMIT;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WORKFLOW_DEBUG_EVENT_LIMIT;
}

/** 截断长文本，避免调试事件因为流式 chunk 无限增长。 */
function truncateDebugText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  logWorkflowRunsDebug("[workflow-runs] 已截断 workflow 调试文本", {
    originalLength: value.length,
    maxLength,
  });
  return `${value.slice(0, maxLength)}...`;
}

/** 安全估算对象大小，序列化失败时返回 Infinity 以强制摘要化。 */
function estimateJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch (error) {
    console.warn("[workflow-runs] 估算 workflow 事件大小失败，改存摘要", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Number.POSITIVE_INFINITY;
  }
}

/** 为大型 state-updated 事件生成摘要，避免调试日志持有完整大对象。 */
function summarizeWorkflowStateValue(value: unknown): unknown {
  const jsonLength = estimateJsonLength(value);
  if (jsonLength <= WORKFLOW_STATE_EVENT_SUMMARY_LIMIT) {
    return value;
  }
  const valueType = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  const summary = {
    kind: "summary",
    valueType,
    jsonLength,
    keys: value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>).slice(0, 20)
      : undefined,
  };
  logWorkflowRunsDebug("[workflow-runs] 已将大型 state-updated 事件压缩为摘要", summary);
  return summary;
}

/** 对进入调试环形缓冲区的事件做瘦身，运行态 state 仍保留完整值。 */
function slimWorkflowDebugEvent(event: WorkflowStreamEvent): Record<string, unknown> {
  if (event.type === "state-updated") {
    return {
      ...event,
      value: summarizeWorkflowStateValue(event.value),
    };
  }
  if (event.type === "node-streaming") {
    return {
      ...event,
      chunk: {
        content: event.chunk.content
          ? truncateDebugText(event.chunk.content, WORKFLOW_STREAMING_EVENT_PREVIEW_LIMIT)
          : event.chunk.content,
        reasoning: event.chunk.reasoning
          ? truncateDebugText(event.chunk.reasoning, WORKFLOW_STREAMING_EVENT_PREVIEW_LIMIT)
          : event.chunk.reasoning,
      },
    };
  }
  return event;
}

/** 合并连续 node-streaming 调试事件，降低日志行数和 React 渲染压力。 */
function mergeStreamingDebugEvent(
  previous: WorkflowDebugEvent,
  event: Record<string, unknown>,
  timestamp: number,
): WorkflowDebugEvent | null {
  if (
    previous.type !== "node-streaming"
    || event.type !== "node-streaming"
    || previous.nodeId !== event.nodeId
  ) {
    return null;
  }
  const previousChunk = previous.chunk && typeof previous.chunk === "object"
    ? previous.chunk as { content?: string; reasoning?: string }
    : {};
  const nextChunk = event.chunk && typeof event.chunk === "object"
    ? event.chunk as { content?: string; reasoning?: string }
    : {};
  const merged = {
    ...previous,
    ...event,
    timestamp,
    chunk: {
      content: truncateDebugText(
        `${previousChunk.content ?? ""}${nextChunk.content ?? ""}`,
        WORKFLOW_STREAMING_EVENT_PREVIEW_LIMIT,
      ),
      reasoning: truncateDebugText(
        `${previousChunk.reasoning ?? ""}${nextChunk.reasoning ?? ""}`,
        WORKFLOW_STREAMING_EVENT_PREVIEW_LIMIT,
      ),
    },
    sampleCount: typeof previous.sampleCount === "number" ? previous.sampleCount + 1 : 2,
  };
  logWorkflowRunsDebug("[workflow-runs] 已合并 node-streaming 调试事件", {
    runId: event.runId,
    nodeId: event.nodeId,
    sampleCount: merged.sampleCount,
  });
  return merged as WorkflowDebugEvent;
}

function createInitialLiveRun(runId: string, workflowId: string): LiveRunState {
  return {
    runId,
    workflowId,
    status: "running",
    currentStep: 0,
    activeNodes: [],
    completedNodes: new Set(),
    nodeStatuses: new Map(),
    streamingContent: new Map(),
    state: {},
    events: [],
  };
}

/** 追加带时间戳的调试事件，并执行环形缓冲、stream 合并和大 state 摘要化。 */
function pushEvent(
  run: LiveRunState,
  event: WorkflowStreamEvent,
): Array<LiveRunState["events"][number]> {
  const timestamp = Date.now();
  const slimEvent = slimWorkflowDebugEvent(event);
  const eventEntry = { ...slimEvent, timestamp } as WorkflowDebugEvent;
  const previous = run.events.at(-1);
  let nextEvents = run.events;
  if (previous) {
    const merged = mergeStreamingDebugEvent(previous, slimEvent, timestamp);
    if (merged) {
      nextEvents = [...run.events.slice(0, -1), merged];
    } else {
      nextEvents = [...run.events, eventEntry];
    }
  } else {
    nextEvents = [eventEntry];
  }
  const limit = resolveWorkflowDebugEventLimit();
  if (limit > 0 && nextEvents.length > limit) {
    logWorkflowRunsDebug("[workflow-runs] workflow 调试事件超过上限，已丢弃最早事件", {
      runId: run.runId,
      eventLimit: limit,
      droppedCount: nextEvents.length - limit,
    });
    return nextEvents.slice(-limit);
  }
  return nextEvents;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWorkflowRunsStore = create<WorkflowRunsState>()((set, get) => ({
  liveRuns: new Map(),
  runHistory: [],

  // ---- startRun ----------------------------------------------------------

  startRun: async (workflowId, initialState) => {
    try {
      const result = await window.myClawAPI.startWorkflowRun({
        workflowId,
        initialState,
      });
      const runId: string | null = (result as any)?.runId ?? null;
      if (!runId) {
        console.warn("[workflow-runs] startWorkflowRun 返回空 runId", result);
        return null;
      }

      // Optimistically create a live-run entry so UI can bind immediately
      const liveRun = createInitialLiveRun(runId, workflowId);
      if (initialState) {
        liveRun.state = { ...initialState };
      }

      set((prev) => {
        const next = new Map(prev.liveRuns);
        next.set(runId, liveRun);
        return { liveRuns: next };
      });

      return runId;
    } catch (err) {
      console.error("[workflow-runs] startRun 失败", err);
      return null;
    }
  },

  // ---- cancelRun ---------------------------------------------------------

  cancelRun: async (runId) => {
    try {
      await window.myClawAPI.cancelWorkflowRun(runId);
      set((prev) => {
        const existing = prev.liveRuns.get(runId);
        if (!existing) return {};
        const next = new Map(prev.liveRuns);
        next.set(runId, { ...existing, status: "canceled" });
        return { liveRuns: next };
      });
    } catch (err) {
      console.error("[workflow-runs] cancelRun 失败", err);
    }
  },

  // ---- resumeRun ---------------------------------------------------------

  resumeRun: async (runId, resumeValue) => {
    try {
      await window.myClawAPI.resumeWorkflowRun(runId, resumeValue);
      set((prev) => {
        const existing = prev.liveRuns.get(runId);
        if (!existing) return {};
        const next = new Map(prev.liveRuns);
        next.set(runId, {
          ...existing,
          status: "running",
          interruptPayload: undefined,
        });
        return { liveRuns: next };
      });
    } catch (err) {
      console.error("[workflow-runs] resumeRun 失败", err);
    }
  },

  // ---- loadRunHistory ----------------------------------------------------

  loadRunHistory: async (_workflowId?) => {
    try {
      const { items } = await window.myClawAPI.fetchWorkflowRuns();
      const summaries = (items ?? []) as WorkflowRunSummary[];
      set({ runHistory: summaries });
    } catch (err) {
      console.error("[workflow-runs] loadRunHistory 失败", err);
    }
  },

  // ---- getLiveRun --------------------------------------------------------

  getLiveRun: (runId) => {
    return get().liveRuns.get(runId);
  },

  // ---- handleStreamEvent -------------------------------------------------
  //
  // Central reducer for all WorkflowStreamEvent variants pushed from
  // the main process via "workflow:stream" channel.
  // -----------------------------------------------------------------------

  handleStreamEvent: (event) => {
    set((prev) => {
      const runId = event.runId;
      let run = prev.liveRuns.get(runId);

      switch (event.type) {
        // ---- run-start ---------------------------------------------------
        case "run-start": {
          run = createInitialLiveRun(event.runId, event.workflowId);
          const next = new Map(prev.liveRuns);
          next.set(runId, { ...run, events: pushEvent(run, event) });
          return { liveRuns: next };
        }

        // ---- run-complete ------------------------------------------------
        case "run-complete": {
          if (!run) return {};
          const finishedRun: LiveRunState = {
            ...run,
            status: event.status,
            state: { ...run.state, ...event.finalState },
            currentStep: event.totalSteps,
            events: pushEvent(run, event),
          };

          const next = new Map(prev.liveRuns);
          next.set(runId, finishedRun);

          // Also append to runHistory as a summary
          const summary: WorkflowRunSummary = {
            id: runId,
            workflowId: run.workflowId,
            workflowVersion: 0,
            status: event.status,
            currentNodeIds: [],
            startedAt: new Date(
              run.events[0]?.timestamp ?? Date.now(),
            ).toISOString(),
            updatedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            totalSteps: event.totalSteps,
          };

          return {
            liveRuns: next,
            runHistory: [summary, ...prev.runHistory],
          };
        }

        // ---- step-start --------------------------------------------------
        case "step-start": {
          if (!run) return {};
          const next = new Map(prev.liveRuns);
          next.set(runId, {
            ...run,
            currentStep: event.step,
            activeNodes: [...event.nodes],
            events: pushEvent(run, event),
          });
          return { liveRuns: next };
        }

        // ---- step-complete -----------------------------------------------
        case "step-complete": {
          if (!run) return {};
          const next = new Map(prev.liveRuns);
          next.set(runId, {
            ...run,
            currentStep: event.step,
            events: pushEvent(run, event),
          });
          return { liveRuns: next };
        }

        // ---- node-start --------------------------------------------------
        case "node-start": {
          if (!run) return {};
          const nodeStatuses = new Map(run.nodeStatuses);
          nodeStatuses.set(event.nodeId, {
            phase: "running",
            startedAt: Date.now(),
          });

          const activeNodes = run.activeNodes.includes(event.nodeId)
            ? run.activeNodes
            : [...run.activeNodes, event.nodeId];

          const next = new Map(prev.liveRuns);
          next.set(runId, {
            ...run,
            activeNodes,
            nodeStatuses,
            events: pushEvent(run, event),
          });
          return { liveRuns: next };
        }

        // ---- node-streaming ----------------------------------------------
        case "node-streaming": {
          if (!run) return {};
          const streamingContent = new Map(run.streamingContent);
          const existing = streamingContent.get(event.nodeId) ?? "";
          const chunk = event.chunk?.content ?? "";
          streamingContent.set(event.nodeId, existing + chunk);

          const nodeStatuses = new Map(run.nodeStatuses);
          nodeStatuses.set(event.nodeId, {
            phase: "streaming",
            content: streamingContent.get(event.nodeId)!,
          });

          const next = new Map(prev.liveRuns);
          next.set(runId, {
            ...run,
            streamingContent,
            nodeStatuses,
            events: pushEvent(run, event),
          });
          return { liveRuns: next };
        }

        // ---- node-complete -----------------------------------------------
        case "node-complete": {
          if (!run) return {};
          const nodeStatuses = new Map(run.nodeStatuses);
          nodeStatuses.set(event.nodeId, {
            phase: "completed",
            durationMs: event.durationMs,
            outputs: event.outputs,
          });

          const completedNodes = new Set(run.completedNodes);
          completedNodes.add(event.nodeId);

          const activeNodes = run.activeNodes.filter(
            (id) => id !== event.nodeId,
          );

          const streamingContent = new Map(run.streamingContent);
          streamingContent.delete(event.nodeId);

          const next = new Map(prev.liveRuns);
          next.set(runId, {
            ...run,
            activeNodes,
            completedNodes,
            nodeStatuses,
            streamingContent,
            events: pushEvent(run, event),
          });
          return { liveRuns: next };
        }

        // ---- node-error --------------------------------------------------
        case "node-error": {
          if (!run) return {};
          const nodeStatuses = new Map(run.nodeStatuses);
          nodeStatuses.set(event.nodeId, {
            phase: "error",
            error: event.error,
            willRetry: event.willRetry,
            attempt: event.attempt,
          });

          // If not retrying, remove from activeNodes
          const activeNodes = event.willRetry
            ? run.activeNodes
            : run.activeNodes.filter((id) => id !== event.nodeId);

          const next = new Map(prev.liveRuns);
          next.set(runId, {
            ...run,
            activeNodes,
            nodeStatuses,
            events: pushEvent(run, event),
          });
          return { liveRuns: next };
        }

        // ---- state-updated -----------------------------------------------
        case "state-updated": {
          if (!run) return {};
          const next = new Map(prev.liveRuns);
          next.set(runId, {
            ...run,
            state: {
              ...run.state,
              [event.channelName]: event.value,
            },
            events: pushEvent(run, event),
          });
          return { liveRuns: next };
        }

        // ---- checkpoint-saved --------------------------------------------
        case "checkpoint-saved": {
          if (!run) return {};
          const next = new Map(prev.liveRuns);
          next.set(runId, {
            ...run,
            events: pushEvent(run, event),
          });
          return { liveRuns: next };
        }

        // ---- interrupt-requested -----------------------------------------
        case "interrupt-requested": {
          if (!run) return {};
          const nodeStatuses = new Map(run.nodeStatuses);
          nodeStatuses.set(event.nodeId, {
            phase: "interrupted",
            payload: event.payload,
          });

          const next = new Map(prev.liveRuns);
          next.set(runId, {
            ...run,
            status: "waiting-input",
            interruptPayload: event.payload,
            nodeStatuses,
            events: pushEvent(run, event),
          });
          return { liveRuns: next };
        }

        // ---- interrupt-resumed -------------------------------------------
        case "interrupt-resumed": {
          if (!run) return {};
          const nodeStatuses = new Map(run.nodeStatuses);
          nodeStatuses.set(event.nodeId, {
            phase: "running",
            startedAt: Date.now(),
          });

          const next = new Map(prev.liveRuns);
          next.set(runId, {
            ...run,
            status: "running",
            interruptPayload: undefined,
            nodeStatuses,
            events: pushEvent(run, event),
          });
          return { liveRuns: next };
        }

        default: {
          // Unknown event type -- log and ignore
          console.warn("[workflow-runs] 未知的流式事件类型", (event as any).type);
          return {};
        }
      }
    });
  },

  // ---- clearLiveRun ------------------------------------------------------

  clearLiveRun: (runId) => {
    set((prev) => {
      if (!prev.liveRuns.has(runId)) return {};
      const next = new Map(prev.liveRuns);
      next.delete(runId);
      return { liveRuns: next };
    });
  },
}));

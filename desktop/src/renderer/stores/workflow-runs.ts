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

/** Append a timestamped event entry to the run's event log. */
function pushEvent(
  run: LiveRunState,
  event: WorkflowStreamEvent,
): Array<LiveRunState["events"][number]> {
  return [
    ...run.events,
    { ...event, timestamp: Date.now() },
  ];
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

/**
 * Workflow Engine barrel export.
 *
 * Re-exports every public type, class, and function from the engine
 * sub-modules so that consumers can import from a single path:
 *
 *   import { PregelRunner, NodeExecutorRegistry, ... } from "../services/workflow-engine";
 */

// ── Channels ──
export type { Channel } from "./channels";
export { LastValueChannel, ReducerChannel, EphemeralChannel, compileChannels } from "./channels";

// ── Errors ──
export type { InterruptPayload } from "./errors";
export { GraphInterrupt, isGraphInterrupt, RecursionLimitError } from "./errors";

// ── Event emitter ──
export type { WorkflowEventListener } from "./event-emitter";
export { WorkflowEventEmitter } from "./event-emitter";

// ── Node executor ──
export type {
  WorkflowRunConfigLite,
  NodeWrite,
  NodeExecutionContext,
  NodeExecutionResult,
  NodeExecutor,
} from "./node-executor";
export { NodeExecutorRegistry } from "./node-executor";

// ── Graph compiler ──
export type { CompiledGraph } from "./graph-compiler";
export { compileGraph } from "./graph-compiler";

// ── Pregel runner ──
export type { WorkflowRunResult, CheckpointData, WorkflowCheckpointer, PregelRunnerDeps } from "./pregel-runner";
export { PregelRunner } from "./pregel-runner";

// ── Executors ──
export { StartNodeExecutor } from "./executors/start";
export { EndNodeExecutor } from "./executors/end";
export { ConditionNodeExecutor, resolveJsonPath, evaluateCondition } from "./executors/condition";
export type { ModelCaller, ModelProfileResolver } from "./executors/llm";
export { LlmNodeExecutor } from "./executors/llm";
export type { ToolExecutorFn, McpToolCallerFn } from "./executors/tool";
export { ToolNodeExecutor, parseMcpToolId } from "./executors/tool";
export { HumanInputNodeExecutor } from "./executors/human-input";
export { JoinNodeExecutor } from "./executors/join";

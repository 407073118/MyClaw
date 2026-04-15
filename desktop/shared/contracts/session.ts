import type { ChatRunPhase, ChatRunStatus } from "./events";
import type { PlanModeState, PlanState } from "./plan";
import type {
  BackgroundTaskHandle,
  CapabilityEvent,
  CitationRecord,
  ComputerCall,
  ResolvedExecutionPlan,
  SessionRuntimeIntent,
  SessionRuntimeVersion,
  TurnExecutionPlan,
} from "./session-runtime";
import type { Task } from "./task";
import type { A2UiPayload } from "./ui";

export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export type MessageTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ChatMessageToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** 内容可以是纯字符串，也可以是多模态数组（用于视觉/截图场景）。 */
export type ChatMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
    >;

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  content: ChatMessageContent;
  reasoning?: string | null;
  ui?: A2UiPayload | null;
  createdAt: string;
  /** Tool calls returned by the model (assistant messages only) */
  tool_calls?: ChatMessageToolCall[];
  /** The tool_call_id this message is a response to (tool messages only) */
  tool_call_id?: string;
  /** Token usage for this message (assistant messages only) */
  usage?: MessageTokenUsage | null;
};

/** Safely extract the text portion from ChatMessageContent (string or multimodal array). */
export function textOfContent(content: ChatMessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export type ChatSession = {
  id: string;
  title: string;
  modelProfileId: string;
  attachedDirectory: string | null;
  /** 硅基员工私域 session 会绑定所属员工；主聊天 session 保持缺省。 */
  siliconPersonId?: string | null;
  createdAt: string;
  runtimeVersion?: SessionRuntimeVersion;
  /** 持久化 session 时允许缺少 Phase 2 扩展字段，兼容旧版 runtime intent。 */
  runtimeIntent?: SessionRuntimeIntent | null;
  /** 旧会话可能没有 executionPlan；新会话落盘后应保留完整计划元数据。 */
  executionPlan?: ResolvedExecutionPlan | null;
  /** 多模型执行层的共享计划，允许历史会话缺字段。 */
  turnExecutionPlan?: TurnExecutionPlan | null;
  /** 最近一轮统一执行结果的持久化索引。 */
  lastTurnOutcomeId?: string | null;
  /** 最近一轮的来源引用快照，供前端直接展示 citation/source 面板。 */
  lastTurnCitations?: CitationRecord[];
  /** 最近一轮的能力轨迹快照，供前端展示搜索/回退/后台任务时间线。 */
  lastCapabilityEvents?: CapabilityEvent[];
  /** 最近一轮 native computer 动作批次快照，供前端展示动作卡片与调试信息。 */
  lastComputerCalls?: ComputerCall[];
  /** 最近一轮后台任务的派生快照，由主进程基于 turn outcome 回填给前端。 */
  backgroundTask?: BackgroundTaskHandle | null;
  /** Phase 3.5 在 session 级别持久化 plan mode 状态机，兼容旧会话缺字段。 */
  planModeState?: PlanModeState | null;
  /** Phase 3 允许旧会话缺少 planState，新增会话可按需持久化计划进度。 */
  planState?: PlanState | null;
  /** Task V2: session-scoped 任务列表，独立于 Plan Mode，普通对话中自动追踪多步骤工作。 */
  tasks?: Task[];
  /** Chat run lifecycle metadata for interrupt-aware UI and persistence. */
  chatRunState?: {
    runId: string;
    status: ChatRunStatus;
    phase: ChatRunPhase;
    activeMessageId?: string;
    lastReason?: string | null;
  } | null;
  messages: ChatMessage[];
};

import type { PlanState } from "./plan";
import type { A2UiPayload } from "./ui";
import type {
  ResolvedExecutionPlan,
  SessionRuntimeIntent,
  SessionRuntimeVersion,
} from "./session-runtime";

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
  createdAt: string;
  runtimeVersion?: SessionRuntimeVersion;
  /** 持久化 session 时允许缺少 Phase 2 扩展字段，兼容旧版 runtime intent。 */
  runtimeIntent?: SessionRuntimeIntent | null;
  /** 旧会话可能没有 executionPlan；新会话落盘后应保留完整计划元数据。 */
  executionPlan?: ResolvedExecutionPlan | null;
  /** Phase 3 允许旧会话缺少 planState，新增会话可按需持久化计划进度。 */
  planState?: PlanState | null;
  messages: ChatMessage[];
};

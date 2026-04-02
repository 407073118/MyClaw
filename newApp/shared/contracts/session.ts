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

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  content: string;
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

export type ChatSession = {
  id: string;
  title: string;
  modelProfileId: string;
  attachedDirectory: string | null;
  createdAt: string;
  messages: ChatMessage[];
};

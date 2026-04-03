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

/** Content can be a plain string or multimodal array (for vision/screenshot). */
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
  messages: ChatMessage[];
};

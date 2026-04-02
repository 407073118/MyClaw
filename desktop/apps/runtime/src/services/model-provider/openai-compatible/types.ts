export type OpenAiToolCall = {
  id: string;
  name: string;
  argumentsJson: string;
  input: Record<string, unknown>;
};

export type OpenAiStepResult = {
  assistantText: string | null;
  assistantReasoning: string | null;
  toolCalls: OpenAiToolCall[];
  assistantMessage: Record<string, unknown>;
  finishReason: string | null;
};

export type OpenAiRequestMessage = Record<string, unknown>;

export type OpenAiToolCallAccumulator = {
  id: string;
  name: string;
  argumentsJson: string;
};

export type OpenAiCompatibleFlavor = "generic" | "qwen" | "qwen-coding" | "minimax";

export type OpenAiSseState = {
  contentParts: string[];
  reasoningParts: string[];
  toolCallsByIndex: Map<number, OpenAiToolCallAccumulator>;
  finishReason: string | null;
  latestContentSnapshot: string;
  latestReasoningSnapshot: string;
};

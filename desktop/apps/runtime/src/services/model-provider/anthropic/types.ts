export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

export type AnthropicStepResult = {
  assistantText: string | null;
  assistantReasoning: string | null;
  toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  assistantBlocks: Array<Record<string, unknown>>;
  finishReason: string | null;
};

export type AnthropicSseToolAccumulator = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  inputJson: string;
};

export type AnthropicSseState = {
  textParts: string[];
  reasoningParts: string[];
  toolCallsByIndex: Map<number, AnthropicSseToolAccumulator>;
  assistantBlocksByIndex: Map<number, Record<string, unknown>>;
  finishReason: string | null;
};

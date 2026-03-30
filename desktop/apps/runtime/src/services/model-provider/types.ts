import type { ChatMessage, ModelProfile } from "@myclaw-desktop/shared";

export type ChatCompletionInput = {
  profile: ModelProfile;
  messages: ChatMessage[];
};

export type ChatCompletionOutput = {
  content: string;
  reasoning?: string | null;
};

export type ModelConversationDelta = {
  content?: string;
  reasoning?: string;
};

export type ProfileConnectivityInput = {
  profile: ModelProfile;
};

export type ProfileConnectivityOutput = {
  latencyMs: number;
};

export type ProfileModelCatalogInput = {
  profile: ModelProfile;
};

export type ProfileModelCatalogOutput = {
  modelIds: string[];
};

export type ModelToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ModelToolCallResult = {
  content: string;
  stop?: boolean;
};

export type ModelConversationInput = {
  profile: ModelProfile;
  messages: ChatMessage[];
  onToolCall?: (call: ModelToolCall) => Promise<ModelToolCallResult>;
  onAssistantDelta?: (delta: ModelConversationDelta) => Promise<void> | void;
  maxToolRounds?: number;
  tools?: readonly ModelConversationToolDefinition[];
};

export type ModelConversationToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

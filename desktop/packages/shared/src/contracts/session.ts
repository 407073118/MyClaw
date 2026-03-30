import type { A2UiPayload } from "./ui";

export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  content: string;
  reasoning?: string | null;
  ui?: A2UiPayload | null;
  createdAt: string;
};

export type ChatSession = {
  id: string;
  title: string;
  modelProfileId: string;
  attachedDirectory: string | null;
  createdAt: string;
  messages: ChatMessage[];
};

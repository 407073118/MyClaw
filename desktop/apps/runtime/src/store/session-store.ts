import type { A2UiPayload, ChatMessage, ChatSession } from "@myclaw-desktop/shared";

function now(): string {
  return new Date().toISOString();
}

function createWelcomeMessage(): ChatMessage {
  return {
    id: "msg-welcome",
    role: "assistant",
    content: "运行时已就绪。当前工作区拆分为桌面 UI、运行时 API 和共享协议。",
    createdAt: now(),
  };
}

export function createSessionStore(defaultModelProfileId = "model-default"): { sessions: ChatSession[] } {
  return {
    sessions: [
      createSession({
        id: "session-default",
        title: "欢迎会话",
        modelProfileId: defaultModelProfileId,
      }),
    ],
  };
}

export function createSession(input: {
  id?: string;
  title?: string;
  modelProfileId: string;
  attachedDirectory?: string | null;
}): ChatSession {
  return {
    id: input.id ?? `session-${crypto.randomUUID()}`,
    title: input.title ?? "新对话",
    modelProfileId: input.modelProfileId,
    attachedDirectory: input.attachedDirectory ?? null,
    createdAt: now(),
    messages: [createWelcomeMessage()],
  };
}

export function prependSession(
  sessions: ChatSession[],
  input: {
    title?: string;
    modelProfileId: string;
    attachedDirectory?: string | null;
  },
): ChatSession {
  const session = createSession(input);
  sessions.unshift(session);
  return session;
}

export function removeSession(sessions: ChatSession[], sessionId: string): ChatSession | null {
  const index = sessions.findIndex((item) => item.id === sessionId);
  if (index < 0) {
    return null;
  }

  const [removed] = sessions.splice(index, 1);
  return removed ?? null;
}

export function appendUserMessage(
  sessions: ChatSession[],
  sessionId: string,
  content: string,
): ChatSession | null {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return null;

  const userMessage: ChatMessage = {
    id: `msg-user-${Date.now()}`,
    role: "user",
    content,
    createdAt: now(),
  };

  session.messages.push(userMessage);
  return session;
}

export function appendAssistantMessage(
  sessions: ChatSession[],
  sessionId: string,
  assistant: {
    content: string;
    reasoning?: string | null;
    ui?: A2UiPayload | null;
  },
): ChatSession | null {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return null;

  const assistantMessage: ChatMessage = {
    id: `msg-assistant-${Date.now()}`,
    role: "assistant",
    content: assistant.content,
    reasoning: assistant.reasoning ?? null,
    ui: assistant.ui ?? null,
    createdAt: now(),
  };

  session.messages.push(assistantMessage);
  return session;
}

export function appendConversationTurn(
  sessions: ChatSession[],
  sessionId: string,
  userContent: string,
  assistant: {
    content: string;
    reasoning?: string | null;
    ui?: A2UiPayload | null;
  },
): ChatSession | null {
  const session = appendUserMessage(sessions, sessionId, userContent);
  if (!session) return null;
  return appendAssistantMessage(sessions, sessionId, assistant);
}

export function appendSystemMessage(
  sessions: ChatSession[],
  sessionId: string,
  content: string,
): ChatSession | null {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return null;
  }

  const systemMessage: ChatMessage = {
    id: `msg-system-${session.messages.length + 1}`,
    role: "system",
    content,
    createdAt: now(),
  };

  session.messages.push(systemMessage);
  return session;
}

export function appendToolMessage(
  sessions: ChatSession[],
  sessionId: string,
  content: string,
): ChatSession | null {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return null;
  }

  const toolMessage: ChatMessage = {
    id: `msg-tool-${session.messages.length + 1}`,
    role: "tool",
    content,
    createdAt: now(),
  };

  session.messages.push(toolMessage);
  return session;
}

export function touchSession(sessions: ChatSession[], sessionId: string): ChatSession | null {
  const index = sessions.findIndex((item) => item.id === sessionId);
  if (index < 0) return null;

  const [session] = sessions.splice(index, 1);
  sessions.unshift(session);
  return session;
}

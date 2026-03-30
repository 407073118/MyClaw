import type { ApprovalPolicy, ApprovalRequest, ChatMessage, ChatSession } from "@myclaw-desktop/shared";
import type { IncomingMessage, ServerResponse } from "node:http";

export type SessionStreamPayload = {
  session: ChatSession;
  approvals?: ApprovalPolicy;
  approvalRequests?: ApprovalRequest[];
  error?: string;
  detail?: string;
};

/**
 * 判断当前聊天请求是否要求按 SSE 增量返回会话快照。
 */
export function isSessionStreamRequested(request: IncomingMessage): boolean {
  const accept = request.headers.accept;
  return typeof accept === "string" && accept.toLowerCase().includes("text/event-stream");
}

/**
 * 向桌面端写入一条 SSE 事件，供会话流式刷新使用。
 */
export function writeSessionStreamEvent(
  response: ServerResponse,
  eventName: "snapshot" | "complete" | "error",
  payload: SessionStreamPayload,
): void {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * 创建一个空白助手消息，后续通过增量写入 reasoning 与 content。
 */
export function createAssistantDraftMessage(session: ChatSession): ChatMessage {
  const message: ChatMessage = {
    id: `msg-assistant-${Date.now()}`,
    role: "assistant",
    content: "",
    reasoning: "",
    ui: null,
    createdAt: new Date().toISOString(),
  };
  session.messages.push(message);
  return message;
}

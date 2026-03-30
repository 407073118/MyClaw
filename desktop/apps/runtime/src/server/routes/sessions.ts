import type { ChatMessage, ChatSession, ModelProfile } from "@myclaw-desktop/shared";
import type { IncomingMessage } from "node:http";

import { parseAssistantReply } from "../../services/a2ui";
import type {
  ChatCompletionOutput,
  ModelConversationToolDefinition,
  ModelToolCall,
  ModelToolCallResult,
} from "../../services/model-provider";
import {
  appendAssistantMessage,
  appendSystemMessage,
  appendToolMessage,
  appendUserMessage,
  createSession,
  prependSession,
  removeSession,
} from "../../store/session-store";
import { createAssistantDraftMessage, isSessionStreamRequested, writeSessionStreamEvent } from "../http/session-stream";
import type { HttpRouter } from "../http/router";
import type { RuntimeContext } from "../runtime-context";

type SessionToolLog = { role: "system" | "tool"; content: string };

export type RegisterSessionRoutesDependencies = {
  readJsonBody: (request: IncomingMessage) => Promise<Record<string, unknown>>;
  persistState: () => Promise<void>;
  resolveSessionProfile: (session: ChatSession) => ModelProfile | null;
  refreshSkills: () => Promise<void>;
  buildModelToolDefinitions: () => ModelConversationToolDefinition[];
  buildModelSystemMessages: (input: {
    conversationMessages: ChatMessage[];
    availableTools: ModelConversationToolDefinition[];
  }) => ChatMessage[];
  executeModelToolCall: (input: {
    sessionId: string;
    call: ModelToolCall;
    logs: SessionToolLog[];
    onLog?: (log: SessionToolLog) => void | Promise<void>;
  }) => Promise<ModelToolCallResult>;
  runConversation: (input: {
    profile: ModelProfile;
    messages: ChatMessage[];
    availableTools: ModelConversationToolDefinition[];
    onToolCall: (call: ModelToolCall) => Promise<ModelToolCallResult>;
    onAssistantDelta?: (delta: { content?: string; reasoning?: string }) => Promise<void>;
  }) => Promise<ChatCompletionOutput>;
};

/**
 * 注册 sessions 相关路由。
 * 第二刀优先覆盖创建会话、删除会话、发送消息三条核心链路。
 */
export function registerSessionRoutes(
  router: HttpRouter,
  runtimeContext: RuntimeContext,
  dependencies: RegisterSessionRoutesDependencies,
): void {
  router.register("POST", "/api/sessions", async ({ request, response }) => {
    const payload = await dependencies.readJsonBody(request);
    const profile = runtimeContext.state.models.find(
      (item) => item.id === runtimeContext.state.getDefaultModelProfileId(),
    );

    if (!profile) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "default_model_not_configured" }));
      return true;
    }

    const session = prependSession(runtimeContext.state.sessions.sessions, {
      title: typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "新对话",
      modelProfileId: profile.id,
      attachedDirectory: null,
    });
    await dependencies.persistState();

    response.writeHead(201, { "content-type": "application/json" });
    response.end(JSON.stringify({ session }));
    return true;
  });

  router.registerPattern("DELETE", /^\/api\/sessions\/([^/]+)$/, async ({ response, pathMatch }) => {
    const sessionId = decodeURIComponent(pathMatch?.[1] ?? "");
    const deletedSession = removeSession(runtimeContext.state.sessions.sessions, sessionId);

    if (!deletedSession) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "session_not_found" }));
      return true;
    }

    runtimeContext.state.setApprovalRequests(
      runtimeContext.state.getApprovalRequests().filter((item) => item.sessionId !== sessionId),
    );

    if (runtimeContext.state.sessions.sessions.length === 0) {
      const fallbackModelProfileId = runtimeContext.state.getDefaultModelProfileId() ?? runtimeContext.state.models[0]?.id;
      if (!fallbackModelProfileId) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "default_model_not_configured" }));
        return true;
      }

      runtimeContext.state.sessions.sessions.push(
        createSession({
          modelProfileId: fallbackModelProfileId,
        }),
      );
    }

    await dependencies.persistState();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        deletedSessionId: sessionId,
        sessions: runtimeContext.state.sessions.sessions,
        approvalRequests: runtimeContext.state.getApprovalRequests(),
      }),
    );
    return true;
  });

  router.registerPattern("POST", /^\/api\/sessions\/([^/]+)\/messages$/, async ({ request, response, pathMatch }) => {
    const payload = await dependencies.readJsonBody(request);
    const content = typeof payload.content === "string" ? payload.content.trim() : "";
    const shouldStreamSession = isSessionStreamRequested(request);

    if (!content) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "content_required" }));
      return true;
    }

    const targetSessionId = decodeURIComponent(pathMatch?.[1] ?? "");
    const session = runtimeContext.state.sessions.sessions.find((item) => item.id === targetSessionId);
    if (!session) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "session_not_found" }));
      return true;
    }

    const profile = dependencies.resolveSessionProfile(session);
    if (!profile) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "default_model_not_configured" }));
      return true;
    }

    let userUpdatedSession: ChatSession | null = null;
    let assistantStreamMessage: ChatMessage | null = null;

    try {
      if (shouldStreamSession) {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
      }

      userUpdatedSession = appendUserMessage(runtimeContext.state.sessions.sessions, session.id, content);
      if (!userUpdatedSession) {
        if (shouldStreamSession) {
          writeSessionStreamEvent(response, "error", {
            session,
            error: "session_not_found",
            detail: "会话不存在，无法写入用户消息。",
          });
          response.end();
          return true;
        }

        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "session_not_found" }));
        return true;
      }

      const activeSession = userUpdatedSession;

      if (shouldStreamSession) {
        writeSessionStreamEvent(response, "snapshot", {
          session: activeSession,
          approvals: runtimeContext.state.getApprovals(),
          approvalRequests: runtimeContext.state.getApprovalRequests(),
        });
      }

      await dependencies.refreshSkills();
      assistantStreamMessage = shouldStreamSession ? createAssistantDraftMessage(activeSession) : null;
      const modelToolLogs: SessionToolLog[] = [];
      const availableTools = dependencies.buildModelToolDefinitions();
      const modelMessages: ChatMessage[] = [
        ...dependencies.buildModelSystemMessages({
          conversationMessages: activeSession.messages,
          availableTools,
        }),
        ...activeSession.messages,
      ];
      const streamModelToolLog = shouldStreamSession
        ? (log: SessionToolLog) => {
          if (log.role === "system") {
            appendSystemMessage(runtimeContext.state.sessions.sessions, activeSession.id, log.content);
          } else {
            appendToolMessage(runtimeContext.state.sessions.sessions, activeSession.id, log.content);
          }

          writeSessionStreamEvent(response, "snapshot", {
            session: activeSession,
            approvals: runtimeContext.state.getApprovals(),
            approvalRequests: runtimeContext.state.getApprovalRequests(),
          });
        }
        : undefined;
      const streamAssistantDelta = shouldStreamSession
        ? async (delta: { content?: string; reasoning?: string }) => {
          if (!assistantStreamMessage) {
            return;
          }

          let changed = false;
          if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
            assistantStreamMessage.reasoning = `${assistantStreamMessage.reasoning ?? ""}${delta.reasoning}`;
            changed = true;
          }
          if (typeof delta.content === "string" && delta.content.length > 0) {
            assistantStreamMessage.content = `${assistantStreamMessage.content}${delta.content}`;
            changed = true;
          }

          if (changed) {
            writeSessionStreamEvent(response, "snapshot", {
              session: activeSession,
              approvals: runtimeContext.state.getApprovals(),
              approvalRequests: runtimeContext.state.getApprovalRequests(),
            });
          }
        }
        : undefined;

      const assistantResult = await dependencies.runConversation({
        profile,
        messages: modelMessages,
        availableTools,
        onToolCall: async (call) =>
          dependencies.executeModelToolCall({
            sessionId: activeSession.id,
            call,
            logs: modelToolLogs,
            onLog: streamModelToolLog,
          }),
        onAssistantDelta: streamAssistantDelta,
      });

      if (!shouldStreamSession) {
        for (const log of modelToolLogs) {
          if (log.role === "system") {
            appendSystemMessage(runtimeContext.state.sessions.sessions, activeSession.id, log.content);
          } else {
            appendToolMessage(runtimeContext.state.sessions.sessions, activeSession.id, log.content);
          }
        }
      }

      const assistantReply = parseAssistantReply(assistantResult.content);
      let updatedSession: ChatSession | null;
      if (shouldStreamSession) {
        if (assistantStreamMessage) {
          assistantStreamMessage.reasoning = assistantResult.reasoning ?? assistantStreamMessage.reasoning ?? null;
          assistantStreamMessage.content = assistantReply.content;
          assistantStreamMessage.ui = assistantReply.ui ?? null;
        }
        updatedSession = activeSession;
      } else {
        updatedSession = appendAssistantMessage(runtimeContext.state.sessions.sessions, activeSession.id, {
          content: assistantReply.content,
          reasoning: assistantResult.reasoning ?? null,
          ui: assistantReply.ui ?? null,
        });
      }

      await dependencies.persistState();

      if (shouldStreamSession) {
        writeSessionStreamEvent(response, "complete", {
          session: updatedSession ?? userUpdatedSession,
          approvals: runtimeContext.state.getApprovals(),
          approvalRequests: runtimeContext.state.getApprovalRequests(),
        });
        response.end();
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            session: updatedSession,
            approvals: runtimeContext.state.getApprovals(),
            approvalRequests: runtimeContext.state.getApprovalRequests(),
          }),
        );
      }
    } catch (error) {
      if (shouldStreamSession && userUpdatedSession) {
        const activeSession = userUpdatedSession;
        const draftAssistantMessage = assistantStreamMessage;

        // If we created a draft assistant message but failed before any content was added, remove it.
        if (draftAssistantMessage && !draftAssistantMessage.content && !draftAssistantMessage.reasoning) {
          const index = activeSession.messages.findIndex((m) => m.id === draftAssistantMessage.id);
          if (index >= 0) {
            activeSession.messages.splice(index, 1);
          }
        }

        await dependencies.persistState();
        writeSessionStreamEvent(response, "error", {
          session: activeSession,
          approvals: runtimeContext.state.getApprovals(),
          approvalRequests: runtimeContext.state.getApprovalRequests(),
          error: "model_request_failed",
          detail: error instanceof Error ? error.message : "Unknown model request failure",
        });
        response.end();
      } else {
        response.writeHead(502, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: "model_request_failed",
            detail: error instanceof Error ? error.message : "Unknown model request failure",
          }),
        );
      }
    }

    return true;
  });
}

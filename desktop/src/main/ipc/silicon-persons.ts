import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";

import type { ChatSession, SiliconPerson } from "@shared/contracts";

import { invokeRegisteredSessionSendMessage } from "./sessions";
import { invokeRegisteredWorkflowStartRun } from "./workflows";
import type { RuntimeContext } from "../services/runtime-context";
import {
  createSiliconPersonSession,
  ensureSiliconPersonCurrentSession,
  markSiliconPersonSessionRead,
  syncSiliconPersonExecutionResult,
  switchSiliconPersonCurrentSession,
} from "../services/silicon-person-session";
import { saveSiliconPerson } from "../services/state-persistence";

/** 注册硅基员工 IPC，由主线程统一处理写入和 currentSession 路由。 */
export function registerSiliconPersonHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("silicon-person:list", async (): Promise<SiliconPerson[]> => {
    console.info("[silicon-person:list] 返回硅基员工列表", {
      count: ctx.state.siliconPersons.length,
    });
    return ctx.state.siliconPersons;
  });

  ipcMain.handle(
    "silicon-person:get",
    async (_event, siliconPersonId: string): Promise<SiliconPerson> => {
      const siliconPerson = ctx.state.siliconPersons.find((item) => item.id === siliconPersonId);
      if (!siliconPerson) {
        throw new Error(`SiliconPerson not found: ${siliconPersonId}`);
      }
      console.info("[silicon-person:get] 读取硅基员工详情", {
        siliconPersonId,
      });
      return siliconPerson;
    },
  );

  ipcMain.handle(
    "silicon-person:create",
    async (
      _event,
      input: { name: string; title?: string; description: string; [key: string]: unknown },
    ): Promise<{ siliconPerson: SiliconPerson; items: SiliconPerson[] }> => {
      const now = new Date().toISOString();
      const siliconPerson: SiliconPerson = {
        id: `sp-${randomUUID()}`,
        name: input.name.trim(),
        title: (input.title as string | undefined)?.trim() || input.name.trim(),
        description: input.description.trim(),
        status: "idle",
        source: "personal",
        approvalMode: "inherit",
        currentSessionId: null,
        sessions: [],
        unreadCount: 0,
        hasUnread: false,
        needsApproval: false,
        workflowIds: [],
        updatedAt: now,
      };

      ctx.state.siliconPersons.push(siliconPerson);
      saveSiliconPerson(ctx.runtime.paths, siliconPerson).catch((error) => {
        console.error("[silicon-person:create] 硅基员工持久化失败", {
          siliconPersonId: siliconPerson.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      console.info("[silicon-person:create] 已创建硅基员工", {
        siliconPersonId: siliconPerson.id,
        name: siliconPerson.name,
      });

      return { siliconPerson, items: [...ctx.state.siliconPersons] };
    },
  );

  ipcMain.handle(
    "silicon-person:update",
    async (
      _event,
      siliconPersonId: string,
      input: Partial<SiliconPerson>,
    ): Promise<{ siliconPerson: SiliconPerson }> => {
      const index = ctx.state.siliconPersons.findIndex((item) => item.id === siliconPersonId);
      if (index === -1) {
        throw new Error(`SiliconPerson not found: ${siliconPersonId}`);
      }

      const current = ctx.state.siliconPersons[index]!;
      const siliconPerson: SiliconPerson = {
        ...current,
        ...input,
        id: siliconPersonId,
        updatedAt: new Date().toISOString(),
      };
      ctx.state.siliconPersons[index] = siliconPerson;

      saveSiliconPerson(ctx.runtime.paths, siliconPerson).catch((error) => {
        console.error("[silicon-person:update] 硅基员工持久化失败", {
          siliconPersonId,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      console.info("[silicon-person:update] 已更新硅基员工", {
        siliconPersonId,
      });

      return { siliconPerson };
    },
  );

  ipcMain.handle(
    "silicon-person:create-session",
    async (
      _event,
      siliconPersonId: string,
      input?: { title?: string },
    ): Promise<{ siliconPerson: SiliconPerson; session: ChatSession }> => {
      console.info("[silicon-person:create-session] 请求新建硅基员工会话", {
        siliconPersonId,
        title: input?.title?.trim() || null,
      });
      return createSiliconPersonSession(ctx, {
        siliconPersonId,
        title: input?.title,
      });
    },
  );

  ipcMain.handle(
    "silicon-person:switch-session",
    async (
      _event,
      siliconPersonId: string,
      sessionId: string,
    ): Promise<{ siliconPerson: SiliconPerson; session: ChatSession }> => {
      console.info("[silicon-person:switch-session] 请求切换硅基员工 currentSession", {
        siliconPersonId,
        sessionId,
      });
      return switchSiliconPersonCurrentSession(ctx, {
        siliconPersonId,
        sessionId,
      });
    },
  );

  ipcMain.handle(
    "silicon-person:mark-session-read",
    async (
      _event,
      siliconPersonId: string,
      sessionId: string,
    ): Promise<{ siliconPerson: SiliconPerson; session: ChatSession }> => {
      console.info("[silicon-person:mark-session-read] 请求消费硅基员工会话未读", {
        siliconPersonId,
        sessionId,
      });
      return markSiliconPersonSessionRead(ctx, {
        siliconPersonId,
        sessionId,
      });
    },
  );

  ipcMain.handle(
    "silicon-person:send-message",
    async (
      _event,
      siliconPersonId: string,
      input: { content: string },
    ): Promise<{ siliconPerson: SiliconPerson; session: ChatSession }> => {
      console.info("[silicon-person:send-message] 请求路由硅基员工消息", {
        siliconPersonId,
        contentLength: input.content.length,
      });

      const { siliconPerson, session } = await ensureSiliconPersonCurrentSession(ctx, {
        siliconPersonId,
      });

      console.info("[silicon-person:send-message] 已解析 currentSession，转入共享会话执行链", {
        siliconPersonId,
        sessionId: session.id,
      });

      const payload = await invokeRegisteredSessionSendMessage(session.id, {
        content: input.content,
      });
      const syncedSiliconPerson = await syncSiliconPersonExecutionResult(ctx, {
        siliconPersonId: siliconPerson.id,
        session: payload.session,
        forceCurrentSession: true,
      });

      return {
        siliconPerson: syncedSiliconPerson,
        session: payload.session,
      };
    },
  );

  ipcMain.handle(
    "silicon-person:start-workflow-run",
    async (
      _event,
      siliconPersonId: string,
      workflowId: string,
    ): Promise<{ siliconPerson: SiliconPerson; session: ChatSession; runId: string }> => {
      console.info("[silicon-person:start-workflow-run] 请求为硅基员工启动工作流", {
        siliconPersonId,
        workflowId,
      });

      const { siliconPerson, session } = await ensureSiliconPersonCurrentSession(ctx, {
        siliconPersonId,
      });
      if (!siliconPerson.workflowIds.includes(workflowId)) {
        throw new Error(`Workflow ${workflowId} is not bound to SiliconPerson ${siliconPersonId}`);
      }

      const payload = await invokeRegisteredWorkflowStartRun({
        workflowId,
        initialState: {
          siliconPersonId: siliconPerson.id,
          sessionId: session.id,
        },
      });
      const latestSiliconPerson = ctx.state.siliconPersons.find((item) => item.id === siliconPerson.id) ?? siliconPerson;
      const latestSession = ctx.state.sessions.find((item) => item.id === session.id) ?? session;

      console.info("[silicon-person:start-workflow-run] 已通过共享工作流运行时启动 run", {
        siliconPersonId,
        workflowId,
        sessionId: latestSession.id,
        runId: payload.runId,
      });

      return {
        siliconPerson: latestSiliconPerson,
        session: latestSession,
        runId: payload.runId,
      };
    },
  );
}

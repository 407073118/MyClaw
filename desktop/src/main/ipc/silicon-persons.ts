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
  resolveSiliconPersonApprovalPolicy,
  syncSiliconPersonExecutionResult,
  switchSiliconPersonCurrentSession,
} from "../services/silicon-person-session";
import type { McpServer, SkillDefinition } from "@shared/contracts";
import { saveSiliconPerson } from "../services/state-persistence";
import { initializeWorkspaceDirectories, getOrCreateWorkspace, refreshWorkspaceSkills } from "../services/silicon-person-workspace";
import { deriveSiliconPersonPaths } from "../services/directory-service";

// ---------------------------------------------------------------------------
// 每个硅基员工独立的消息队列：同一个人排队串行，不同人并发执行
// ---------------------------------------------------------------------------

interface QueuedMessage {
  content: string;
}

const spMessageQueues = new Map<string, QueuedMessage[]>();
const spQueueRunning = new Set<string>();

/** 入队一条消息，如果该员工当前空闲则立即启动消费循环。 */
function enqueueSiliconPersonMessage(
  ctx: RuntimeContext,
  siliconPersonId: string,
  content: string,
): void {
  let queue = spMessageQueues.get(siliconPersonId);
  if (!queue) {
    queue = [];
    spMessageQueues.set(siliconPersonId, queue);
  }
  queue.push({ content });

  if (!spQueueRunning.has(siliconPersonId)) {
    void drainSiliconPersonQueue(ctx, siliconPersonId);
  }
}

/** 串行消费指定员工的消息队列，直到队列为空。 */
async function drainSiliconPersonQueue(
  ctx: RuntimeContext,
  siliconPersonId: string,
): Promise<void> {
  if (spQueueRunning.has(siliconPersonId)) return;
  spQueueRunning.add(siliconPersonId);

  try {
    const queue = spMessageQueues.get(siliconPersonId);
    while (queue && queue.length > 0) {
      const message = queue.shift()!;
      try {
        console.info("[silicon-person-queue] 开始执行消息", {
          siliconPersonId,
          contentLength: message.content.length,
          remaining: queue.length,
        });

        const { siliconPerson, session } = await ensureSiliconPersonCurrentSession(ctx, {
          siliconPersonId,
        });

        const payload = await invokeRegisteredSessionSendMessage(session.id, {
          content: message.content,
        });

        await syncSiliconPersonExecutionResult(ctx, {
          siliconPersonId: siliconPerson.id,
          session: payload.session,
          forceCurrentSession: true,
        });

        console.info("[silicon-person-queue] 消息执行完成", {
          siliconPersonId,
          sessionId: session.id,
          remaining: queue.length,
        });
      } catch (error) {
        console.error("[silicon-person-queue] 消息执行失败", {
          siliconPersonId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    spQueueRunning.delete(siliconPersonId);
    // 防止 finally 和新入队之间的竞态
    const queue = spMessageQueues.get(siliconPersonId);
    if (queue && queue.length > 0) {
      void drainSiliconPersonQueue(ctx, siliconPersonId);
    }
  }
}

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
        baseIdentity: (input.baseIdentity as string | undefined)?.trim() || undefined,
        rolePersona: (input.rolePersona as string | undefined)?.trim() || undefined,
        soul: (input.soul as string | undefined)?.trim() || undefined,
        modelBindingSnapshot: (input.modelBindingSnapshot as SiliconPerson["modelBindingSnapshot"]) ?? null,
        updatedAt: now,
      };

      // 初始化员工独立工作空间目录（skills/、sessions/、内置技能种子）
      initializeWorkspaceDirectories(ctx.runtime.paths, siliconPerson.id);

      ctx.state.siliconPersons.push(siliconPerson);
      try {
        await saveSiliconPerson(ctx.runtime.paths, siliconPerson);
      } catch (error) {
        // 写盘失败：回滚内存状态
        const rollbackIdx = ctx.state.siliconPersons.findIndex((item) => item.id === siliconPerson.id);
        if (rollbackIdx !== -1) ctx.state.siliconPersons.splice(rollbackIdx, 1);
        console.error("[silicon-person:create] 硅基员工持久化失败，已回滚内存", {
          siliconPersonId: siliconPerson.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error("硅基员工创建失败：持久化异常");
      }

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

      try {
        await saveSiliconPerson(ctx.runtime.paths, siliconPerson);
      } catch (error) {
        // 写盘失败：回滚内存状态
        ctx.state.siliconPersons[index] = current;
        console.error("[silicon-person:update] 硅基员工持久化失败，已回滚内存", {
          siliconPersonId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error("硅基员工更新失败：持久化异常");
      }

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

  /** fire-and-forget：入队后立即返回，后台按队列串行执行。 */
  ipcMain.handle(
    "silicon-person:send-message",
    async (
      _event,
      siliconPersonId: string,
      input: { content: string },
    ): Promise<{ dispatched: true; siliconPersonId: string }> => {
      console.info("[silicon-person:send-message] 消息已入队（fire-and-forget）", {
        siliconPersonId,
        contentLength: input.content.length,
      });

      enqueueSiliconPersonMessage(ctx, siliconPersonId, input.content);

      return { dispatched: true, siliconPersonId };
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

  /** 获取硅基员工工作空间路径信息。 */
  ipcMain.handle(
    "silicon-person:get-paths",
    async (_event, siliconPersonId: string): Promise<{ personDir: string; skillsDir: string; sessionsDir: string }> => {
      const personPaths = deriveSiliconPersonPaths(ctx.runtime.paths, siliconPersonId);
      return {
        personDir: personPaths.personDir,
        skillsDir: personPaths.skillsDir,
        sessionsDir: personPaths.sessionsDir,
      };
    },
  );

  // ---- 硅基员工独立资源查询 ----

  /** 获取硅基员工自己的技能列表。 */
  ipcMain.handle(
    "silicon-person:list-skills",
    async (_event, siliconPersonId: string): Promise<{ items: SkillDefinition[] }> => {
      const workspace = await getOrCreateWorkspace(ctx.runtime.paths, siliconPersonId);
      return { items: workspace.skills };
    },
  );

  /** 刷新硅基员工的技能列表（重新从磁盘加载）。 */
  ipcMain.handle(
    "silicon-person:refresh-skills",
    async (_event, siliconPersonId: string): Promise<{ items: SkillDefinition[] }> => {
      const workspace = await getOrCreateWorkspace(ctx.runtime.paths, siliconPersonId);
      const skills = refreshWorkspaceSkills(workspace);
      return { items: skills };
    },
  );

  /** 获取硅基员工自己的 MCP 服务列表。 */
  ipcMain.handle(
    "silicon-person:list-mcp-servers",
    async (_event, siliconPersonId: string): Promise<{ servers: McpServer[] }> => {
      const workspace = await getOrCreateWorkspace(ctx.runtime.paths, siliconPersonId);
      return { servers: workspace.mcpManager.listServers() };
    },
  );
}

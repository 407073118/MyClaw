import { randomUUID } from "node:crypto";

import type {
  ChatRunStatus,
  ChatSession,
  SiliconPerson,
  SiliconPersonSessionSummary,
  SiliconPersonStatus,
} from "@shared/contracts";
import {
  SESSION_RUNTIME_VERSION,
  resolveSiliconPersonCurrentSessionId,
} from "@shared/contracts";

import type { RuntimeContext } from "./runtime-context";
import { saveSession, saveSiliconPerson } from "./state-persistence";

/** 统一构建硅基员工会话摘要，避免各层重复拼装状态字段。 */
function buildSiliconPersonSessionSummary(input: {
  session: ChatSession;
  status: SiliconPersonStatus;
  unreadCount?: number;
  hasUnread?: boolean;
  needsApproval?: boolean;
}): SiliconPersonSessionSummary {
  return {
    id: input.session.id,
    title: input.session.title,
    status: input.status,
    unreadCount: input.unreadCount ?? 0,
    hasUnread: input.hasUnread ?? false,
    needsApproval: input.needsApproval ?? false,
    updatedAt: input.session.messages.at(-1)?.createdAt ?? input.session.createdAt,
  };
}

/** 读取指定硅基员工，不存在时直接抛错，保证主线程写入口语义收敛。 */
function requireSiliconPerson(ctx: RuntimeContext, siliconPersonId: string): SiliconPerson {
  const siliconPerson = ctx.state.siliconPersons.find((item) => item.id === siliconPersonId);
  if (!siliconPerson) {
    throw new Error(`SiliconPerson not found: ${siliconPersonId}`);
  }
  return siliconPerson;
}

/** 校验会话归属，避免不同硅基员工共享 currentSession。 */
function assertSiliconPersonSessionOwner(
  session: ChatSession,
  siliconPersonId: string,
): void {
  if (session.siliconPersonId && session.siliconPersonId !== siliconPersonId) {
    throw new Error(`Session ${session.id} does not belong to SiliconPerson ${siliconPersonId}`);
  }
}

/** 统一创建归属到硅基员工的新会话，确保 currentSession 只在受控入口切换。 */
function buildSiliconPersonSession(
  ctx: RuntimeContext,
  input: {
    siliconPerson: SiliconPerson;
    title?: string;
    fallbackTitle: string;
  },
): ChatSession {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: input.title?.trim() || input.fallbackTitle,
    modelProfileId: ctx.state.getDefaultModelProfileId() ?? "",
    attachedDirectory: null,
    createdAt: now,
    runtimeVersion: SESSION_RUNTIME_VERSION,
    siliconPersonId: input.siliconPerson.id,
    messages: [],
  };
}

/** 把聊天运行态映射为硅基员工状态，避免 renderer 侧重复理解 session 语义。 */
function mapChatRunStatusToSiliconPersonStatus(
  chatRunStatus: ChatRunStatus | undefined,
): SiliconPersonStatus {
  switch (chatRunStatus) {
    case "completed":
      return "done";
    case "failed":
      return "error";
    case "canceling":
      return "canceling";
    case "canceled":
      return "canceled";
    case "running":
      return "running";
    default:
      return "idle";
  }
}

/** 读取某个会话在硅基员工摘要里的现有状态，便于只更新未读等派生字段。 */
function readExistingSiliconPersonSessionSummary(input: {
  siliconPerson: SiliconPerson;
  sessionId: string;
}): SiliconPersonSessionSummary | null {
  return input.siliconPerson.sessions.find((item) => item.id === input.sessionId) ?? null;
}

/** 按会话最终执行结果回写硅基员工摘要，统一 done/unread/approval 的最小语义。 */
export async function syncSiliconPersonExecutionResult(
  ctx: RuntimeContext,
  input: {
    siliconPersonId: string;
    session: ChatSession;
    forceCurrentSession?: boolean;
  },
): Promise<SiliconPerson> {
  const pendingApprovals = ctx.state.getApprovalRequests()
    .filter((request) => request.sessionId === input.session.id);
  const needsApproval = pendingApprovals.length > 0;
  const status = needsApproval
    ? "needs_approval"
    : mapChatRunStatusToSiliconPersonStatus(input.session.chatRunState?.status);
  const lastMessage = input.session.messages.at(-1);
  const hasUnread = lastMessage?.role === "assistant" || lastMessage?.role === "tool";
  const unreadCount = hasUnread ? 1 : 0;

  console.info("[silicon-person-session] 按执行结果回写硅基员工摘要", {
    siliconPersonId: input.siliconPersonId,
    sessionId: input.session.id,
    chatRunStatus: input.session.chatRunState?.status ?? null,
    status,
    unreadCount,
    needsApproval,
  });

  return syncSiliconPersonSessionSummary(ctx, {
    siliconPersonId: input.siliconPersonId,
    session: input.session,
    status,
    unreadCount,
    hasUnread,
    needsApproval,
    forceCurrentSession: input.forceCurrentSession ?? false,
  });
}

/** 把会话状态同步回硅基员工摘要列表，并按规则维护 currentSession。 */
export async function syncSiliconPersonSessionSummary(
  ctx: RuntimeContext,
  input: {
    siliconPersonId: string;
    session: ChatSession;
    status: SiliconPersonStatus;
    unreadCount?: number;
    hasUnread?: boolean;
    needsApproval?: boolean;
    forceCurrentSession?: boolean;
  },
): Promise<SiliconPerson> {
  const siliconPerson = requireSiliconPerson(ctx, input.siliconPersonId);
  const summary = buildSiliconPersonSessionSummary({
    session: input.session,
    status: input.status,
    unreadCount: input.unreadCount,
    hasUnread: input.hasUnread,
    needsApproval: input.needsApproval,
  });
  const nextSessions = siliconPerson.sessions.filter((item) => item.id !== summary.id);
  nextSessions.push(summary);
  nextSessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  siliconPerson.sessions = nextSessions;
  siliconPerson.status = input.status;
  siliconPerson.unreadCount = nextSessions.reduce((total, item) => total + item.unreadCount, 0);
  siliconPerson.hasUnread = nextSessions.some((item) => item.hasUnread);
  siliconPerson.needsApproval = nextSessions.some((item) => item.needsApproval);
  siliconPerson.currentSessionId = input.forceCurrentSession
    ? input.session.id
    : resolveSiliconPersonCurrentSessionId({
      currentSessionId: siliconPerson.currentSessionId,
      sessions: nextSessions,
    });
  siliconPerson.updatedAt = new Date().toISOString();

  console.info("[silicon-person-session] 同步硅基员工会话摘要", {
    siliconPersonId: siliconPerson.id,
    sessionId: input.session.id,
    status: input.status,
    forceCurrentSession: input.forceCurrentSession ?? false,
  });
  await saveSiliconPerson(ctx.runtime.paths, siliconPerson);
  return siliconPerson;
}

/** 手动新建硅基员工会话，并把它设为 currentSession。 */
export async function createSiliconPersonSession(
  ctx: RuntimeContext,
  input: {
    siliconPersonId: string;
    title?: string;
  },
): Promise<{ siliconPerson: SiliconPerson; session: ChatSession }> {
  const siliconPerson = requireSiliconPerson(ctx, input.siliconPersonId);
  const session = buildSiliconPersonSession(ctx, {
    siliconPerson,
    title: input.title,
    fallbackTitle: `${siliconPerson.title || siliconPerson.name} 新会话`,
  });
  ctx.state.sessions.push(session);

  console.info("[silicon-person-session] 手动新建会话", {
    siliconPersonId: siliconPerson.id,
    sessionId: session.id,
    title: session.title,
  });

  await saveSession(ctx.runtime.paths, session);
  const syncedSiliconPerson = await syncSiliconPersonSessionSummary(ctx, {
    siliconPersonId: siliconPerson.id,
    session,
    status: siliconPerson.status,
    unreadCount: 0,
    hasUnread: false,
    needsApproval: false,
    forceCurrentSession: true,
  });

  return { siliconPerson: syncedSiliconPerson, session };
}

/** 没有 currentSession 时自动创建默认会话；已有时只复用，不主动切换。 */
export async function ensureSiliconPersonCurrentSession(
  ctx: RuntimeContext,
  input: {
    siliconPersonId: string;
    title?: string;
  },
): Promise<{ siliconPerson: SiliconPerson; session: ChatSession; created: boolean }> {
  const siliconPerson = requireSiliconPerson(ctx, input.siliconPersonId);
  const currentSessionId = resolveSiliconPersonCurrentSessionId({
    currentSessionId: siliconPerson.currentSessionId,
    sessions: siliconPerson.sessions,
  });
  const currentSession = currentSessionId
    ? ctx.state.sessions.find((item) => item.id === currentSessionId)
    : null;

  if (currentSession) {
    assertSiliconPersonSessionOwner(currentSession, siliconPerson.id);
    const syncedSiliconPerson = await syncSiliconPersonSessionSummary(ctx, {
      siliconPersonId: siliconPerson.id,
      session: currentSession,
      status: siliconPerson.status,
      unreadCount: siliconPerson.unreadCount,
      hasUnread: siliconPerson.hasUnread,
      needsApproval: siliconPerson.needsApproval,
      forceCurrentSession: true,
    });
    return { siliconPerson: syncedSiliconPerson, session: currentSession, created: false };
  }

  console.info("[silicon-person-session] 首次自动创建 currentSession", {
    siliconPersonId: siliconPerson.id,
  });
  const created = await createSiliconPersonSession(ctx, {
    siliconPersonId: siliconPerson.id,
    title: input.title?.trim() || `${siliconPerson.title || siliconPerson.name} 默认会话`,
  });
  return {
    ...created,
    created: true,
  };
}

/** 显式切换 currentSession，只允许切换到当前硅基员工自己的会话。 */
export async function switchSiliconPersonCurrentSession(
  ctx: RuntimeContext,
  input: {
    siliconPersonId: string;
    sessionId: string;
  },
): Promise<{ siliconPerson: SiliconPerson; session: ChatSession }> {
  const siliconPerson = requireSiliconPerson(ctx, input.siliconPersonId);
  const session = ctx.state.sessions.find((item) => item.id === input.sessionId);
  if (!session) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }
  assertSiliconPersonSessionOwner(session, siliconPerson.id);

  console.info("[silicon-person-session] 手动切换 currentSession", {
    siliconPersonId: siliconPerson.id,
    sessionId: session.id,
  });

  const syncedSiliconPerson = await syncSiliconPersonSessionSummary(ctx, {
    siliconPersonId: siliconPerson.id,
    session,
    status: siliconPerson.status,
    unreadCount: siliconPerson.unreadCount,
    hasUnread: siliconPerson.hasUnread,
    needsApproval: siliconPerson.needsApproval,
    forceCurrentSession: true,
  });

  return { siliconPerson: syncedSiliconPerson, session };
}

/** 将指定硅基员工会话标记为已读，只消费 unread，不改变 currentSession 规则。 */
export async function markSiliconPersonSessionRead(
  ctx: RuntimeContext,
  input: {
    siliconPersonId: string;
    sessionId: string;
  },
): Promise<{ siliconPerson: SiliconPerson; session: ChatSession }> {
  const siliconPerson = requireSiliconPerson(ctx, input.siliconPersonId);
  const session = ctx.state.sessions.find((item) => item.id === input.sessionId);
  if (!session) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }
  assertSiliconPersonSessionOwner(session, siliconPerson.id);

  const existingSummary = readExistingSiliconPersonSessionSummary({
    siliconPerson,
    sessionId: session.id,
  });
  const preservedStatus = existingSummary?.status
    ?? mapChatRunStatusToSiliconPersonStatus(session.chatRunState?.status);
  const preservedNeedsApproval = existingSummary?.needsApproval ?? false;
  const shouldPreserveCurrentSession = siliconPerson.currentSessionId === session.id;

  console.info("[silicon-person-session] 标记会话已读", {
    siliconPersonId: siliconPerson.id,
    sessionId: session.id,
    preservedStatus,
    preservedNeedsApproval,
    preserveCurrentSession: shouldPreserveCurrentSession,
  });

  const syncedSiliconPerson = await syncSiliconPersonSessionSummary(ctx, {
    siliconPersonId: siliconPerson.id,
    session,
    status: preservedStatus,
    unreadCount: 0,
    hasUnread: false,
    needsApproval: preservedNeedsApproval,
    forceCurrentSession: shouldPreserveCurrentSession,
  });

  return { siliconPerson: syncedSiliconPerson, session };
}

/** 把消息优先路由到 currentSession，后续完整执行链仍交给通用 session 主链路。 */
export async function routeMessageToSiliconPersonCurrentSession(
  ctx: RuntimeContext,
  input: {
    siliconPersonId: string;
    content: string;
  },
): Promise<{ siliconPerson: SiliconPerson; session: ChatSession }> {
  const { siliconPerson, session } = await ensureSiliconPersonCurrentSession(ctx, {
    siliconPersonId: input.siliconPersonId,
  });
  const now = new Date().toISOString();

  console.info("[silicon-person-session] 路由消息到 currentSession", {
    siliconPersonId: siliconPerson.id,
    sessionId: session.id,
    contentLength: input.content.length,
  });

  session.messages.push({
    id: randomUUID(),
    role: "user",
    content: input.content,
    createdAt: now,
  });
  session.siliconPersonId = siliconPerson.id;
  await saveSession(ctx.runtime.paths, session);

  const syncedSiliconPerson = await syncSiliconPersonSessionSummary(ctx, {
    siliconPersonId: siliconPerson.id,
    session,
    status: "running",
    unreadCount: 0,
    hasUnread: false,
    needsApproval: false,
    forceCurrentSession: true,
  });

  return { siliconPerson: syncedSiliconPerson, session };
}

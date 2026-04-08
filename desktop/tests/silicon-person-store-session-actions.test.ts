/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession, SiliconPerson } from "@shared/contracts";

function buildSession(input: Partial<ChatSession> & Pick<ChatSession, "id" | "title">): ChatSession {
  return {
    id: input.id,
    title: input.title,
    modelProfileId: input.modelProfileId ?? "model-1",
    attachedDirectory: input.attachedDirectory ?? null,
    createdAt: input.createdAt ?? "2026-04-08T00:00:00.000Z",
    messages: input.messages ?? [],
    tasks: input.tasks,
    runtimeVersion: input.runtimeVersion ?? 2,
    siliconPersonId: input.siliconPersonId,
  };
}

function buildSiliconPerson(input?: Partial<SiliconPerson>): SiliconPerson {
  return {
    id: input?.id ?? "sp-1",
    name: input?.name ?? "Ada",
    title: input?.title ?? "研究搭档",
    description: input?.description ?? "负责承接主聊天分发，并在私域空间内持续推进任务。",
    status: input?.status ?? "idle",
    source: input?.source ?? "personal",
    approvalMode: input?.approvalMode ?? "inherit",
    currentSessionId: input?.currentSessionId ?? "session-1",
    sessions: input?.sessions ?? [
      {
        id: "session-1",
        title: "默认会话",
        status: "done",
        unreadCount: 0,
        hasUnread: false,
        needsApproval: false,
        updatedAt: "2026-04-08T00:00:00.000Z",
      },
    ],
    unreadCount: input?.unreadCount ?? 0,
    hasUnread: input?.hasUnread ?? false,
    needsApproval: input?.needsApproval ?? false,
    workflowIds: input?.workflowIds ?? [],
    updatedAt: input?.updatedAt ?? "2026-04-08T00:00:00.000Z",
  };
}

describe("workspace silicon person session actions", () => {
  const createSiliconPersonSession = vi.fn();
  const switchSiliconPersonSession = vi.fn();
  const sendSiliconPersonMessage = vi.fn();
  const startSiliconPersonWorkflowRun = vi.fn();
  const markSiliconPersonSessionRead = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    createSiliconPersonSession.mockReset();
    switchSiliconPersonSession.mockReset();
    sendSiliconPersonMessage.mockReset();
    startSiliconPersonWorkflowRun.mockReset();
    markSiliconPersonSessionRead.mockReset();

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        createSiliconPersonSession,
        switchSiliconPersonSession,
        sendSiliconPersonMessage,
        startSiliconPersonWorkflowRun,
        markSiliconPersonSessionRead,
      },
    });
  });

  afterEach(() => {
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("syncs manual silicon person session creation into the local registries", async () => {
    const session1 = buildSession({
      id: "session-1",
      title: "默认会话",
      siliconPersonId: "sp-1",
    });
    const session2 = buildSession({
      id: "session-2",
      title: "跟进会话",
      siliconPersonId: "sp-1",
    });
    const siliconPerson = buildSiliconPerson({
      currentSessionId: "session-1",
      sessions: [
        {
          id: "session-1",
          title: "默认会话",
          status: "done",
          unreadCount: 0,
          hasUnread: false,
          needsApproval: false,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
      ],
    });

    createSiliconPersonSession.mockResolvedValue({
      siliconPerson: {
        ...siliconPerson,
        currentSessionId: "session-2",
        sessions: [
          {
            id: "session-2",
            title: "跟进会话",
            status: "running",
            unreadCount: 0,
            hasUnread: false,
            needsApproval: false,
            updatedAt: "2026-04-08T01:00:00.000Z",
          },
          ...siliconPerson.sessions,
        ],
      },
      session: session2,
    });

    const { useWorkspaceStore } = await import("../src/renderer/stores/workspace");
    useWorkspaceStore.setState({
      siliconPersons: [siliconPerson],
      sessions: [session1],
    });

    const created = await useWorkspaceStore.getState().createSiliconPersonSession("sp-1", {
      title: "跟进会话",
    });

    expect(createSiliconPersonSession).toHaveBeenCalledWith("sp-1", { title: "跟进会话" });
    expect(created.id).toBe("session-2");
    expect(useWorkspaceStore.getState().siliconPersons[0]?.currentSessionId).toBe("session-2");
    expect(useWorkspaceStore.getState().sessions.map((item) => item.id)).toContain("session-2");
  });

  it("routes silicon person messages through the current session payload returned by preload", async () => {
    const session1 = buildSession({
      id: "session-1",
      title: "默认会话",
      siliconPersonId: "sp-1",
    });
    const routedSession = buildSession({
      id: "session-1",
      title: "默认会话",
      siliconPersonId: "sp-1",
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "请先拆解任务",
          createdAt: "2026-04-08T02:00:00.000Z",
        },
      ],
    });
    const siliconPerson = buildSiliconPerson();

    sendSiliconPersonMessage.mockResolvedValue({
      siliconPerson: {
        ...siliconPerson,
        status: "running",
      },
      session: routedSession,
    });

    const { useWorkspaceStore } = await import("../src/renderer/stores/workspace");
    useWorkspaceStore.setState({
      siliconPersons: [siliconPerson],
      sessions: [session1],
    });

    const session = await useWorkspaceStore.getState().sendSiliconPersonMessage("sp-1", "请先拆解任务");

    expect(sendSiliconPersonMessage).toHaveBeenCalledWith("sp-1", "请先拆解任务");
    expect(session.messages).toHaveLength(1);
    expect(useWorkspaceStore.getState().sessions.find((item) => item.id === "session-1")?.messages).toHaveLength(1);
    expect(useWorkspaceStore.getState().siliconPersons[0]?.status).toBe("running");
  });

  it("switches the silicon person current session using the explicit preload payload", async () => {
    const session1 = buildSession({
      id: "session-1",
      title: "默认会话",
      siliconPersonId: "sp-1",
    });
    const session2 = buildSession({
      id: "session-2",
      title: "复盘会话",
      siliconPersonId: "sp-1",
    });
    const siliconPerson = buildSiliconPerson({
      sessions: [
        {
          id: "session-1",
          title: "默认会话",
          status: "done",
          unreadCount: 0,
          hasUnread: false,
          needsApproval: false,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
        {
          id: "session-2",
          title: "复盘会话",
          status: "done",
          unreadCount: 0,
          hasUnread: false,
          needsApproval: false,
          updatedAt: "2026-04-08T03:00:00.000Z",
        },
      ],
    });

    switchSiliconPersonSession.mockResolvedValue({
      siliconPerson: {
        ...siliconPerson,
        currentSessionId: "session-2",
      },
      session: session2,
    });

    const { useWorkspaceStore } = await import("../src/renderer/stores/workspace");
    useWorkspaceStore.setState({
      siliconPersons: [siliconPerson],
      sessions: [session1, session2],
    });

    const switched = await useWorkspaceStore.getState().switchSiliconPersonSession("sp-1", "session-2");

    expect(switchSiliconPersonSession).toHaveBeenCalledWith("sp-1", "session-2");
    expect(switched.id).toBe("session-2");
    expect(useWorkspaceStore.getState().siliconPersons[0]?.currentSessionId).toBe("session-2");
  });

  it("starts a silicon person workflow run and merges the ensured session payload into local store", async () => {
    const session1 = buildSession({
      id: "session-1",
      title: "默认会话",
      siliconPersonId: "sp-1",
      tasks: [
        {
          id: "task-1",
          subject: "拆解任务",
          description: "由工作流驱动",
          status: "pending",
          blocks: [],
          blockedBy: [],
        },
      ],
    });
    const siliconPerson = buildSiliconPerson({
      workflowIds: ["workflow-1"],
    });

    startSiliconPersonWorkflowRun.mockResolvedValue({
      siliconPerson,
      session: session1,
      runId: "workflow-run-1",
    });

    const { useWorkspaceStore } = await import("../src/renderer/stores/workspace");
    useWorkspaceStore.setState({
      siliconPersons: [siliconPerson],
      sessions: [],
      workflowRuns: {},
    });

    const payload = await useWorkspaceStore.getState().startSiliconPersonWorkflowRun("sp-1", "workflow-1");

    expect(startSiliconPersonWorkflowRun).toHaveBeenCalledWith("sp-1", "workflow-1");
    expect(payload.runId).toBe("workflow-run-1");
    expect(useWorkspaceStore.getState().sessions.find((item) => item.id === "session-1")?.tasks).toHaveLength(1);
    expect(useWorkspaceStore.getState().workflowRuns["workflow-run-1"]).toMatchObject({
      id: "workflow-run-1",
      workflowId: "workflow-1",
      status: "running",
    });
  });

  it("marks a silicon person session as read without changing currentSession", async () => {
    const session1 = buildSession({
      id: "session-1",
      title: "榛樿浼氳瘽",
      siliconPersonId: "sp-1",
    });
    const session2 = buildSession({
      id: "session-2",
      title: "鏂扮殑浼氳瘽",
      siliconPersonId: "sp-1",
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "宸茶",
          createdAt: "2026-04-08T04:00:00.000Z",
        },
      ],
    });
    const siliconPerson = buildSiliconPerson({
      currentSessionId: "session-1",
      sessions: [
        {
          id: "session-1",
          title: "榛樿浼氳瘽",
          status: "done",
          unreadCount: 2,
          hasUnread: true,
          needsApproval: false,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
        {
          id: "session-2",
          title: "鏂扮殑浼氳瘽",
          status: "done",
          unreadCount: 1,
          hasUnread: true,
          needsApproval: false,
          updatedAt: "2026-04-08T04:00:00.000Z",
        },
      ],
    });
    const workflowRuns = {
      "workflow-run-1": {
        id: "workflow-run-1",
        workflowId: "workflow-1",
        status: "running",
      },
    };

    markSiliconPersonSessionRead.mockResolvedValue({
      siliconPerson: {
        ...siliconPerson,
        sessions: siliconPerson.sessions.map((item) =>
          item.id === "session-2"
            ? {
                ...item,
                unreadCount: 0,
                hasUnread: false,
              }
            : item,
        ),
      },
      session: {
        ...session2,
        tasks: [
          {
            id: "task-1",
            subject: "mark read",
            description: "do not change currentSession",
            status: "done",
            blocks: [],
            blockedBy: [],
          },
        ],
      },
    });

    const { useWorkspaceStore } = await import("../src/renderer/stores/workspace");
    useWorkspaceStore.setState({
      siliconPersons: [siliconPerson],
      sessions: [session1, session2],
      workflowRuns,
      activeSessionId: "session-1",
    });

    const readSession = await useWorkspaceStore.getState().markSiliconPersonSessionRead("sp-1", "session-2");

    expect(markSiliconPersonSessionRead).toHaveBeenCalledWith("sp-1", "session-2");
    expect(readSession.id).toBe("session-2");
    expect(useWorkspaceStore.getState().currentSession?.id).toBe("session-1");
    expect(useWorkspaceStore.getState().siliconPersons[0]?.sessions.find((item) => item.id === "session-2")).toMatchObject({
      unreadCount: 0,
      hasUnread: false,
    });
    expect(useWorkspaceStore.getState().workflowRuns).toBe(workflowRuns);
    expect(useWorkspaceStore.getState().workflowRuns["workflow-run-1"]).toMatchObject({
      id: "workflow-run-1",
      workflowId: "workflow-1",
      status: "running",
    });
  });
});

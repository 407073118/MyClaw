import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatSession, SiliconPerson } from "@shared/contracts";
import type { RuntimeContext } from "../src/main/services/runtime-context";

const saveSessionMock = vi.fn();
const saveSiliconPersonMock = vi.fn();

vi.mock("../src/main/services/state-persistence", () => ({
  saveSession: saveSessionMock,
  saveSiliconPerson: saveSiliconPersonMock,
}));

/** 构造最小 RuntimeContext，用来验证硅基员工 session 的 currentSession 路由。 */
function buildContext(input?: {
  siliconPersons?: SiliconPerson[];
  sessions?: ChatSession[];
}): RuntimeContext {
  return {
    runtime: {
      myClawRootPath: "/tmp/myclaw",
      skillsRootPath: "/tmp/myclaw/skills",
      sessionsRootPath: "/tmp/myclaw/sessions",
      paths: {
        rootDir: "/tmp",
        myClawDir: "/tmp/myclaw",
        skillsDir: "/tmp/myclaw/skills",
        sessionsDir: "/tmp/myclaw/sessions",
        modelsDir: "/tmp/myclaw/models",
        settingsFile: "/tmp/myclaw/settings.json",
      },
    },
    state: {
      models: [],
      sessions: input?.sessions ?? [],
      siliconPersons: input?.siliconPersons ?? [],
      skills: [],
      workflowDefinitions: {},
      workflowRuns: [],
      activeWorkflowRuns: new Map(),
      activeSessionRuns: new Map(),
      getDefaultModelProfileId: () => "profile-1",
      setDefaultModelProfileId: () => {},
      getWorkflows: () => [],
      getApprovals: () => ({
        mode: "prompt",
        autoApproveReadOnly: true,
        autoApproveSkills: true,
        alwaysAllowedTools: [],
      }),
      getApprovalRequests: () => [],
      setApprovalRequests: () => {},
      getPersonalPromptProfile: () => ({
        prompt: "",
        summary: "",
        tags: [],
        updatedAt: null,
      }),
      setPersonalPromptProfile: () => {},
    },
    services: {
      refreshSkills: async () => [],
      listMcpServers: () => [],
      mcpManager: null,
      resolveModelCapability: undefined,
    },
    tools: {
      resolveBuiltinTools: () => [],
      resolveMcpTools: () => [],
    },
  };
}

/** 构造一个最小硅基员工对象，便于覆盖自动建会话和手动切换语义。 */
function buildSiliconPerson(): SiliconPerson {
  return {
    id: "sp-1",
    name: "小王",
    title: "硅基运营",
    description: "负责日常运营跟进",
    status: "idle",
    source: "personal",
    approvalMode: "inherit",
    currentSessionId: null,
    sessions: [],
    unreadCount: 0,
    hasUnread: false,
    needsApproval: false,
    workflowIds: [],
    updatedAt: "2026-04-08T00:00:00.000Z",
  };
}

describe("silicon person session routing", () => {
  beforeEach(() => {
    saveSessionMock.mockReset();
    saveSiliconPersonMock.mockReset();
    saveSessionMock.mockResolvedValue(undefined);
    saveSiliconPersonMock.mockResolvedValue(undefined);
  });

  it("auto creates the first currentSession when routing a message", async () => {
    const { routeMessageToSiliconPersonCurrentSession } = await import("../src/main/services/silicon-person-session");
    const ctx = buildContext({
      siliconPersons: [buildSiliconPerson()],
    });

    const payload = await routeMessageToSiliconPersonCurrentSession(ctx, {
      siliconPersonId: "sp-1",
      content: "请整理今天的运营事项",
    });

    expect(payload.session.siliconPersonId).toBe("sp-1");
    expect(payload.session.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "请整理今天的运营事项",
      }),
    ]);
    expect(payload.siliconPerson.currentSessionId).toBe(payload.session.id);
    expect(payload.siliconPerson.status).toBe("running");
    expect(payload.siliconPerson.sessions).toEqual([
      expect.objectContaining({
        id: payload.session.id,
        title: payload.session.title,
        status: "running",
      }),
    ]);
  });

  it("only changes currentSession on manual new or explicit switch", async () => {
    const {
      createSiliconPersonSession,
      routeMessageToSiliconPersonCurrentSession,
      switchSiliconPersonCurrentSession,
    } = await import("../src/main/services/silicon-person-session");
    const session1: ChatSession = {
      id: "session-1",
      title: "默认会话",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      siliconPersonId: "sp-1",
      createdAt: "2026-04-08T00:00:00.000Z",
      messages: [],
    };
    const session2: ChatSession = {
      ...session1,
      id: "session-2",
      title: "复盘会话",
      createdAt: "2026-04-08T01:00:00.000Z",
    };
    const ctx = buildContext({
      sessions: [session1, session2],
      siliconPersons: [{
        ...buildSiliconPerson(),
        currentSessionId: "session-1",
        sessions: [
          {
            id: "session-1",
            title: "默认会话",
            status: "idle",
            unreadCount: 0,
            hasUnread: false,
            needsApproval: false,
            updatedAt: session1.createdAt,
          },
          {
            id: "session-2",
            title: "复盘会话",
            status: "idle",
            unreadCount: 0,
            hasUnread: false,
            needsApproval: false,
            updatedAt: session2.createdAt,
          },
        ],
      }],
    });

    await routeMessageToSiliconPersonCurrentSession(ctx, {
      siliconPersonId: "sp-1",
      content: "继续默认会话",
    });
    expect(ctx.state.siliconPersons[0]?.currentSessionId).toBe("session-1");

    const created = await createSiliconPersonSession(ctx, {
      siliconPersonId: "sp-1",
      title: "新建会话",
    });
    expect(created.siliconPerson.currentSessionId).toBe(created.session.id);

    const switched = await switchSiliconPersonCurrentSession(ctx, {
      siliconPersonId: "sp-1",
      sessionId: "session-2",
    });
    expect(switched.siliconPerson.currentSessionId).toBe("session-2");
  });
});

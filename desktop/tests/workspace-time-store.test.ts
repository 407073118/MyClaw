import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "../src/renderer/stores/workspace";

const bootstrapMock = vi.fn();
const onAppUpdateStateChangedMock = vi.fn(() => () => {});

function buildBootstrapPayload() {
  return {
    sessions: [{
      id: "session-1",
      title: "Default Session",
      modelProfileId: "model-1",
      attachedDirectory: null,
      createdAt: "2026-04-18T00:00:00.000Z",
      messages: [],
    }],
    models: [{
      id: "model-1",
      name: "Test Model",
      provider: "openai-compatible",
      providerFlavor: "openai",
      baseUrl: "https://example.com",
      apiKey: "test-key",
      model: "gpt-test",
    }],
    defaultModelProfileId: "model-1",
    tools: { builtin: [], mcp: [] },
    mcp: { servers: [] },
    skills: { items: [] },
    siliconPersons: [],
    workflows: [],
    workflowRuns: [],
    approvals: {
      mode: "prompt",
      autoApproveReadOnly: true,
      autoApproveSkills: true,
      alwaysAllowedTools: [],
    },
    approvalRequests: [],
    personalPrompt: {
      prompt: "",
      summary: "",
      tags: [],
      updatedAt: null,
    },
    updates: {
      enabled: false,
      stage: "idle",
      currentVersion: "0.1.0",
      latestVersion: null,
      progressPercent: null,
      message: "",
      feedLabel: null,
      downloadPageUrl: null,
    },
    requiresInitialSetup: false,
    myClawRootPath: "F:/MyClaw",
    skillsRootPath: "F:/MyClaw/desktop/skills",
    sessionsRootPath: "F:/MyClaw/desktop/sessions",
    workspaceRootPath: "F:/MyClaw/desktop/workspace",
    artifactsRootPath: "F:/MyClaw/desktop/artifacts",
    cacheRootPath: "F:/MyClaw/desktop/cache",
    time: {
      calendarEvents: [],
      taskCommitments: [],
      reminders: [{
        id: "rem-1",
        kind: "reminder",
        title: "Call doctor",
        triggerAt: "2026-04-20T07:00:00.000Z",
        timezone: "Asia/Shanghai",
        ownerScope: "personal",
        status: "scheduled",
        source: "manual",
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z",
      }],
      scheduleJobs: [{
        id: "job-1",
        kind: "schedule_job",
        title: "Morning brief",
        scheduleKind: "cron",
        timezone: "Asia/Shanghai",
        ownerScope: "personal",
        status: "scheduled",
        source: "manual",
        executor: "assistant_prompt",
        cronExpression: "0 9 * * *",
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z",
      }],
      executionRuns: [],
      availabilityPolicy: {
        timezone: "Asia/Shanghai",
        workingHours: [{ weekday: 1, start: "09:00", end: "18:00" }],
        quietHours: { enabled: true, start: "22:00", end: "08:00" },
        notificationWindows: [],
        focusBlocks: [],
      },
      todayBrief: {
        generatedAt: "2026-04-20T00:00:00.000Z",
        timezone: "Asia/Shanghai",
        items: [],
      },
    },
  };
}

describe("workspace time store", () => {
  beforeEach(() => {
    bootstrapMock.mockReset();
    onAppUpdateStateChangedMock.mockClear();
    bootstrapMock.mockResolvedValue(buildBootstrapPayload());
    useWorkspaceStore.setState({
      ready: false,
      loading: false,
      error: null,
      activeSessionId: null,
      sessions: [],
      models: [],
      builtinTools: [],
      mcpTools: [],
      mcpServers: [],
      skills: [],
      skillDetails: {},
      siliconPersons: [],
      workflows: [],
      workflowSummaries: {},
      workflowDefinitions: {},
      workflowRuns: {},
      cloudHubItems: [],
      cloudHubDetail: null,
      cloudHubManifest: null,
      cloudSkills: [],
      cloudSkillDetail: null,
      approvals: null,
      approvalRequests: [],
      appUpdate: null,
      requiresInitialSetup: true,
      defaultModelProfileId: null,
      myClawRootPath: null,
      skillsRootPath: null,
      sessionsRootPath: null,
      workspaceRootPath: null,
      artifactsRootPath: null,
      cacheRootPath: null,
      currentSession: null,
      backgroundTaskSnapshot: null,
      artifactsByScope: {},
      recentArtifacts: [],
      activeSiliconPersonId: null,
      modelSwitchNotice: null,
      personalPrompt: { prompt: "", summary: "", tags: [], updatedAt: null },
      webPanel: {
        isOpen: false,
        viewPath: null,
        title: "",
        data: null,
        panelWidth: 420,
      },
      time: {
        calendarEvents: [],
        taskCommitments: [],
        reminders: [],
        scheduleJobs: [],
        executionRuns: [],
        availabilityPolicy: null,
        todayBrief: null,
      },
    } as any);

    vi.stubGlobal("window", {
      myClawAPI: {
        platform: "win32",
        bootstrap: bootstrapMock,
        createSession: vi.fn(),
        onAppUpdateStateChanged: onAppUpdateStateChangedMock,
      },
    });
  });

  it("hydrates reminders and schedule jobs from bootstrap", async () => {
    await useWorkspaceStore.getState().loadBootstrap();

    expect(useWorkspaceStore.getState().time.reminders.length).toBeGreaterThan(0);
    expect(useWorkspaceStore.getState().time.scheduleJobs.length).toBeGreaterThan(0);
    expect(useWorkspaceStore.getState().time.availabilityPolicy).not.toBeNull();
  });
});

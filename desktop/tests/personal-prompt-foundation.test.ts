import { beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.fn();
const saveSettingsMock = vi.fn(() => Promise.resolve());

vi.mock("electron", () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock("../src/main/services/state-persistence", () => ({
  saveSettings: saveSettingsMock,
}));

/** 获取指定 channel 对应的 IPC 处理函数，便于直接调用并断言返回结果。 */
function findHandler(channel: string) {
  const matched = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!matched) {
    throw new Error(`未注册 IPC handler: ${channel}`);
  }
  return matched[1] as (...args: unknown[]) => Promise<unknown>;
}

describe("personal prompt profile helpers", () => {
  it("derives compact summary and tags from a user-authored long prompt", async () => {
    const { derivePersonalPromptProfile } = await import("../src/main/services/personal-prompt-profile");

    const profile = derivePersonalPromptProfile(
      "我是黑盒测试，主要负责需求测试、回归测试、上线验证。平时会看 PRD、原型、接口文档，输出测试点、测试用例和缺陷单。我希望你先帮我补齐测试思路，再帮我整理输出。",
    );

    expect(profile.summary).toContain("黑盒测试");
    expect(profile.summary.length).toBeLessThanOrEqual(140);
    expect(profile.tags).toContain("测试");
    expect(profile.tags).toContain("黑盒测试");
    expect(profile.tags).toContain("回归测试");
  });

  it("builds a runtime context block from the saved personal prompt profile", async () => {
    const { buildPersonalPromptContext } = await import("../src/main/services/personal-prompt-profile");

    const context = buildPersonalPromptContext({
      prompt: "我是测试工程师，主要负责黑盒测试和回归测试，希望你优先帮我整理测试思路。",
      summary: "测试工程师，负责黑盒测试和回归测试，偏好先整理测试思路。",
      tags: ["测试", "黑盒测试", "回归测试"],
      updatedAt: "2026-04-04T14:00:00.000Z",
    });

    expect(context).toContain("# User Working Profile");
    expect(context).toContain("黑盒测试");
    expect(context).toContain("回归测试");
  });
});

describe("personal prompt IPC handlers", () => {
  beforeEach(() => {
    handleMock.mockClear();
    saveSettingsMock.mockClear();
  });

  it("updates the saved personal prompt and persists derived profile", async () => {
    let personalPrompt = {
      prompt: "",
      summary: "",
      tags: [],
      updatedAt: null,
    };

    const ctx = {
      state: {
        getPersonalPromptProfile: () => personalPrompt,
        setPersonalPromptProfile: (next: typeof personalPrompt) => {
          personalPrompt = next;
        },
        getDefaultModelProfileId: () => "model-1",
        getApprovals: () => ({
          mode: "prompt",
          autoApproveReadOnly: false,
          autoApproveSkills: true,
          alwaysAllowedTools: [],
        }),
      },
      runtime: {
        paths: {},
      },
    } as any;

    const { registerPersonalPromptHandlers } = await import("../src/main/ipc/personal-prompt");
    registerPersonalPromptHandlers(ctx);

    const setHandler = findHandler("personal-prompt:set");
    const result = await setHandler(null, {
      prompt: "我是黑盒测试，负责需求测试、回归测试和上线验证，希望你帮我先补齐测试思路。",
    }) as typeof personalPrompt;

    expect(result.prompt).toContain("黑盒测试");
    expect(result.summary).toContain("黑盒测试");
    expect(result.tags).toContain("测试");
    expect(saveSettingsMock).toHaveBeenCalledTimes(1);
    expect(saveSettingsMock.mock.calls[0]?.[1]).toMatchObject({
      defaultModelProfileId: "model-1",
      personalPrompt: {
        prompt: expect.stringContaining("黑盒测试"),
      },
    });
  });
});

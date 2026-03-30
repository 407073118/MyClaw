import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as runtimeClient from "@/services/runtime-client";
import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";
import ChatView from "@/views/ChatView.vue";

describe("ChatView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("renders the session rail and inline approval cards", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const wrapper = mount(ChatView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.find("[data-testid='session-list']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='approval-card-approval-default-write-file']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='new-chat-button']").exists()).toBe(true);
  });

  it("renders a structured multi-field form card", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const fixture = createWorkspaceFixture();
    const workspace = useWorkspaceStore();

    workspace.hydrate({
      ...fixture,
      sessions: [
        {
          ...fixture.sessions[0],
          messages: [
            ...fixture.sessions[0].messages,
            {
              id: "msg-assistant-multi-field",
              role: "assistant",
              content: "Fill in the deployment parameters.",
              createdAt: "2026-03-20T10:00:00.000Z",
              ui: {
                version: "a2ui-lite/v1",
                kind: "form",
                id: "deploy-form",
                title: "Deployment parameters",
                submitLabel: "Submit",
                fields: [
                  {
                    name: "environment",
                    label: "Environment",
                    input: "select",
                    required: true,
                    options: [
                      { label: "Staging", value: "staging" },
                      { label: "Production", value: "production" },
                    ],
                  },
                  {
                    name: "region",
                    label: "Region",
                    input: "text",
                    required: true,
                  },
                ],
              },
            } as never,
          ],
        },
      ],
    });

    const wrapper = mount(ChatView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.find("[data-testid='ui-form-msg-assistant-multi-field']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Fill in the deployment parameters.");
    expect(wrapper.text()).toContain("Deployment parameters");
    expect(wrapper.find("[data-testid='ui-field-msg-assistant-multi-field-environment']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='ui-field-msg-assistant-multi-field-region']").exists()).toBe(true);
  });

  it("does not render one-field A2UI payloads as inline forms", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const fixture = createWorkspaceFixture();
    const workspace = useWorkspaceStore();

    workspace.hydrate({
      ...fixture,
      sessions: [
        {
          ...fixture.sessions[0],
          messages: [
            ...fixture.sessions[0].messages,
            {
              id: "msg-assistant-single-field",
              role: "assistant",
              content: "Please confirm whether I should continue.",
              createdAt: "2026-03-20T10:00:00.000Z",
              ui: {
                version: "a2ui-lite/v1",
                kind: "form",
                id: "confirm-next-step",
                title: "Continue?",
                submitLabel: "Submit",
                fields: [
                  {
                    name: "confirmation",
                    label: "Confirmation",
                    input: "select",
                    required: true,
                    options: [
                      { label: "Yes", value: "yes" },
                      { label: "No", value: "no" },
                    ],
                  },
                ],
              },
            } as never,
          ],
        },
      ],
    });

    const wrapper = mount(ChatView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.find("[data-testid='ui-form-msg-assistant-single-field']").exists()).toBe(false);
    expect(wrapper.text()).toContain("Please confirm whether I should continue.");
  });

  it("submits A2UI form values back to runtime", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const fixture = createWorkspaceFixture();
    const workspace = useWorkspaceStore();

    workspace.hydrate({
      ...fixture,
      sessions: [
        {
          ...fixture.sessions[0],
          messages: [
            ...fixture.sessions[0].messages,
            {
              id: "msg-assistant-form",
              role: "assistant",
              content: "Fill in the deployment parameters.",
              createdAt: "2026-03-10T10:00:06.000Z",
              ui: {
                version: "a2ui-lite/v1",
                kind: "form",
                id: "deploy-form",
                title: "Deployment parameters",
                submitLabel: "Submit",
                fields: [
                  {
                    name: "environment",
                    label: "Environment",
                    input: "select",
                    required: true,
                    options: [
                      { label: "Staging", value: "staging" },
                      { label: "Production", value: "production" },
                    ],
                  },
                  {
                    name: "region",
                    label: "Region",
                    input: "text",
                    required: true,
                  },
                ],
              },
            } as never,
          ],
        },
      ],
    });

    const sendMessageSpy = vi.spyOn(runtimeClient, "postSessionMessageStream").mockImplementation(
      async (_baseUrl, _sessionId, _content, handlers) => {
        const updatedSession = {
          ...fixture.sessions[0],
          messages: [
            ...fixture.sessions[0].messages,
            {
              id: "msg-user-form-submit",
              role: "user",
              content: "[A2UI_FORM:deploy-form] environment=production; region=cn-shanghai",
              createdAt: "2026-03-10T10:00:07.000Z",
            },
          ],
        };
        handlers?.onSnapshot?.({
          session: updatedSession,
        });
        return {
          session: updatedSession,
        };
      },
    );

    const wrapper = mount(ChatView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='ui-field-msg-assistant-form-environment']").setValue("production");
    await wrapper.get("[data-testid='ui-field-msg-assistant-form-region']").setValue("cn-shanghai");
    await wrapper.get("[data-testid='ui-submit-msg-assistant-form']").trigger("click");
    await flushPromises();

    expect(sendMessageSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:43110",
      "session-default",
      expect.stringContaining("environment=production"),
      expect.any(Object),
    );
    expect(sendMessageSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:43110",
      "session-default",
      expect.stringContaining("region=cn-shanghai"),
      expect.any(Object),
    );
  });

  it("shows an inline approval card when a chat reply returns pending approvals", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const fixture = createWorkspaceFixture();
    const workspace = useWorkspaceStore();

    workspace.hydrate({
      ...fixture,
      approvalRequests: [],
    });

    vi.spyOn(runtimeClient, "postSessionMessageStream").mockImplementation(async (_base, _sessionId, _content, handlers) => {
      const streamPayload = {
        session: {
          ...fixture.sessions[0],
          messages: [
            ...fixture.sessions[0].messages,
            {
              id: "msg-system-pending-approval",
              role: "system",
              content: "Waiting for approval before running Get-ChildItem E:\\.",
              createdAt: "2026-03-20T10:00:00.000Z",
            },
          ],
        },
        approvals: fixture.approvals,
        approvalRequests: [
          {
            id: "approval-shell-command",
            sessionId: "session-default",
            source: "builtin-tool",
            toolId: "exec.command",
            label: "Get-ChildItem E:\\",
            risk: "exec",
            detail: "The model wants to run a shell command.",
          },
        ],
      };
      handlers?.onSnapshot?.(streamPayload);
      return streamPayload;
    });

    const wrapper = mount(ChatView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='composer-input']").setValue("Inspect the E drive");
    await wrapper.get("[data-testid='composer-submit']").trigger("click");
    await flushPromises();

    expect(wrapper.find("[data-testid='approval-card-approval-shell-command']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Get-ChildItem E:\\");
  });

  it("deletes a session from the session rail after confirmation", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const fixture = createWorkspaceFixture();
    const workspace = useWorkspaceStore();

    workspace.hydrate({
      ...fixture,
      sessions: [
        fixture.sessions[0],
        {
          ...fixture.sessions[0],
          id: "session-secondary",
          title: "Secondary thread",
          createdAt: "2026-03-20T10:05:00.000Z",
        },
      ],
    });

    const deleteSessionSpy = vi.fn().mockResolvedValue(undefined);
    workspace.deleteSession = deleteSessionSpy as typeof workspace.deleteSession;
    vi.stubGlobal("confirm", vi.fn(() => true));

    const wrapper = mount(ChatView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='session-delete-session-secondary']").trigger("click");
    await flushPromises();

    expect(deleteSessionSpy).toHaveBeenCalledWith("session-secondary");
  });

  it("renders provider reasoning when it is present on an assistant message", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const fixture = createWorkspaceFixture();
    const workspace = useWorkspaceStore();

    workspace.hydrate({
      ...fixture,
      sessions: [
        {
          ...fixture.sessions[0],
          messages: [
            ...fixture.sessions[0].messages,
            {
              id: "msg-assistant-reasoning",
              role: "assistant",
              content: "I found the configuration mismatch.",
              reasoning: "I compared the request payload and checked whether tools were actually passed to the provider.",
              createdAt: "2026-03-20T10:00:00.000Z",
            },
          ],
        },
      ],
    });

    const wrapper = mount(ChatView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.find("[data-testid='reasoning-msg-assistant-reasoning']").exists()).toBe(true);
    expect(wrapper.text()).toContain("I compared the request payload and checked whether tools were actually passed to the provider.");
  });

  it("renders execution chain steps for skill activity without exposing the model identity in chat", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const fixture = createWorkspaceFixture();
    const workspace = useWorkspaceStore();

    workspace.hydrate({
      ...fixture,
      sessions: [
        {
          ...fixture.sessions[0],
          messages: [
          ...fixture.sessions[0].messages,
            {
              id: "msg-system-tool-call",
              role: "system",
              content: "[TOOL_CALL] run_skill invocation=br-interview-workspace 岗位=测试开发工程师",
              createdAt: "2026-03-20T10:00:03.000Z",
            },
            {
              id: "msg-system-skill-hit",
              role: "system",
              content: "[SKILL] br-interview-workspace",
              createdAt: "2026-03-20T10:00:04.000Z",
            },
            {
              id: "msg-system-skill-status",
              role: "system",
              content: "[STATUS] 正在生成招聘与面试全流程材料。",
              createdAt: "2026-03-20T10:00:05.000Z",
            },
            {
              id: "msg-assistant-final",
              role: "assistant",
              content: "已直接开始为你生成完整招聘与面试材料。",
              createdAt: "2026-03-20T10:00:06.000Z",
            },
          ],
        },
      ],
    });

    const wrapper = mount(ChatView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.find("[data-testid='execution-chain-group-msg-system-tool-call']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='execution-chain-step-msg-system-skill-hit']").text()).toContain("br-interview-workspace");
    expect(wrapper.find("[data-testid='execution-chain-step-msg-system-skill-status']").text()).toContain("正在生成招聘与面试全流程材料");
    expect(wrapper.text()).not.toContain("gpt-5");
    expect(wrapper.text()).toContain("已直接开始为你生成完整招聘与面试材料。");
  });

  it("renders a tree view for Get-ChildItem directory output", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const fixture = createWorkspaceFixture();
    const workspace = useWorkspaceStore();

    workspace.hydrate({
      ...fixture,
      sessions: [
        {
          ...fixture.sessions[0],
          messages: [
            ...fixture.sessions[0].messages,
            {
              id: "msg-tool-dir",
              role: "tool",
              content: [
                "",
                "    \u76ee\u5f55: F:\\",
                "",
                "Mode                 LastWriteTime         Length Name",
                "----                 -------------         ------ ----",
                "d-----         2025/4/30     17:54                aaaaaa",
                "d-----         2025/3/26     20:55                app",
                "-a----         2025/5/21     15:13           1407 PATH.txt",
              ].join("\n"),
              createdAt: "2026-03-20T10:00:00.000Z",
            },
          ],
        },
      ],
    });

    const wrapper = mount(ChatView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.find("[data-testid='tool-directory-tree-msg-tool-dir']").exists()).toBe(true);
    expect(wrapper.text()).toContain("F:\\");
    expect(wrapper.text()).toContain("aaaaaa");
    expect(wrapper.text()).toContain("PATH.txt");
  });
});

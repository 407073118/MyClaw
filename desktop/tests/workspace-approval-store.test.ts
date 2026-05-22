import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "../src/renderer/stores/workspace";

describe("workspace approval store", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    useWorkspaceStore.setState({
      approvals: {
        mode: "auto-read-only",
        autoApproveReadOnly: true,
        autoApproveSkills: true,
        alwaysAllowedTools: [],
        pathGrants: { allowedDirs: [], deniedPaths: [] },
      },
      approvalRequests: [{
        id: "approval-1",
        sessionId: "session-1",
        source: "external-path",
        toolId: "fs.read",
        label: "读取外部路径",
        risk: "read",
        detail: "模型请求读取工作区外路径",
        pathMeta: {
          path: "F:\\blocked\\secret.txt",
          userPath: "F:\\blocked\\secret.txt",
          operation: "read",
        },
      }],
    } as any);
  });

  it("syncs persisted path grants returned after resolving external-path approval", async () => {
    const nextApprovals = {
      mode: "auto-read-only",
      autoApproveReadOnly: true,
      autoApproveSkills: true,
      alwaysAllowedTools: [],
      pathGrants: {
        allowedDirs: [],
        deniedPaths: ["F:\\blocked\\secret.txt"],
      },
    };

    vi.stubGlobal("window", {
      myClawAPI: {
        resolveApproval: vi.fn().mockResolvedValue({
          success: true,
          approvals: nextApprovals,
          approvalRequests: [],
        }),
      },
    });

    await useWorkspaceStore.getState().resolveApproval("approval-1", "deny-persistent");

    expect(useWorkspaceStore.getState().approvalRequests).toEqual([]);
    expect(useWorkspaceStore.getState().approvals).toEqual(nextApprovals);
  });

  it("deduplicates approval requests by id when stream events replay", () => {
    const existing = useWorkspaceStore.getState().approvalRequests[0] as any;

    useWorkspaceStore.getState().addApprovalRequest({
      ...existing,
      detail: "重复推送后的最新审批详情",
    });

    expect(useWorkspaceStore.getState().approvalRequests).toHaveLength(1);
    expect(useWorkspaceStore.getState().approvalRequests[0]).toMatchObject({
      id: "approval-1",
      detail: "重复推送后的最新审批详情",
    });
  });
});

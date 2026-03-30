import { describe, expect, it } from "vitest";

import {
  sanitizeApprovalPolicy,
  sanitizeApprovalRequests,
  sanitizeBuiltinToolPreferences,
  sanitizeMcpServerConfigs,
  sanitizeMcpToolPreferences,
} from "../../../src/store/runtime-state/runtime-state-sanitizers";

describe("runtime state sanitizers", () => {
  it("falls back invalid approval policy mode while preserving valid booleans", () => {
    const fallback = {
      mode: "prompt",
      autoApproveReadOnly: false,
      autoApproveSkills: false,
      alwaysAllowedTools: [],
    } as const;

    const result = sanitizeApprovalPolicy(
      {
        mode: "invalid-mode" as never,
        autoApproveReadOnly: true,
        autoApproveSkills: true,
        alwaysAllowedTools: ["fs.read", 1] as never,
      },
      fallback,
    );

    expect(result).toEqual({
      mode: "prompt",
      autoApproveReadOnly: true,
      autoApproveSkills: true,
      alwaysAllowedTools: ["fs.read"],
    });
  });

  it("filters malformed approval requests and malformed mcp entries", () => {
    const requests = sanitizeApprovalRequests(
      [
        {
          id: "request-a",
          sessionId: "session-a",
          source: "builtin-tool",
          toolId: "exec.command",
          label: "run",
          risk: "exec",
          detail: "detail",
          resumeConversation: true,
          arguments: { cwd: "C:/tmp" },
        },
        {
          id: "request-b",
          sessionId: "session-b",
          source: "builtin-tool",
          toolId: "exec.command",
          label: "invalid-args",
          risk: "exec",
          detail: "detail",
          arguments: ["bad"],
        } as never,
      ],
      [],
    );
    const servers = sanitizeMcpServerConfigs(
      [
        {
          id: "mcp-stdio",
          name: "Filesystem",
          source: "manual",
          transport: "stdio",
          command: "npx",
          enabled: true,
        },
        {
          id: "mcp-http-invalid",
          name: "Broken",
          source: "manual",
          transport: "http",
          enabled: true,
        } as never,
      ],
      [],
    );
    const prefs = sanitizeMcpToolPreferences(
      [
        {
          toolId: "mcp-stdio:read",
          serverId: "mcp-stdio",
          enabled: true,
          exposedToModel: true,
          approvalModeOverride: "inherit",
          updatedAt: "2026-03-27T00:00:00.000Z",
        },
        {
          toolId: "mcp-stdio:write",
          serverId: "mcp-stdio",
          enabled: true,
          exposedToModel: true,
          approvalModeOverride: "bad",
          updatedAt: "2026-03-27T00:00:00.000Z",
        } as never,
      ],
      [],
    );

    expect(requests).toHaveLength(1);
    expect(servers).toHaveLength(1);
    expect(prefs).toHaveLength(1);
  });

  it("filters malformed builtin tool preferences", () => {
    const result = sanitizeBuiltinToolPreferences(
      [
        {
          toolId: "exec.command",
          enabled: true,
          exposedToModel: false,
          approvalModeOverride: "always-ask",
          updatedAt: "2026-03-27T00:00:00.000Z",
        },
        {
          toolId: "exec.command.unsafe",
          enabled: true,
          exposedToModel: true,
          approvalModeOverride: "invalid",
          updatedAt: "2026-03-27T00:00:00.000Z",
        } as never,
      ],
      [],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.toolId).toBe("exec.command");
  });
});

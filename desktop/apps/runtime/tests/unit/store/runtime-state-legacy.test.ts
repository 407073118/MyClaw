import { describe, expect, it } from "vitest";
import { join } from "node:path";

import {
  createDefaultRuntimeState,
  sanitizeRuntimeState,
} from "../../../src/store/runtime-state/runtime-state-bootstrap";
import {
  parseLegacyJsonState,
} from "../../../src/store/runtime-state/runtime-state-legacy";

describe("runtime state legacy", () => {
  it("returns null when payload is not a json object", () => {
    const result = parseLegacyJsonState(Buffer.from("not-json", "utf8"));

    expect(result).toBeNull();
  });

  it("sanitizes legacy workflow summary fields to persistence-safe defaults", () => {
    const raw = Buffer.from(
      JSON.stringify({
        defaultModelProfileId: "model-a",
        models: [
          {
            id: "model-a",
            name: "Model A",
            provider: "openai-compatible",
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-test",
            model: "gpt-4.1-mini",
          },
        ],
        sessions: [],
        approvals: {
          mode: "prompt",
          autoApproveReadOnly: true,
          autoApproveSkills: true,
          alwaysAllowedTools: [],
        },
        mcpServerConfigs: [],
        mcpToolPreferences: [],
        builtinToolPreferences: [],
        approvalRequests: [],
        employees: [],
        workflows: [
          {
            id: "workflow-a",
            name: "Workflow A",
            description: "legacy workflow",
            status: "draft",
            source: "personal",
            updatedAt: "2026-03-20T00:00:00.000Z",
            version: "NaN",
            nodeCount: "NaN",
            edgeCount: "NaN",
            libraryRootId: "",
          },
        ],
        memoryRecords: [],
        pendingWorkItems: [],
      }),
      "utf8",
    );

    const result = parseLegacyJsonState(raw, join("C:/tmp", "runtime-state.db"));

    expect(result?.workflows[0]).toMatchObject({
      version: 1,
      nodeCount: 0,
      edgeCount: 0,
      libraryRootId: "personal",
    });
  });

  it("falls back to defaults when invalid runtime-state fragments are provided", () => {
    const fallback = createDefaultRuntimeState(join("C:/tmp", "runtime-state.db"));

    const result = sanitizeRuntimeState({
      defaultModelProfileId: "missing-model",
      models: [],
      sessions: [],
      approvals: {
        mode: "invalid",
      },
      mcpServerConfigs: [
        {
          id: "broken-http",
          name: "Broken Http",
          source: "manual",
          transport: "http",
          enabled: true,
        },
      ],
      mcpToolPreferences: [
        {
          toolId: "tool-a",
          enabled: true,
        },
      ],
      builtinToolPreferences: [
        {
          toolId: "builtin-a",
          enabled: true,
        },
      ],
    } as never);

    expect(result.defaultModelProfileId).toBe(fallback.defaultModelProfileId);
    expect(result.approvals).toEqual(fallback.approvals);
    expect(result.mcpServerConfigs).toEqual([]);
    expect(result.mcpToolPreferences).toEqual([]);
    expect(result.builtinToolPreferences).toEqual([]);
  });
});

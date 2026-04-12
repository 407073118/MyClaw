import { describe, expect, it } from "vitest";

import { ToolMiddleware } from "../../../src/main/services/model-runtime/tool-middleware";

describe("tool middleware execution", () => {
  it("uses injected approval and execution delegates", async () => {
    const middleware = new ToolMiddleware({
      requestApproval: async (calls) => calls.map((call) => ({ toolCallId: call.id, approved: call.name !== "deny_me", reason: null })),
      executeToolCalls: async (calls) => calls.map((call) => ({ toolCallId: call.id, name: call.name, output: JSON.stringify(call.input ?? {}), success: true })),
    });
    const calls = [{ id: "tool-1", name: "fs_read", argumentsJson: "{}", input: {} }];

    const approvals = await middleware.requestApproval(calls);
    const results = middleware.normalizeResults(await middleware.execute(calls));

    expect(approvals).toEqual([{ toolCallId: "tool-1", approved: true, reason: null }]);
    expect(results[0]).toMatchObject({ toolCallId: "tool-1", success: true, output: "{}" });
  });
});

import { describe, expect, it } from "vitest";

import type { CanonicalToolSpec } from "@shared/contracts";
import { ToolMiddleware } from "../../../src/main/services/model-runtime/tool-middleware";

/** 构造最小工具定义，专门用于验证工具缓存签名稳定性。 */
function makeTool(id: string, name: string, source: CanonicalToolSpec["source"] = "mcp"): CanonicalToolSpec {
  return {
    id,
    name,
    source,
    description: `工具 ${name}`,
    parameters: {
      type: "object",
      properties: {
        value: { type: "string" },
      },
    },
  };
}

describe("tool cache stability", () => {
  it("keeps tool bundle hash stable when MCP tools arrive in different order", () => {
    const middleware = new ToolMiddleware();
    const left = middleware.compile([
      makeTool("b:read", "read"),
      makeTool("a:write", "write"),
    ], "generic-openai-compatible");
    const right = middleware.compile([
      makeTool("a:write", "write"),
      makeTool("b:read", "read"),
    ], "generic-openai-compatible");

    expect(left.toolBundleHash).toBe(right.toolBundleHash);
    expect(left.tools).toEqual(right.tools);
  });
});

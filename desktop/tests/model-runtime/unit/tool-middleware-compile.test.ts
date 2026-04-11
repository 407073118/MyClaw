import { describe, expect, it } from "vitest";

import { createToolMiddleware } from "../../../src/main/services/model-runtime/tool-middleware";
import type { CanonicalToolSpec } from "@shared/contracts";

const specs: CanonicalToolSpec[] = [{
  id: "fs_read",
  name: "fs_read",
  description: "Read file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  source: "builtin",
}];

describe("tool middleware compile", () => {
  it("emits strict schema for openai-native", () => {
    const middleware = createToolMiddleware();
    const bundle = middleware.compile(specs, "openai-native");
    const compiledTool = bundle.tools[0] as {
      function: { parameters: Record<string, unknown> };
    };
    const parameters = compiledTool.function.parameters;

    expect(bundle.compileMode).toBe("openai-strict");
    expect(parameters.additionalProperties).toBe(false);
  });

  it("emits anthropic input_schema for anthropic-native", () => {
    const middleware = createToolMiddleware();
    const bundle = middleware.compile(specs, "anthropic-native");

    expect(bundle.compileMode).toBe("anthropic-detailed-description");
    expect(bundle.tools[0]).toHaveProperty("input_schema");
  });

  it("keeps Ark-specific compile mode through the registry-driven path", () => {
    const middleware = createToolMiddleware();
    const bundle = middleware.compile(specs, "volcengine-ark");

    expect(bundle.compileMode).toBe("openai-compatible-ark");
  });
});

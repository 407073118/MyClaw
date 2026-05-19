import { describe, expect, it } from "vitest";

import type { CanonicalToolSpec } from "../shared/contracts";
import {
  compileToolsForProviderPolicy,
  resolveProviderToolPolicy,
} from "../src/main/services/model-runtime/provider-tool-policy";

const nestedTool: CanonicalToolSpec = {
  id: "fs.read",
  name: "fs_read",
  description: "Read a file",
  source: "builtin",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      locator: {
        type: "object",
        properties: {
          line: { type: "number" },
        },
      },
    },
  },
};

/** 从模型协议角度锁定工具编译形状，避免把某一家 schema 误发给另一家。 */
describe("provider tool policy", () => {
  it("compiles OpenAI Responses tools with strict recursive object schemas", () => {
    const policy = resolveProviderToolPolicy({
      providerFamily: "openai-native",
      protocolTarget: "openai-responses",
      vendorFamily: "openai",
    });
    const [tool] = compileToolsForProviderPolicy([nestedTool], policy) as Array<Record<string, any>>;

    expect(tool).toMatchObject({
      type: "function",
      name: "fs_read",
      strict: true,
    });
    expect(tool).not.toHaveProperty("function");
    expect(tool.parameters.required).toEqual(["path", "locator"]);
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.parameters.properties.path).toEqual({ type: "string" });
    expect(tool.parameters.properties.locator.required).toEqual(["line"]);
    expect(tool.parameters.properties.locator.additionalProperties).toBe(false);
    expect(tool.parameters.properties.locator.properties.line).toEqual({ type: "number" });
  });

  it("compiles Anthropic Messages tools with input_schema and no OpenAI function wrapper", () => {
    const policy = resolveProviderToolPolicy({
      providerFamily: "anthropic-native",
      protocolTarget: "anthropic-messages",
      vendorFamily: "anthropic",
    });
    const [tool] = compileToolsForProviderPolicy([nestedTool], policy) as Array<Record<string, any>>;

    expect(tool).toMatchObject({
      name: "fs_read",
      input_schema: {
        type: "object",
      },
    });
    expect(tool).not.toHaveProperty("type", "function");
    expect(tool).not.toHaveProperty("function");
  });

  it("keeps generic OpenAI-compatible tools relaxed without strict or native-only fields", () => {
    const policy = resolveProviderToolPolicy({
      providerFamily: "generic-openai-compatible",
      protocolTarget: "openai-chat-compatible",
      vendorFamily: "generic-local-gateway",
    });
    const [tool] = compileToolsForProviderPolicy([nestedTool], policy) as Array<Record<string, any>>;

    expect(tool).toMatchObject({
      type: "function",
      function: {
        name: "fs_read",
      },
    });
    expect(tool.function).not.toHaveProperty("strict");
    expect(tool.function.parameters.properties.path).toEqual({ type: "string" });
    expect(tool).not.toHaveProperty("name");
    expect(policy.toolSearch).toBe("disabled");
    expect(policy.parallelToolCalls).toBe("disabled");
    expect(policy.nativeTools).toEqual([]);
  });

  it("removes tools entirely when the model capability probe says tool calling is unsupported", () => {
    const policy = resolveProviderToolPolicy({
      providerFamily: "generic-openai-compatible",
      protocolTarget: "openai-chat-compatible",
      vendorFamily: "generic-local-gateway",
      capability: {
        source: "manual-override",
        supportsTools: false,
      },
    });

    expect(policy.fallbackBehavior).toBe("disable-tools");
    expect(compileToolsForProviderPolicy([nestedTool], policy)).toEqual([]);
  });
});

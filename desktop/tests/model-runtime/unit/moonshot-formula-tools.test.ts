import { describe, expect, it } from "vitest";

import type { CapabilityExecutionRoute, CanonicalToolSpec } from "@shared/contracts";
import { filterRegistryForMoonshotFormula, isMoonshotFormulaToolStackActive, listMoonshotFormulaNativeToolNames } from "../../../src/main/services/model-runtime/moonshot-formula-tools";

function buildTool(name: string): CanonicalToolSpec {
  return {
    id: name,
    name,
    description: `tool:${name}`,
    parameters: {
      type: "object",
      properties: {},
    },
    source: "builtin",
  };
}

function buildMoonshotFormulaRoutes(): CapabilityExecutionRoute[] {
  return [
    {
      capabilityId: "search",
      routeType: "vendor-native",
      providerFamily: "moonshot-native",
      protocolTarget: "openai-chat-compatible",
      nativeToolName: "$web_search",
      nativeToolStackId: "moonshot-formula",
      toolStackSource: "vendor-native",
      reason: "reasoning_content_replay_required",
    },
    {
      capabilityId: "computer",
      routeType: "vendor-native",
      providerFamily: "moonshot-native",
      protocolTarget: "openai-chat-compatible",
      nativeToolName: "code_runner",
      nativeToolStackId: "moonshot-formula",
      toolStackSource: "vendor-native",
      reason: "reasoning_content_replay_required",
    },
  ];
}

describe("moonshot formula tools", () => {
  it("detects the moonshot formula stack from capability routes", () => {
    expect(isMoonshotFormulaToolStackActive(buildMoonshotFormulaRoutes())).toBe(true);
    expect(listMoonshotFormulaNativeToolNames()).toEqual(["$web_search", "code_runner"]);
  });

  it("keeps local web tools when formula-native replacements are not present in the registry", () => {
    const registry = [
      buildTool("web_search"),
      buildTool("http_fetch"),
      buildTool("browser_open"),
      buildTool("browser_snapshot"),
      buildTool("browser_click"),
      buildTool("browser_type"),
      buildTool("exec_command"),
      buildTool("fs_read"),
    ];

    expect(filterRegistryForMoonshotFormula(registry, buildMoonshotFormulaRoutes()).map((tool) => tool.name)).toEqual([
      "web_search",
      "http_fetch",
      "browser_open",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "exec_command",
      "fs_read",
    ]);
  });

  it("hides overlapping local tools after formula-native replacements are loaded", () => {
    const registry = [
      buildTool("$web_search"),
      buildTool("code_runner"),
      buildTool("web_search"),
      buildTool("http_fetch"),
      buildTool("browser_open"),
      buildTool("browser_snapshot"),
      buildTool("browser_click"),
      buildTool("browser_type"),
      buildTool("exec_command"),
      buildTool("fs_read"),
    ];

    expect(filterRegistryForMoonshotFormula(registry, buildMoonshotFormulaRoutes()).map((tool) => tool.name)).toEqual([
      "$web_search",
      "code_runner",
      "fs_read",
    ]);
  });
});

import { describe, expect, it } from "vitest";

import { ToolRiskCategory } from "../shared/contracts";
import { EXPECTED_BUILTIN_TOOL_NAMES } from "./shared/builtin-tool-contract";
import {
  builtinToolIdToFunctionName,
  listBuiltinToolDefinitions,
  listBuiltinToolRegistryEntries,
  resolveBuiltinToolByFunctionName,
} from "../src/main/services/builtin-tool-registry";
import { buildToolSchemas } from "../src/main/services/tool-schemas";

/** 锁定目标态：工具中心、schema 与执行层必须共享同一份 builtin registry。 */
describe("builtin tool registry target contract", () => {
  it("contains every currently supported builtin model function", () => {
    const registryNames = listBuiltinToolRegistryEntries().map((tool) => tool.modelName);

    expect(registryNames).toEqual(EXPECTED_BUILTIN_TOOL_NAMES);
  });

  it("keeps schema generation aligned with the builtin registry order", () => {
    const schemaNames = buildToolSchemas("F:/workspace").map((tool) => tool.function.name);
    const registryNames = listBuiltinToolRegistryEntries()
      .map((tool) => tool.modelName)
      .filter((name) => name !== "skill_view");

    expect(schemaNames).toEqual(registryNames);
  });

  it("exposes all builtin registry tools to the tool center", () => {
    const toolCenterIds = listBuiltinToolDefinitions().map((tool) => tool.id);

    expect(toolCenterIds).toContain("document.read");
    expect(toolCenterIds).toContain("xlsx.extract");
    expect(toolCenterIds).toContain("fs.find");
    expect(toolCenterIds).toContain("task.create");
    expect(toolCenterIds).toContain("task.list");
    expect(toolCenterIds).toContain("task.get");
    expect(toolCenterIds).toContain("task.update");
    expect(toolCenterIds).toEqual(listBuiltinToolRegistryEntries().map((tool) => tool.id));
  });

  it("resolves builtin tool metadata from model function names without string guessing", () => {
    expect(resolveBuiltinToolByFunctionName("document_read")).toMatchObject({
      id: "document.read",
      modelName: "document_read",
      group: "fs",
      risk: ToolRiskCategory.Read,
    });
    expect(resolveBuiltinToolByFunctionName("browser_press_key")).toMatchObject({
      id: "browser.press_key",
      modelName: "browser_press_key",
      group: "browser",
    });
    expect(resolveBuiltinToolByFunctionName("skill_view")).toMatchObject({
      id: "skill.view",
      modelName: "skill_view",
      group: "skill",
      risk: ToolRiskCategory.Read,
    });
    expect(builtinToolIdToFunctionName("schedule_job.create")).toBe("schedule_job_create");
  });
});

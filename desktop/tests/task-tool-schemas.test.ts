import { describe, expect, it } from "vitest";
import { buildToolSchemas, functionNameToToolId } from "../src/main/services/tool-schemas";
import { ensureStrictToolSchema } from "../src/main/services/model-runtime/provider-tool-policy";
import { EXPECTED_BUILTIN_TOOL_NAMES } from "./shared/builtin-tool-contract";

describe("Task tool schemas", () => {
  it("exposes terminal task_wait_for_user as a builtin task tool", () => {
    const names = buildToolSchemas("F:/workspace").map((tool) => tool.function.name);

    expect(names).toContain("task_wait_for_user");
    expect(EXPECTED_BUILTIN_TOOL_NAMES).toContain("task_wait_for_user");
    expect(functionNameToToolId("task_wait_for_user")).toBe("task.wait_for_user");
  });

  it("documents task_wait_for_user as a terminal hard pause", () => {
    const tool = buildToolSchemas("F:/workspace").find((item) => item.function.name === "task_wait_for_user");

    expect(tool?.function.description).toContain("terminal");
    expect(tool?.function.description).toContain("waiting_user");
    expect(Object.keys(tool?.function.parameters.properties ?? {})).toEqual(
      expect.arrayContaining(["taskId", "question", "reason", "inputSchema", "choices", "expiresAt"]),
    );
  });

  it("does not tell models to set waiting_user through task_update", () => {
    const tool = buildToolSchemas("F:/workspace").find((item) => item.function.name === "task_update");

    expect(tool?.function.description).not.toContain("waiting_user");
    expect((tool?.function.parameters.properties?.status as { enum?: string[] } | undefined)?.enum).not.toContain("waiting_user");
  });

  it("keeps task_wait_for_user optional arguments nullable under strict schema", () => {
    const tool = buildToolSchemas("F:/workspace").find((item) => item.function.name === "task_wait_for_user");
    const strict = ensureStrictToolSchema(tool!.function.parameters);
    const properties = strict.properties as Record<string, { type?: unknown }>;

    expect(strict.required).toEqual(expect.arrayContaining(["inputSchema", "choices", "expiresAt"]));
    expect(properties.inputSchema?.type).toEqual(["object", "null"]);
    expect(properties.choices?.type).toEqual(["array", "null"]);
    expect(properties.expiresAt?.type).toEqual(["string", "null"]);
  });
});

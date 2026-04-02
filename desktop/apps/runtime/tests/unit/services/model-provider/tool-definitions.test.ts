import { describe, expect, it } from "vitest";

import {
  MYCLAW_MODEL_TOOLS,
  getBuiltinModelToolDefinition,
  listBuiltinModelToolDefinitions,
} from "../../../../src/services/model-provider/tool-definitions";

describe("model-provider tool definitions", () => {
  it("returns null for unknown builtin tool ids", () => {
    expect(getBuiltinModelToolDefinition("unknown.id")).toBeNull();
  });

  it("returns defensive copies for builtin model tool definitions", () => {
    const original = getBuiltinModelToolDefinition("fs.read");
    expect(original).not.toBeNull();

    original!.name = "tampered";
    original!.parameters = { type: "object", properties: {} };

    const fresh = getBuiltinModelToolDefinition("fs.read");
    expect(fresh?.name).toBe("fs_read_file");
    expect((fresh?.parameters as { required?: string[] }).required).toEqual(["path"]);
  });

  it("lists builtin model tool definitions as cloned records", () => {
    const entries = listBuiltinModelToolDefinitions();
    expect(entries["fs.read"]?.name).toBe("fs_read_file");

    entries["fs.read"] = {
      name: "tampered",
      description: "tampered",
      parameters: {},
    };

    const fresh = listBuiltinModelToolDefinitions();
    expect(fresh["fs.read"]?.name).toBe("fs_read_file");
  });

  it("exposes coding-first default tools including search, git, and exec", () => {
    const toolNames = MYCLAW_MODEL_TOOLS.map((tool) => tool.name);
    expect(toolNames).toEqual([
      "fs_read_file",
      "fs_write_file",
      "fs_list_files",
      "fs_search",
      "fs_find",
      "fs_apply_patch",
      "exec_command",
      "git_status",
      "git_diff",
      "git_show",
      "http_fetch",
      "web_search",
      "task_manage",
      "run_skill",
    ]);

    const builtinFsRead = getBuiltinModelToolDefinition("fs.read");
    const builtinFsWrite = getBuiltinModelToolDefinition("fs.write");
    const builtinFsList = getBuiltinModelToolDefinition("fs.list");
    expect(MYCLAW_MODEL_TOOLS[0]).toEqual(builtinFsRead);
    expect(MYCLAW_MODEL_TOOLS[1]).toEqual(builtinFsWrite);
    expect(MYCLAW_MODEL_TOOLS[2]).toEqual(builtinFsList);
  });
});

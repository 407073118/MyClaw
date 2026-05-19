import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/main/ipc/sessions.ts"), "utf8");

describe("project capability session send wiring", () => {
  it("resolves a bundle and saves the run snapshot before model execution", () => {
    expect(source).toContain("ctx.services.capabilityBundles?.resolveForSession");
    expect(source).toContain("saveRunCapabilitySnapshot");
    expect(source).toContain("bundleHash: capabilityBundle.hash");
  });

  it("passes the same bundle into schemas, prompts, and tool execution", () => {
    expect(source).toContain("capabilityBundle ? { capabilityBundle } : {}");
    expect(source).toContain("capabilityBundle,");
    expect(source).toContain("capabilityBundle ? { capabilityBundle } : {}");
  });

  it("routes project MCP calls to the project temporary runtime", () => {
    expect(source).toContain("ctx.services.projectMcpRuntime.callToolForCapability");
    expect(source).toContain("使用项目 MCP 临时 runtime 调用工具");
    expect(source).not.toContain("Project MCP execution is not supported yet");
  });

  it("keeps global MCP bundle calls on the legacy MCP manager path", () => {
    expect(source).toContain("使用全局 MCP legacy 路径调用工具");
    expect(source).toContain("activeMcpManager.callTool");
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedBuiltinTool, ResolvedMcpTool } from "@shared/contracts";
import type { RuntimeContext } from "../src/main/services/runtime-context";

const ipcHandleRegistry = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandleRegistry.set(channel, handler);
    }),
  },
  shell: {
    openPath: vi.fn(async () => ""),
    showItemInFolder: vi.fn(),
  },
}));

function builtinTool(): ResolvedBuiltinTool {
  return {
    id: "fs.read",
    name: "Read file",
    description: "Read a file",
    group: "fs",
    risk: "read",
    requiresAttachedDirectory: true,
    enabled: true,
    exposedToModel: true,
    effectiveApprovalMode: "inherit",
  };
}

function mcpTool(): ResolvedMcpTool {
  return {
    id: "mcp__demo__search",
    name: "search",
    description: "Search",
    serverId: "demo",
    risk: "read",
    inputSchema: null,
    enabled: true,
    exposedToModel: true,
    effectiveApprovalMode: "inherit",
  };
}

function buildContext(rootDir: string): RuntimeContext {
  return {
    runtime: {
      myClawRootPath: rootDir,
      skillsRootPath: join(rootDir, "skills"),
      sessionsRootPath: join(rootDir, "sessions"),
      paths: {
        rootDir,
        myClawDir: rootDir,
        skillsDir: join(rootDir, "skills"),
        sessionsDir: join(rootDir, "sessions"),
        modelsDir: join(rootDir, "models"),
        settingsFile: join(rootDir, "settings.json"),
      },
    },
    state: {} as RuntimeContext["state"],
    services: {} as RuntimeContext["services"],
    tools: {
      resolveBuiltinTools: () => [builtinTool()],
      resolveMcpTools: () => [mcpTool()],
    },
  };
}

function getHandler(channel: string) {
  const handler = ipcHandleRegistry.get(channel);
  if (!handler) throw new Error(`未注册 IPC handler: ${channel}`);
  return handler;
}

describe("tool preference IPC handlers", () => {
  let rootDir = "";

  beforeEach(() => {
    vi.resetModules();
    ipcHandleRegistry.clear();
    rootDir = mkdtempSync(join(tmpdir(), "myclaw-tool-pref-"));
  });

  afterEach(() => {
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
  });

  it("persists builtin tool preferences only after a real write succeeds", async () => {
    const { registerToolHandlers } = await import("../src/main/ipc/tools");
    registerToolHandlers(buildContext(rootDir));

    const handler = getHandler("tool:update-builtin-pref");
    const result = await handler(null, "fs.read", {
      enabled: false,
      exposedToModel: false,
      approvalModeOverride: "always-ask",
    }) as ResolvedBuiltinTool;

    expect(result.enabled).toBe(false);
    expect(result.exposedToModel).toBe(false);
    expect(readFileSync(join(rootDir, "tool-preferences.json"), "utf8")).toContain("\"fs.read\"");
  });

  it("rejects invalid approval mode instead of persisting a corrupted preference", async () => {
    const { registerToolHandlers } = await import("../src/main/ipc/tools");
    registerToolHandlers(buildContext(rootDir));

    const handler = getHandler("tool:update-builtin-pref");
    await expect(handler(null, "fs.read", {
      enabled: true,
      exposedToModel: true,
      approvalModeOverride: "not-valid",
    })).rejects.toThrow("Invalid tool approvalModeOverride");
  });

  it("does not overwrite a corrupted preference file with a fake success", async () => {
    writeFileSync(join(rootDir, "tool-preferences.json"), "{broken", "utf8");

    const { registerToolHandlers } = await import("../src/main/ipc/tools");
    registerToolHandlers(buildContext(rootDir));

    const handler = getHandler("tool:update-builtin-pref");
    await expect(handler(null, "fs.read", {
      enabled: false,
      exposedToModel: false,
      approvalModeOverride: "inherit",
    })).rejects.toThrow();
    expect(readFileSync(join(rootDir, "tool-preferences.json"), "utf8")).toBe("{broken");
  });

  it("propagates MCP preference write failures instead of returning a local fallback", async () => {
    const blockedPath = join(rootDir, "blocked");
    writeFileSync(blockedPath, "not a directory", "utf8");

    const { registerToolHandlers } = await import("../src/main/ipc/tools");
    registerToolHandlers(buildContext(blockedPath));

    const handler = getHandler("tool:update-mcp-pref");
    await expect(handler(null, "mcp__demo__search", {
      enabled: false,
      exposedToModel: false,
      approvalModeOverride: "always-ask",
    })).rejects.toThrow();
  });
});

import { ipcMain } from "electron";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

import type { ResolvedBuiltinTool, ResolvedMcpTool } from "@shared/contracts";

import { BuiltinToolExecutor } from "../services/builtin-tool-executor";
import type { RuntimeContext } from "../services/runtime-context";

type BuiltinToolExecuteInput = {
  toolId: string;
  label: string;
  sessionId?: string;
  attachedDirectory?: string | null;
};

type McpToolExecuteInput = {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  sessionId?: string;
};

type ToolExecutionResult = {
  success: boolean;
  output: string;
  error?: string;
};

// One executor instance per app lifetime; holds in-memory task list state.
const builtinExecutor = new BuiltinToolExecutor();

// ---------------------------------------------------------------------------
// Tool preference persistence
// ---------------------------------------------------------------------------

type ToolPreferenceMap = Record<string, {
  enabled: boolean;
  exposedToModel: boolean;
  approvalModeOverride: unknown;
}>;

function loadToolPreferences(prefsPath: string): ToolPreferenceMap {
  try {
    if (existsSync(prefsPath)) {
      return JSON.parse(readFileSync(prefsPath, "utf8"));
    }
  } catch { /* ignore */ }
  return {};
}

async function saveToolPreferences(prefsPath: string, prefs: ToolPreferenceMap): Promise<void> {
  try {
    const dir = join(prefsPath, "..");
    await mkdir(dir, { recursive: true });
    await writeFile(prefsPath, JSON.stringify(prefs, null, 2), "utf8");
  } catch (err) {
    console.error("[tools] failed to persist tool preferences", err);
  }
}

export function registerToolHandlers(ctx: RuntimeContext): void {
  // List all resolved builtin tools (merged with user preferences)
  ipcMain.handle("tool:list-builtin", async (): Promise<ResolvedBuiltinTool[]> => {
    return ctx.tools.resolveBuiltinTools();
  });

  // List all resolved MCP tools (merged with user preferences)
  ipcMain.handle("tool:list-mcp", async (): Promise<ResolvedMcpTool[]> => {
    return ctx.tools.resolveMcpTools();
  });

  // Update builtin tool user preferences (enabled, exposedToModel, approvalModeOverride)
  ipcMain.handle(
    "tool:update-builtin-pref",
    async (
      _event,
      toolId: string,
      input: { enabled: boolean; exposedToModel: boolean; approvalModeOverride: unknown },
    ): Promise<ResolvedBuiltinTool> => {
      const tools = ctx.tools.resolveBuiltinTools();
      const existing = tools.find((t) => t.id === toolId);
      if (!existing) {
        throw new Error(`Builtin tool not found: ${toolId}`);
      }
      const updated = { ...existing, ...input } as ResolvedBuiltinTool;

      // Persist preference to disk
      const prefsPath = join(ctx.runtime.paths.myClawDir, "tool-preferences.json");
      const prefs = loadToolPreferences(prefsPath);
      prefs[toolId] = { enabled: input.enabled, exposedToModel: input.exposedToModel, approvalModeOverride: input.approvalModeOverride };
      await saveToolPreferences(prefsPath, prefs);

      return updated;
    },
  );

  // Update MCP tool user preferences
  ipcMain.handle(
    "tool:update-mcp-pref",
    async (
      _event,
      toolId: string,
      input: { enabled: boolean; exposedToModel: boolean; approvalModeOverride: unknown },
    ): Promise<ResolvedMcpTool> => {
      const tools = ctx.tools.resolveMcpTools();
      const existing = tools.find((t) => t.id === toolId);
      if (!existing) {
        throw new Error(`MCP tool not found: ${toolId}`);
      }
      const updated = { ...existing, ...input } as ResolvedMcpTool;

      // Persist preference to disk
      const prefsPath = join(ctx.runtime.paths.myClawDir, "mcp-tool-preferences.json");
      const prefs = loadToolPreferences(prefsPath);
      prefs[toolId] = { enabled: input.enabled, exposedToModel: input.exposedToModel, approvalModeOverride: input.approvalModeOverride };
      await saveToolPreferences(prefsPath, prefs);

      return updated;
    },
  );

  // Execute a builtin tool
  ipcMain.handle(
    "tool:execute-builtin",
    async (_event, input: BuiltinToolExecuteInput): Promise<ToolExecutionResult> => {
      return builtinExecutor.execute(
        input.toolId,
        input.label,
        input.attachedDirectory ?? null,
      );
    },
  );

  // Execute an MCP tool
  ipcMain.handle(
    "tool:execute-mcp",
    async (_event, input: McpToolExecuteInput): Promise<ToolExecutionResult> => {
      if (!ctx.services.mcpManager) {
        return { success: false, output: "", error: "MCP manager not initialized" };
      }
      try {
        const output = await ctx.services.mcpManager.callTool(
          input.serverId,
          input.toolName,
          input.arguments,
        );
        return { success: true, output };
      } catch (err) {
        return {
          success: false,
          output: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}

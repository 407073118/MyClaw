import { ipcMain } from "electron";
import { join, resolve, sep } from "node:path";
import { existsSync } from "node:fs";

import type { RuntimeContext } from "../services/runtime-context";

export function registerWebPanelHandlers(ctx: RuntimeContext): void {
  // Resolve a skill HTML page absolute path for the renderer to load in iframe
  ipcMain.handle("web-panel:resolve-page", async (_event, skillId: string, relativePath: string) => {
    const skill = ctx.state.skills.find((s) => s.id === skillId);
    if (!skill?.path || !relativePath) return null;
    const normalizedPath = relativePath.replace(/\\/g, "/");
    if (!skill.viewFiles?.includes(normalizedPath)) {
      return null;
    }
    const skillRoot = resolve(skill.path);
    const viewPath = resolve(join(skill.path, normalizedPath));
    if (viewPath !== skillRoot && !viewPath.startsWith(`${skillRoot}${sep}`)) {
      return null;
    }
    return existsSync(viewPath) ? viewPath : null;
  });
}

import { ipcMain } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";

import type { RuntimeContext } from "../services/runtime-context";

export function registerWebPanelHandlers(ctx: RuntimeContext): void {
  // Resolve a skill's view.html absolute path for the renderer to load in iframe
  ipcMain.handle("web-panel:resolve-view", async (_event, skillId: string) => {
    const skill = ctx.state.skills.find((s) => s.id === skillId);
    if (!skill?.path) return null;
    const viewPath = join(skill.path, "view.html");
    return existsSync(viewPath) ? viewPath : null;
  });
}

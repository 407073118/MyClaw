import { ipcMain, shell } from "electron";

import type { RuntimeContext } from "../services/runtime-context";

/** 注册桌面端更新相关 IPC，供设置页执行检查、下载与安装动作。 */
export function registerUpdateHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("update:get-state", async () => ctx.services.appUpdater.getSnapshot());

  ipcMain.handle("update:check", async () => ctx.services.appUpdater.checkForUpdates());

  ipcMain.handle("update:download", async () => ctx.services.appUpdater.downloadUpdate());

  ipcMain.handle("update:quit-and-install", async () => ctx.services.appUpdater.quitAndInstall());

  ipcMain.handle("update:open-download-page", async () => {
    const snapshot = ctx.services.appUpdater.getSnapshot();
    if (!snapshot.downloadPageUrl) {
      return { opened: false };
    }
    await shell.openExternal(snapshot.downloadPageUrl);
    return { opened: true };
  });
}

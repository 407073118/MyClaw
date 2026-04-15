import { BrowserWindow, ipcMain, shell } from "electron";
import { dirname, join } from "node:path";

import { EventType } from "@shared/contracts";
import type { ArtifactRuntimeEventPayload, ArtifactScopeRef } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";

function broadcastToRenderers(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function emitArtifactEvent(
  eventType: EventType.ArtifactCreated
    | EventType.ArtifactUpdated
    | EventType.ArtifactCompleted
    | EventType.ArtifactFailed
    | EventType.ArtifactLinked,
  payload: ArtifactRuntimeEventPayload,
): void {
  broadcastToRenderers("session:stream", {
    type: eventType,
    ...payload,
  });
}

/** 注册 artifact 元数据与文件操作 IPC。 */
export function registerArtifactHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("artifact:list-by-scope", async (_event, scope: ArtifactScopeRef) => {
    return ctx.services.artifactRegistry.listArtifactsByScope(scope);
  });

  ipcMain.handle("artifact:list-recent", async (_event, input?: { limit?: number }) => {
    return ctx.services.artifactRegistry.listRecentArtifacts(input?.limit ?? 20);
  });

  ipcMain.handle("artifact:mark-final", async (_event, artifactId: string, scope?: ArtifactScopeRef) => {
    const current = ctx.services.artifactRegistry.getArtifactById(artifactId);
    if (!current) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const updated = (scope && current.storageClass === "workspace")
      ? await ctx.services.artifactManager.promoteArtifactToFinal(artifactId, scope)
      : ctx.services.artifactManager.markArtifactFinal(artifactId);
    const primaryScope = scope ?? ctx.services.artifactRegistry.listArtifactLinks(artifactId)[0];
    if (primaryScope) {
      emitArtifactEvent(EventType.ArtifactUpdated, {
        artifactId: updated.id,
        scopeKind: primaryScope.scopeKind,
        scopeId: primaryScope.scopeId,
        lifecycle: updated.lifecycle,
        status: updated.status,
        title: updated.title,
      });
    }
    return updated;
  });

  ipcMain.handle("artifact:open", async (_event, artifactId: string) => {
    const artifact = ctx.services.artifactRegistry.getArtifactById(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    const absolutePath = join(ctx.runtime.myClawRootPath, artifact.relativePath);
    ctx.services.artifactRegistry.markOpened(artifactId);
    await shell.openPath(absolutePath);
    return { success: true };
  });

  ipcMain.handle("artifact:reveal", async (_event, artifactId: string) => {
    const artifact = ctx.services.artifactRegistry.getArtifactById(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    const absolutePath = join(ctx.runtime.myClawRootPath, artifact.relativePath);
    await shell.openPath(dirname(absolutePath));
    return { success: true };
  });
}

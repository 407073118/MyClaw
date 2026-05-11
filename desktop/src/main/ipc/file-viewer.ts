import { ipcMain, shell } from "electron";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

import { FILE_VIEWER_PANEL_PATH } from "@shared/contracts";
import { buildFileViewerPayload } from "../services/file-viewer";

type FileViewerPreviewInput = {
  path: string;
  baseDirectory?: string | null;
};

export type FileViewerPreviewResult = {
  success: boolean;
  error?: string;
  resolvedPath?: string;
  viewMeta?: {
    viewPath: string;
    title: string;
    data: unknown;
  };
};

/** 判断渲染层传回的路径是否是普通本地路径，避免把 URL 当成本地应用入口。 */
function normalizeLocalPath(input: string, baseDirectory?: string | null): string | null {
  const raw = input.trim();
  if (!raw || /^[a-z]+:\/\//i.test(raw)) return null;
  const base = baseDirectory?.trim() && existsSync(baseDirectory)
    ? baseDirectory
    : process.cwd();
  return resolve(base, raw);
}

/** 为聊天内联文件名构造右侧预览结果，正文只进入 UI payload，不回填聊天文本。 */
export async function buildFileViewerPreviewResult(input: FileViewerPreviewInput): Promise<FileViewerPreviewResult> {
  const resolved = normalizeLocalPath(input.path, input.baseDirectory);
  if (!resolved || !existsSync(resolved)) {
    return {
      success: false,
      error: "文件不存在或不是本地路径。",
    };
  }

  const payload = await buildFileViewerPayload(resolved);
  console.info("[file-viewer] 从聊天内联文件名打开右侧预览", {
    path: resolved,
    viewerKind: payload.viewerKind,
  });
  return {
    success: true,
    resolvedPath: resolved,
    viewMeta: {
      viewPath: FILE_VIEWER_PANEL_PATH,
      title: payload.fileName,
      data: payload,
    },
  };
}

/** 注册文件阅览面板的本地动作 IPC。 */
export function registerFileViewerHandlers(): void {
  ipcMain.handle("file-viewer:preview", async (_event, input: FileViewerPreviewInput) => {
    return buildFileViewerPreviewResult(input);
  });

  ipcMain.handle("file-viewer:open-external", async (_event, path: string) => {
    const resolved = normalizeLocalPath(path);
    if (!resolved || !existsSync(resolved)) {
      throw new Error("文件不存在，无法用本地应用打开。");
    }
    console.info("[file-viewer] 用户从右侧面板请求本地打开", { path: resolved });
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
    return { success: true };
  });

  ipcMain.handle("file-viewer:reveal", async (_event, path: string) => {
    const resolved = normalizeLocalPath(path);
    if (!resolved || !existsSync(resolved)) {
      throw new Error("文件不存在，无法定位。");
    }
    console.info("[file-viewer] 用户从右侧面板请求定位文件", { path: resolved });
    if (typeof shell.showItemInFolder === "function") {
      shell.showItemInFolder(resolved);
    } else {
      await shell.openPath(dirname(resolved));
    }
    return { success: true };
  });
}

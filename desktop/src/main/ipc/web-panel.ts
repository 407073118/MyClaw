import { ipcMain } from "electron";
import { join, relative, resolve, sep } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import type { RuntimeContext } from "../services/runtime-context";

/** 统一路径分隔符，便于跨平台做目录边界校验和回传相对路径。 */
function normalizeSep(path: string): string {
  return path.replace(/\\/g, "/");
}

/** 判断目标路径是否仍位于指定根目录内，避免 HTML 面板越界读取文件。 */
function isInsideBase(base: string, target: string): boolean {
  const normalizedBase = normalizeSep(resolve(base)).toLowerCase();
  const normalizedTarget = normalizeSep(resolve(target)).toLowerCase();
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}/`);
}

/** 规范化 HTML 面板请求的本地 dataRef 路径，兼容 local:/C:/... 写法。 */
function normalizeDataRefPath(rawPath: string): string {
  let normalized = rawPath.trim();
  if (normalized.startsWith("local:")) {
    normalized = normalized.slice("local:".length);
    if (/^\/[A-Za-z]:[\\/]/.test(normalized)) {
      normalized = normalized.slice(1);
    }
  }
  return normalized;
}

/** 解析面板本地 JSON 数据，兼容纯 JSON 和含 application/json script 的包装文件。 */
function parsePanelDataRefContent(content: string): unknown {
  const scriptMatch = content.match(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
  const jsonText = (scriptMatch ? scriptMatch[1] : content).trim();
  return JSON.parse(jsonText);
}

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

  ipcMain.handle("web-panel:read-skill-data-ref", async (_event, skillId: string, dataRef: string) => {
    const skill = ctx.state.skills.find((s) => s.id === skillId);
    if (!skill?.path || typeof dataRef !== "string" || !dataRef.trim()) {
      return { success: false, error: "缺少 skillId 或 dataRef。" };
    }

    const skillRoot = resolve(skill.path);
    const resolvedPath = resolve(skill.path, normalizeDataRefPath(dataRef));
    if (!isInsideBase(skillRoot, resolvedPath)) {
      console.warn("[web-panel] HTML 面板请求越界 dataRef 已拒绝", {
        skillId,
        dataRef,
        resolvedPath,
      });
      return { success: false, error: "dataRef 只能读取当前 Skill 目录内的文件。" };
    }
    if (!existsSync(resolvedPath)) {
      return { success: false, error: "dataRef 文件不存在：" + normalizeSep(relative(skillRoot, resolvedPath)) };
    }

    try {
      const data = parsePanelDataRefContent(readFileSync(resolvedPath, "utf-8"));
      console.info("[web-panel] 已按 HTML 面板请求读取本地 dataRef", {
        skillId,
        dataRef: normalizeSep(relative(skillRoot, resolvedPath)),
      });
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: "dataRef 文件不是合法 JSON：" + (error instanceof Error ? error.message : String(error)),
      };
    }
  });
}

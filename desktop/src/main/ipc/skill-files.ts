import { ipcMain, shell } from "electron";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { RuntimeContext } from "../services/runtime-context";
import type { FileTreeNode } from "@shared/contracts";

function buildTree(dirPath: string, basePath: string): FileTreeNode[] {
  if (!existsSync(dirPath)) return [];

  const entries = readdirSync(dirPath);
  const dirs: FileTreeNode[] = [];
  const files: FileTreeNode[] = [];

  for (const name of entries) {
    const fullPath = join(dirPath, name);
    const relativePath = fullPath
      .slice(basePath.length)
      .replace(/\\/g, "/")
      .replace(/^\//, "");
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      dirs.push({
        name,
        relativePath,
        type: "directory",
        children: buildTree(fullPath, basePath),
      });
    } else {
      files.push({
        name,
        relativePath,
        type: "file",
      });
    }
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  return [...dirs, ...files];
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico"]);

function getImageMimeType(ext: string): string {
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".svg": return "image/svg+xml";
    case ".ico": return "image/x-icon";
    default: return "application/octet-stream";
  }
}

export function registerSkillFileHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("skill:read-tree", (_event, skillId: string) => {
    const skill = ctx.state.skills.find((s) => s.id === skillId);
    if (!skill?.path) throw new Error(`Skill not found: ${skillId}`);
    if (!existsSync(skill.path)) throw new Error(`Skill directory not found: ${skill.path}`);

    return buildTree(skill.path, skill.path);
  });

  ipcMain.handle("skill:read-file", (_event, skillId: string, relativePath: string) => {
    if (relativePath.includes("..")) {
      throw new Error("Path traversal is not allowed");
    }

    const skill = ctx.state.skills.find((s) => s.id === skillId);
    if (!skill?.path) throw new Error(`Skill not found: ${skillId}`);

    const filePath = join(skill.path, relativePath);
    if (!existsSync(filePath)) throw new Error(`File not found: ${relativePath}`);

    const ext = relativePath.substring(relativePath.lastIndexOf(".")).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      const buffer = readFileSync(filePath);
      const base64 = buffer.toString("base64");
      return `data:${getImageMimeType(ext)};base64,${base64}`;
    }

    return readFileSync(filePath, "utf-8");
  });

  /** 重新扫描磁盘上的 Skills 目录，返回最新列表。 */
  ipcMain.handle("skills:refresh", async () => {
    const skills = await ctx.services.refreshSkills();
    return { items: skills };
  });

  /** 在系统文件管理器中打开 Skills 根目录。 */
  ipcMain.handle("skills:open-folder", async () => {
    await shell.openPath(ctx.runtime.skillsRootPath);
  });
}

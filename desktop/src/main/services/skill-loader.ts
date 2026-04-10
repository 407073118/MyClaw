/**
 * 技能加载与种子工具。
 *
 * 从 `index.ts` 中提取，使硅基员工工作空间也能复用
 * `loadSkillsFromDisk` 和 `seedBuiltinSkills`。
 */

import { app } from "electron";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";

import type { SkillDefinition } from "@shared/contracts";
import { createLogger } from "./logger";

const log = createLogger("skill-loader");

// ---------------------------------------------------------------------------
// 辅助方法
// ---------------------------------------------------------------------------

/**
 * 递归复制整个目录树。
 * 可兼容 asar 归档（cpSync 在 Electron 中未必完全可用）。
 */
function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      const content = readFileSync(srcPath);
      const { writeFileSync: wfs } = require("node:fs") as typeof import("node:fs");
      wfs(destPath, content);
    }
  }
}

/**
 * 从 SKILL.md 中提取 `name` 与 `description`。
 * 如果存在 `---` 包裹的 YAML 风格 frontmatter，则优先读取；
 * 否则回退到目录名以及正文中第一条非标题文本。
 */
function extractSkillMeta(dirName: string, markdown: string): { name: string; description: string; workspaceDir: string | null } {
  const lines = markdown.split(/\r?\n/);
  let name = dirName;
  let description = "";
  let workspaceDir: string | null = null;

  if (lines[0]?.trim() === "---") {
    const closingIdx = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (closingIdx > 0) {
      for (const rawLine of lines.slice(1, closingIdx)) {
        const line = rawLine.trim();
        const colonIdx = line.indexOf(":");
        if (colonIdx <= 0) continue;
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (key === "name" && value) name = value;
        if (key === "description" && value) description = value;
        if (key === "workspacedir" && value) workspaceDir = value;
      }
      if (!description) {
        const bodyLines = lines.slice(closingIdx + 1);
        description = bodyLines.find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? "";
      }
      return { name, description, workspaceDir };
    }
  }

  description = lines.find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? "";
  return { name, description, workspaceDir };
}

// ---------------------------------------------------------------------------
// 导出接口
// ---------------------------------------------------------------------------

/**
 * 扫描 `skillsDir` 中的技能定义。
 *
 * 支持两种磁盘格式：
 *
 * 1. JSON manifest：即 `<name>.json` 文件，内容符合
 *    `SkillDefinition` 结构。
 *
 * 2. SKILL.md 目录：即包含 `SKILL.md` 文件的子目录，
 *    系统会自动推导出最小 `SkillDefinition`。
 */
export function loadSkillsFromDisk(skillsDir: string): SkillDefinition[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: SkillDefinition[] = [];

  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const fullPath = resolve(skillsDir, entry);

    // --- 形式 1：JSON manifest 文件 ---
    if (entry.endsWith(".json")) {
      try {
        const raw = readFileSync(fullPath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<SkillDefinition>;
        if (parsed && typeof parsed === "object" && typeof parsed.id === "string" && typeof parsed.name === "string") {
          const skillDir = parsed.path ?? fullPath;
          let jsonViewFiles: string[] = [];
          try {
            const dirPath = statSync(skillDir).isDirectory() ? skillDir : dirname(skillDir);
            jsonViewFiles = readdirSync(dirPath).filter((f) => f.endsWith(".html"));
          } catch { /* ignore */ }
          skills.push({
            id: parsed.id,
            name: parsed.name,
            description: parsed.description ?? "",
            path: skillDir,
            enabled: parsed.enabled !== false,
            allowedTools: parsed.allowedTools,
            disableModelInvocation: parsed.disableModelInvocation ?? false,
            workingDirectory: parsed.workingDirectory ?? null,
            entrypoint: parsed.entrypoint ?? null,
            hasScriptsDirectory: parsed.hasScriptsDirectory ?? false,
            hasReferencesDirectory: parsed.hasReferencesDirectory ?? false,
            hasAssetsDirectory: parsed.hasAssetsDirectory ?? false,
            hasTestsDirectory: parsed.hasTestsDirectory ?? false,
            hasAgentsDirectory: parsed.hasAgentsDirectory ?? false,
            hasViewFile: jsonViewFiles.length > 0,
            viewFiles: parsed.viewFiles ?? jsonViewFiles,
          });
        }
      } catch {
        log.warn("Failed to parse JSON skill manifest", { path: fullPath });
      }
      continue;
    }

    // --- 形式 2：SKILL.md 目录 ---
    const skillMdPath = join(fullPath, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      continue;
    }

    try {
      const markdown = readFileSync(skillMdPath, "utf-8");
      const { name, description, workspaceDir } = extractSkillMeta(entry, markdown);

      let subEntries: string[] = [];
      try { subEntries = readdirSync(fullPath); } catch { /* ignore */ }
      const subDirs = new Set(subEntries.map((e) => e.toLowerCase()));

      const skillId = `skill-${name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")}`;
      const viewFiles = subEntries.filter((f) => f.endsWith(".html"));

      skills.push({
        id: skillId,
        name,
        description,
        path: fullPath,
        enabled: true,
        allowedTools: undefined,
        disableModelInvocation: false,
        workingDirectory: workspaceDir,
        entrypoint: null,
        hasScriptsDirectory: subDirs.has("scripts"),
        hasReferencesDirectory: subDirs.has("references"),
        hasAssetsDirectory: subDirs.has("assets"),
        hasTestsDirectory: subDirs.has("tests"),
        hasAgentsDirectory: subDirs.has("agents"),
        hasViewFile: viewFiles.length > 0,
        viewFiles,
      });
    } catch {
      log.warn("Failed to read SKILL.md in directory", { path: fullPath });
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

/** 将内置技能种子到目标目录（仅在不存在时复制）。 */
export function seedBuiltinSkills(skillsDir: string): void {
  let appPath: string;
  try {
    appPath = app.getAppPath();
  } catch {
    // 测试环境下 Electron app 不可用，仅使用 __dirname 候选路径
    appPath = "";
  }

  const candidates = [
    ...(appPath ? [join(appPath, "builtin-skills")] : []),
    join(__dirname, "../../builtin-skills"),
    join(__dirname, "../../../builtin-skills"),
  ];

  let builtinDir: string | null = null;
  for (const c of candidates) {
    if (existsSync(c)) { builtinDir = c; break; }
  }
  if (!builtinDir) {
    log.warn("No builtin-skills directory found", { candidates });
    return;
  }
  log.info(`Found builtin-skills at: ${builtinDir}`);

  try {
    const entries = readdirSync(builtinDir);
    for (const entry of entries) {
      const src = join(builtinDir, entry);
      const dest = join(skillsDir, entry);
      if (!existsSync(dest)) {
        copyDirRecursive(src, dest);
        log.info(`Seeded builtin skill: ${entry}`);
      }
    }
  } catch (err) {
    log.warn("Failed to seed builtin skills", { error: String(err) });
  }
}

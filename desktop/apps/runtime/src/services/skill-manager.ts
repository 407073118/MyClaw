import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SkillDefinition, SkillDetail } from "@myclaw-desktop/shared";
import { executeProgram } from "./process-executor";

const STARTER_SKILL_NAME = "code-review";
const STARTER_SKILL_ENTRY_FILE = "SKILL.md";

type SkillFrontmatter = {
  name?: string;
  description?: string;
  allowedTools?: string[];
  disableModelInvocation?: boolean;
  workingDirectory?: string;
  entrypoint?: string;
};

export type SkillManagerOptions = {
  starterSkillSeedPath?: string;
};

function parseSkillDescription(markdown: string): string {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  return lines[0] ?? "Local skill";
}

function normalizeFrontmatterKey(key: string): string {
  return key.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function parseFrontmatterString(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function parseFrontmatterBoolean(value: string): boolean | undefined {
  const normalized = parseFrontmatterString(value).toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

function assignFrontmatterValue(frontmatter: SkillFrontmatter, rawKey: string, rawValue: string | string[]): void {
  const key = normalizeFrontmatterKey(rawKey);

  if (key === "name" && typeof rawValue === "string") {
    const value = parseFrontmatterString(rawValue);
    if (value) {
      frontmatter.name = value;
    }
    return;
  }

  if (key === "description" && typeof rawValue === "string") {
    const value = parseFrontmatterString(rawValue);
    if (value) {
      frontmatter.description = value;
    }
    return;
  }

  if (key === "allowed-tools" || key === "allowedtools") {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const normalizedValues = values.map((value) => parseFrontmatterString(value)).filter(Boolean);
    if (normalizedValues.length > 0) {
      frontmatter.allowedTools = normalizedValues;
    }
    return;
  }

  if (key === "disable-model-invocation" || key === "disablemodelinvocation") {
    if (typeof rawValue === "string") {
      const value = parseFrontmatterBoolean(rawValue);
      if (typeof value === "boolean") {
        frontmatter.disableModelInvocation = value;
      }
    }
    return;
  }

  if (key === "working-directory" || key === "workingdirectory") {
    if (typeof rawValue === "string") {
      const value = parseFrontmatterString(rawValue);
      if (value) {
        frontmatter.workingDirectory = value;
      }
    }
    return;
  }

  if (key === "entrypoint" && typeof rawValue === "string") {
    const value = parseFrontmatterString(rawValue);
    if (value) {
      frontmatter.entrypoint = value;
    }
  }
}

/** 解析标准 SKILL.md frontmatter，供名称与描述提取复用。 */
function parseSkillFrontmatter(markdown: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return {
      frontmatter: {},
      body: markdown,
    };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex <= 0) {
    return {
      frontmatter: {},
      body: markdown,
    };
  }

  const frontmatter: SkillFrontmatter = {};
  let pendingArrayKey: string | null = null;
  let pendingArrayValues: string[] = [];

  const flushPendingArray = (): void => {
    if (pendingArrayKey && pendingArrayValues.length > 0) {
      assignFrontmatterValue(frontmatter, pendingArrayKey, pendingArrayValues);
    }
    pendingArrayKey = null;
    pendingArrayValues = [];
  };

  for (const rawLine of lines.slice(1, closingIndex)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (pendingArrayKey && line.startsWith("- ")) {
      pendingArrayValues.push(line.slice(2).trim());
      continue;
    }

    flushPendingArray();
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!value) {
      pendingArrayKey = key;
      pendingArrayValues = [];
      continue;
    }

    assignFrontmatterValue(frontmatter, key, value);
  }

  flushPendingArray();

  return {
    frontmatter,
    body: lines.slice(closingIndex + 1).join("\n"),
  };
}

/** 优先读取标准 frontmatter 描述，缺失时回退正文第一条有效文本。 */
function resolveSkillDescription(markdown: string): string {
  const { frontmatter, body } = parseSkillFrontmatter(markdown);
  if (frontmatter.description) {
    return frontmatter.description;
  }

  return parseSkillDescription(body);
}

/** 优先读取标准 frontmatter 名称，缺失时回退目录名。 */
function resolveSkillName(directoryName: string, markdown: string): string {
  const { frontmatter } = parseSkillFrontmatter(markdown);
  return frontmatter.name?.trim() || directoryName;
}

/** 提取标准 skill 包结构信号，避免再把技能误判成脚本插件。 */
function resolveSkillPackageStructure(entries: Array<{ name: string; isDirectory: () => boolean }>): Pick<
  SkillDefinition,
  | "hasScriptsDirectory"
  | "hasReferencesDirectory"
  | "hasAssetsDirectory"
  | "hasTestsDirectory"
  | "hasAgentsDirectory"
> {
  const directoryNames = new Set(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name.toLowerCase()),
  );

  return {
    hasScriptsDirectory: directoryNames.has("scripts"),
    hasReferencesDirectory: directoryNames.has("references"),
    hasAssetsDirectory: directoryNames.has("assets"),
    hasTestsDirectory: directoryNames.has("tests"),
    hasAgentsDirectory: directoryNames.has("agents"),
  };
}

function normalizeSkillId(skillName: string): string {
  return `skill-${skillName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function normalizeSkillDirectoryName(skillName: string): string {
  return skillName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function buildSkillEntryPath(skillPath: string): string {
  return join(skillPath, STARTER_SKILL_ENTRY_FILE);
}

/** 解析开发环境与打包环境下可用的 starter skill 种子路径候选。 */
function buildDefaultStarterSkillSeedCandidates(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MYCLAW_STARTER_SKILL_PATH?.trim(),
    resolve(moduleDir, "../../skills", STARTER_SKILL_NAME),
    resolve(process.cwd(), "skills", STARTER_SKILL_NAME),
    resolve(process.cwd(), "apps", "runtime", "skills", STARTER_SKILL_NAME),
  ].filter((value): value is string => Boolean(value));

  return [...new Set(candidates)];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class SkillManager {
  constructor(
    private readonly skillsRootPath: string,
    private readonly options: SkillManagerOptions = {},
  ) {}

  getRootPath(): string {
    return this.skillsRootPath;
  }

  async initialize(): Promise<void> {
    await mkdir(this.skillsRootPath, { recursive: true });
    await this.ensureStarterSkill();
  }

  /** 枚举标准 SKILL.md 包，并输出前端展示与调用所需元数据。 */
  async list(): Promise<SkillDefinition[]> {
    await mkdir(this.skillsRootPath, { recursive: true });
    const entries = await readdir(this.skillsRootPath, { withFileTypes: true });
    const skills: SkillDefinition[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDir = resolve(this.skillsRootPath, entry.name);
      const skillMarkdownPath = buildSkillEntryPath(skillDir);
      if (!(await fileExists(skillMarkdownPath))) {
        continue;
      }

      const packageEntries = await readdir(skillDir, { withFileTypes: true });
      const markdown = await readFile(skillMarkdownPath, "utf8");
      const { frontmatter } = parseSkillFrontmatter(markdown);
      const resolvedName = resolveSkillName(entry.name, markdown);

      skills.push({
        id: normalizeSkillId(resolvedName),
        name: resolvedName,
        description: resolveSkillDescription(markdown),
        path: skillDir,
        enabled: true,
        allowedTools: frontmatter.allowedTools,
        disableModelInvocation: frontmatter.disableModelInvocation ?? false,
        workingDirectory: frontmatter.workingDirectory ?? null,
        entrypoint: frontmatter.entrypoint ?? null,
        ...resolveSkillPackageStructure(packageEntries),
      });
    }

    skills.sort((a, b) => a.name.localeCompare(b.name));
    return skills;
  }

  /** 按 skill 名、skill id 或目录名解析对话中的技能调用。 */
  async resolveSkillByInvocation(invocation: string): Promise<SkillDefinition | null> {
    const [firstToken] = invocation.trim().split(/\s+/, 1);
    if (!firstToken) {
      return null;
    }

    const skills = await this.list();
    const normalized = firstToken.toLowerCase();

    return (
      skills.find((item) => item.name.toLowerCase() === normalized) ??
      skills.find((item) => item.id.replace(/^skill-/, "") === normalized.replace(/^skill[._-]/, "")) ??
      skills.find((item) => basename(item.path).toLowerCase() === normalized) ??
      null
    );
  }

  /** 读取指定 Skill 的详情，返回桌面端展示所需的 SKILL.md 路径与正文。 */
  async getDetail(skillId: string): Promise<SkillDetail | null> {
    const skills = await this.list();
    const skill = skills.find((item) => item.id === skillId);
    if (!skill) {
      return null;
    }

    const entryPath = buildSkillEntryPath(skill.path);
    const content = await readFile(entryPath, "utf8");

    return {
      ...skill,
      entryPath,
      content,
    };
  }

  async installCloudSkillRelease(input: {
    downloadUrl: string;
    skillName: string;
  }): Promise<SkillDefinition> {
    const downloadUrl = input.downloadUrl.trim();
    const normalizedDirectoryName = normalizeSkillDirectoryName(input.skillName.trim());

    if (!downloadUrl) {
      throw new Error("downloadUrl is required");
    }

    if (!normalizedDirectoryName) {
      throw new Error("skillName is required");
    }

    await mkdir(this.skillsRootPath, { recursive: true });
    const workingRoot = await mkdtemp(join(this.skillsRootPath, ".cloud-import-"));
    const archivePath = join(workingRoot, "release.zip");
    const extractPath = join(workingRoot, "extracted");
    const destinationPath = join(this.skillsRootPath, normalizedDirectoryName);

    try {
      await mkdir(extractPath, { recursive: true });
      await this.downloadArchive(downloadUrl, archivePath);
      await this.extractArchive(archivePath, extractPath);

      const sourcePath = await this.resolveSkillSourcePath(extractPath);
      await rm(destinationPath, { recursive: true, force: true });
      await cp(sourcePath, destinationPath, { recursive: true, force: true });

      const installed = (await this.list()).find((skill) => resolve(skill.path) === resolve(destinationPath));
      if (!installed) {
        throw new Error("Installed skill not found after import");
      }

      return installed;
    } finally {
      await rm(workingRoot, { recursive: true, force: true });
    }
  }

  private async downloadArchive(downloadUrl: string, destinationPath: string): Promise<void> {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(destinationPath, bytes);
  }

  private async extractArchive(archivePath: string, destinationPath: string): Promise<void> {
    const commandResult =
      platform() === "win32" && archivePath.toLowerCase().endsWith(".zip")
        ? await executeProgram({
            command: "powershell.exe",
            args: [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-Command",
              `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationPath.replace(/'/g, "''")}' -Force`,
            ],
            cwd: this.skillsRootPath,
          })
        : await executeProgram({
            command: "tar",
            args: ["-xf", archivePath, "-C", destinationPath],
            cwd: this.skillsRootPath,
          });

    if (commandResult.timedOut || (commandResult.exitCode ?? 1) !== 0) {
      const detail = [commandResult.stderr, commandResult.stdout]
        .find((value) => value && value.trim().length > 0)
        ?.trim();
      throw new Error(detail ? `Extract archive failed: ${detail}` : "Extract archive failed");
    }
  }

  private async resolveSkillSourcePath(extractPath: string): Promise<string> {
    if (await fileExists(join(extractPath, "SKILL.md"))) {
      return extractPath;
    }

    const directories = (await readdir(extractPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    if (directories.length === 1) {
      const wrappedPath = join(extractPath, directories[0]);
      if (await fileExists(join(wrappedPath, "SKILL.md"))) {
        return wrappedPath;
      }
    }

    throw new Error("Imported archive does not contain SKILL.md");
  }

  /** 首次初始化时确保 starter skill 可用，优先从内置资源拷贝。 */
  private async ensureStarterSkill(): Promise<void> {
    const existing = await this.list();
    if (existing.length > 0) {
      return;
    }

    const skillDir = join(this.skillsRootPath, STARTER_SKILL_NAME);
    const seeded = await this.seedStarterSkillFromBuiltinSource(skillDir);
    if (seeded) {
      return;
    }

    await this.writeFallbackStarterSkill(skillDir);
  }

  /** 从内置 seed 目录复制 starter skill，复制成功返回 true。 */
  private async seedStarterSkillFromBuiltinSource(destinationPath: string): Promise<boolean> {
    const seedPath = await this.resolveStarterSkillSeedPath();
    if (!seedPath) {
      return false;
    }

    await rm(destinationPath, { recursive: true, force: true });
    await cp(seedPath, destinationPath, { recursive: true, force: true });
    return true;
  }

  /** 解析 starter skill 的种子目录，支持显式配置与默认探测。 */
  private async resolveStarterSkillSeedPath(): Promise<string | null> {
    const configuredPath = this.options.starterSkillSeedPath?.trim();
    const candidates = configuredPath ? [configuredPath] : buildDefaultStarterSkillSeedCandidates();

    for (const candidate of candidates) {
      if (await fileExists(buildSkillEntryPath(candidate))) {
        return candidate;
      }
    }

    return null;
  }

  /** 当 seed 资源不可用时，回退生成最小可用 starter skill。 */
  private async writeFallbackStarterSkill(skillDir: string): Promise<void> {
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      buildSkillEntryPath(skillDir),
      [
        "---",
        "name: code-review",
        "description: Review local code changes before editing or shipping.",
        "---",
        "",
        "# Code Review",
        "",
        "Review the current workspace and highlight risks before shipping.",
        "",
        "## Usage",
        "",
        "Run `/skill code-review` to inspect the current worktree.",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(skillDir, "run.ps1"),
      [
        "param(",
        "  [Parameter(ValueFromRemainingArguments = $true)]",
        "  [string[]]$Args",
        ")",
        "$joined = if ($Args) { $Args -join ' ' } else { '(none)' }",
        "Write-Output \"Skill code-review executed. Args: $joined\"",
      ].join("\n"),
      "utf8",
    );
  }
}

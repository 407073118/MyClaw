import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRuntimeApp } from "../server";
import { SkillManager } from "./skill-manager";

function createZipArchive(sourceDirectory: string, destinationZipPath: string): void {
  if (platform() === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Compress-Archive -Path '${join(sourceDirectory, "*")}' -DestinationPath '${destinationZipPath}' -Force`,
      ],
      { stdio: "ignore" },
    );
    return;
  }

  execFileSync(
    "tar",
    ["-a", "-c", "-f", destinationZipPath, "-C", sourceDirectory, "."],
    { stdio: "ignore" },
  );
}

async function createZipWithRootFiles(tempRoot: string, skillContent: string): Promise<string> {
  const sourceDirectory = join(tempRoot, "zip-root-files");
  const archivePath = join(tempRoot, "root-files.zip");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(join(sourceDirectory, "SKILL.md"), skillContent, "utf8");
  await writeFile(join(sourceDirectory, "run.ps1"), "Write-Output root", "utf8");
  createZipArchive(sourceDirectory, archivePath);
  return archivePath;
}

async function createZipWithSingleWrapperDirectory(tempRoot: string, skillContent: string): Promise<string> {
  const wrapperRoot = join(tempRoot, "zip-wrapper");
  const wrappedSkillDirectory = join(wrapperRoot, "wrapped-skill");
  const archivePath = join(tempRoot, "wrapper.zip");
  await mkdir(wrappedSkillDirectory, { recursive: true });
  await writeFile(join(wrappedSkillDirectory, "SKILL.md"), skillContent, "utf8");
  await writeFile(join(wrappedSkillDirectory, "run.ps1"), "Write-Output wrapped", "utf8");
  createZipArchive(wrapperRoot, archivePath);
  return archivePath;
}

function createFileServer(archivePath: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    if (request.url !== "/artifact.zip") {
      response.writeHead(404);
      response.end();
      return;
    }

    const bytes = await readFile(archivePath);
    response.writeHead(200, {
      "content-type": "application/zip",
      "content-length": String(bytes.length),
    });
    response.end(bytes);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind test server"));
        return;
      }

      resolve({
        url: `http://127.0.0.1:${address.port}/artifact.zip`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}

describe("skill manager bootstrap", () => {
  let tempDir: string;
  let skillsRootPath: string;
  let seedSkillPath: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-skill-bootstrap-"));
    skillsRootPath = join(tempDir, ".myClaw", "skills");
    seedSkillPath = join(tempDir, "seed", "code-review");
    await mkdir(seedSkillPath, { recursive: true });
    await writeFile(join(seedSkillPath, "SKILL.md"), "# Seeded Skill\n\nSeeded from builtin skill.", "utf8");
    await writeFile(join(seedSkillPath, "run.ps1"), "Write-Output seeded", "utf8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates skills root path during initialize", async () => {
    const manager = new SkillManager(skillsRootPath, {
      starterSkillSeedPath: seedSkillPath,
    });

    await manager.initialize();

    await expect(access(skillsRootPath)).resolves.toBeUndefined();
  });

  it("seeds starter skill from builtin seed path on first launch", async () => {
    const manager = new SkillManager(skillsRootPath, {
      starterSkillSeedPath: seedSkillPath,
    });

    await manager.initialize();

    const starterContent = await readFile(join(skillsRootPath, "code-review", "SKILL.md"), "utf8");
    expect(starterContent).toContain("Seeded from builtin skill.");
  });

  it("prefers frontmatter description when listing skills", async () => {
    const manager = new SkillManager(skillsRootPath, {
      starterSkillSeedPath: seedSkillPath,
    });

    await manager.initialize();
    const customSkillPath = join(skillsRootPath, "br-interview-workspace");
    await mkdir(customSkillPath, { recursive: true });
    await writeFile(
      join(customSkillPath, "SKILL.md"),
      [
        "---",
        "name: br-interview-workspace",
        "description: Use when 需要在本地文件系统中完成招聘工作流。",
        "---",
        "",
        "# br-interview-workspace",
        "",
        "这里是正文第一段，不应该覆盖 description。",
      ].join("\n"),
      "utf8",
    );

    const skills = await manager.list();
    const interviewSkill = skills.find((item) => item.name === "br-interview-workspace");

    expect(interviewSkill?.description).toBe("Use when 需要在本地文件系统中完成招聘工作流。");
  });

  it("derives standard skill package metadata from SKILL.md and package directories", async () => {
    const manager = new SkillManager(skillsRootPath, {
      starterSkillSeedPath: seedSkillPath,
    });

    await manager.initialize();
    const standardSkillPath = join(skillsRootPath, "br-interview-workspace");
    await mkdir(join(standardSkillPath, "scripts"), { recursive: true });
    await mkdir(join(standardSkillPath, "agents"), { recursive: true });
    await mkdir(join(standardSkillPath, "tests"), { recursive: true });
    await writeFile(
      join(standardSkillPath, "SKILL.md"),
      [
        "---",
        "name: interview-workspace",
        "description: Standard skill package for interview workflows.",
        "---",
        "",
        "# br-interview-workspace",
        "",
        "正文说明。",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(standardSkillPath, "scripts", "manage_job.py"), "print('ok')", "utf8");
    await writeFile(join(standardSkillPath, "agents", "openai.yaml"), "model: gpt-5", "utf8");
    await writeFile(join(standardSkillPath, "tests", "test_skill.py"), "def test_ok(): pass", "utf8");

    const skills = await manager.list();
    const standardSkill = skills.find((item) => item.id === "skill-interview-workspace");

    expect(standardSkill?.name).toBe("interview-workspace");
    expect(standardSkill?.description).toBe("Standard skill package for interview workflows.");
    expect(standardSkill?.hasScriptsDirectory).toBe(true);
    expect(standardSkill?.hasAgentsDirectory).toBe(true);
    expect(standardSkill?.hasTestsDirectory).toBe(true);
    expect(standardSkill?.hasReferencesDirectory).toBe(false);
    expect(standardSkill?.hasAssetsDirectory).toBe(false);
  });

  it("parses declarative execution metadata from standard skill frontmatter", async () => {
    const manager = new SkillManager(skillsRootPath, {
      starterSkillSeedPath: seedSkillPath,
    });

    await manager.initialize();
    const standardSkillPath = join(skillsRootPath, "br-interview-workspace");
    await mkdir(join(standardSkillPath, "scripts"), { recursive: true });
    await writeFile(
      join(standardSkillPath, "SKILL.md"),
      [
        "---",
        "name: br-interview-workspace",
        "description: Interview workflow skill.",
        "allowed-tools:",
        "  - exec_command",
        "  - fs_read",
        "disable-model-invocation: true",
        "working-directory: scripts",
        "entrypoint: scripts/init_workspace.py",
        "---",
        "",
        "# br-interview-workspace",
      ].join("\n"),
      "utf8",
    );

    const detail = await manager.getDetail("skill-br-interview-workspace");

    expect(detail?.allowedTools).toEqual(["exec_command", "fs_read"]);
    expect(detail?.disableModelInvocation).toBe(true);
    expect(detail?.workingDirectory).toBe("scripts");
    expect(detail?.entrypoint).toBe("scripts/init_workspace.py");
  });

  it("resolves standard skill packages by frontmatter name during invocation", async () => {
    const manager = new SkillManager(skillsRootPath, {
      starterSkillSeedPath: seedSkillPath,
    });

    await manager.initialize();
    const standardSkillPath = join(skillsRootPath, "br-interview-workspace");
    await mkdir(standardSkillPath, { recursive: true });
    await writeFile(
      join(standardSkillPath, "SKILL.md"),
      [
        "---",
        "name: interview-workspace",
        "description: Standard skill package for interview workflows.",
        "---",
        "",
        "# br-interview-workspace",
      ].join("\n"),
      "utf8",
    );

    const resolved = await manager.resolveSkillByInvocation("interview-workspace summarize");

    expect(resolved?.id).toBe("skill-interview-workspace");
    expect(resolved?.name).toBe("interview-workspace");
    expect(resolved?.path).toBe(standardSkillPath);
  });
});

describe("skill manager cloud import", () => {
  let tempDir: string;
  let stateFilePath: string;
  let workspaceRoot: string;
  let skillsRootPath: string;
  let runtimeClose: (() => Promise<void>) | undefined;
  let artifactServerClose: (() => Promise<void>) | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-skill-manager-"));
    stateFilePath = join(tempDir, "runtime-state.db");
    workspaceRoot = join(tempDir, "workspace");
    skillsRootPath = join(workspaceRoot, "skills");
  });

  afterEach(async () => {
    try {
      await runtimeClose?.();
    } catch (error) {
      const closeError = error as NodeJS.ErrnoException;
      if (closeError.message !== "Server is not running.") {
        throw error;
      }
    }

    try {
      await artifactServerClose?.();
    } catch (error) {
      const closeError = error as NodeJS.ErrnoException;
      if (closeError.message !== "Server is not running.") {
        throw error;
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("imports a cloud zip where SKILL.md is at archive root", async () => {
    const manager = new SkillManager(skillsRootPath);
    await manager.initialize();
    const archivePath = await createZipWithRootFiles(tempDir, "# Root Skill\n\nRoot archive format.");
    const artifactServer = await createFileServer(archivePath);
    artifactServerClose = artifactServer.close;

    const installed = await manager.installCloudSkillRelease({
      downloadUrl: artifactServer.url,
      skillName: "cloud-root-skill",
    });

    expect(installed.name).toBe("cloud-root-skill");
    const installedSkillMarkdown = await readFile(join(installed.path, "SKILL.md"), "utf8");
    expect(installedSkillMarkdown).toContain("Root archive format.");
  }, 60000);

  it("imports a cloud zip where SKILL.md is inside a single wrapper directory", async () => {
    const manager = new SkillManager(skillsRootPath);
    await manager.initialize();
    const archivePath = await createZipWithSingleWrapperDirectory(
      tempDir,
      "# Wrapped Skill\n\nSingle wrapper directory format.",
    );
    const artifactServer = await createFileServer(archivePath);
    artifactServerClose = artifactServer.close;

    const installed = await manager.installCloudSkillRelease({
      downloadUrl: artifactServer.url,
      skillName: "cloud-wrapped-skill",
    });

    expect(installed.name).toBe("cloud-wrapped-skill");
    const installedSkillMarkdown = await readFile(join(installed.path, "SKILL.md"), "utf8");
    expect(installedSkillMarkdown).toContain("Single wrapper directory format.");
  }, 60000);

  it("imports cloud skill releases through runtime api", async () => {
    const archivePath = await createZipWithRootFiles(tempDir, "# Runtime Import\n\nCloud runtime import.");
    const artifactServer = await createFileServer(archivePath);
    artifactServerClose = artifactServer.close;

    const runtime = await createRuntimeApp({
      port: 0,
      stateFilePath,
      workspaceRoot,
    });
    runtimeClose = runtime.close;

    const response = await fetch(`${runtime.baseUrl}/api/skills/import-cloud-release`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        downloadUrl: artifactServer.url,
        skillName: "runtime-cloud-skill",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.skill.name).toBe("runtime-cloud-skill");
    expect(payload.skills.items.some((item: { name: string }) => item.name === "runtime-cloud-skill")).toBe(true);
  }, 60000);

  it("returns installed skill detail through runtime api", async () => {
    const runtime = await createRuntimeApp({
      port: 0,
      stateFilePath,
      workspaceRoot,
    });
    runtimeClose = runtime.close;

    const response = await fetch(`${runtime.baseUrl}/api/skills/skill-code-review`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.skill.id).toBe("skill-code-review");
    expect(payload.skill.entryPath).toContain("SKILL.md");
    expect(payload.skill.content).toContain("Usage");
  }, 60000);
});

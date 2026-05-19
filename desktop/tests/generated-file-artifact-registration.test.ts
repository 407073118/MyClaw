import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MyClawPaths } from "../src/main/services/directory-service";
import { ArtifactManager, resolveArtifactAbsolutePath } from "../src/main/services/artifact-manager";
import { ArtifactRegistry } from "../src/main/services/artifact-registry";
import {
  executeArtifactRegisterTool,
  registerGeneratedFileArtifact,
} from "../src/main/services/artifact-tool";
import { SessionDatabase } from "../src/main/services/session-database";
import { buildToolSchemas, functionNameToToolId } from "../src/main/services/tool-schemas";

function createTestPaths(rootDir: string): MyClawPaths {
  const myClawDir = join(rootDir, "myClaw");
  return {
    rootDir,
    myClawDir,
    skillsDir: join(myClawDir, "skills"),
    projectCapabilitiesDir: join(myClawDir, "project-capabilities"),
    projectCapabilitiesDbFile: join(myClawDir, "project-capabilities.db"),
    workspaceDir: join(myClawDir, "workspace"),
    artifactsDir: join(myClawDir, "artifacts"),
    cacheDir: join(myClawDir, "cache"),
    sessionsDir: join(myClawDir, "sessions"),
    sessionsDbFile: join(myClawDir, "sessions.db"),
    timeDbFile: join(myClawDir, "time.db"),
    modelsDir: join(myClawDir, "models"),
    settingsFile: join(myClawDir, "settings.json"),
  };
}

describe("generated file artifact registration", () => {
  let rootDir: string;
  let paths: MyClawPaths;
  let db: SessionDatabase;
  let registry: ArtifactRegistry;
  let manager: ArtifactManager;

  beforeEach(async () => {
    rootDir = mkdtempSync(join(tmpdir(), `myclaw-artifacts-${randomUUID()}-`));
    paths = createTestPaths(rootDir);
    db = await SessionDatabase.create(paths.sessionsDbFile);
    registry = new ArtifactRegistry(db);
    manager = new ArtifactManager(paths, registry);
  });

  afterEach(() => {
    db.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("exposes the configured Files output directory in file-producing tool schemas", () => {
    const tools = buildToolSchemas(paths.myClawDir, undefined, undefined, undefined, {
      artifactsRootPath: paths.artifactsDir,
    });
    const names = tools.map((tool) => tool.function.name);
    const fsWrite = tools.find((tool) => tool.function.name === "fs_write");
    const artifactRegister = tools.find((tool) => tool.function.name === "artifact_register");

    expect(names).toContain("fs_write");
    expect(names).toContain("artifact_register");
    expect(functionNameToToolId("artifact_register")).toBe("artifact.register");
    expect(fsWrite?.function.description).toContain(paths.artifactsDir);
    expect(fsWrite?.function.description).toContain("configured Files output directory");
    expect(artifactRegister?.function.description).toContain("Files");
    expect(artifactRegister?.function.description).toContain(paths.artifactsDir);
  });

  it("copies a file written inside MyClaw into the configured Files output directory", async () => {
    const filePath = join(paths.myClawDir, "report.md");
    writeFileSync(filePath, "# 报告\n\n正文", "utf8");

    const artifact = await registerGeneratedFileArtifact({
      artifactManager: manager,
      paths,
      cwd: paths.myClawDir,
      sessionId: "session-1",
      filePath: "report.md",
      title: "报告",
      kind: "doc",
      sourceToolName: "fs_write",
    });

    expect(artifact.title).toBe("报告");
    expect(artifact.kind).toBe("doc");
    expect(artifact.storageClass).toBe("artifact");
    expect(artifact.relativePath).toBe("sessions/session-1/report.md");

    const managedPath = join(paths.artifactsDir, artifact.relativePath);
    expect(existsSync(managedPath)).toBe(true);
    expect(resolveArtifactAbsolutePath(paths, artifact)).toBe(managedPath);
    expect(readFileSync(managedPath, "utf8")).toBe("# 报告\n\n正文");

    const scoped = registry.listUserArtifactsByScope({ scopeKind: "session", scopeId: "session-1" });
    expect(scoped.map((item) => item.id)).toContain(artifact.id);
  });

  it("copies an external generated file into the configured Files output directory before recording it", async () => {
    const externalDir = join(rootDir, "external-project");
    const externalPath = join(externalDir, "analysis.md");
    mkdirSync(externalDir, { recursive: true });
    writeFileSync(externalPath, "# 外部分析\n", "utf8");

    const result = await executeArtifactRegisterTool(
      {
        path: externalPath,
        title: "外部分析",
        kind: "doc",
      },
      {
        artifactManager: manager,
        paths,
        cwd: externalDir,
        sessionId: "session-1",
      },
    );

    expect(result.success).toBe(true);
    expect(result.artifact?.storageClass).toBe("artifact");
    expect(result.artifact?.relativePath).toBe("sessions/session-1/analysis.md");

    const managedPath = join(paths.artifactsDir, result.artifact!.relativePath);
    expect(existsSync(managedPath)).toBe(true);
    expect(readFileSync(managedPath, "utf8")).toBe("# 外部分析\n");
  });

  it("honors a configured Files output directory outside MyClaw", async () => {
    paths.artifactsDir = join(rootDir, "custom-files-output");
    const filePath = join(paths.myClawDir, "custom-report.md");
    writeFileSync(filePath, "# 自定义目录报告\n", "utf8");

    const artifact = await registerGeneratedFileArtifact({
      artifactManager: manager,
      paths,
      cwd: paths.myClawDir,
      sessionId: "session-1",
      filePath: "custom-report.md",
      title: "自定义目录报告",
      kind: "doc",
      sourceToolName: "fs_write",
    });

    expect(artifact.storageClass).toBe("artifact");
    expect(artifact.relativePath).toBe("sessions/session-1/custom-report.md");

    const managedPath = join(paths.artifactsDir, artifact.relativePath);
    expect(existsSync(managedPath)).toBe(true);
    expect(resolveArtifactAbsolutePath(paths, artifact)).toBe(managedPath);
    expect(readFileSync(managedPath, "utf8")).toBe("# 自定义目录报告\n");
  });
});

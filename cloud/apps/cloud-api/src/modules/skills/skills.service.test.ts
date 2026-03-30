import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { SkillsService } from "./skills.service";

function createArtifactServiceMock() {
  return {
    storeSkillArtifact: vi.fn(async ({ releaseId }: { releaseId: string }) => ({
      fileName: `${releaseId}.zip`,
      fileSize: 256,
      storageKey: `/group1/M00/00/16/${releaseId}.zip`,
      storageUrl: `http://127.0.0.1:8080/group1/M00/00/16/${releaseId}.zip`,
    })),
    createDownloadToken: vi.fn(async (releaseId: string) => ({
      downloadUrl: `/api/artifacts/download/${releaseId}`,
      expiresIn: 300,
    })),
  };
}

describe("skills service", () => {
  it("lists skills from the skills repository", async () => {
    const repository = {
      list: vi.fn(async () => [
        {
          id: "skill-filesystem",
          name: "Filesystem Skill",
          summary: "Manage filesystem tasks",
          description: "Skill backed by cloud storage",
          latestVersion: "1.0.0",
          latestReleaseId: "release-skill-filesystem-1.0.0",
          updatedAt: "2026-03-27T10:00:00.000Z",
        },
      ]),
      findById: vi.fn(),
      createSkill: vi.fn(),
      createRelease: vi.fn(),
    };

    const service = new SkillsService(repository as any, createArtifactServiceMock() as any);
    const result = await service.list();

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("skill-filesystem");
    expect(repository.list).toHaveBeenCalledTimes(1);
  });

  it("creates a skill item in the independent skills repository", async () => {
    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn(async () => null),
      createSkill: vi.fn(async (input: any) => ({
        ...input,
        latestReleaseId: null,
        releases: [],
        createdAt: "2026-03-27T10:00:00.000Z",
        updatedAt: "2026-03-27T10:00:00.000Z",
      })),
      createRelease: vi.fn(),
    };

    const service = new SkillsService(repository as any, createArtifactServiceMock() as any);
    const result = await service.createSkill({
      id: "skill-filesystem",
      name: "Filesystem Skill",
      summary: "Manage filesystem tasks",
      description: "Skill backed by cloud storage",
    });

    expect(result.id).toBe("skill-filesystem");
    expect(repository.createSkill).toHaveBeenCalledTimes(1);
  });

  it("publishes a skill release and persists artifact metadata", async () => {
    const createRelease = vi.fn(async (input: any) => ({
      skillId: input.skillId,
      releaseId: input.releaseId,
      version: input.version,
      releaseNotes: input.releaseNotes,
      manifest: input.manifest,
      artifact: {
        fileName: input.artifact.fileName,
        fileSize: input.artifact.fileSize,
        downloadUrl: input.artifact.downloadUrl,
        expiresIn: input.artifact.downloadExpiresIn,
      },
    }));

    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn(async () => ({
        id: "skill-filesystem",
        name: "Filesystem Skill",
        summary: "Manage filesystem tasks",
        description: "Skill backed by cloud storage",
        latestVersion: "1.0.0",
        latestReleaseId: "release-skill-filesystem-1.0.0",
        releases: [],
        createdAt: "2026-03-27T10:00:00.000Z",
        updatedAt: "2026-03-27T10:00:00.000Z",
      })),
      createSkill: vi.fn(),
      createRelease,
    };

    const service = new SkillsService(repository as any, createArtifactServiceMock() as any);
    const result = await service.publishRelease("skill-filesystem", {
      version: "1.1.0",
      releaseNotes: "Add cloud publish pipeline",
      fileName: "skill-filesystem.zip",
      fileBytes: Buffer.from("zip-data"),
      entryFile: "SKILL.md",
      readme: "# Filesystem Skill",
    });

    expect(result.releaseId).toBe("release-skill-filesystem-1.1.0");
    expect(createRelease).toHaveBeenCalledTimes(1);
  });

  it("rejects publishing a non-zip skill package", async () => {
    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn(async () => ({
        id: "skill-filesystem",
        name: "Filesystem Skill",
        summary: "Manage filesystem tasks",
        description: "Skill backed by cloud storage",
        latestVersion: "1.0.0",
        latestReleaseId: "release-skill-filesystem-1.0.0",
        releases: [],
        createdAt: "2026-03-27T10:00:00.000Z",
        updatedAt: "2026-03-27T10:00:00.000Z",
      })),
      createSkill: vi.fn(),
      createRelease: vi.fn(),
    };

    const service = new SkillsService(repository as any, createArtifactServiceMock() as any);

    await expect(
      service.publishRelease("skill-filesystem", {
        version: "1.1.0",
        releaseNotes: "bad package",
        fileName: "skill-filesystem.txt",
        fileBytes: Buffer.from("zip-data"),
        entryFile: "SKILL.md",
        readme: "# Filesystem Skill",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws not found when publishing a release for a missing skill", async () => {
    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn(async () => null),
      createSkill: vi.fn(),
      createRelease: vi.fn(),
    };

    const service = new SkillsService(repository as any, createArtifactServiceMock() as any);

    await expect(
      service.publishRelease("missing-skill", {
        version: "1.0.0",
        releaseNotes: "missing skill",
        fileName: "missing-skill.zip",
        fileBytes: Buffer.from("zip-data"),
        entryFile: "SKILL.md",
        readme: "# Missing",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { SkillsController } from "./skills.controller";
import { SkillsService } from "./skills.service";

describe("skills controller", () => {
  it("lists skills via the dedicated skills service", async () => {
    const list = vi.fn(async () => [
      {
        id: "skill-filesystem",
        name: "Filesystem Skill",
        summary: "Manage filesystem tasks",
        description: "Skill backed by cloud storage",
        latestVersion: "1.0.0",
        latestReleaseId: "release-skill-filesystem-1.0.0",
        updatedAt: "2026-03-27T10:00:00.000Z",
      },
    ]);

    const controller = new SkillsController({
      list,
      findById: vi.fn(),
      createSkill: vi.fn(),
      publishRelease: vi.fn(),
    } as unknown as SkillsService);

    await expect(controller.list()).resolves.toEqual({
      skills: [
        expect.objectContaining({
          id: "skill-filesystem",
        }),
      ],
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("throws not found when a skill detail is missing", async () => {
    const controller = new SkillsController({
      list: vi.fn(),
      findById: vi.fn(async () => null),
      createSkill: vi.fn(),
      publishRelease: vi.fn(),
    } as unknown as SkillsService);

    await expect(controller.detail("missing-skill")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("creates a skill via the dedicated skills service", async () => {
    const createSkill = vi.fn(async () => ({
      id: "skill-filesystem",
      name: "Filesystem Skill",
      summary: "Manage filesystem tasks",
      description: "Skill backed by cloud storage",
      latestVersion: null,
      latestReleaseId: null,
      releases: [],
      createdAt: "2026-03-27T10:00:00.000Z",
      updatedAt: "2026-03-27T10:00:00.000Z",
    }));

    const controller = new SkillsController({
      list: vi.fn(),
      findById: vi.fn(),
      createSkill,
      publishRelease: vi.fn(),
    } as unknown as SkillsService);

    await expect(
      controller.createSkill({
        id: "skill-filesystem",
        name: "Filesystem Skill",
        summary: "Manage filesystem tasks",
        description: "Skill backed by cloud storage",
      }),
    ).resolves.toMatchObject({
      skill: expect.objectContaining({
        id: "skill-filesystem",
      }),
    });
  });

  it("validates release publish payload and delegates multipart file upload", async () => {
    const publishRelease = vi.fn(async () => ({
      skillId: "skill-filesystem",
      releaseId: "release-skill-filesystem-1.1.0",
      version: "1.1.0",
      releaseNotes: "Add cloud publish pipeline",
      manifest: {
        name: "Filesystem Skill",
        version: "1.1.0",
        entryFile: "SKILL.md",
        readme: "# Filesystem Skill",
      },
      artifact: {
        fileName: "skill-filesystem.zip",
        fileSize: 256,
        downloadUrl: "/api/artifacts/download/release-skill-filesystem-1.1.0",
        expiresIn: 300,
      },
    }));

    const controller = new SkillsController({
      list: vi.fn(),
      findById: vi.fn(),
      createSkill: vi.fn(),
      publishRelease,
    } as unknown as SkillsService);

    await expect(
      controller.publishRelease(
        "skill-filesystem",
        {
          version: "1.1.0",
          releaseNotes: "Add cloud publish pipeline",
          entryFile: "SKILL.md",
          readme: "# Filesystem Skill",
        },
        {
          buffer: Buffer.from("zip-data"),
          mimetype: "application/zip",
          originalname: "skill-filesystem.zip",
          size: 256,
        },
      ),
    ).resolves.toMatchObject({
      releaseId: "release-skill-filesystem-1.1.0",
    });
    expect(publishRelease).toHaveBeenCalledTimes(1);
  });

  it("throws when skill release file is missing", async () => {
    const controller = new SkillsController({
      list: vi.fn(),
      findById: vi.fn(),
      createSkill: vi.fn(),
      publishRelease: vi.fn(),
    } as unknown as SkillsService);

    await expect(
      controller.publishRelease("skill-filesystem", {
        version: "1.1.0",
        releaseNotes: "x",
        entryFile: "SKILL.md",
        readme: "# Filesystem Skill",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

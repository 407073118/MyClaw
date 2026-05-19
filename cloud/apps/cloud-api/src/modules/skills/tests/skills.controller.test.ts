import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { SkillsController } from "../controllers/skills.controller";
import { SkillsService } from "../services/skills.service";

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

  it("validates release package and delegates extracted SKILL.md metadata", async () => {
    const skillMarkdown = `---
name: filesystem-skill
description: Manage filesystem tasks safely.
---
`;
    const publishRelease = vi.fn(async () => ({
      skillId: "skill-filesystem",
      releaseId: "release-skill-filesystem-1.0.1",
      version: "1.0.1",
      releaseNotes: "从 SKILL.md 自动发布",
      manifest: {
        name: "Filesystem Skill",
        version: "1.0.1",
        entryFile: "SKILL.md",
        readme: skillMarkdown,
      },
      artifact: {
        fileName: "skill-filesystem.zip",
        fileSize: 256,
        sha256: "a".repeat(64),
        downloadUrl: "/api/artifacts/download/release-skill-filesystem-1.0.1",
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
        {},
        [
          {
            buffer: Buffer.from(skillMarkdown),
            fieldname: "files",
            originalname: "SKILL.md",
            size: Buffer.byteLength(skillMarkdown),
          },
        ],
      ),
    ).resolves.toMatchObject({
      releaseId: "release-skill-filesystem-1.0.1",
    });
    expect(publishRelease).toHaveBeenCalledWith("skill-filesystem", expect.objectContaining({
      entryFile: "SKILL.md",
      readme: skillMarkdown,
      releaseNotes: "从 SKILL.md 自动发布",
      version: undefined,
    }));
  });

  it("allows release publish without a user-provided version", async () => {
    const skillMarkdown = `---
name: filesystem-skill
description: Manage filesystem tasks safely.
---
`;
    const publishRelease = vi.fn(async () => ({
      skillId: "skill-filesystem",
      releaseId: "release-skill-filesystem-1.0.2",
      version: "1.0.2",
      releaseNotes: "Auto version",
      manifest: {
        name: "Filesystem Skill",
        version: "1.0.2",
        entryFile: "SKILL.md",
        readme: "# Filesystem Skill",
      },
      artifact: {
        fileName: "skill-filesystem.zip",
        fileSize: 256,
        sha256: "a".repeat(64),
        downloadUrl: "/api/artifacts/download/release-skill-filesystem-1.0.2",
        expiresIn: 300,
      },
    }));

    const controller = new SkillsController({
      list: vi.fn(),
      findById: vi.fn(),
      createSkill: vi.fn(),
      publishRelease,
    } as unknown as SkillsService);

    await controller.publishRelease(
      "skill-filesystem",
      {
        releaseNotes: "Auto version",
      },
      [
        {
          buffer: Buffer.from(skillMarkdown),
          fieldname: "files",
          originalname: "SKILL.md",
          size: Buffer.byteLength(skillMarkdown),
        },
      ],
    );

    expect(publishRelease).toHaveBeenCalledWith("skill-filesystem", expect.objectContaining({
      version: undefined,
      releaseNotes: "Auto version",
    }));
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
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

import { describe, expect, it, vi } from "vitest";

import { ArtifactService } from "./artifact.service";

describe("artifact service", () => {
  it("loads stored artifact metadata from skill release in database", async () => {
    const artifactStorage = {
      createDownloadDescriptor: vi.fn(async (releaseId: string) => ({
        downloadUrl: `/api/artifacts/download/${releaseId}`,
        expiresIn: 300,
      })),
      storeSkillArtifact: vi.fn(),
      openSkillArtifactReadStream: vi.fn(),
    };
    const databaseService = {
      skillRelease: {
        findUnique: vi.fn(async () => ({
          artifactFileName: "security-audit.zip",
          artifactFileSize: 256,
          artifactStoragePath: "/group1/M00/00/16/security-audit.zip",
          artifactDownloadUrl: "/api/artifacts/download/release-skill-security-audit-2.2.0",
        })),
      },
      mcpServerRelease: {
        findUnique: vi.fn(async () => null),
      },
    };
    const service = new ArtifactService(artifactStorage as any, databaseService as any);

    const artifact = await service.getStoredSkillArtifact("release-skill-security-audit-2.2.0");

    expect(artifact).toEqual({
      fileName: "security-audit.zip",
      fileSize: 256,
      storageKey: "/group1/M00/00/16/security-audit.zip",
      storageUrl: "/api/artifacts/download/release-skill-security-audit-2.2.0",
    });
  });

  it("returns null when skill release not found", async () => {
    const artifactStorage = {
      createDownloadDescriptor: vi.fn(async (releaseId: string) => ({
        downloadUrl: `/api/artifacts/download/${releaseId}`,
        expiresIn: 300,
      })),
      storeSkillArtifact: vi.fn(),
      openSkillArtifactReadStream: vi.fn(),
    };
    const databaseService = {
      skillRelease: {
        findUnique: vi.fn(async () => null),
      },
      mcpServerRelease: {
        findUnique: vi.fn(async () => null),
      },
    };
    const service = new ArtifactService(artifactStorage as any, databaseService as any);

    const artifact = await service.getStoredSkillArtifact("missing-release");

    expect(artifact).toBeNull();
  });
});

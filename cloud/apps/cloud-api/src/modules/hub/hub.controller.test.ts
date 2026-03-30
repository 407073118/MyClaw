import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { ArtifactService } from "../artifact/artifact.service";
import { HubController } from "./hub.controller";
import { HubService } from "./hub.service";

describe("hub controller", () => {
  it("awaits the service list before returning the response body", async () => {
    const list = vi.fn(async () => [
      {
        id: "employee-onboarding-assistant",
        type: "employee-package",
        name: "Onboarding Assistant",
        summary: "Employee package",
        latestVersion: "1.0.0",
        iconUrl: "/api/hub/items/employee-onboarding-assistant/icon",
      },
    ]);

    const controller = new HubController(
      {
        list,
        findById: async () => null,
      } as unknown as HubService,
      {
        getManifest: () => {
          throw new Error("not used");
        },
        createDownloadToken: async () => {
          throw new Error("not used");
        },
      } as unknown as ArtifactService,
    );

    await expect(Promise.resolve(controller.list("employee-package"))).resolves.toEqual({
      items: [
        {
          id: "employee-onboarding-assistant",
          type: "employee-package",
          name: "Onboarding Assistant",
          summary: "Employee package",
          latestVersion: "1.0.0",
          iconUrl: "/api/hub/items/employee-onboarding-assistant/icon",
        },
      ],
    });
    expect(list).toHaveBeenCalledWith("employee-package", undefined);
  });

  it("throws not found when a detail item is missing", async () => {
    const controller = new HubController(
      {
        list: async () => [],
        findById: async () => null,
      } as unknown as HubService,
      {
        getManifest: () => {
          throw new Error("not used");
        },
        createDownloadToken: async () => {
          throw new Error("not used");
        },
      } as unknown as ArtifactService,
    );

    await expect(controller.detail("missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("validates employee release payload and delegates to service", async () => {
    const publishEmployeePackageRelease = vi.fn(async () => ({
      itemId: "employee-onboarding-assistant",
      releaseId: "release-employee-onboarding-assistant-1.1.0",
      version: "1.1.0",
      latestVersion: "1.1.0",
      manifest: {
        kind: "employee-package",
        name: "Onboarding Assistant",
        version: "1.1.0",
        description: "Employee package",
        role: "onboarding-assistant",
      },
      artifact: {
        fileName: "employee-onboarding.zip",
        fileSize: 256,
        downloadUrl: "/api/artifacts/download/release-employee-onboarding-assistant-1.1.0",
        expiresIn: 300,
      },
    }));

    const controller = new HubController(
      {
        list: async () => [],
        findById: async () => null,
        publishEmployeePackageRelease,
      } as unknown as HubService,
      {
        getManifest: () => {
          throw new Error("not used");
        },
        createDownloadToken: async () => {
          throw new Error("not used");
        },
      } as unknown as ArtifactService,
    );

    await expect(
      controller.publishEmployeeRelease(
        "employee-onboarding-assistant",
        { version: "1.1.0", releaseNotes: "Employee package update" },
        {
          buffer: Buffer.from("zip-data"),
          mimetype: "application/zip",
          originalname: "employee-onboarding.zip",
          size: 256,
        },
      ),
    ).resolves.toMatchObject({
      version: "1.1.0",
    });
    expect(publishEmployeePackageRelease).toHaveBeenCalledTimes(1);
  });

  it("does not expose skill creation APIs anymore", () => {
    const controller = new HubController(
      {
        list: async () => [],
        findById: async () => null,
      } as unknown as HubService,
      {
        getManifest: () => {
          throw new Error("not used");
        },
        createDownloadToken: async () => {
          throw new Error("not used");
        },
      } as unknown as ArtifactService,
    );

    expect("createSkill" in controller).toBe(false);
    expect("publishSkillRelease" in controller).toBe(false);
    expect("createMcp" in controller).toBe(false);
    expect("publishMcpRelease" in controller).toBe(false);
  });

  it("throws when employee release file is missing", async () => {
    const controller = new HubController(
      {
        list: async () => [],
        findById: async () => null,
        publishEmployeePackageRelease: async () => {
          throw new Error("not used");
        },
      } as unknown as HubService,
      {
        getManifest: () => {
          throw new Error("not used");
        },
        createDownloadToken: async () => {
          throw new Error("not used");
        },
      } as unknown as ArtifactService,
    );

    await expect(
      controller.publishEmployeeRelease("employee-onboarding-assistant", { version: "1.1.0", releaseNotes: "x" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("validates workflow release payload and delegates to service", async () => {
    const publishWorkflowPackageRelease = vi.fn(async () => ({
      itemId: "workflow-onboarding",
      releaseId: "release-workflow-onboarding-1.1.0",
      version: "1.1.0",
      latestVersion: "1.1.0",
      manifest: {
        kind: "workflow-package",
        name: "Onboarding Workflow",
        version: "1.1.0",
        description: "Workflow package",
        entryWorkflowId: "workflow-onboarding",
      },
      artifact: {
        fileName: "workflow-onboarding.zip",
        fileSize: 256,
        downloadUrl: "/api/artifacts/download/release-workflow-onboarding-1.1.0",
        expiresIn: 300,
      },
    }));

    const controller = new HubController(
      {
        list: async () => [],
        findById: async () => null,
        publishWorkflowPackageRelease,
      } as unknown as HubService,
      {
        getManifest: () => {
          throw new Error("not used");
        },
        createDownloadToken: async () => {
          throw new Error("not used");
        },
      } as unknown as ArtifactService,
    );

    await expect(
      controller.publishWorkflowRelease(
        "workflow-onboarding",
        { version: "1.1.0", releaseNotes: "Workflow package update" },
        {
          buffer: Buffer.from("zip-data"),
          mimetype: "application/zip",
          originalname: "workflow-onboarding.zip",
          size: 256,
        },
      ),
    ).resolves.toMatchObject({
      version: "1.1.0",
    });
    expect(publishWorkflowPackageRelease).toHaveBeenCalledTimes(1);
  });
});

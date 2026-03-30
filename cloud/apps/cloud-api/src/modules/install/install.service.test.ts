import type { InstallAction, InstallStatus } from "@myclaw-cloud/shared";
import { describe, expect, it } from "vitest";

import { InstallService } from "./install.service";

describe("install service", () => {
  it("persists install traces through the repository", async () => {
    const repository = {
      create: async (input: {
        account: string;
        itemId: string;
        releaseId: string;
        action: InstallAction;
        status: InstallStatus;
        errorMessage?: string;
      }) => ({
        id: "log-1",
        createdAt: new Date(),
        ...input
      }),
      list: async () => [
        {
          id: "log-1",
          account: "zhangsan",
          itemId: "skill-code-review",
          releaseId: "release-skill-code-review-1.0.0",
          action: "install" as InstallAction,
          status: "success" as InstallStatus,
          errorMessage: undefined,
          createdAt: new Date()
        }
      ]
    };
    const service = new InstallService(repository);

    const result = await service.log("zhangsan", {
      itemId: "skill-code-review",
      releaseId: "release-skill-code-review-1.0.0",
      action: "install",
      status: "success"
    });

    expect(result.ok).toBe(true);
    const logs = await service.list();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      itemId: "skill-code-review",
      action: "install"
    });
  });
});

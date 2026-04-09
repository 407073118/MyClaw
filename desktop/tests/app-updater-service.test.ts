import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

type UpdateInfoLike = {
  version: string;
  releaseDate?: string;
};

class MockUpdaterAdapter extends EventEmitter {
  autoDownload = true;
  allowPrerelease = false;
  checkForUpdates = vi.fn(async () => {
    this.emit("checking-for-update");
  });
  downloadUpdate = vi.fn(async () => {
    this.emit("download-progress", {
      percent: 55,
      bytesPerSecond: 1024,
      transferred: 55,
      total: 100,
    });
  });
  quitAndInstall = vi.fn();
}

describe("app updater service", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("stays disabled when the public release repository is not configured", async () => {
    const { createAppUpdaterService } = await import("../src/main/services/app-updater");

    const service = createAppUpdaterService({
      packaged: true,
      currentVersion: "0.1.0",
      config: {
        enabled: false,
        provider: "github",
        owner: "",
        repo: "",
        channel: "latest",
        downloadPageUrl: null,
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(service.getSnapshot()).toMatchObject({
      enabled: false,
      stage: "disabled",
      currentVersion: "0.1.0",
    });
  });

  it("tracks check, download, and install transitions for a github release feed", async () => {
    const { createAppUpdaterService } = await import("../src/main/services/app-updater");
    const adapter = new MockUpdaterAdapter();
    const snapshots: Array<{ stage: string; progressPercent: number | null; latestVersion: string | null }> = [];

    const service = createAppUpdaterService({
      packaged: true,
      currentVersion: "0.1.0",
      config: {
        enabled: true,
        provider: "github",
        owner: "acme",
        repo: "myclaw-desktop-releases",
        channel: "latest",
        downloadPageUrl: "https://github.com/acme/myclaw-desktop-releases/releases",
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      adapterFactory: () => adapter as any,
      onStateChange: (snapshot) => {
        snapshots.push({
          stage: snapshot.stage,
          progressPercent: snapshot.progressPercent,
          latestVersion: snapshot.latestVersion,
        });
      },
    });

    expect(service.getSnapshot()).toMatchObject({
      enabled: true,
      stage: "idle",
      feedLabel: "acme/myclaw-desktop-releases",
    });
    expect(adapter.autoDownload).toBe(false);

    await service.checkForUpdates();
    expect(service.getSnapshot().stage).toBe("checking");

    adapter.emit("update-available", {
      version: "0.2.0",
      releaseDate: "2026-04-08T08:00:00.000Z",
    } satisfies UpdateInfoLike);

    expect(service.getSnapshot()).toMatchObject({
      stage: "available",
      latestVersion: "0.2.0",
    });

    await service.downloadUpdate();
    expect(adapter.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot()).toMatchObject({
      stage: "downloading",
      progressPercent: 55,
    });

    adapter.emit("update-downloaded", {
      version: "0.2.0",
      downloadedFile: "MyClaw Setup 0.2.0.exe",
    });

    expect(service.getSnapshot()).toMatchObject({
      stage: "downloaded",
      latestVersion: "0.2.0",
    });

    await service.quitAndInstall();
    expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(snapshots.map((item) => item.stage)).toEqual(
      expect.arrayContaining(["checking", "available", "downloading", "downloaded"]),
    );
  });
});

import type { ProgressInfo, UpdateInfo } from "electron-updater";

import type { Logger } from "./logger";
import type { AppUpdaterConfig } from "./update-config";

export type AppUpdateStage =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "no-update"
  | "error";

export type AppUpdateSnapshot = {
  enabled: boolean;
  stage: AppUpdateStage;
  currentVersion: string;
  latestVersion: string | null;
  progressPercent: number | null;
  message: string;
  feedLabel: string | null;
  downloadPageUrl: string | null;
};

type AppUpdaterAdapter = {
  autoDownload: boolean;
  allowPrerelease: boolean;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: () => void;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
};

type CreateAppUpdaterServiceInput = {
  packaged: boolean;
  currentVersion: string;
  config: AppUpdaterConfig;
  logger: Pick<Logger, "info" | "warn" | "error">;
  adapterFactory?: (config: AppUpdaterConfig) => AppUpdaterAdapter;
  onStateChange?: (snapshot: AppUpdateSnapshot) => void;
};

export type AppUpdaterService = {
  getSnapshot: () => AppUpdateSnapshot;
  subscribe: (listener: (snapshot: AppUpdateSnapshot) => void) => () => void;
  checkForUpdates: () => Promise<AppUpdateSnapshot>;
  downloadUpdate: () => Promise<AppUpdateSnapshot>;
  quitAndInstall: () => Promise<{ accepted: boolean }>;
};

function buildFeedLabel(config: AppUpdaterConfig): string | null {
  if (!config.owner || !config.repo) {
    return null;
  }
  return `${config.owner}/${config.repo}`;
}

function createSnapshot(input: {
  enabled: boolean;
  stage: AppUpdateStage;
  currentVersion: string;
  latestVersion?: string | null;
  progressPercent?: number | null;
  message: string;
  feedLabel: string | null;
  downloadPageUrl: string | null;
}): AppUpdateSnapshot {
  return {
    enabled: input.enabled,
    stage: input.stage,
    currentVersion: input.currentVersion,
    latestVersion: input.latestVersion ?? null,
    progressPercent: input.progressPercent ?? null,
    message: input.message,
    feedLabel: input.feedLabel,
    downloadPageUrl: input.downloadPageUrl,
  };
}

/** 创建桌面端更新服务，统一管理状态快照、日志与更新动作。 */
export function createAppUpdaterService(input: CreateAppUpdaterServiceInput): AppUpdaterService {
  const listeners = new Set<(snapshot: AppUpdateSnapshot) => void>();
  if (input.onStateChange) {
    listeners.add(input.onStateChange);
  }

  const feedLabel = buildFeedLabel(input.config);
  let latestVersion: string | null = null;
  let snapshot = createSnapshot({
    enabled: false,
    stage: "disabled",
    currentVersion: input.currentVersion,
    message: "未配置公开发布仓库，暂不启用自动更新。",
    feedLabel,
    downloadPageUrl: input.config.downloadPageUrl,
  });

  const publishSnapshot = (): AppUpdateSnapshot => {
    for (const listener of listeners) {
      listener(snapshot);
    }
    return snapshot;
  };

  const setSnapshot = (next: AppUpdateSnapshot): AppUpdateSnapshot => {
    snapshot = next;
    return publishSnapshot();
  };

  if (!input.packaged) {
    snapshot = createSnapshot({
      enabled: false,
      stage: "disabled",
      currentVersion: input.currentVersion,
      message: "开发环境不启用桌面自动更新。",
      feedLabel,
      downloadPageUrl: input.config.downloadPageUrl,
    });
  } else if (input.config.enabled) {
    snapshot = createSnapshot({
      enabled: true,
      stage: "idle",
      currentVersion: input.currentVersion,
      message: `当前版本 ${input.currentVersion}，可手动检查更新。`,
      feedLabel,
      downloadPageUrl: input.config.downloadPageUrl,
    });
  }

  const adapter = input.packaged && input.config.enabled
    ? (input.adapterFactory?.(input.config) ?? (() => {
      const { NsisUpdater } = require("electron-updater") as typeof import("electron-updater");
      return new NsisUpdater({
        provider: "github",
        owner: input.config.owner,
        repo: input.config.repo,
        private: false,
        releaseType: "release",
        ...(input.config.channel ? { channel: input.config.channel } : {}),
      }) as unknown as AppUpdaterAdapter;
    })())
    : null;

  if (adapter) {
    adapter.autoDownload = false;
    adapter.allowPrerelease = input.config.channel !== "latest";

    adapter.on("checking-for-update", () => {
      input.logger.info("开始检查桌面端更新", { currentVersion: input.currentVersion, feedLabel });
      setSnapshot(createSnapshot({
        enabled: true,
        stage: "checking",
        currentVersion: input.currentVersion,
        latestVersion,
        message: "正在检查新版本...",
        feedLabel,
        downloadPageUrl: input.config.downloadPageUrl,
      }));
    });

    adapter.on("update-available", (info: UpdateInfo) => {
      latestVersion = info.version ?? null;
      input.logger.info("检测到新的桌面端版本", { latestVersion, feedLabel });
      setSnapshot(createSnapshot({
        enabled: true,
        stage: "available",
        currentVersion: input.currentVersion,
        latestVersion,
        message: `发现新版本 ${latestVersion ?? "未知版本"}，可立即下载。`,
        feedLabel,
        downloadPageUrl: input.config.downloadPageUrl,
      }));
    });

    adapter.on("update-not-available", () => {
      latestVersion = null;
      input.logger.info("当前已是最新桌面端版本", { currentVersion: input.currentVersion, feedLabel });
      setSnapshot(createSnapshot({
        enabled: true,
        stage: "no-update",
        currentVersion: input.currentVersion,
        message: "当前已是最新版本。",
        feedLabel,
        downloadPageUrl: input.config.downloadPageUrl,
      }));
    });

    adapter.on("download-progress", (progress: ProgressInfo) => {
      const progressPercent = Number.isFinite(progress.percent) ? Math.round(progress.percent) : 0;
      setSnapshot(createSnapshot({
        enabled: true,
        stage: "downloading",
        currentVersion: input.currentVersion,
        latestVersion,
        progressPercent,
        message: `正在下载更新（${progressPercent}%）`,
        feedLabel,
        downloadPageUrl: input.config.downloadPageUrl,
      }));
    });

    adapter.on("update-downloaded", (info: UpdateInfo) => {
      latestVersion = info.version ?? latestVersion;
      input.logger.info("桌面端更新已下载完成", { latestVersion, feedLabel });
      setSnapshot(createSnapshot({
        enabled: true,
        stage: "downloaded",
        currentVersion: input.currentVersion,
        latestVersion,
        progressPercent: 100,
        message: `更新 ${latestVersion ?? "未知版本"} 已下载完成，重启后安装。`,
        feedLabel,
        downloadPageUrl: input.config.downloadPageUrl,
      }));
    });

    adapter.on("error", (error: Error) => {
      input.logger.error("桌面端更新流程失败", { error: error.message, feedLabel });
      setSnapshot(createSnapshot({
        enabled: true,
        stage: "error",
        currentVersion: input.currentVersion,
        latestVersion,
        message: `更新失败：${error.message}`,
        feedLabel,
        downloadPageUrl: input.config.downloadPageUrl,
      }));
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    async checkForUpdates() {
      if (!adapter) {
        return snapshot;
      }
      await adapter.checkForUpdates();
      return snapshot;
    },
    async downloadUpdate() {
      if (!adapter) {
        return snapshot;
      }
      if (snapshot.stage === "available") {
        setSnapshot(createSnapshot({
          enabled: true,
          stage: "downloading",
          currentVersion: input.currentVersion,
          latestVersion,
          progressPercent: 0,
          message: "正在准备下载更新...",
          feedLabel,
          downloadPageUrl: input.config.downloadPageUrl,
        }));
      }
      await adapter.downloadUpdate();
      return snapshot;
    },
    async quitAndInstall() {
      if (!adapter || snapshot.stage !== "downloaded") {
        input.logger.warn("桌面端更新尚未下载完成，忽略安装请求", { stage: snapshot.stage, feedLabel });
        return { accepted: false };
      }
      input.logger.info("用户确认重启并安装桌面端更新", { latestVersion, feedLabel });
      adapter.quitAndInstall();
      return { accepted: true };
    },
  };
}

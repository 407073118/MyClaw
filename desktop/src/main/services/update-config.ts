import { appEnv } from "../../../config";

export type AppUpdateProvider = "github";

export type AppUpdaterConfig = {
  enabled: boolean;
  provider: AppUpdateProvider;
  owner: string;
  repo: string;
  channel: string;
  downloadPageUrl: string | null;
};

function normalize(value: string | undefined | null): string {
  return value?.trim() ?? "";
}

function buildGitHubDownloadPage(owner: string, repo: string): string | null {
  if (!owner || !repo) {
    return null;
  }
  return `https://github.com/${owner}/${repo}/releases`;
}

/** 解析桌面端更新配置，优先读取环境变量，其次读取打包进应用的环境配置。 */
export function resolveAppUpdaterConfig(env: NodeJS.ProcessEnv = process.env): AppUpdaterConfig {
  const providerRaw = normalize(env.MYCLAW_UPDATE_PROVIDER || appEnv.UPDATE_PROVIDER).toLowerCase();
  const owner = normalize(env.MYCLAW_UPDATE_OWNER || appEnv.UPDATE_OWNER);
  const repo = normalize(env.MYCLAW_UPDATE_REPO || appEnv.UPDATE_REPO);
  const channel = normalize(env.MYCLAW_UPDATE_CHANNEL || appEnv.UPDATE_CHANNEL) || "latest";
  const downloadPageUrl = normalize(env.MYCLAW_UPDATE_DOWNLOAD_PAGE || appEnv.UPDATE_DOWNLOAD_PAGE)
    || buildGitHubDownloadPage(owner, repo);

  if (providerRaw !== "github" || !owner || !repo) {
    return {
      enabled: false,
      provider: "github",
      owner,
      repo,
      channel,
      downloadPageUrl,
    };
  }

  return {
    enabled: true,
    provider: "github",
    owner,
    repo,
    channel,
    downloadPageUrl,
  };
}

import type { AppEnvConfig } from "./types";

/** 生产环境配置 */
export const env: AppEnvConfig = {
  CLOUD_API_BASE: "http://192.168.161.149:43211/api",
  UPDATE_PROVIDER: "github",
  UPDATE_OWNER: "407073118",
  UPDATE_REPO: "MyClaw-desktop-releases",
  UPDATE_CHANNEL: "latest",
  UPDATE_DOWNLOAD_PAGE: "https://github.com/407073118/MyClaw-desktop-releases/releases",
};

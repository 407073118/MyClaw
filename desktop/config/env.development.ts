import type { AppEnvConfig } from "./types";

/** 开发环境配置 */
export const env: AppEnvConfig = {
  CLOUD_API_BASE: "http://localhost:43210/api",
  UPDATE_PROVIDER: "",
  UPDATE_OWNER: "",
  UPDATE_REPO: "",
  UPDATE_CHANNEL: "latest",
  UPDATE_DOWNLOAD_PAGE: "",
};

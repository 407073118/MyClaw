/** 所有环境共享的配置结构 */
export interface AppEnvConfig {
  /** Cloud API 基础地址 */
  CLOUD_API_BASE: string;
  /** 桌面端更新提供方，当前仅支持 github。 */
  UPDATE_PROVIDER: string;
  /** 桌面端公开发布仓库 owner。 */
  UPDATE_OWNER: string;
  /** 桌面端公开发布仓库 repo。 */
  UPDATE_REPO: string;
  /** 桌面端更新通道，默认 latest。 */
  UPDATE_CHANNEL: string;
  /** 桌面端手动下载页，留空时回落到公开 release 页面。 */
  UPDATE_DOWNLOAD_PAGE: string;
}

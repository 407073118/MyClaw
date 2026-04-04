import type { InstallAction, InstallStatus } from "@myclaw-cloud/shared";

/** 安装日志的标准输出记录。 */
export type InstallLogRecord = {
  id: string;
  account: string;
  itemType: string;
  itemId: string;
  releaseId: string;
  action: InstallAction;
  status: InstallStatus;
  errorMessage?: string;
  createdAt: Date;
};

/** 创建安装日志时使用的输入结构。 */
export type CreateInstallLogInput = {
  account: string;
  itemType: "skill" | "mcp";
  itemId: string;
  releaseId: string;
  action: InstallAction;
  status: InstallStatus;
  errorMessage?: string;
};

/** 安装日志仓储接口，负责写入与查询安装流水。 */
export interface InstallLogRepository {
  /** 记录一次安装行为的执行结果。 */
  create(input: CreateInstallLogInput): Promise<InstallLogRecord>;

  /** 查询全部安装日志记录。 */
  list(): Promise<InstallLogRecord[]>;
}

export const INSTALL_LOG_REPOSITORY = Symbol("INSTALL_LOG_REPOSITORY");

import type { InstallAction, InstallStatus } from "@myclaw-cloud/shared";

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

export type CreateInstallLogInput = {
  account: string;
  itemType: "skill" | "mcp";
  itemId: string;
  releaseId: string;
  action: InstallAction;
  status: InstallStatus;
  errorMessage?: string;
};

export interface InstallLogRepository {
  create(input: CreateInstallLogInput): Promise<InstallLogRecord>;
  list(): Promise<InstallLogRecord[]>;
}

export const INSTALL_LOG_REPOSITORY = Symbol("INSTALL_LOG_REPOSITORY");


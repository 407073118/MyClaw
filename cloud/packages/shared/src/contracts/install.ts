export type InstallAction = "install" | "upgrade" | "remove";
export type InstallStatus = "success" | "failed";

export type InstallLogRequest = {
  itemId: string;
  releaseId: string;
  action: InstallAction;
  status: InstallStatus;
  errorMessage?: string;
};

export type InstallLogResponse = {
  ok: boolean;
};


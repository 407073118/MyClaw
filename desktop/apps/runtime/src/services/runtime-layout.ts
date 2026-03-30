import { resolveMyClawLayout, type MyClawLayout } from "./myclaw-layout";

export type RuntimeLayout = {
  rootDir: MyClawLayout["rootDir"];
  runtimeDir: MyClawLayout["runtimeDir"];
  runtimeStateFilePath: MyClawLayout["runtimeStateFilePath"];
  stateFilePath: string;
  employeesDir: MyClawLayout["employeesDir"];
  workflowsDir: MyClawLayout["workflowsDir"];
  workflowRootsDir: MyClawLayout["workflowRootsDir"];
  workflowRunsDir: MyClawLayout["workflowRunsDir"];
  employeePackagesDir: MyClawLayout["employeePackagesDir"];
  memoryDir: MyClawLayout["memoryDir"];
  pendingWorkDir: MyClawLayout["pendingWorkDir"];
  runsDir: MyClawLayout["runsDir"];
  publishDraftsDir: MyClawLayout["publishDraftsDir"];
  skillsDir: MyClawLayout["skillsDir"];
  sessionsDir: MyClawLayout["sessionsDir"];
  logsDir: MyClawLayout["logsDir"];
  cacheDir: MyClawLayout["cacheDir"];
};

/** 解析运行时目录布局，统一约束本地状态与相关业务资产路径。 */
export function resolveRuntimeLayout(stateFilePath?: string): RuntimeLayout {
  const layout = resolveMyClawLayout(stateFilePath);

  return {
    ...layout,
    // 兼容历史字段，避免调用方一次性迁移产生回归。
    stateFilePath: layout.runtimeStateFilePath,
  };
}

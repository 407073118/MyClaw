import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export type MyClawLayout = {
  rootDir: string;
  runtimeDir: string;
  runtimeStateFilePath: string;
  employeesDir: string;
  workflowsDir: string;
  workflowRootsDir: string;
  workflowRunsDir: string;
  employeePackagesDir: string;
  memoryDir: string;
  pendingWorkDir: string;
  runsDir: string;
  publishDraftsDir: string;
  skillsDir: string;
  sessionsDir: string;
  logsDir: string;
  cacheDir: string;
};

/** 解析固定的应用私有根目录，统一落在用户主目录下的 `.myClaw`。 */
export function resolveMyClawRootDirectory(): string {
  return resolve(homedir(), ".myClaw");
}

/** 解析运行时目录，集中存放 SQLite 状态文件等 runtime 数据。 */
export function resolveMyClawRuntimeDirectory(): string {
  return join(resolveMyClawRootDirectory(), "runtime");
}

/** 当 runtime 目录名为 `runtime` 时回退到其父目录作为根目录，否则保持同级目录。 */
function deriveRootDirectory(runtimeDir: string): string {
  const normalizedRuntimeDir = runtimeDir.replace(/[\\/]+$/, "");
  if (basename(normalizedRuntimeDir).toLowerCase() === "runtime") {
    return dirname(normalizedRuntimeDir);
  }

  return normalizedRuntimeDir;
}

/** 依据根目录与 runtime 目录生成完整布局，保证各业务子目录路径稳定可预测。 */
function buildLayout(rootDir: string, runtimeDir: string, runtimeStateFilePath: string): MyClawLayout {
  const workflowsDir = join(rootDir, "workflows");
  return {
    rootDir,
    runtimeDir,
    runtimeStateFilePath,
    employeesDir: join(rootDir, "employees"),
    workflowsDir,
    workflowRootsDir: join(workflowsDir, "roots"),
    workflowRunsDir: join(workflowsDir, "runs"),
    employeePackagesDir: join(rootDir, "employee-packages"),
    memoryDir: join(rootDir, "memory"),
    pendingWorkDir: join(rootDir, "pending-work"),
    runsDir: join(rootDir, "runs"),
    publishDraftsDir: join(rootDir, "publish-drafts"),
    skillsDir: join(rootDir, "skills"),
    sessionsDir: join(rootDir, "sessions"),
    logsDir: join(rootDir, "logs"),
    cacheDir: join(rootDir, "cache"),
  };
}

/** 解析 `.myClaw` 全量布局；传入覆盖路径时按路径推导根目录与 runtime 目录。 */
export function resolveMyClawLayout(runtimeStateFilePath?: string): MyClawLayout {
  if (runtimeStateFilePath) {
    const resolvedStateFilePath = resolve(runtimeStateFilePath);
    const runtimeDir = dirname(resolvedStateFilePath);
    const rootDir = deriveRootDirectory(runtimeDir);
    return buildLayout(rootDir, runtimeDir, resolvedStateFilePath);
  }

  const runtimeDir = resolveMyClawRuntimeDirectory();
  const rootDir = resolveMyClawRootDirectory();
  return buildLayout(rootDir, runtimeDir, join(runtimeDir, "state.db"));
}

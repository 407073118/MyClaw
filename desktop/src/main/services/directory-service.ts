import { app } from "electron";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 安装器写入到安装目录旁的数据目录配置文件名。 */
export const INSTALLER_DATA_ROOT_FILENAME = "myclaw-data-root.txt";

export type MyClawPaths = {
  /** 数据根目录，默认回落到 Electron userData。 */
  rootDir: string;
  /** `<rootDir>/myClaw` 主业务目录。 */
  myClawDir: string;
  /** `<rootDir>/myClaw/skills` 全局技能目录。 */
  skillsDir: string;
  /** `<rootDir>/myClaw/workspace` 全局受控工作目录。 */
  workspaceDir: string;
  /** `<rootDir>/myClaw/artifacts` 全局稳定产物目录。 */
  artifactsDir: string;
  /** `<rootDir>/myClaw/cache` 可重建缓存目录。 */
  cacheDir: string;
  /** `<rootDir>/myClaw/sessions` 历史 JSON 会话目录，仅供迁移期读取。 */
  sessionsDir: string;
  /** `<rootDir>/myClaw/sessions.db` 统一会话数据库。 */
  sessionsDbFile: string;
  /** `<rootDir>/myClaw/models` 模型配置目录。 */
  modelsDir: string;
  /** `<rootDir>/myClaw/settings.json` 设置文件。 */
  settingsFile: string;
};

/**
 * 硅基员工独立工作空间路径。
 *
 * 每个硅基员工都拥有自己的工作目录和产物目录，用于隔离执行现场与稳定结果。
 */
export type SiliconPersonPaths = {
  /** 员工根目录 `<myClawDir>/silicon-persons/<id>`。 */
  personDir: string;
  /** 员工受控工作目录 `<personDir>/workspace`。 */
  workspaceDir: string;
  /** 员工稳定产物目录 `<personDir>/artifacts`。 */
  artifactsDir: string;
  /** 员工技能目录。 */
  skillsDir: string;
  /** 员工历史 JSON 会话目录，仅供迁移期读取。 */
  sessionsDir: string;
  /** 员工 MCP 配置文件。 */
  mcpConfigFile: string;
  /** 员工元数据文件。 */
  personFile: string;
  /** 员工运行时数据库。 */
  runtimeDbFile: string;
};

/** 解析安装目录旁的数据目录配置文件路径。 */
function resolveInstallerDataRootConfigPath(): string {
  return join(dirname(app.getPath("exe")), INSTALLER_DATA_ROOT_FILENAME);
}

/** 读取安装器指定的数据根目录，未配置时返回 null。 */
function readInstallerSelectedDataRoot(): string | null {
  if (!app.isPackaged) {
    return null;
  }

  const configPath = resolveInstallerDataRootConfigPath();
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const selectedRoot = readFileSync(configPath, "utf-8").trim();
    if (!selectedRoot) {
      console.warn("[directory-service] 安装器数据目录配置为空，忽略该配置", {
        configPath,
      });
      return null;
    }

    console.info("[directory-service] 读取到安装器指定的数据目录配置", {
      configPath,
      selectedRoot,
    });
    return selectedRoot;
  } catch (error) {
    console.warn("[directory-service] 读取安装器数据目录配置失败，回退默认目录", {
      configPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** 解析显式配置的数据根目录，优先级为环境变量、便携目录、安装器配置。 */
function resolveConfiguredDataRoot(): string | null {
  const explicitRoot = process.env.MYCLAW_DATA_ROOT?.trim();
  if (explicitRoot) {
    console.info("[directory-service] 检测到环境变量 MYCLAW_DATA_ROOT，使用显式数据目录", {
      explicitRoot,
    });
    return explicitRoot;
  }

  const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim();
  if (portableExecutableDir) {
    const portableRoot = join(portableExecutableDir, "data");
    console.info("[directory-service] 检测到 PORTABLE_EXECUTABLE_DIR，使用便携数据目录", {
      portableExecutableDir,
      portableRoot,
    });
    return portableRoot;
  }

  return readInstallerSelectedDataRoot();
}

/** 判断当前是否需要重定向 Electron userData。 */
function shouldRedirectUserData(): boolean {
  return resolveConfiguredDataRoot() !== null;
}

/** 解析最终业务数据根目录。 */
function resolveDataRoot(): string {
  const configuredRoot = resolveConfiguredDataRoot();
  if (configuredRoot) {
    return configuredRoot;
  }
  return app.getPath("userData");
}

/** 根据根目录推导全局路径。 */
export function derivePaths(rootDir: string): MyClawPaths {
  const myClawDir = join(rootDir, "myClaw");
  return {
    rootDir,
    myClawDir,
    skillsDir: join(myClawDir, "skills"),
    workspaceDir: join(myClawDir, "workspace"),
    artifactsDir: join(myClawDir, "artifacts"),
    cacheDir: join(myClawDir, "cache"),
    sessionsDir: join(myClawDir, "sessions"),
    sessionsDbFile: join(myClawDir, "sessions.db"),
    modelsDir: join(myClawDir, "models"),
    settingsFile: join(myClawDir, "settings.json"),
  };
}

/** 根据员工 ID 推导独立工作空间路径。 */
export function deriveSiliconPersonPaths(
  paths: MyClawPaths,
  personId: string,
): SiliconPersonPaths {
  const personDir = join(paths.myClawDir, "silicon-persons", personId);
  return {
    personDir,
    workspaceDir: join(personDir, "workspace"),
    artifactsDir: join(personDir, "artifacts"),
    skillsDir: join(personDir, "skills"),
    sessionsDir: join(personDir, "sessions"),
    mcpConfigFile: join(personDir, "mcp-servers.json"),
    personFile: join(personDir, "person.json"),
    runtimeDbFile: join(personDir, "runtime.db"),
  };
}

/** 确保员工工作空间目录全部存在。 */
export function ensureSiliconPersonDirectories(personPaths: SiliconPersonPaths): void {
  for (const dir of [
    personPaths.personDir,
    personPaths.workspaceDir,
    personPaths.artifactsDir,
    personPaths.skillsDir,
    personPaths.sessionsDir,
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/** 确保全局业务目录全部存在。 */
function ensureDirectories(paths: MyClawPaths): void {
  for (const dir of [
    paths.myClawDir,
    paths.skillsDir,
    paths.workspaceDir,
    paths.artifactsDir,
    paths.cacheDir,
    paths.sessionsDir,
    paths.modelsDir,
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/** 在存在自定义数据目录时重定向 Electron userData。 */
export function redirectUserData(): void {
  const configuredRoot = resolveConfiguredDataRoot();
  if (!configuredRoot) {
    console.info("[directory-service] 未检测到自定义数据目录，继续使用 Electron 默认 userData", {
      packaged: app.isPackaged,
      userData: app.getPath("userData"),
    });
    return;
  }

  const electronDataDir = join(configuredRoot, "electron");
  if (!existsSync(electronDataDir)) {
    mkdirSync(electronDataDir, { recursive: true });
  }

  console.info("[directory-service] 使用自定义数据目录并重定向 Electron userData", {
    packaged: app.isPackaged,
    configuredRoot,
    electronDataDir,
  });
  app.setPath("userData", electronDataDir);
}

/** 初始化目录服务并创建业务所需的目录结构。 */
export async function initializeDirectories(): Promise<MyClawPaths> {
  const rootDir = resolveDataRoot();
  const paths = derivePaths(rootDir);
  ensureDirectories(paths);

  console.info("[directory-service] MyClaw 数据目录已初始化", {
    packaged: app.isPackaged,
    redirectedUserData: shouldRedirectUserData(),
    userData: app.getPath("userData"),
    rootDir: paths.rootDir,
    myClawDir: paths.myClawDir,
  });

  return paths;
}

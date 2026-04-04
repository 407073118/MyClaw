import { app } from "electron";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

// ---------------------------------------------------------------------------
// 目录布局（生产环境：数据便携存放在可执行文件旁边）：
//
//   <exeDir>/
//   ├── MyClaw.exe
//   ├── resources/
//   ├── data/                     ← portable data root
//   │   ├── electron/             ← Electron userData (cache, localStorage …)
//   │   └── myClaw/               ← app business data
//   │       ├── skills/
//   │       ├── sessions/
//   │       ├── models/
//   │       └── settings.json
//
// 开发环境下，数据保留在 Electron 默认的 userData 目录中。
// ---------------------------------------------------------------------------

export type MyClawPaths = {
  /** 数据根目录（生产环境便携存储，开发环境使用 userData） */
  rootDir: string;
  /** <rootDir>/myClaw：应用业务数据主目录 */
  myClawDir: string;
  /** <rootDir>/myClaw/skills：技能目录 */
  skillsDir: string;
  /** <rootDir>/myClaw/sessions：会话目录 */
  sessionsDir: string;
  /** <rootDir>/myClaw/models：模型配置目录 */
  modelsDir: string;
  /** <rootDir>/myClaw/settings.json：设置文件路径 */
  settingsFile: string;
};

/**
 * 解析数据根目录。
 *
 * - **生产环境（已打包）：** `<install dir>/data`，所有数据跟随程序一起便携存放
 * - **开发环境（未打包）：** 使用 Electron 默认 `userData`
 *
 * 通过 `app.isPackaged` 区分是否已打包，这是官方且可靠的判断方式。
 */
function resolveDataRoot(): string {
  // 环境变量优先，方便开发时指向已有安装目录的数据
  if (process.env.MYCLAW_DATA_ROOT) {
    return process.env.MYCLAW_DATA_ROOT;
  }
  if (app.isPackaged) {
    const exeDir = dirname(app.getPath("exe"));
    return join(exeDir, "data");
  }
  // 开发模式下使用 Electron 默认 userData，路径稳定且可复用既有数据
  return app.getPath("userData");
}

/** 根据根目录推导所有标准路径。 */
export function derivePaths(rootDir: string): MyClawPaths {
  const myClawDir = join(rootDir, "myClaw");
  return {
    rootDir,
    myClawDir,
    skillsDir: join(myClawDir, "skills"),
    sessionsDir: join(myClawDir, "sessions"),
    modelsDir: join(myClawDir, "models"),
    settingsFile: join(myClawDir, "settings.json"),
  };
}

/** 确保所有必需目录都已存在于磁盘中。 */
function ensureDirectories(paths: MyClawPaths): void {
  for (const dir of [paths.myClawDir, paths.skillsDir, paths.sessionsDir, paths.modelsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * 将 Electron 的 userData 重定向到便携目录。
 *
 * 仅在**生产环境（已打包）**生效。
 * 开发环境下该方法为空操作，继续使用默认 userData 路径。
 *
 * 必须在 `app.whenReady()` 之前调用。
 */
export function redirectUserData(): void {
  if (!app.isPackaged) {
    // 开发模式下不改写 userData，保持默认路径
    return;
  }
  const dataRoot = resolveDataRoot();
  const electronDataDir = join(dataRoot, "electron");
  if (!existsSync(electronDataDir)) {
    mkdirSync(electronDataDir, { recursive: true });
  }
  app.setPath("userData", electronDataDir);
}

/**
 * 初始化目录服务。
 * 该方法会创建必需的子目录，并返回解析后的路径集合。
 */
export async function initializeDirectories(): Promise<MyClawPaths> {
  const rootDir = resolveDataRoot();
  const paths = derivePaths(rootDir);
  ensureDirectories(paths);

  console.info("[directory-service] MyClaw 数据目录已初始化", {
    packaged: app.isPackaged,
    rootDir: paths.rootDir,
    myClawDir: paths.myClawDir,
  });

  return paths;
}

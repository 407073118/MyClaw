import { app, dialog, BrowserWindow } from "electron";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Directory layout under the user-chosen root:
//
//   <rootDir>/
//   ├── myClaw/
//   │   ├── skills/
//   │   ├── sessions/
//   │   ├── models/
//   │   └── settings.json
// ---------------------------------------------------------------------------

export type MyClawPaths = {
  /** User-chosen root directory (parent of myClaw/) */
  rootDir: string;
  /** <rootDir>/myClaw — all app data lives here */
  myClawDir: string;
  /** <rootDir>/myClaw/skills */
  skillsDir: string;
  /** <rootDir>/myClaw/sessions */
  sessionsDir: string;
  /** <rootDir>/myClaw/models */
  modelsDir: string;
  /** <rootDir>/myClaw/settings.json */
  settingsFile: string;
};

/**
 * Config file path — 统一使用固定的 appData 路径，不依赖 app.name。
 * 这样开发模式 (Electron/) 和打包模式 (myclaw-desktop/) 都读写同一个文件。
 */
function getConfigPath(): string {
  const appData = app.getPath("appData"); // C:\Users\xxx\AppData\Roaming
  const configDir = join(appData, "myclaw-desktop");
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  return join(configDir, "myclaw-config.json");
}

/** Read previously saved root directory from config, or null if not set */
export function loadSavedRootDir(): string | null {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    if (typeof config.rootDir === "string" && config.rootDir) {
      return config.rootDir;
    }
  } catch {
    // corrupt config — treat as first launch
  }
  return null;
}

/** Persist the user's chosen root directory */
function saveRootDir(rootDir: string): void {
  const configPath = getConfigPath();
  const dir = join(configPath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify({ rootDir }, null, 2), "utf-8");
}

/** Derive all standard paths from a root directory */
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

/** Ensure all directories exist on disk */
function ensureDirectories(paths: MyClawPaths): void {
  for (const dir of [paths.myClawDir, paths.skillsDir, paths.sessionsDir, paths.modelsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Show a native folder picker dialog asking the user to choose
 * where MyClaw should store its data.
 */
async function promptForRootDir(parentWindow?: BrowserWindow | null): Promise<string | null> {
  const result = await dialog.showOpenDialog(parentWindow ?? ({} as any), {
    title: "选择 MyClaw 数据存储目录",
    message: "请选择一个文件夹，MyClaw 将在其中创建 myClaw/ 子目录来存储所有数据（模型配置、Skills、Sessions 等）。",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "选择此目录",
  });

  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
}

/**
 * Initialize the directory service:
 * - If a root directory was previously saved, use it
 * - Otherwise, use Electron's default userData as temporary fallback
 *   (the renderer's Setup page will prompt the user to choose)
 * - Create all sub-directories
 * - Return the resolved paths
 */
export async function initializeDirectories(
  _parentWindow?: BrowserWindow | null,
): Promise<MyClawPaths> {
  let rootDir = loadSavedRootDir();

  if (!rootDir) {
    // Use default until user picks via Setup page
    rootDir = app.getPath("userData");
  }

  const paths = derivePaths(rootDir);
  ensureDirectories(paths);

  console.info("[directory-service] MyClaw 数据目录已初始化", {
    rootDir: paths.rootDir,
    myClawDir: paths.myClawDir,
  });

  return paths;
}

/**
 * Change the root directory (called from settings).
 * Saves the new root and creates directories. Does NOT migrate data.
 */
export async function changeRootDir(
  parentWindow?: BrowserWindow | null,
): Promise<MyClawPaths | null> {
  const newRoot = await promptForRootDir(parentWindow);
  if (!newRoot) return null;

  saveRootDir(newRoot);
  const paths = derivePaths(newRoot);
  ensureDirectories(paths);

  console.info("[directory-service] MyClaw 根目录已更改", {
    rootDir: paths.rootDir,
    myClawDir: paths.myClawDir,
  });

  return paths;
}

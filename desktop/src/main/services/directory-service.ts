import { app } from "electron";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

// ---------------------------------------------------------------------------
// Directory layout (production — portable next to executable):
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
// In development, data stays under Electron's default userData (%APPDATA%).
// ---------------------------------------------------------------------------

export type MyClawPaths = {
  /** Root data directory (portable in prod, userData in dev) */
  rootDir: string;
  /** <rootDir>/myClaw — all app business data lives here */
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
 * Resolve the data root.
 *
 * - **Production (packaged):** `<install dir>/data` — portable, all data next to exe
 * - **Development (unpackaged):** Electron default `userData` (%APPDATA%/myclaw-desktop)
 *
 * Uses `app.isPackaged` which is the reliable, official way to distinguish.
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
  // Dev mode: use Electron's default userData — stable and already has existing data
  return app.getPath("userData");
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
 * Redirect Electron's userData to portable location.
 *
 * Only applies in **production** (packaged) builds.
 * In dev mode this is a no-op — we keep the default %APPDATA% paths.
 *
 * MUST be called before app.whenReady().
 */
export function redirectUserData(): void {
  if (!app.isPackaged) {
    // Dev mode: don't touch userData, keep everything in %APPDATA%
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
 * Initialize the directory service.
 * Creates all necessary sub-directories and returns resolved paths.
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

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

const PROJECT_ROOT = path.join(__dirname, "..");
const MAIN_ENTRY = path.join(PROJECT_ROOT, "dist", "src", "main", "index.js");

/** Windows 下把当前控制台 codepage 切到 UTF-8 (65001)，避免 Electron 中文 stdout 乱码。 */
function ensureUtf8ConsoleOnWindows() {
  if (process.platform !== "win32") {
    return;
  }
  try {
    spawnSync("chcp 65001", { stdio: "ignore", shell: true });
  } catch (error) {
    console.warn("[desktop-start] 切换控制台 codepage 到 65001 失败，可能出现中文乱码", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 在当前进程内启动 electron dist/src/main/index.js。 */
function startElectron() {
  const electronBin = process.platform === "win32" ? "electron.cmd" : "electron";
  const child = spawn(electronBin, [MAIN_ENTRY], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
  child.on("error", (error) => {
    console.error("[desktop-start] Electron 启动失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}

ensureUtf8ConsoleOnWindows();
startElectron();

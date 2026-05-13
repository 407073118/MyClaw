import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const appRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** 写出桌面启动器中文日志，帮助用户理解当前打开方式。 */
function logLauncher(message, metadata = {}) {
  console.log(JSON.stringify({ level: "info", message, metadata }));
}

/** 解析普通桌面用户默认配置，优先使用系统 AppData 作为 runtime 位置。 */
async function resolveLauncherConfig() {
  const { resolveSiliconDesktopConfig } = await import("../../dist/desktop/desktop-config.js");
  const userDataDir = process.env.APPDATA
    ? join(process.env.APPDATA, "Silicon Desktop")
    : join(homedir(), ".silicon-desktop");
  return resolveSiliconDesktopConfig({
    argv: process.argv.slice(2),
    env: process.env,
    userDataDir,
  });
}

/** 优先启动 Electron 壳；如果二进制未安装则返回 false。 */
function tryLaunchElectron() {
  const electronExe = process.platform === "win32"
    ? join(appRoot, "node_modules", "electron", "dist", "electron.exe")
    : join(appRoot, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
  if (!existsSync(electronExe)) {
    logLauncher("Electron runtime 未就绪，切换到 Edge App Mode 桌面壳", { electronExe });
    return false;
  }
  const mainPath = join(appRoot, "apps", "desktop", "main.cjs");
  spawn(electronExe, [mainPath, ...process.argv.slice(2)], {
    cwd: appRoot,
    detached: true,
    stdio: "ignore",
  }).unref();
  logLauncher("Silicon Desktop 已用 Electron 启动", { mainPath });
  return true;
}

/** 启动内置 HTTP server，并返回 Workbench URL。 */
async function launchLocalServer(config) {
  const serverPath = join(appRoot, "dist", "http", "server.js");
  spawn(process.execPath, [
    serverPath,
    "--runtime-root",
    config.runtimeRoot,
    "--host",
    config.host,
    "--port",
    String(config.port),
  ], {
    cwd: appRoot,
    detached: true,
    stdio: "ignore",
  }).unref();
  const url = `http://${config.host}:${config.port}/`;
  logLauncher("Silicon Desktop 本地 server 已启动", { url, runtimeRoot: config.runtimeRoot });
  await delay(800);
  return url;
}

/** 用 Edge App Mode 打开桌面窗口，失败时退回默认浏览器。 */
function launchAppWindow(url) {
  const edgeCandidates = [
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  const edge = edgeCandidates.find((candidate) => existsSync(candidate));
  if (edge) {
    spawn(edge, [`--app=${url}`], {
      detached: true,
      stdio: "ignore",
    }).unref();
    logLauncher("Silicon Desktop 已用 Edge App Mode 打开", { url });
    return;
  }
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
    }).unref();
    logLauncher("未找到 Edge，已使用系统默认浏览器打开 Silicon Desktop", { url });
    return;
  }
  spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
}

/** 等待指定毫秒数，给本地 server 留出监听时间。 */
async function delay(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const config = await resolveLauncherConfig();
if (!tryLaunchElectron()) {
  const url = await launchLocalServer(config);
  launchAppWindow(url);
}

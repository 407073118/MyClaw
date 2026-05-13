const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

let server = null;
let mainWindow = null;
let runtimeRoot = "";

/** 写出桌面壳中文日志，方便定位启动和窗口问题。 */
function logDesktop(message, metadata = {}) {
  console.log(JSON.stringify({ level: "info", message, metadata }));
}

/** 写出桌面壳中文警告日志，并保留错误上下文。 */
function warnDesktop(message, metadata = {}) {
  console.error(JSON.stringify({ level: "warn", message, metadata }));
}

/** 动态加载 build 后的 Silicon runtime 模块，避免 Electron main 直接依赖源码 TS。 */
async function loadRuntimeModules() {
  const distRoot = join(__dirname, "..", "..", "dist");
  const [desktopConfig, runtimeRootModule, httpServer] = await Promise.all([
    import(pathToFileURL(join(distRoot, "desktop", "desktop-config.js")).href),
    import(pathToFileURL(join(distRoot, "core", "runtime-root.js")).href),
    import(pathToFileURL(join(distRoot, "http", "server.js")).href),
  ]);
  return {
    resolveSiliconDesktopConfig: desktopConfig.resolveSiliconDesktopConfig,
    initializeSiliconRuntimeRoot: runtimeRootModule.initializeSiliconRuntimeRoot,
    startSiliconHttpServer: httpServer.startSiliconHttpServer,
  };
}

/** 准备 Silicon Desktop runtime 和内置 Web UI server。 */
async function prepareSiliconDesktop() {
  const modules = await loadRuntimeModules();
  const config = modules.resolveSiliconDesktopConfig({
    argv: process.argv.slice(2),
    env: process.env,
    userDataDir: app.getPath("userData"),
  });
  runtimeRoot = config.runtimeRoot;
  logDesktop("开始初始化 Silicon Desktop runtime", { runtimeRoot: config.runtimeRoot });
  await modules.initializeSiliconRuntimeRoot({
    runtimeRoot: config.runtimeRoot,
    logger: { info: logDesktop, warn: warnDesktop },
  });
  server = await modules.startSiliconHttpServer({
    runtimeRoot: config.runtimeRoot,
    host: config.host,
    port: config.port,
    logger: { info: logDesktop, warn: warnDesktop },
  });
  return `http://${config.host}:${config.port}/`;
}

/** 创建主窗口，让用户以桌面应用方式使用 Silicon Workbench。 */
async function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "Silicon Desktop",
    backgroundColor: "#f7f5ef",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  await mainWindow.loadURL(url);
  logDesktop("Silicon Desktop 主窗口已打开", { url });
}

/** 安装简洁菜单，提供刷新、打开 runtime 目录和退出。 */
function installApplicationMenu() {
  const template = [
    {
      label: "Silicon",
      submenu: [
        {
          label: "刷新",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow?.webContents.reload(),
        },
        {
          label: "打开 Runtime 目录",
          click: () => {
            if (runtimeRoot) {
              void shell.openPath(runtimeRoot);
            }
          },
        },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "查看",
      submenu: [
        { role: "toggleDevTools", label: "开发者工具" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** 关闭本地 server，避免退出桌面壳后端口继续占用。 */
async function stopLocalServer() {
  if (!server) {
    return;
  }
  await new Promise((resolve) => {
    server.close(() => resolve());
  });
  server = null;
  logDesktop("Silicon Desktop 本地 server 已关闭");
}

/** 启动桌面应用主流程，并把失败显示给用户。 */
async function main() {
  app.setName("Silicon Desktop");
  await app.whenReady();
  installApplicationMenu();
  const url = await prepareSiliconDesktop();
  await createMainWindow(url);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(url);
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (!server) {
    return;
  }
  event.preventDefault();
  void stopLocalServer().finally(() => app.quit());
});

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  warnDesktop("Silicon Desktop 启动失败", { message });
  void dialog.showErrorBox("Silicon Desktop 启动失败", message);
  app.quit();
});

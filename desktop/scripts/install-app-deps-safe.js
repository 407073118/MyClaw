/**
 * 安全包装 electron-builder install-app-deps。
 *
 * 这个脚本不尝试修复 native rebuild，只负责在 optional 依赖失败时
 * 放行安装流程。桌面端当前不依赖 canvas 的运行结果，因此失败时只
 * 记录告警并继续。
 */
const { spawnSync } = require("node:child_process");

const isWindows = process.platform === "win32";
const command = isWindows ? "electron-builder.cmd" : "electron-builder";

/**
 * 执行 install-app-deps。
 */
function runInstallAppDeps() {
  return spawnSync(command, ["install-app-deps"], {
    stdio: "inherit",
    shell: isWindows,
  });
}

/**
 * 主入口。
 */
function main() {
  const result = runInstallAppDeps();

  if (result.error && result.error.code === "ENOENT") {
    console.warn(
      "[install-app-deps-safe] 未找到 electron-builder，可跳过 native rebuild，通常表示 node_modules 尚未完整安装。",
    );
    process.exit(0);
  }

  if (result.status !== 0) {
    console.warn(
      "[install-app-deps-safe] electron-builder install-app-deps 失败，已忽略以继续安装；常见原因是 canvas 的 optional rebuild 在某些 Python 3.12+ 环境下失败。",
    );
    process.exit(0);
  }

  process.exit(0);
}

module.exports = {
  main,
  runInstallAppDeps,
};

if (require.main === module) {
  main();
}

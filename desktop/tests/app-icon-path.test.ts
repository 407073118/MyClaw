import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("应用图标路径", () => {
  test("主进程不再从 dist/src/main 误解析到 dist/build/icon.png", () => {
    const mainSource = readFileSync(resolve(__dirname, "..", "src", "main", "index.ts"), "utf-8");

    expect(mainSource).toContain("resolveAppIconPath");
    expect(mainSource).not.toContain("../../build/icon.png");
  });

  test("pnpm start 的主进程产物目录可以解析到根层 build 图标", async () => {
    const { resolveAppIconPath } = await import("../src/main/services/app-icon-path");
    const desktopRoot = resolve(__dirname, "..");
    const distMainDir = resolve(desktopRoot, "dist", "src", "main");
    const iconPath = resolveAppIconPath({
      mainDir: distMainDir,
      cwd: desktopRoot,
      exists: existsSync,
      logger: {
        info: () => undefined,
        warn: () => undefined,
      },
    });

    expect(iconPath).toBe(resolve(desktopRoot, "build", "icon.png"));
  });
});

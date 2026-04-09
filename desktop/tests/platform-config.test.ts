import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("跨平台配置", () => {
  test("Windows 安装器不再写死固定盘符安装目录", () => {
    const packageJsonPath = resolve(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    expect(packageJson.build?.nsis?.defaultInstallDir).toBeUndefined();
  });

  test("桌面端更新依赖 electron-updater 并发布到公开 release 仓库", () => {
    const packageJsonPath = resolve(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    expect(packageJson.dependencies?.["electron-updater"]).toBeTruthy();
    expect(packageJson.build?.publish).toMatchObject({
      provider: "github",
      owner: "407073118",
      repo: "MyClaw-desktop-releases",
    });
  });

  test("生产环境默认指向公开 release 仓库", async () => {
    const modulePath = resolve(__dirname, "..", "config", "env.production.ts");
    const { env } = await import(modulePath);

    expect(env.UPDATE_PROVIDER).toBe("github");
    expect(env.UPDATE_OWNER).toBe("407073118");
    expect(env.UPDATE_REPO).toBe("MyClaw-desktop-releases");
    expect(env.UPDATE_CHANNEL).toBe("latest");
    expect(env.UPDATE_DOWNLOAD_PAGE).toBe("https://github.com/407073118/MyClaw-desktop-releases/releases");
  });

  test("图标脚本默认解析跨平台来源，不依赖 Windows 下载目录", async () => {
    const modulePath = resolve(__dirname, "..", "scripts", "generate-icons.mjs");
    const { resolveSourceImagePath } = await import(modulePath);

    const resolved = resolveSourceImagePath({
      argv: ["node", "generate-icons.mjs"],
      env: {},
      fallbackExists: () => false,
    });

    expect(resolved).toBeNull();
  });

  test("图标脚本优先使用命令行传入的图片路径", async () => {
    const modulePath = resolve(__dirname, "..", "scripts", "generate-icons.mjs");
    const { resolveSourceImagePath } = await import(modulePath);

    const resolved = resolveSourceImagePath({
      argv: ["node", "generate-icons.mjs", "/tmp/myclaw-icon.png"],
      env: {
        MYCLAW_ICON_SOURCE: "/tmp/ignored.png",
      },
      fallbackExists: () => true,
    });

    expect(resolved).toBe("/tmp/myclaw-icon.png");
  });
});

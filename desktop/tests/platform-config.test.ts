import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("跨平台配置", () => {
  test("Windows 安装器不再写死固定盘符安装目录", () => {
    const packageJsonPath = resolve(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    expect(packageJson.build?.nsis?.defaultInstallDir).toBeUndefined();
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

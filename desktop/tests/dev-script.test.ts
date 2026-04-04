import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

describe("dev 启动脚本", () => {
  test("会强制使用 development 环境", () => {
    const { buildDevEnvironment } = require("../scripts/dev.js");

    const env = buildDevEnvironment({
      PATH: "/usr/bin",
      NODE_ENV: "production",
    });

    expect(env.NODE_ENV).toBe("development");
  });

  test("未显式指定数据目录时不再注入 Windows 固定盘符", () => {
    const { buildDevEnvironment } = require("../scripts/dev.js");

    const env = buildDevEnvironment({
      PATH: "/usr/bin",
    });

    expect(env.MYCLAW_DATA_ROOT).toBeUndefined();
  });

  test("显式指定数据目录时保留用户配置", () => {
    const { buildDevEnvironment } = require("../scripts/dev.js");

    const env = buildDevEnvironment({
      PATH: "/usr/bin",
      MYCLAW_DATA_ROOT: "/tmp/myclaw-data",
    });

    expect(env.MYCLAW_DATA_ROOT).toBe("/tmp/myclaw-data");
  });
});

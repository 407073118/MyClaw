import { join } from "node:path";

export type ResolveSiliconDesktopConfigInput = {
  argv: string[];
  env: Record<string, string | undefined>;
  userDataDir: string;
};

export type SiliconDesktopConfig = {
  runtimeRoot: string;
  host: string;
  port: number;
};

/** 解析 Silicon Desktop 启动配置，让普通用户无需手动配置 runtime。 */
export function resolveSiliconDesktopConfig(input: ResolveSiliconDesktopConfigInput): SiliconDesktopConfig {
  const values = parseDesktopArguments(input.argv);
  const runtimeRoot = values.get("runtime-root")
    ?? input.env.SILICON_RUNTIME_ROOT
    ?? join(input.userDataDir, "runtime");
  const host = values.get("host") ?? input.env.SILICON_UI_HOST ?? "127.0.0.1";
  const portText = values.get("port") ?? input.env.SILICON_UI_PORT ?? "17321";
  const port = Number.parseInt(portText, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid Silicon Desktop port: ${portText}`);
  }
  return { runtimeRoot, host, port };
}

/** 解析桌面壳命令行参数，高级用户可覆盖 runtime-root、host 和 port。 */
function parseDesktopArguments(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Invalid Silicon Desktop argument near ${key ?? "<empty>"}`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

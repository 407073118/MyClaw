import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

type IconPathLogger = Pick<typeof console, "info" | "warn">;

export interface ResolveAppIconPathOptions {
  mainDir: string;
  cwd?: string;
  exists?: (path: string) => boolean;
  logger?: IconPathLogger;
}

/** 中文注释：解析应用窗口图标路径，兼容 pnpm start 的 dist/src/main 产物目录与打包运行目录。 */
export function resolveAppIconPath({
  mainDir,
  cwd = process.cwd(),
  exists = existsSync,
  logger = console,
}: ResolveAppIconPathOptions): string {
  const candidates = [
    resolve(mainDir, "../../../build/icon.png"),
    resolve(cwd, "build", "icon.png"),
    resolve(mainDir, "../../build/icon.png"),
  ];

  for (const candidate of candidates) {
    if (exists(candidate)) {
      logger.info("[app-icon] 已解析应用图标路径", { iconPath: candidate });
      return candidate;
    }
  }

  const fallback = join(mainDir, "../../../build/icon.png");
  logger.warn("[app-icon] 未找到应用图标文件，将交给 Electron 使用回退图标", {
    mainDir,
    cwd,
    candidates,
    fallback,
  });
  return fallback;
}

import { resolve } from "node:path";

/**
 * 中文注释：解析 cloud-api 运行时允许读取的 .env 候选路径，兼容从 cloud 根目录或 cloud-api 目录启动。
 */
export function resolveRuntimeEnvPaths(
  currentWorkingDirectory = process.cwd(),
  runtimeDirectory = __dirname
): string[] {
  const candidates = [
    resolve(currentWorkingDirectory, ".env"),
    resolve(currentWorkingDirectory, "apps/cloud-api/.env"),
    resolve(runtimeDirectory, "../../.env")
  ];

  return [...new Set(candidates)];
}

/**
 * 中文注释：在 Prisma 或 Nest 初始化前加载环境变量，避免运行时拿不到 DATABASE_URL。
 */
export function loadRuntimeEnv(
  currentWorkingDirectory = process.cwd(),
  runtimeDirectory = __dirname
): string | null {
  if (process.env.DATABASE_URL?.trim()) {
    console.info("[cloud-api] 检测到 DATABASE_URL 已存在，跳过 .env 加载");
    return null;
  }

  for (const envPath of resolveRuntimeEnvPaths(currentWorkingDirectory, runtimeDirectory)) {
    try {
      process.loadEnvFile(envPath);
      console.info(`[cloud-api] 已加载环境变量文件: ${envPath}`);
      return envPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }

      console.error(`[cloud-api] 加载环境变量文件失败: ${envPath}`, error);
      throw error;
    }
  }

  console.warn("[cloud-api] 未找到 .env 文件，将继续使用当前进程环境变量");
  return null;
}

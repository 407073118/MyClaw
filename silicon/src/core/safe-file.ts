import { rename, unlink, writeFile } from "node:fs/promises";

import type { SiliconLogger } from "./employee-scaffold.js";

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 原子覆盖写入 UTF-8 文件，先写临时文件再 rename。 */
export async function writeUtf8FileAtomically(
  filePath: string,
  content: string,
  logger: SiliconLogger = noopLogger,
): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  logger.info("开始原子写入 UTF-8 文件", { filePath, tempPath });
  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, filePath);
    logger.info("UTF-8 文件原子写入完成", { filePath });
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    logger.warn("UTF-8 文件原子写入失败", {
      filePath,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** 仅在目标不存在时写入 UTF-8 文件，避免覆盖审计链。 */
export async function writeNewUtf8File(
  filePath: string,
  content: string,
  logger: SiliconLogger = noopLogger,
): Promise<void> {
  logger.info("开始新建 UTF-8 文件", { filePath });
  await writeFile(filePath, content, { encoding: "utf8", flag: "wx" }).catch((error: unknown) => {
    logger.warn("新建 UTF-8 文件失败", {
      filePath,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  });
  logger.info("UTF-8 文件已新建", { filePath });
}

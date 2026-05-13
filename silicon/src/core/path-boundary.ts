import { isAbsolute, relative, resolve } from "node:path";

import type { SiliconLogger } from "./employee-scaffold.js";

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 校验单个路径片段，禁止分隔符、空值和目录穿越。 */
export function assertSafePathSegment(
  segment: string,
  label: string,
  logger: SiliconLogger = noopLogger,
): string {
  logger.info("开始校验硅基员工路径片段", { label, segment });
  if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
    logger.warn("硅基员工路径片段校验失败", { label, segment });
    throw new Error(`Invalid path segment for ${label}: ${segment}`);
  }
  return segment;
}

/** 在员工身体边界内解析子路径，并确认最终路径没有越界。 */
export function resolveEmployeeChildPath(
  employeeDir: string,
  relativeSegments: string[],
  logger: SiliconLogger = noopLogger,
): string {
  logger.info("开始解析硅基员工边界内路径", { employeeDir, relativeSegments });
  const root = resolve(employeeDir);
  const safeSegments = relativeSegments.map((segment, index) => assertSafePathSegment(segment, `segment-${index}`, logger));
  const target = resolve(root, ...safeSegments);
  assertPathInside(root, target, logger);
  logger.info("硅基员工边界内路径解析完成", { employeeDir, target });
  return target;
}

/** 校验目标路径必须位于根路径内部。 */
export function assertPathInside(
  rootPath: string,
  targetPath: string,
  logger: SiliconLogger = noopLogger,
): void {
  const root = resolve(rootPath);
  const target = resolve(targetPath);
  const relation = relative(root, target);
  if (relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))) {
    return;
  }
  logger.warn("硅基员工路径越界，已拒绝访问", { root, target, relation });
  throw new Error(`Path escapes boundary: ${target}`);
}

import { mkdir } from "node:fs/promises";

import type { SiliconLogger } from "./employee-scaffold.js";
import { resolveEmployeeChildPath } from "./path-boundary.js";
import { writeUtf8FileAtomically } from "./safe-file.js";
import { listEmployeeTemplates } from "./template-registry.js";

export type InitializeSiliconRuntimeRootInput = {
  runtimeRoot: string;
  now?: () => Date;
  logger?: SiliconLogger;
};

export type InitializeSiliconRuntimeRootResult = {
  runtimeRoot: string;
  templateCount: number;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 初始化 Silicon Runtime 根目录，创建平台状态、模板仓库和员工容器。 */
export async function initializeSiliconRuntimeRoot(
  input: InitializeSiliconRuntimeRootInput,
): Promise<InitializeSiliconRuntimeRootResult> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始初始化 Silicon Runtime 根目录", { runtimeRoot: input.runtimeRoot });
  await mkdir(resolveEmployeeChildPath(input.runtimeRoot, ["employees"], logger), { recursive: true });
  await mkdir(resolveEmployeeChildPath(input.runtimeRoot, ["templates"], logger), { recursive: true });
  await mkdir(resolveEmployeeChildPath(input.runtimeRoot, ["platform"], logger), { recursive: true });
  await mkdir(resolveEmployeeChildPath(input.runtimeRoot, ["artifacts"], logger), { recursive: true });

  const now = (input.now ?? (() => new Date()))().toISOString();
  const templates = listEmployeeTemplates(logger);
  for (const template of templates) {
    await writeUtf8FileAtomically(
      resolveEmployeeChildPath(input.runtimeRoot, ["templates", `${template.definitionId}.json`], logger),
      `${JSON.stringify(template, null, 2)}\n`,
      logger,
    );
  }
  await writeUtf8FileAtomically(resolveEmployeeChildPath(input.runtimeRoot, ["platform", "state.json"], logger), `${JSON.stringify({
    schemaVersion: 1,
    status: "ready",
    createdAt: now,
    updatedAt: now,
    templateCount: templates.length,
  }, null, 2)}\n`, logger);
  await writeUtf8FileAtomically(resolveEmployeeChildPath(input.runtimeRoot, ["platform", "events.jsonl"], logger), "", logger);
  logger.info("Silicon Runtime 根目录初始化完成", {
    runtimeRoot: input.runtimeRoot,
    templateCount: templates.length,
  });
  return {
    runtimeRoot: input.runtimeRoot,
    templateCount: templates.length,
  };
}

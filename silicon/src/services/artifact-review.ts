import { readFile } from "node:fs/promises";

import { readEmployeeTask } from "../core/task-store.js";
import type { SiliconLogger } from "../core/employee-scaffold.js";
import { resolveEmployeeChildPath } from "../core/path-boundary.js";
import type { ArtifactReviewView } from "../contracts/view-models.js";
import { resolveRuntimeEmployeeDir } from "./runtime-paths.js";

export type ReadArtifactReviewViewInput = {
  runtimeRoot: string;
  employeeId: string;
  taskId: string;
  logger?: SiliconLogger;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 读取任务 artifact 和 review 预览，供 UI 交付与复盘视图使用。 */
export async function readArtifactReviewView(input: ReadArtifactReviewViewInput): Promise<ArtifactReviewView> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始读取 UI artifact/review 视图", {
    runtimeRoot: input.runtimeRoot,
    employeeId: input.employeeId,
    taskId: input.taskId,
  });
  const employeeDir = resolveRuntimeEmployeeDir(input.runtimeRoot, input.employeeId, logger);
  const task = await readEmployeeTask(employeeDir, input.taskId);
  const runMetadata = task.runId ? await readRunMetadata(employeeDir, task.runId, logger) : "";
  const artifactContent = task.artifactPath
    ? await readEmployeeRelativeFile(employeeDir, task.artifactPath, logger)
    : "";
  const rawReviewContent = task.reviewPath
    ? await readEmployeeRelativeFile(employeeDir, task.reviewPath, logger)
    : "";
  const reviewContent = runMetadata ? `${rawReviewContent}\n\n${runMetadata}` : rawReviewContent;
  const view: ArtifactReviewView = {
    employeeId: input.employeeId,
    taskId: input.taskId,
    runId: task.runId,
    artifact: {
      path: task.artifactPath,
      content: artifactContent,
    },
    review: {
      path: task.reviewPath,
      content: reviewContent,
    },
  };
  logger.info("UI artifact/review 视图已读取", {
    employeeId: input.employeeId,
    taskId: input.taskId,
    hasArtifact: Boolean(task.artifactPath),
    hasReview: Boolean(task.reviewPath),
  });
  return view;
}

/** 在员工目录边界内读取相对文件，防止 UI 传入路径穿越。 */
async function readEmployeeRelativeFile(employeeDir: string, relativePath: string, logger: SiliconLogger): Promise<string> {
  const target = resolveEmployeeChildPath(employeeDir, relativePath.split("/"), logger);
  const content = await readFile(target, "utf8");
  logger.info("UI 已读取员工相对文件", { employeeDir, relativePath, byteLength: content.length });
  return content;
}

/** 从 run state 提取 executor metadata，让 UI 明确展示 missing_adapter 等机器态。 */
async function readRunMetadata(employeeDir: string, runId: string, logger: SiliconLogger): Promise<string> {
  const raw = await readEmployeeRelativeFile(employeeDir, `runs/${runId}/state.json`, logger).catch(() => "");
  if (!raw.trim()) {
    return "";
  }
  const parsed = JSON.parse(raw) as { verifier?: { executorMode?: string; blockedReason?: string } };
  const executorMode = parsed.verifier?.executorMode;
  const blockedReason = parsed.verifier?.blockedReason;
  const lines = ["## Executor Metadata"];
  if (executorMode) {
    lines.push(`executorMode: ${executorMode}`);
  }
  if (blockedReason) {
    lines.push(`blockedReason: ${blockedReason}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

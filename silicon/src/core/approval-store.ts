import { readdir, readFile } from "node:fs/promises";

import type { CapabilityId } from "../policy/policy-engine.js";
import type { SiliconLogger } from "./employee-scaffold.js";
import { resolveEmployeeChildPath } from "./path-boundary.js";
import { writeNewUtf8File, writeUtf8FileAtomically } from "./safe-file.js";
import { assertApprovalRequest, parseJsonRecord } from "./schema-guards.js";

export type ApprovalStatus = "requested" | "approved" | "denied";

export type ApprovalRequest = {
  schemaVersion: 1;
  id: string;
  taskId: string;
  capability: CapabilityId;
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type CreateApprovalRequestInput = {
  employeeDir: string;
  approvalId: string;
  taskId: string;
  capability: CapabilityId;
  reason: string;
  now?: () => Date;
  logger?: SiliconLogger;
};

export type ResolveApprovalRequestInput = {
  employeeDir: string;
  approvalId: string;
  now?: () => Date;
  logger?: SiliconLogger;
};

const APPROVAL_ID_PATTERN = /^[a-z][a-z0-9-]{1,127}$/;

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 计算员工 approval 请求的稳定 JSON 文件路径。 */
export function resolveApprovalRequestPath(
  employeeDir: string,
  approvalId: string,
  logger: SiliconLogger = noopLogger,
): string {
  return resolveEmployeeChildPath(employeeDir, ["approvals", `${approvalId}.json`], logger);
}

/** 创建需要人工确认的审批请求，并写入员工 approvals 边界。 */
export async function createApprovalRequest(input: CreateApprovalRequestInput): Promise<ApprovalRequest> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始创建硅基员工审批请求", {
    employeeDir: input.employeeDir,
    approvalId: input.approvalId,
    taskId: input.taskId,
    capability: input.capability,
  });
  if (!APPROVAL_ID_PATTERN.test(input.approvalId)) {
    logger.warn("硅基员工审批 ID 校验失败", { approvalId: input.approvalId });
    throw new Error(`Invalid approvalId: ${input.approvalId}`);
  }
  const now = (input.now ?? (() => new Date()))().toISOString();
  const approval: ApprovalRequest = {
    schemaVersion: 1,
    id: input.approvalId,
    taskId: input.taskId,
    capability: input.capability,
    reason: input.reason,
    status: "requested",
    createdAt: now,
    updatedAt: now,
  };
  await writeApprovalRequest(input.employeeDir, approval, logger, { createOnly: true });
  logger.info("硅基员工审批请求已创建", {
    employeeDir: input.employeeDir,
    approvalId: approval.id,
    taskId: approval.taskId,
    status: approval.status,
  });
  return approval;
}

/** 读取员工 approvals 中的审批请求 JSON。 */
export async function readApprovalRequest(employeeDir: string, approvalId: string): Promise<ApprovalRequest> {
  const raw = await readFile(resolveApprovalRequestPath(employeeDir, approvalId), "utf8");
  const parsed = parseJsonRecord(raw, "ApprovalRequest");
  assertApprovalRequest(parsed);
  return parsed;
}

/** 列出员工 approvals 目录中的审批请求，供管理面处理等待队列。 */
export async function listApprovalRequests(
  employeeDir: string,
  logger: SiliconLogger = noopLogger,
): Promise<ApprovalRequest[]> {
  logger.info("开始列出硅基员工审批请求", { employeeDir });
  const approvalsDir = resolveEmployeeChildPath(employeeDir, ["approvals"], logger);
  const entries = await readdir(approvalsDir).catch(() => []);
  const approvals: ApprovalRequest[] = [];
  for (const entry of entries.filter((item) => item.endsWith(".json")).sort()) {
    const approvalPath = resolveEmployeeChildPath(employeeDir, ["approvals", entry], logger);
    try {
      const raw = await readFile(approvalPath, "utf8");
      const parsed = parseJsonRecord(raw, "ApprovalRequest");
      assertApprovalRequest(parsed);
      approvals.push(parsed);
    } catch (error) {
      logger.warn("读取硅基员工审批请求失败，已跳过坏审批文件", {
        employeeDir,
        approvalPath,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
  logger.info("硅基员工审批请求已列出", { employeeDir, count: approvals.length });
  return approvals;
}

/** 将审批请求推进为 approved 状态，供 heartbeat 继续执行等待中的任务。 */
export async function approveApprovalRequest(input: ResolveApprovalRequestInput): Promise<ApprovalRequest> {
  return resolveApprovalRequest(input, "approved");
}

/** 将审批请求推进为 denied 状态，供 heartbeat 终止等待中的任务。 */
export async function denyApprovalRequest(input: ResolveApprovalRequestInput): Promise<ApprovalRequest> {
  return resolveApprovalRequest(input, "denied");
}

/** 写入审批请求 JSON，保持审批状态可审计。 */
export async function writeApprovalRequest(
  employeeDir: string,
  approval: ApprovalRequest,
  logger: SiliconLogger = noopLogger,
  options?: { createOnly?: boolean },
): Promise<void> {
  logger.info("写入硅基员工审批状态", {
    employeeDir,
    approvalId: approval.id,
    taskId: approval.taskId,
    status: approval.status,
  });
  const approvalPath = resolveApprovalRequestPath(employeeDir, approval.id, logger);
  const payload = `${JSON.stringify({ ...approval, schemaVersion: 1 }, null, 2)}\n`;
  if (options?.createOnly) {
    await writeNewUtf8File(approvalPath, payload, logger);
  } else {
    await writeUtf8FileAtomically(approvalPath, payload, logger);
  }
}

/** 解析审批请求并写回最终审批状态。 */
async function resolveApprovalRequest(
  input: ResolveApprovalRequestInput,
  status: Extract<ApprovalStatus, "approved" | "denied">,
): Promise<ApprovalRequest> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始处理硅基员工审批请求", {
    employeeDir: input.employeeDir,
    approvalId: input.approvalId,
    nextStatus: status,
  });
  const approval = await readApprovalRequest(input.employeeDir, input.approvalId);
  if (approval.status !== "requested") {
    logger.warn("硅基员工审批请求已经是终态，拒绝重复处理", {
      employeeDir: input.employeeDir,
      approvalId: input.approvalId,
      currentStatus: approval.status,
      requestedStatus: status,
    });
    throw new Error(`Approval request is already resolved: ${input.approvalId}`);
  }
  const now = (input.now ?? (() => new Date()))().toISOString();
  const resolved: ApprovalRequest = {
    ...approval,
    schemaVersion: 1,
    status,
    updatedAt: now,
    resolvedAt: now,
  };
  await writeApprovalRequest(input.employeeDir, resolved, logger);
  logger.info("硅基员工审批请求已处理", {
    employeeDir: input.employeeDir,
    approvalId: resolved.id,
    taskId: resolved.taskId,
    status: resolved.status,
  });
  return resolved;
}

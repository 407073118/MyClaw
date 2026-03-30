import { isAbsolute, join, normalize, resolve } from "node:path";

import type { RuntimeLayout } from "../services/runtime-layout";

export type WorkflowLibraryRootRecord = {
  id: string;
  name: string;
  path: string;
  writable: boolean;
  kind: "personal" | "mounted";
  createdAt: string;
  updatedAt: string;
};

/** 判断是否开启工作流存储调试日志。 */
function isWorkflowStorageDebugEnabled(): boolean {
  return process.env.MYCLAW_RUNTIME_STORAGE_DEBUG === "1";
}

/** 统一输出工作流存储调试日志，默认关闭避免污染常规输出。 */
function logWorkflowStorage(message: string, payload: Record<string, unknown>): void {
  if (!isWorkflowStorageDebugEnabled()) {
    return;
  }
  console.info(message, payload);
}

/** 创建默认个人工作流根目录记录。 */
function createDefaultPersonalWorkflowRoot(layout: RuntimeLayout, now: string): WorkflowLibraryRootRecord {
  const root: WorkflowLibraryRootRecord = {
    id: "personal",
    name: "Personal Workflows",
    path: join(layout.workflowRootsDir, "personal"),
    writable: true,
    kind: "personal",
    createdAt: now,
    updatedAt: now,
  };

  logWorkflowStorage("[workflow-library-root-store] 已创建默认个人工作流根目录记录", {
    id: root.id,
    path: root.path,
  });
  return root;
}

/** 校验并归一化根目录路径，mounted 根必须为稳定绝对路径。*/
function resolveAndValidateRootPath(item: WorkflowLibraryRootRecord): string {
  const trimmed = item.path.trim();
  if (!trimmed) {
    throw new Error(`Invalid workflow library root '${item.id}': empty root path.`);
  }

  if (item.kind === "mounted" && !isAbsolute(trimmed)) {
    throw new Error(
      `Mounted workflow library root path must be absolute: root '${item.id}' uses '${item.path}'.`,
    );
  }

  return resolve(normalize(trimmed));
}

/** 归一化工作流根目录配置，确保至少存在一个可写个人根目录。 */
export function resolveWorkflowLibraryRoots(
  input: WorkflowLibraryRootRecord[] | undefined,
  layout: RuntimeLayout,
  now = new Date().toISOString(),
): WorkflowLibraryRootRecord[] {
  const normalized: WorkflowLibraryRootRecord[] = [];
  if (Array.isArray(input)) {
    input.forEach((item) => {
      if (
        !item ||
        typeof item.id !== "string" ||
        typeof item.name !== "string" ||
        typeof item.path !== "string" ||
        typeof item.writable !== "boolean" ||
        (item.kind !== "personal" && item.kind !== "mounted") ||
        typeof item.createdAt !== "string" ||
        typeof item.updatedAt !== "string"
      ) {
        return;
      }

      normalized.push({
        ...item,
        path: resolveAndValidateRootPath(item),
      });
    });
  }

  if (normalized.length === 0) {
    const fallback = createDefaultPersonalWorkflowRoot(layout, now);
    logWorkflowStorage("[workflow-library-root-store] 输入为空，回退到默认个人根目录", {
      id: fallback.id,
    });
    return [fallback];
  }

  const hasPersonalWritableRoot = normalized.some(
    (item) => item.id === "personal" && item.kind === "personal" && item.writable,
  );
  if (hasPersonalWritableRoot) {
    logWorkflowStorage("[workflow-library-root-store] 已加载工作流根目录配置", {
      count: normalized.length,
    });
    return normalized;
  }

  const fallback = createDefaultPersonalWorkflowRoot(layout, now);
  logWorkflowStorage("[workflow-library-root-store] 缺少可写个人根目录，已自动补齐", {
    countBefore: normalized.length,
  });
  return [fallback, ...normalized];
}

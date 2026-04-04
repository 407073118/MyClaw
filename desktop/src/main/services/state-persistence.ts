/**
 * 状态持久化服务。
 *
 * 在启动时从磁盘同步加载所有已持久化状态，
 * 并在状态变更后异步保存单个对象。
 *
 * 目录布局：
 *   <myClawDir>/models/<id>.json
 *   <myClawDir>/sessions/<id>/session.json
 *   <myClawDir>/sessions/<id>/messages.json
 *   <myClawDir>/employees/<id>.json
 *   <myClawDir>/workflows/<id>.json
 *   <myClawDir>/settings.json
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { writeFile, mkdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  ApprovalPolicy,
  ChatSession,
  LocalEmployeeSummary,
  ModelProfile,
  PersonalPromptProfile,
  WorkflowDefinition,
  WorkflowSummary,
} from "@shared/contracts";
import { createDefaultApprovalPolicy, createDefaultPersonalPromptProfile } from "@shared/contracts";

import type { MyClawPaths } from "./directory-service";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type AppSettings = {
  defaultModelProfileId: string | null;
  approvalPolicy: ApprovalPolicy;
  personalPrompt: PersonalPromptProfile;
};

export type PersistedState = {
  models: ModelProfile[];
  sessions: ChatSession[];
  employees: LocalEmployeeSummary[];
  workflows: WorkflowSummary[];
  workflowDefinitions: Record<string, WorkflowDefinition>;
  defaultModelProfileId: string | null;
  approvalPolicy: ApprovalPolicy;
  personalPrompt: PersonalPromptProfile;
};

// ---------------------------------------------------------------------------
// 辅助方法
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function tryReadJson<T>(filePath: string): T | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    // 记录文件损坏或缺失，方便定位潜在数据丢失问题
    if (existsSync(filePath)) {
      console.warn(`[state-persistence] Corrupt or unreadable JSON: ${filePath}`, err instanceof Error ? err.message : String(err));
    }
    return null;
  }
}

/**
 * 原子写入：先写临时文件，再执行重命名。
 * 可防止崩溃或断电时因部分写入导致的数据损坏。
 */
async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmpPath, data, "utf-8");
  await rename(tmpPath, filePath);
}

function employeesDir(paths: MyClawPaths): string {
  return join(paths.myClawDir, "employees");
}

function workflowsDir(paths: MyClawPaths): string {
  return join(paths.myClawDir, "workflows");
}

// ---------------------------------------------------------------------------
// 从磁盘加载全部状态（同步执行，仅在启动时调用一次）
// ---------------------------------------------------------------------------

export function loadPersistedState(paths: MyClawPaths): PersistedState {
  // ---- settings.json -----------------------------------------------------
  let defaultModelProfileId: string | null = null;
  let approvalPolicy: ApprovalPolicy = createDefaultApprovalPolicy();
  let personalPrompt: PersonalPromptProfile = createDefaultPersonalPromptProfile();

  const settings = tryReadJson<Partial<AppSettings>>(paths.settingsFile);
  if (settings) {
    defaultModelProfileId = settings.defaultModelProfileId ?? null;
    if (settings.approvalPolicy) {
      approvalPolicy = { ...approvalPolicy, ...settings.approvalPolicy };
    }
    if (settings.personalPrompt) {
      personalPrompt = { ...personalPrompt, ...settings.personalPrompt };
    }
  }

  // ---- models ------------------------------------------------------------
  const models: ModelProfile[] = [];
  ensureDir(paths.modelsDir);
  try {
    for (const file of readdirSync(paths.modelsDir)) {
      if (!file.endsWith(".json")) continue;
      const data = tryReadJson<ModelProfile>(join(paths.modelsDir, file));
      if (data && data.id) {
        models.push(data);
      }
    }
  } catch {
    // modelsDir 不可读时从空数据启动
  }

  // ---- sessions ----------------------------------------------------------
  const sessions: ChatSession[] = [];
  ensureDir(paths.sessionsDir);
  try {
    for (const sessionId of readdirSync(paths.sessionsDir)) {
      const sessionDir = join(paths.sessionsDir, sessionId);
      const metaFile = join(sessionDir, "session.json");
      const messagesFile = join(sessionDir, "messages.json");
      const meta = tryReadJson<Omit<ChatSession, "messages">>(metaFile);
      if (!meta || !meta.id) continue;
      const messages = tryReadJson<ChatSession["messages"]>(messagesFile) ?? [];
      sessions.push({ ...meta, messages });
    }
  } catch {
    // sessionsDir 不可读时从空数据启动
  }

  // ---- employees ---------------------------------------------------------
  const employees: LocalEmployeeSummary[] = [];
  const empDir = employeesDir(paths);
  ensureDir(empDir);
  try {
    for (const file of readdirSync(empDir)) {
      if (!file.endsWith(".json")) continue;
      const data = tryReadJson<LocalEmployeeSummary>(join(empDir, file));
      if (data && data.id) {
        employees.push(data);
      }
    }
  } catch {
    // 不可读时从空数据启动
  }

  // ---- workflows ---------------------------------------------------------
  const workflowsArr: WorkflowSummary[] = [];
  const workflowDefinitions: Record<string, WorkflowDefinition> = {};
  const wfDir = workflowsDir(paths);
  ensureDir(wfDir);
  try {
    for (const file of readdirSync(wfDir)) {
      if (!file.endsWith(".json")) continue;
      const data = tryReadJson<WorkflowDefinition>(join(wfDir, file));
      if (data && data.id) {
        workflowDefinitions[data.id] = data;
        // 从完整定义中构建摘要
        const summary: WorkflowSummary = {
          id: data.id,
          name: data.name,
          description: data.description,
          status: data.status,
          source: data.source,
          updatedAt: data.updatedAt,
          version: data.version ?? 1,
          nodeCount: data.nodes?.length ?? 0,
          edgeCount: data.edges?.length ?? 0,
          libraryRootId: data.libraryRootId ?? "",
        };
        workflowsArr.push(summary);
      }
    }
  } catch {
    // 不可读时从空数据启动
  }

  return {
    models,
    sessions,
    employees,
    workflows: workflowsArr,
    workflowDefinitions,
    defaultModelProfileId,
    approvalPolicy,
    personalPrompt,
  };
}

// ---------------------------------------------------------------------------
// 保存单个对象（异步执行，每次变更后调用）
// ---------------------------------------------------------------------------

export async function saveModelProfile(
  paths: MyClawPaths,
  profile: ModelProfile,
): Promise<void> {
  ensureDir(paths.modelsDir);
  const filePath = join(paths.modelsDir, `${profile.id}.json`);
  await atomicWriteFile(filePath, JSON.stringify(profile, null, 2));
}

export async function deleteModelProfileFile(
  paths: MyClawPaths,
  id: string,
): Promise<void> {
  const filePath = join(paths.modelsDir, `${id}.json`);
  if (existsSync(filePath)) {
    await rm(filePath);
  }
}

export async function saveSession(
  paths: MyClawPaths,
  session: ChatSession,
): Promise<void> {
  const sessionDir = join(paths.sessionsDir, session.id);
  await mkdir(sessionDir, { recursive: true });

  // 拆分保存：metadata（不含 messages）与 messages 分别落盘
  // 两者都使用原子写入（临时文件 + rename）避免数据损坏
  const { messages, ...meta } = session;
  await atomicWriteFile(join(sessionDir, "session.json"), JSON.stringify(meta, null, 2));
  await atomicWriteFile(join(sessionDir, "messages.json"), JSON.stringify(messages, null, 2));
}

export async function deleteSessionFiles(
  paths: MyClawPaths,
  id: string,
): Promise<void> {
  const sessionDir = join(paths.sessionsDir, id);
  if (existsSync(sessionDir)) {
    await rm(sessionDir, { recursive: true, force: true });
  }
}

export async function saveEmployee(
  paths: MyClawPaths,
  employee: LocalEmployeeSummary,
): Promise<void> {
  const dir = employeesDir(paths);
  ensureDir(dir);
  await atomicWriteFile(join(dir, `${employee.id}.json`), JSON.stringify(employee, null, 2));
}

export async function saveWorkflow(
  paths: MyClawPaths,
  workflow: WorkflowDefinition | WorkflowSummary,
): Promise<void> {
  const dir = workflowsDir(paths);
  ensureDir(dir);
  await atomicWriteFile(join(dir, `${workflow.id}.json`), JSON.stringify(workflow, null, 2));
}

export async function saveSettings(
  paths: MyClawPaths,
  settings: AppSettings,
): Promise<void> {
  ensureDir(paths.myClawDir);
  await atomicWriteFile(paths.settingsFile, JSON.stringify(settings, null, 2));
}

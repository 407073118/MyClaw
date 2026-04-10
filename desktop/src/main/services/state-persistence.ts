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
 *   <myClawDir>/silicon-persons/<id>/person.json  (legacy: <id>.json)
 *   <myClawDir>/workflows/<id>.json
 *   <myClawDir>/settings.json
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { writeFile, mkdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  ApprovalPolicy,
  ChatSession,
  ModelProfile,
  PersonalPromptProfile,
  SiliconPerson,
  WorkflowDefinition,
  WorkflowRunSummary,
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
  siliconPersons: SiliconPerson[];
  workflows: WorkflowSummary[];
  workflowRuns: WorkflowRunSummary[];
  workflowDefinitions: Record<string, WorkflowDefinition>;
  defaultModelProfileId: string | null;
  approvalPolicy: ApprovalPolicy;
  personalPrompt: PersonalPromptProfile;
};

type PersistedSessionMetadata = Omit<ChatSession, "messages">;

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

function siliconPersonsDir(paths: MyClawPaths): string {
  return join(paths.myClawDir, "silicon-persons");
}

function workflowsDir(paths: MyClawPaths): string {
  return join(paths.myClawDir, "workflows");
}

function workflowRunsDir(paths: MyClawPaths): string {
  return join(paths.myClawDir, "workflow-runs");
}

function hasOwnPlanState(value: object): boolean {
  return Object.prototype.hasOwnProperty.call(value, "planState");
}

function hasOwnPlanModeState(value: object): boolean {
  return Object.prototype.hasOwnProperty.call(value, "planModeState");
}

function hasOwnTasks(value: object): boolean {
  return Object.prototype.hasOwnProperty.call(value, "tasks");
}

function hydrateSession(
  meta: PersistedSessionMetadata,
  messages: ChatSession["messages"],
): ChatSession {
  // 兼容迁移期旧会话：缺少 planState / planModeState 时保持缺字段；显式 null/对象则原样恢复。
  const hydratedSession = { ...meta, messages } as ChatSession;
  if (hasOwnPlanModeState(meta)) {
    hydratedSession.planModeState = meta.planModeState;
  }
  if (hasOwnPlanState(meta)) {
    hydratedSession.planState = meta.planState;
  }
  if (hasOwnTasks(meta)) {
    hydratedSession.tasks = (meta as { tasks?: unknown }).tasks as typeof hydratedSession.tasks;
  }
  return hydratedSession;
}

function dehydrateSession(session: ChatSession): PersistedSessionMetadata {
  const { messages: _messages, ...meta }: { messages: ChatSession["messages"] } & PersistedSessionMetadata = session;

  if (hasOwnPlanModeState(session)) {
    meta.planModeState = session.planModeState;
  }
  if (hasOwnPlanState(session)) {
    meta.planState = session.planState;
  }
  if (hasOwnTasks(session)) {
    meta.tasks = session.tasks;
  }
  return meta;
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
      const meta = tryReadJson<PersistedSessionMetadata>(metaFile);
      if (!meta || !meta.id) continue;
      const messages = tryReadJson<ChatSession["messages"]>(messagesFile) ?? [];
      sessions.push(hydrateSession(meta, messages));
    }
  } catch {
    // sessionsDir 不可读时从空数据启动
  }

  // ---- silicon persons ---------------------------------------------------
  const siliconPersons: SiliconPerson[] = [];
  const personDir = siliconPersonsDir(paths);
  ensureDir(personDir);
  try {
    for (const entry of readdirSync(personDir)) {
      const entryPath = join(personDir, entry);
      try {
        if (statSync(entryPath).isDirectory()) {
          // 新格式：<id>/person.json
          const data = tryReadJson<SiliconPerson>(join(entryPath, "person.json"));
          if (data && data.id) {
            siliconPersons.push(data);

            // 加载该员工独立目录下的 sessions
            const personSessionsDir = join(entryPath, "sessions");
            if (existsSync(personSessionsDir)) {
              try {
                for (const sid of readdirSync(personSessionsDir)) {
                  const sDir = join(personSessionsDir, sid);
                  const sMeta = tryReadJson<PersistedSessionMetadata>(join(sDir, "session.json"));
                  if (!sMeta || !sMeta.id) continue;
                  const sMsgs = tryReadJson<ChatSession["messages"]>(join(sDir, "messages.json")) ?? [];
                  sessions.push(hydrateSession(sMeta, sMsgs));
                }
              } catch { /* 不可读时跳过 */ }
            }
          }
        } else if (entry.endsWith(".json")) {
          // 旧格式兼容：<id>.json
          const data = tryReadJson<SiliconPerson>(entryPath);
          if (data && data.id) {
            siliconPersons.push(data);
          }
        }
      } catch {
        // 单条目不可读时跳过
      }
    }
  } catch {
    // 不可读时从空数据启动
  }

  // ---- workflows ---------------------------------------------------------
  const workflowsArr: WorkflowSummary[] = [];
  const workflowRuns: WorkflowRunSummary[] = [];
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

  const workflowRunDir = workflowRunsDir(paths);
  ensureDir(workflowRunDir);
  try {
    for (const file of readdirSync(workflowRunDir)) {
      if (!file.endsWith(".json")) continue;
      const data = tryReadJson<WorkflowRunSummary>(join(workflowRunDir, file));
      if (data && data.id) {
        workflowRuns.push(data);
      }
    }
  } catch {
    // workflowRunsDir 涓嶅彲璇绘椂浠庣┖鏁版嵁鍚姩
  }

  return {
    models,
    sessions,
    siliconPersons,
    workflows: workflowsArr,
    workflowRuns,
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

/**
 * 解析 session 的实际存储目录。
 *
 * 硅基员工的 session 存储在 `silicon-persons/<personId>/sessions/`，
 * 主助手的 session 存储在全局 `sessions/`。
 */
function resolveSessionsDir(paths: MyClawPaths, session: { siliconPersonId?: string | null }): string {
  if (session.siliconPersonId) {
    return join(siliconPersonsDir(paths), session.siliconPersonId, "sessions");
  }
  return paths.sessionsDir;
}

export async function saveSession(
  paths: MyClawPaths,
  session: ChatSession,
): Promise<void> {
  const sessionsDir = resolveSessionsDir(paths, session);
  const sessionDir = join(sessionsDir, session.id);
  await mkdir(sessionDir, { recursive: true });

  // 拆分保存：metadata（不含 messages）与 messages 分别落盘
  // 两者都使用原子写入（临时文件 + rename）避免数据损坏
  // 先写 messages 再写 session：session.json 存在即表示该次保存已完成，
  // 若中间崩溃只有 messages 写入则 session.json 仍为上一版本，加载时不会出错。
  const { messages } = session;
  const meta = dehydrateSession(session);
  await atomicWriteFile(join(sessionDir, "messages.json"), JSON.stringify(messages, null, 2));
  await atomicWriteFile(join(sessionDir, "session.json"), JSON.stringify(meta, null, 2));
}

export async function deleteSessionFiles(
  paths: MyClawPaths,
  id: string,
  siliconPersonId?: string | null,
): Promise<void> {
  const sessionsDir = siliconPersonId
    ? join(siliconPersonsDir(paths), siliconPersonId, "sessions")
    : paths.sessionsDir;
  const sessionDir = join(sessionsDir, id);
  if (existsSync(sessionDir)) {
    await rm(sessionDir, { recursive: true, force: true });
  }
}

export async function saveSiliconPerson(
  paths: MyClawPaths,
  siliconPerson: SiliconPerson,
): Promise<void> {
  const personDirPath = join(siliconPersonsDir(paths), siliconPerson.id);
  await mkdir(personDirPath, { recursive: true });
  await atomicWriteFile(join(personDirPath, "person.json"), JSON.stringify(siliconPerson, null, 2));
}

export async function saveWorkflow(
  paths: MyClawPaths,
  workflow: WorkflowDefinition | WorkflowSummary,
): Promise<void> {
  const dir = workflowsDir(paths);
  ensureDir(dir);
  await atomicWriteFile(join(dir, `${workflow.id}.json`), JSON.stringify(workflow, null, 2));
}

export async function deleteWorkflowFile(
  paths: MyClawPaths,
  workflowId: string,
): Promise<void> {
  const filePath = join(workflowsDir(paths), `${workflowId}.json`);
  if (existsSync(filePath)) {
    await rm(filePath, { force: true });
  }
}

export async function saveWorkflowRun(
  paths: MyClawPaths,
  workflowRun: WorkflowRunSummary,
): Promise<void> {
  const dir = workflowRunsDir(paths);
  ensureDir(dir);
  await atomicWriteFile(join(dir, `${workflowRun.id}.json`), JSON.stringify(workflowRun, null, 2));
}

export async function deleteWorkflowRunFile(
  paths: MyClawPaths,
  workflowRunId: string,
): Promise<void> {
  const filePath = join(workflowRunsDir(paths), `${workflowRunId}.json`);
  if (existsSync(filePath)) {
    await rm(filePath, { force: true });
  }
}

export async function saveSettings(
  paths: MyClawPaths,
  settings: AppSettings,
): Promise<void> {
  ensureDir(paths.myClawDir);
  await atomicWriteFile(paths.settingsFile, JSON.stringify(settings, null, 2));
}

/** 初始化或获取指定硅基员工的运行时数据库。 */
export async function openSiliconPersonRuntime(
  paths: MyClawPaths,
  siliconPersonId: string,
): Promise<import("./silicon-person-runtime-store").SiliconPersonRuntimeStore> {
  const { SiliconPersonRuntimeStore } = await import("./silicon-person-runtime-store");
  const personDir = join(siliconPersonsDir(paths), siliconPersonId);
  ensureDir(personDir);
  const store = new SiliconPersonRuntimeStore(join(personDir, "runtime.db"));
  await store.init();
  return store;
}

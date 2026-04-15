/**
 * 状态持久化服务。
 *
 * 在启动时从磁盘同步加载所有已持久化状态，
 * 并在状态变更后异步保存单个对象。
 *
 * 会话数据使用 SQLite（sql.js, 纯 WASM）统一存储：
 *   <myClawDir>/sessions.db        — 所有会话 + 消息（主聊天 & 硅基员工）
 *
 * 其余数据仍使用 JSON 文件：
 *   <myClawDir>/models/<id>.json
 *   <myClawDir>/silicon-persons/<id>/person.json
 *   <myClawDir>/workflows/<id>.json
 *   <myClawDir>/settings.json
 *
 * 旧 JSON 会话目录（sessions/、silicon-persons/<id>/sessions/）在首次启动时
 * 自动迁移至 sessions.db，迁移完成后保留原文件供回滚。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
// rmSync / writeFileSync 已不再需要，会话数据通过 SessionDatabase 管理
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
import { normalizeFirstClassVendorRoute } from "./managed-model-profile";
import { SessionDatabase } from "./session-database";

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
// SessionDatabase 单例
// ---------------------------------------------------------------------------

let _sessionDb: SessionDatabase | null = null;

/** 获取已初始化的 SessionDatabase 单例。loadPersistedState 内部创建。 */
export function getSessionDatabase(): SessionDatabase {
  if (!_sessionDb) {
    throw new Error("[state-persistence] SessionDatabase 尚未初始化，请确保 loadPersistedState 已被调用");
  }
  return _sessionDb;
}

/** 关闭并重置 SessionDatabase 单例（测试清理用）。 */
export function resetSessionDatabase(): void {
  if (_sessionDb) {
    _sessionDb.close();
    _sessionDb = null;
  }
}

/**
 * 确保 SessionDatabase 单例可用。
 * 正常启动后直接返回 loadPersistedState 创建的实例；
 * 测试等场景下通过 async create 延迟初始化 sql.js 引擎。
 */
async function ensureSessionDatabase(paths: MyClawPaths): Promise<SessionDatabase> {
  if (!_sessionDb) {
    const dbFile = (paths as Record<string, string>).sessionsDbFile
      || join(paths.myClawDir, "sessions.db");
    _sessionDb = await SessionDatabase.create(dbFile);
  }
  return _sessionDb;
}

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

// dehydrateSession 已移除：会话数据通过 SessionDatabase 统一序列化

// ---------------------------------------------------------------------------
// 从磁盘加载全部状态（同步执行，仅在启动时调用一次）
// ---------------------------------------------------------------------------

export async function loadPersistedState(paths: MyClawPaths): Promise<PersistedState> {
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
        const normalized = normalizeFirstClassVendorRoute(data);
        models.push(normalized);
        if (JSON.stringify(normalized) !== JSON.stringify(data)) {
          await atomicWriteFile(join(paths.modelsDir, file), JSON.stringify(normalized, null, 2));
        }
      }
    }
  } catch {
    // modelsDir 不可读时从空数据启动
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
          const data = tryReadJson<SiliconPerson>(join(entryPath, "person.json"));
          if (data && data.id) {
            siliconPersons.push(data);
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

  // ---- sessions (SQLite) ------------------------------------------------
  // 关闭此前可能由上一次 loadPersistedState 打开的连接
  if (_sessionDb) {
    _sessionDb.close();
    _sessionDb = null;
  }

  const sessionDb = await SessionDatabase.create(paths.sessionsDbFile);
  _sessionDb = sessionDb;

  let sessions: ChatSession[];

  if (sessionDb.getSessionCount() === 0) {
    // DB 为空 — 尝试从旧 JSON 文件迁移
    const jsonSessions = loadLegacyJsonSessions(paths, siliconPersons);
    if (jsonSessions.length > 0) {
      sessionDb.migrateFromJson(jsonSessions);
      console.info("[state-persistence] 已将 JSON 会话迁移至 sessions.db", {
        count: jsonSessions.length,
      });
    }
    sessions = sessionDb.loadAllSessions();
  } else {
    sessions = sessionDb.loadAllSessions();
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
  const normalizedProfile = normalizeFirstClassVendorRoute(profile);
  await atomicWriteFile(filePath, JSON.stringify(normalizedProfile, null, 2));
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

// ---------------------------------------------------------------------------
// 旧 JSON 会话加载（仅供迁移使用）
// ---------------------------------------------------------------------------

/** 从旧目录结构加载所有 JSON 会话（主聊天 + 硅基员工），用于首次迁移到 SQLite。 */
function loadLegacyJsonSessions(
  paths: MyClawPaths,
  siliconPersons: SiliconPerson[],
): ChatSession[] {
  const sessions: ChatSession[] = [];

  // 主聊天 sessions
  ensureDir(paths.sessionsDir);
  try {
    for (const sessionId of readdirSync(paths.sessionsDir)) {
      const sessionDir = join(paths.sessionsDir, sessionId);
      const meta = tryReadJson<PersistedSessionMetadata>(join(sessionDir, "session.json"));
      if (!meta || !meta.id) continue;
      const messages = tryReadJson<ChatSession["messages"]>(join(sessionDir, "messages.json")) ?? [];
      sessions.push(hydrateSession(meta, messages));
    }
  } catch {
    // 不可读时跳过
  }

  // 硅基员工 sessions
  const personBaseDir = siliconPersonsDir(paths);
  for (const person of siliconPersons) {
    const personSessionsDir = join(personBaseDir, person.id, "sessions");
    if (!existsSync(personSessionsDir)) continue;
    try {
      for (const sid of readdirSync(personSessionsDir)) {
        const sDir = join(personSessionsDir, sid);
        const sMeta = tryReadJson<PersistedSessionMetadata>(join(sDir, "session.json"));
        if (!sMeta || !sMeta.id) continue;
        // 校验会话归属
        if (sMeta.siliconPersonId && sMeta.siliconPersonId !== person.id) {
          console.warn("[state-persistence] 迁移时跳过归属不一致的硅基员工会话", {
            sessionId: sMeta.id,
            expected: person.id,
            actual: sMeta.siliconPersonId,
          });
          continue;
        }
        const sMsgs = tryReadJson<ChatSession["messages"]>(join(sDir, "messages.json")) ?? [];
        const session = hydrateSession(sMeta, sMsgs);
        if (!session.siliconPersonId) {
          session.siliconPersonId = person.id;
        }
        sessions.push(session);
      }
    } catch {
      // 不可读时跳过
    }
  }

  return sessions;
}

// ---------------------------------------------------------------------------
// 会话持久化（SQLite）
// ---------------------------------------------------------------------------

/** 保存会话到 SQLite 数据库（元数据 + 消息，事务原子写入）。 */
export async function saveSession(
  paths: MyClawPaths,
  session: ChatSession,
): Promise<void> {
  (await ensureSessionDatabase(paths)).saveSession(session);
}

/** 从 SQLite 数据库中删除会话（CASCADE 自动清理消息和 FTS 索引）。 */
export async function deleteSessionFiles(
  paths: MyClawPaths,
  id: string,
  _siliconPersonId?: string | null,
): Promise<void> {
  (await ensureSessionDatabase(paths)).deleteSession(id);
}

export async function saveSiliconPerson(
  paths: MyClawPaths,
  siliconPerson: SiliconPerson,
): Promise<void> {
  const personDirPath = join(siliconPersonsDir(paths), siliconPerson.id);
  await mkdir(personDirPath, { recursive: true });
  await atomicWriteFile(join(personDirPath, "person.json"), JSON.stringify(siliconPerson, null, 2));
}

export async function deleteSiliconPersonFiles(
  paths: MyClawPaths,
  siliconPersonId: string,
): Promise<void> {
  const personDirPath = join(siliconPersonsDir(paths), siliconPersonId);
  if (existsSync(personDirPath)) {
    await rm(personDirPath, { recursive: true, force: true });
  }
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

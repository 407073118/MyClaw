/**
 * State persistence service.
 *
 * Loads all persisted state from disk at startup (synchronous),
 * and saves individual items asynchronously after mutations.
 *
 * Directory layout:
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
  WorkflowDefinition,
  WorkflowSummary,
} from "@shared/contracts";
import { createDefaultApprovalPolicy } from "@shared/contracts";

import type { MyClawPaths } from "./directory-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AppSettings = {
  defaultModelProfileId: string | null;
  approvalPolicy: ApprovalPolicy;
};

export type PersistedState = {
  models: ModelProfile[];
  sessions: ChatSession[];
  employees: LocalEmployeeSummary[];
  workflows: WorkflowSummary[];
  workflowDefinitions: Record<string, WorkflowDefinition>;
  defaultModelProfileId: string | null;
  approvalPolicy: ApprovalPolicy;
};

// ---------------------------------------------------------------------------
// Helpers
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
    // Log corruption/missing file so data loss is discoverable
    if (existsSync(filePath)) {
      console.warn(`[state-persistence] Corrupt or unreadable JSON: ${filePath}`, err instanceof Error ? err.message : String(err));
    }
    return null;
  }
}

/**
 * Atomic write: write to temp file then rename.
 * Prevents data corruption from partial writes on crash/power loss.
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
// Load all state from disk (synchronous — called once at startup)
// ---------------------------------------------------------------------------

export function loadPersistedState(paths: MyClawPaths): PersistedState {
  // ---- settings.json -----------------------------------------------------
  let defaultModelProfileId: string | null = null;
  let approvalPolicy: ApprovalPolicy = createDefaultApprovalPolicy();

  const settings = tryReadJson<Partial<AppSettings>>(paths.settingsFile);
  if (settings) {
    defaultModelProfileId = settings.defaultModelProfileId ?? null;
    if (settings.approvalPolicy) {
      approvalPolicy = { ...approvalPolicy, ...settings.approvalPolicy };
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
    // modelsDir unreadable — start empty
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
    // sessionsDir unreadable — start empty
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
    // unreadable — start empty
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
        // Build summary from full definition
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
    // unreadable — start empty
  }

  return {
    models,
    sessions,
    employees,
    workflows: workflowsArr,
    workflowDefinitions,
    defaultModelProfileId,
    approvalPolicy,
  };
}

// ---------------------------------------------------------------------------
// Save individual items (async — called after each mutation)
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

  // Split: metadata (without messages) and messages separately
  // Both use atomic writes (temp + rename) to prevent data corruption
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

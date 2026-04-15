import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { appendFile, mkdir, rename, rm, writeFile } from "node:fs/promises";

import type { TurnOutcome } from "@shared/contracts";
import type { MyClawPaths } from "../directory-service";
import type { ArtifactManager } from "../artifact-manager";

function resolveTurnOutcomesDir(paths: MyClawPaths): string {
  return join(paths.myClawDir, "turn-outcomes");
}

/** 兼容旧命名，供测试与集成层读取 outcome 目录。 */
export const resolveTurnOutcomeDir = resolveTurnOutcomesDir;

function resolveTurnTelemetryFile(paths: MyClawPaths): string {
  return join(paths.myClawDir, "turn-telemetry.jsonl");
}

async function syncTurnOutcomeArtifact(
  paths: MyClawPaths,
  outcome: TurnOutcome,
  artifactManager?: ArtifactManager | null,
): Promise<void> {
  if (!artifactManager) return;

  const artifactId = `turn-outcome-${outcome.id}`;
  const scope = outcome.workflowRunId
    ? { scopeKind: "workflowRun" as const, scopeId: outcome.workflowRunId }
    : outcome.sessionId
      ? { scopeKind: "session" as const, scopeId: outcome.sessionId }
      : { scopeKind: "turnOutcome" as const, scopeId: outcome.id };
  const links = [
    { scope: { scopeKind: "turnOutcome" as const, scopeId: outcome.id }, relation: "reference" as const, isPrimary: false },
    ...(outcome.sessionId
      ? [{ scope: { scopeKind: "session" as const, scopeId: outcome.sessionId }, relation: "secondary_output" as const, isPrimary: !outcome.workflowRunId }]
      : []),
    ...(outcome.workflowRunId
      ? [{ scope: { scopeKind: "workflowRun" as const, scopeId: outcome.workflowRunId }, relation: "secondary_output" as const, isPrimary: true }]
      : []),
  ];

  if (!artifactManager.registry.getArtifactById(artifactId)) {
    artifactManager.planArtifact({
      artifactId,
      title: `Turn Outcome ${outcome.id}`,
      kind: "log",
      mimeType: "application/json",
      storageClass: "cache",
      fileName: `${outcome.id}.json`,
      scope,
      links,
      metadata: {
        turnOutcomeId: outcome.id,
        sessionId: outcome.sessionId ?? null,
        workflowRunId: outcome.workflowRunId ?? null,
      },
    });
  }

  artifactManager.completeArtifact({
    artifactId,
    absolutePath: resolveTurnOutcomeFile(paths, outcome.id),
    lifecycle: "ready",
    status: "ready",
    metadata: {
      turnOutcomeId: outcome.id,
      sessionId: outcome.sessionId ?? null,
      workflowRunId: outcome.workflowRunId ?? null,
      success: outcome.success,
      providerFamily: outcome.providerFamily,
      protocolTarget: outcome.protocolTarget,
    },
  });
}

async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, JSON.stringify(payload, null, 2), "utf-8");
  await rename(tempFile, filePath);
}

function resolveTurnOutcomeFile(paths: MyClawPaths, id: string): string {
  return join(resolveTurnOutcomesDir(paths), `${id}.json`);
}

/** 为共享 outcome 生成稳定 id。 */
export function createTurnOutcomeId(): string {
  return `turn-${process.pid}-${Date.now()}`;
}

/** 保存单条 TurnOutcome，并同步记录 telemetry tags。 */
export async function saveTurnOutcome(
  paths: MyClawPaths,
  outcome: TurnOutcome,
  artifactManager?: ArtifactManager | null,
): Promise<TurnOutcome> {
  const dir = resolveTurnOutcomesDir(paths);
  await mkdir(dir, { recursive: true });
  await atomicWriteJson(resolveTurnOutcomeFile(paths, outcome.id), outcome);
  if (outcome.telemetry) {
    await appendFile(
      resolveTurnTelemetryFile(paths),
      `${JSON.stringify(outcome.telemetry)}\n`,
      "utf-8",
    );
  }
  await syncTurnOutcomeArtifact(paths, outcome, artifactManager);
  return outcome;
}

/**
 * 更新已存在的 TurnOutcome，但不重复追加 telemetry 事件。
 * 用于在同一逻辑 turn 后续补写工具/上下文指标时保持 JSONL 事件幂等。
 */
export async function updateTurnOutcome(
  paths: MyClawPaths,
  outcome: TurnOutcome,
  artifactManager?: ArtifactManager | null,
): Promise<TurnOutcome> {
  const dir = resolveTurnOutcomesDir(paths);
  await mkdir(dir, { recursive: true });
  await atomicWriteJson(resolveTurnOutcomeFile(paths, outcome.id), outcome);
  await syncTurnOutcomeArtifact(paths, outcome, artifactManager);
  return outcome;
}

/** 读取单条 outcome。 */
export function loadTurnOutcome(paths: MyClawPaths, id: string): TurnOutcome | null {
  const filePath = resolveTurnOutcomeFile(paths, id);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as TurnOutcome;
  } catch {
    return null;
  }
}

/** 兼容旧命名，供现有测试与调用方异步读取 outcome。 */
export async function readTurnOutcome(paths: MyClawPaths, id: string): Promise<TurnOutcome | null> {
  return loadTurnOutcome(paths, id);
}

/** 按条件列出 outcome，供 session/workflow roundtrip 与 scorecard 聚合复用。 */
export async function listTurnOutcomes(
  paths: MyClawPaths,
  filter?: { sessionId?: string; workflowRunId?: string },
): Promise<TurnOutcome[]> {
  const dir = resolveTurnOutcomesDir(paths);
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      try {
        return JSON.parse(readFileSync(join(dir, file), "utf-8")) as TurnOutcome;
      } catch {
        return null;
      }
    })
    .filter((record): record is TurnOutcome => {
      if (!record) return false;
      if (filter?.sessionId && record.sessionId !== filter.sessionId) return false;
      if (filter?.workflowRunId && record.workflowRunId !== filter.workflowRunId) return false;
      return true;
    });
}

/** 删除单条 outcome，主要供测试清理使用。 */
export async function deleteTurnOutcome(paths: MyClawPaths, id: string): Promise<void> {
  const filePath = resolveTurnOutcomeFile(paths, id);
  if (!existsSync(filePath)) {
    return;
  }
  await rm(filePath, { force: true });
}

/** 创建 store facade，便于 gateway 注入使用。 */
export function createTurnOutcomeStore(paths: MyClawPaths, artifactManager?: ArtifactManager | null) {
  return {
    async save(outcome: TurnOutcome): Promise<TurnOutcome> {
      return saveTurnOutcome(paths, outcome, artifactManager);
    },
    async update(outcome: TurnOutcome): Promise<TurnOutcome> {
      return updateTurnOutcome(paths, outcome, artifactManager);
    },
    async list(filter?: { sessionId?: string; workflowRunId?: string }): Promise<TurnOutcome[]> {
      return listTurnOutcomes(paths, filter);
    },
    load(id: string): TurnOutcome | null {
      return loadTurnOutcome(paths, id);
    },
    async remove(id: string): Promise<void> {
      return deleteTurnOutcome(paths, id);
    },
    directory(): string {
      return resolveTurnOutcomesDir(paths);
    },
  };
}

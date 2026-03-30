import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveMyClawLayout } from "../services/myclaw-layout";
import { resolveRuntimeLayout } from "../services/runtime-layout";
import { resolveWorkflowLibraryRoots } from "./workflow-library-root-store";
import { sanitizeWorkflows } from "./workflow-store";
import {
  createDefaultRuntimeState,
  normalizeWorkflowSummaryForPersistence,
  sanitizeRuntimeState,
} from "./runtime-state/runtime-state-bootstrap";
import { parseLegacyJsonState } from "./runtime-state/runtime-state-legacy";
import { readRuntimeStateFromDatabase, writeRuntimeStateToDatabase } from "./runtime-state/runtime-state-codecs";
import { isSqliteFile } from "./runtime-state/runtime-state-shared-parsers";
import { openRuntimeStateDatabase } from "./runtime-state/runtime-state-sqlite";
import type { RuntimeState } from "./runtime-state/runtime-state-types";

export type { RuntimeState } from "./runtime-state/runtime-state-types";

/** 获取 runtime 状态目录，默认指向 `~/.myClaw/runtime`。 */
export function resolveRuntimeStateDirectory(): string {
  return resolveMyClawLayout().runtimeDir;
}

/** 解析 runtime 状态文件路径；未传入时使用 `.myClaw` 默认布局。 */
export function resolveRuntimeStateFilePath(stateFilePath?: string): string {
  return stateFilePath ?? resolveMyClawLayout().runtimeStateFilePath;
}

export async function runtimeStateExists(stateFilePath?: string): Promise<boolean> {
  try {
    await access(resolveRuntimeStateFilePath(stateFilePath), constants.F_OK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

/** 从 SQLite 或 legacy JSON 加载状态，并执行统一清洗兜底。 */
export async function loadRuntimeState(stateFilePath?: string): Promise<RuntimeState> {
  const filePath = resolveRuntimeStateFilePath(stateFilePath);

  try {
    const raw = await readFile(filePath);
    if (isSqliteFile(raw)) {
      const db = await openRuntimeStateDatabase(raw);
      try {
        return sanitizeRuntimeState(readRuntimeStateFromDatabase(db), filePath);
      } finally {
        db.close();
      }
    }

    const legacy = parseLegacyJsonState(raw, filePath);
    if (legacy) {
      await saveRuntimeState(legacy, filePath);
      return legacy;
    }

    throw new Error(`Unsupported runtime state format: ${filePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const fallback = createDefaultRuntimeState(filePath);
      await saveRuntimeState(fallback, filePath);
      return fallback;
    }

    throw error;
  }
}

/** 按 schema 编码当前状态并写入 SQLite 文件。 */
export async function saveRuntimeState(
  state: RuntimeState,
  stateFilePath?: string,
): Promise<void> {
  const filePath = resolveRuntimeStateFilePath(stateFilePath);
  const layout = resolveRuntimeLayout(filePath);
  const workflowLibraryRoots = resolveWorkflowLibraryRoots(state.workflowLibraryRoots, layout);
  const persistedState: RuntimeState = {
    ...state,
    workflows: sanitizeWorkflows(state.workflows).map((workflow) =>
      normalizeWorkflowSummaryForPersistence(workflow),
    ),
    workflowLibraryRoots,
  };

  const db = await openRuntimeStateDatabase();
  try {
    writeRuntimeStateToDatabase(db, persistedState);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(db.export()));
  } finally {
    db.close();
  }
}

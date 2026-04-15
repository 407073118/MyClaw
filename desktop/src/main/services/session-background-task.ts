import type { ChatSession, TurnOutcome } from "@shared/contracts";

import type { MyClawPaths } from "./directory-service";
import { loadTurnOutcome } from "./model-runtime/turn-outcome-store";

const TERMINAL_BACKGROUND_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

/** 基于会话最近一次 turn outcome，同步派生给前端可直接消费的后台任务快照。 */
export function syncSessionBackgroundTaskSnapshot(
  paths: MyClawPaths,
  session: ChatSession,
  outcome?: TurnOutcome | null,
): ChatSession {
  const resolvedOutcome = outcome
    ?? (session.lastTurnOutcomeId ? loadTurnOutcome(paths, session.lastTurnOutcomeId) : null);
  const backgroundTask = resolvedOutcome?.backgroundTask ?? null;
  session.lastTurnCitations = resolvedOutcome?.citations ?? [];
  session.lastCapabilityEvents = resolvedOutcome?.capabilityEvents ?? [];
  session.lastComputerCalls = resolvedOutcome?.computerCalls ?? [];

  if (!backgroundTask || TERMINAL_BACKGROUND_TASK_STATUSES.has(backgroundTask.status)) {
    session.backgroundTask = null;
    return session;
  }

  session.backgroundTask = backgroundTask;
  return session;
}

/** 判断后台任务是否已经到达终态，便于主进程决定是否回灌最终结果。 */
export function isTerminalBackgroundTaskStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL_BACKGROUND_TASK_STATUSES.has(status);
}

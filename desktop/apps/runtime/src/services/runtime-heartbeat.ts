import type { PendingWorkItem } from "../store/pending-work-store";

export type RuntimeHeartbeatInput = {
  items: PendingWorkItem[];
  now?: string;
};

export type RuntimeHeartbeatResult = {
  items: PendingWorkItem[];
  readyIds: string[];
  expiredIds: string[];
};

function isDue(candidate: string | null | undefined, now: number): boolean {
  if (!candidate) {
    return false;
  }

  const parsed = Date.parse(candidate);
  return !Number.isNaN(parsed) && parsed <= now;
}

function shouldPromote(item: PendingWorkItem, now: number): boolean {
  if (isDue(item.dueAt, now)) {
    return true;
  }

  if (item.resumePolicy.kind === "time") {
    return isDue(item.resumePolicy.value, now);
  }

  return item.resumePolicy.kind === "heartbeat" && !item.dueAt;
}

export function runHeartbeat(input: RuntimeHeartbeatInput): RuntimeHeartbeatResult {
  const nowIso = input.now ?? new Date().toISOString();
  const now = Date.parse(nowIso);
  const readyIds: string[] = [];
  const expiredIds: string[] = [];

  const items = input.items.map((item) => {
    if (item.status !== "waiting") {
      return item;
    }

    if (isDue(item.expiresAt, now)) {
      expiredIds.push(item.id);
      return {
        ...item,
        status: "expired" as const,
        updatedAt: nowIso,
      };
    }

    if (!shouldPromote(item, now)) {
      return item;
    }

    readyIds.push(item.id);
    return {
      ...item,
      status: "ready" as const,
      updatedAt: nowIso,
    };
  });

  return {
    items,
    readyIds,
    expiredIds,
  };
}

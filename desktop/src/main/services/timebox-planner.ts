import {
  createDefaultAvailabilityPolicy,
  type AvailabilityPolicy,
  type PlanTimeboxesInput,
  type SuggestedTimebox,
} from "@shared/contracts";
import {
  addDaysToDateKey,
  dateKeyAndClockToUtcIso,
  isoToDateKey,
  weekdayFromDateKey,
} from "@shared/time/local-time";

type BusyWindow = {
  startsAt: string;
  endsAt: string;
};

/** 生成首版时间块建议，优先找最早可用窗口，不做复杂优化求解。 */
export function planTimeboxes(input: PlanTimeboxesInput): SuggestedTimebox[] {
  const policy = resolveAvailabilityPolicy(input.availabilityPolicy, input.timezone);
  const planningStart = resolvePlanningStart(input);
  const busyWindows: BusyWindow[] = input.events.map((event) => ({
    startsAt: event.startsAt,
    endsAt: event.endsAt,
  }));
  const suggestions: SuggestedTimebox[] = [];

  for (const commitment of sortCommitments(input.commitments)) {
    if (!commitment.dueAt || !commitment.durationMinutes || commitment.durationMinutes <= 0) {
      continue;
    }

    const dueDateKey = isoToDateKey(commitment.dueAt, input.timezone);
    let cursor = planningStart;

    while (cursor <= dueDateKey) {
      const workingWindows = policy.workingHours.filter((window) => window.weekday === weekdayFromDateKey(cursor));
      for (const window of workingWindows) {
        const suggestion = findSuggestionInWindow({
          cursor,
          commitmentId: commitment.id,
          title: commitment.title,
          durationMinutes: commitment.durationMinutes,
          dueAt: commitment.dueAt,
          timezone: input.timezone,
          busyWindows,
          windowStart: dateKeyAndClockToUtcIso(cursor, window.start, input.timezone),
          windowEnd: dateKeyAndClockToUtcIso(cursor, window.end, input.timezone),
          isDueDate: cursor === dueDateKey,
        });
        if (suggestion) {
          suggestions.push(suggestion);
          busyWindows.push({
            startsAt: suggestion.startsAt,
            endsAt: suggestion.endsAt,
          });
          cursor = dueDateKey;
          break;
        }
      }
      cursor = addDaysToDateKey(cursor, 1);
    }
  }

  return suggestions.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

/** 解析可用时段策略，缺省时使用桌面端默认工作时间。 */
function resolveAvailabilityPolicy(
  policy: AvailabilityPolicy | null | undefined,
  timezone: string,
): AvailabilityPolicy {
  return policy ?? createDefaultAvailabilityPolicy(timezone);
}

/** 解析规划起点，优先使用最早相关日期，避免无意义地从远未来回扫。 */
function resolvePlanningStart(input: PlanTimeboxesInput): string {
  const anchors = [
    ...input.events.map((event) => event.startsAt),
    ...input.commitments.flatMap((commitment) => commitment.dueAt ? [commitment.dueAt] : []),
  ];

  if (anchors.length === 0) {
    return isoToDateKey(input.now ?? new Date().toISOString(), input.timezone);
  }

  return anchors.map((value) => isoToDateKey(value, input.timezone)).sort()[0];
}

/** 按截止时间和优先级排序，确保更紧急的承诺先抢占空档。 */
function sortCommitments(input: PlanTimeboxesInput["commitments"]) {
  return [...input].sort((left, right) => {
    const dueCompare = (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999");
    if (dueCompare !== 0) {
      return dueCompare;
    }
    return priorityWeight(right.priority) - priorityWeight(left.priority);
  });
}

/** 在指定工作窗口中寻找首个可用时间块。 */
function findSuggestionInWindow(input: {
  cursor: string;
  commitmentId: string;
  title: string;
  durationMinutes: number;
  dueAt: string;
  timezone: string;
  busyWindows: BusyWindow[];
  windowStart: string;
  windowEnd: string;
  isDueDate: boolean;
}): SuggestedTimebox | null {
  const durationMs = input.durationMinutes * 60_000;
  const effectiveWindowEnd = input.isDueDate && input.dueAt < input.windowEnd
    ? input.dueAt
    : input.windowEnd;
  if (effectiveWindowEnd <= input.windowStart) {
    return null;
  }

  const overlaps = input.busyWindows
    .filter((busy) => busy.endsAt > input.windowStart && busy.startsAt < effectiveWindowEnd)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));

  let cursor = input.windowStart;
  for (const busy of overlaps) {
    const gapEnd = busy.startsAt < effectiveWindowEnd ? busy.startsAt : effectiveWindowEnd;
    if (new Date(gapEnd).getTime() - new Date(cursor).getTime() >= durationMs) {
      const startsAt = cursor;
      const endsAt = new Date(new Date(startsAt).getTime() + durationMs).toISOString();
      return {
        commitmentId: input.commitmentId,
        title: input.title,
        startsAt,
        endsAt,
        timezone: input.timezone,
      };
    }
    if (busy.endsAt > cursor) {
      cursor = busy.endsAt;
    }
  }

  if (new Date(effectiveWindowEnd).getTime() - new Date(cursor).getTime() >= durationMs) {
    const startsAt = cursor;
    const endsAt = new Date(new Date(startsAt).getTime() + durationMs).toISOString();
    return {
      commitmentId: input.commitmentId,
      title: input.title,
      startsAt,
      endsAt,
      timezone: input.timezone,
    };
  }

  return null;
}

/** 将优先级映射成数值，供首版规划器排序使用。 */
function priorityWeight(priority: string | undefined): number {
  if (priority === "urgent") {
    return 4;
  }
  if (priority === "high") {
    return 3;
  }
  if (priority === "medium") {
    return 2;
  }
  return 1;
}

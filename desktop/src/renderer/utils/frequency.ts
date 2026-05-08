import type { ScheduleJob, ScheduleJobKind } from "@shared/contracts";

export type FrequencyValue =
  | { kind: "once"; startsAt: string }
  | { kind: "every-day"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekends"; time: string }
  | { kind: "weekly"; weekdays: number[]; time: string }
  | { kind: "monthly"; day: number; time: string }
  | { kind: "interval-minutes"; minutes: number }
  | { kind: "interval-hours"; hours: number }
  | { kind: "custom-cron"; expression: string };

export type FrequencyKind = FrequencyValue["kind"];

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

/** 给每种 kind 提供合理 default。 */
export function defaultFrequencyForKind(kind: FrequencyKind): FrequencyValue {
  switch (kind) {
    case "once":
      return { kind, startsAt: defaultOnceStartsAt() };
    case "every-day":
    case "weekdays":
    case "weekends":
      return { kind, time: "09:00" };
    case "weekly":
      return { kind, weekdays: [1], time: "09:00" };
    case "monthly":
      return { kind, day: 1, time: "09:00" };
    case "interval-minutes":
      return { kind, minutes: 30 };
    case "interval-hours":
      return { kind, hours: 4 };
    case "custom-cron":
      return { kind, expression: "0 9 * * 1-5" };
  }
}

/** 把 FrequencyValue 转成 ScheduleJob create / update 所需的调度字段。 */
export function frequencyToScheduleInput(
  value: FrequencyValue,
): {
  scheduleKind: ScheduleJobKind;
  startsAt?: string;
  intervalMinutes?: number;
  cronExpression?: string;
} {
  switch (value.kind) {
    case "once":
      return { scheduleKind: "once", startsAt: value.startsAt };
    case "every-day": {
      const [h, m] = parseClock(value.time);
      return { scheduleKind: "cron", cronExpression: `${m} ${h} * * *` };
    }
    case "weekdays": {
      const [h, m] = parseClock(value.time);
      return { scheduleKind: "cron", cronExpression: `${m} ${h} * * 1-5` };
    }
    case "weekends": {
      const [h, m] = parseClock(value.time);
      return { scheduleKind: "cron", cronExpression: `${m} ${h} * * 0,6` };
    }
    case "weekly": {
      const [h, m] = parseClock(value.time);
      const days = (value.weekdays.length === 0 ? [1] : value.weekdays).slice().sort((a, b) => a - b).join(",");
      return { scheduleKind: "cron", cronExpression: `${m} ${h} * * ${days}` };
    }
    case "monthly": {
      const [h, m] = parseClock(value.time);
      const day = clamp(value.day, 1, 31);
      return { scheduleKind: "cron", cronExpression: `${m} ${h} ${day} * *` };
    }
    case "interval-minutes":
      return { scheduleKind: "interval", intervalMinutes: clamp(value.minutes, 5, 1440) };
    case "interval-hours":
      return { scheduleKind: "interval", intervalMinutes: clamp(value.hours, 1, 24) * 60 };
    case "custom-cron":
      return { scheduleKind: "cron", cronExpression: value.expression.trim() };
  }
}

/** 从已有 ScheduleJob 反解 FrequencyValue（编辑模式预填用）。 */
export function parseFrequency(job: ScheduleJob): FrequencyValue {
  if (job.scheduleKind === "once") {
    return { kind: "once", startsAt: job.startsAt ?? defaultOnceStartsAt() };
  }
  if (job.scheduleKind === "interval") {
    const minutes = job.intervalMinutes ?? 30;
    if (minutes >= 60 && minutes <= 24 * 60 && minutes % 60 === 0) {
      return { kind: "interval-hours", hours: minutes / 60 };
    }
    return { kind: "interval-minutes", minutes };
  }
  const expression = (job.cronExpression ?? "").trim();
  if (!expression) {
    return defaultFrequencyForKind("every-day");
  }
  return parseCronExpression(expression);
}

function parseCronExpression(expression: string): FrequencyValue {
  const parts = expression.split(/\s+/);
  if (parts.length !== 5) {
    return { kind: "custom-cron", expression };
  }
  const [minStr, hourStr, domStr, monStr, dowStr] = parts;
  const minute = toInt(minStr);
  const hour = toInt(hourStr);
  if (minute === null || hour === null || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    return { kind: "custom-cron", expression };
  }
  if (monStr !== "*") {
    return { kind: "custom-cron", expression };
  }
  const time = formatClock(hour, minute);

  if (domStr === "*" && dowStr === "*") {
    return { kind: "every-day", time };
  }
  if (domStr === "*" && dowStr === "1-5") {
    return { kind: "weekdays", time };
  }
  if (domStr === "*" && (dowStr === "0,6" || dowStr === "6,0")) {
    return { kind: "weekends", time };
  }
  if (domStr === "*" && /^[0-7](?:,[0-7])*$/.test(dowStr)) {
    const weekdays = dowStr.split(",").map((value) => normalizeWeekday(Number(value))).filter((value, index, list) => list.indexOf(value) === index).sort((a, b) => a - b);
    return { kind: "weekly", weekdays, time };
  }
  if (dowStr === "*" && /^\d{1,2}$/.test(domStr)) {
    const day = clamp(Number(domStr), 1, 31);
    return { kind: "monthly", day, time };
  }
  return { kind: "custom-cron", expression };
}

/** 把 FrequencyValue 转成中文人话展示。 */
export function formatFrequency(
  value: FrequencyValue,
  opts: { formatDateTime: (iso: string) => string },
): string {
  switch (value.kind) {
    case "once":
      return `一次性 · ${opts.formatDateTime(value.startsAt)}`;
    case "every-day":
      return `每天 ${value.time}`;
    case "weekdays":
      return `工作日 ${value.time}`;
    case "weekends":
      return `周末 ${value.time}`;
    case "weekly": {
      const days = value.weekdays.length === 0 ? "一" : value.weekdays
        .map((value) => WEEKDAY_LABELS[normalizeWeekday(value)])
        .join("");
      return `每周${days} ${value.time}`;
    }
    case "monthly":
      return `每月 ${value.day} 号 ${value.time}`;
    case "interval-minutes":
      return `每 ${value.minutes} 分钟`;
    case "interval-hours":
      return `每 ${value.hours} 小时`;
    case "custom-cron":
      return `Cron: ${value.expression}`;
  }
}

/** 给已有 job 直接渲染人话频率。 */
export function formatJobFrequency(
  job: ScheduleJob,
  formatDateTime: (iso: string) => string,
): string {
  return formatFrequency(parseFrequency(job), { formatDateTime });
}

function defaultOnceStartsAt(): string {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  return next.toISOString();
}

function parseClock(time: string): [number, number] {
  const [hStr, mStr] = (time ?? "").split(":");
  const h = clamp(toInt(hStr) ?? 9, 0, 23);
  const m = clamp(toInt(mStr) ?? 0, 0, 59);
  return [h, m];
}

function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function toInt(value: string | undefined): number | null {
  if (!value) return null;
  if (!/^-?\d+$/.test(value)) return null;
  return Number(value);
}

/** cron 里 7 等同周日；统一映射到 0-6（0=周日）。 */
function normalizeWeekday(value: number): number {
  if (value === 7) return 0;
  if (value < 0 || value > 7) return 0;
  return value;
}

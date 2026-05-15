import { weekdayFromDateKey } from "../../../shared/time/local-time";

/** 读取 cron 表达式五段，当前只支持标准 minute hour day month weekday。 */
export function parseCronExpression(expression: string): string[] | null {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  return fields.length === 5 ? fields : null;
}

/** 判断单个 cron 字段是否命中当前值，支持通配、步长、范围、逗号列表和单值。 */
export function matchesCronField(field: string, value: number, sundayAlias = false): boolean {
  return field.split(",").some((rawPart) => {
    const part = rawPart.trim();
    if (!part || part === "*") {
      return true;
    }
    if (part.startsWith("*/")) {
      const step = Number(part.slice(2));
      return Number.isFinite(step) && step > 0 && value % step === 0;
    }
    if (part.includes("-")) {
      const [startRaw, endRaw] = part.split("-", 2);
      const start = readCronNumber(startRaw, sundayAlias);
      const end = readCronNumber(endRaw, sundayAlias);
      const current = normalizeCronValue(value, sundayAlias);
      if (start === null || end === null) {
        return false;
      }
      return current >= start && current <= end;
    }
    const expected = readCronNumber(part, sundayAlias);
    if (expected === null) {
      return false;
    }
    return normalizeCronValue(value, sundayAlias) === expected;
  });
}

/** 计算 cron 任务下一次运行时间；找不到时返回 null。 */
export function findNextCronRunAt(
  expression: string,
  reference: Date,
  timeZone: string,
): string | null {
  const fields = parseCronExpression(expression);
  if (!fields) {
    return null;
  }
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  let candidate = new Date(reference.getTime() + 60_000);
  candidate.setUTCSeconds(0, 0);

  for (let index = 0; index < 366 * 24 * 60; index += 1) {
    const parts = readCronCandidateParts(candidate, timeZone);
    if (
      matchesCronField(minuteField, parts.minute)
      && matchesCronField(hourField, parts.hour)
      && matchesCronField(dayField, parts.day)
      && matchesCronField(monthField, parts.month)
      && matchesCronField(weekdayField, parts.weekday, true)
    ) {
      return candidate.toISOString();
    }
    candidate = new Date(candidate.getTime() + 60_000);
  }

  return null;
}

/** 把 UTC 时间投影到指定时区的分钟颗粒，供 cron 匹配复用。 */
function readCronCandidateParts(date: Date, timeZone: string): {
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "1970");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    month,
    day,
    hour,
    minute,
    weekday: weekdayFromDateKey(dateKey),
  };
}

/** 读取 cron 字段里的数字，按字段需要处理周日别名。 */
function readCronNumber(raw: string | undefined, sundayAlias: boolean): number | null {
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }
  return normalizeCronValue(Number(raw), sundayAlias);
}

/** 统一 cron 星期字段的周日别名，其他字段保持原值。 */
function normalizeCronValue(value: number, sundayAlias: boolean): number {
  return sundayAlias && value === 7 ? 0 : value;
}

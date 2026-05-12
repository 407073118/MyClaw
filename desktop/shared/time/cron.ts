/**
 * 桌面端 cron 工具：被 main 端调度器和 renderer 端时间轴共用。
 * 支持标准五段表达式 minute hour day month weekday，字段语法包含
 * 通配、步长、逗号列表和单值。
 */

/**
 * 读取 cron 表达式。
 *
 * 支持两种格式：
 * - 5 段标准 cron：`minute hour day month weekday`
 * - 6 段 Quartz 风格：`second minute hour day month weekday` —— 模型 LLM 经常生成这种，
 *   桌面调度器是分钟粒度，第一段秒会被丢弃后归一为 5 段。
 */
export function parseCronExpression(expression: string): string[] | null {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  if (fields.length === 5) return fields;
  if (fields.length === 6) return fields.slice(1);
  return null;
}

/** 判断单个 cron 字段是否命中给定值。 */
export function matchesCronField(field: string, value: number): boolean {
  return field.split(",").some((rawPart) => {
    const part = rawPart.trim();
    if (!part || part === "*") {
      return true;
    }
    if (part.startsWith("*/")) {
      const step = Number(part.slice(2));
      return Number.isFinite(step) && step > 0 && value % step === 0;
    }
    const expected = Number(part);
    if (!Number.isFinite(expected)) {
      return false;
    }
    if (value === 0 && expected === 7) {
      return true;
    }
    return value === expected;
  });
}

type CronParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  dateKey: string;
};

export type CronEnumerationOptions = {
  limit?: number;
};

/**
 * 按时区缓存 Intl.DateTimeFormat 实例 —— enumerateCronRunsOnDate 一次会调
 * readCronCandidateParts 上千次（24h × 60min × 36h × N 个 cron 任务），频繁
 * `new Intl.DateTimeFormat` 是日程页主要 CPU 热点。formatter 本身按时区参数稳定，
 * 用一个 Map 复用即可。
 */
const cronFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getCronFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = cronFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    cronFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** 把 UTC 时间投影到指定时区的分钟颗粒，供 cron 匹配复用。 */
export function readCronCandidateParts(date: Date, timeZone: string): CronParts {
  const formatter = getCronFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "1970");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const weekday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
  return { year, month, day, hour, minute, weekday, dateKey };
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
      && matchesCronField(weekdayField, parts.weekday)
    ) {
      return candidate.toISOString();
    }
    candidate = new Date(candidate.getTime() + 60_000);
  }

  return null;
}

/**
 * 枚举 cron 表达式在指定本地日期（按 timeZone）内的所有触发时刻。
 *
 * 时间轴渲染需要"今天 02:00 / 14:00 …"这种全部触发点，而不是只看
 * `nextRunAt` 单点 —— 否则循环任务在跑过之后或还没轮到时整天都看不见。
 *
 * @param expression cron 表达式
 * @param dateKey   `YYYY-MM-DD` 本地日期键
 * @param timeZone  IANA 时区
 * @param options   可选枚举上限，给时间轴预览避免先生成全天高频触发点
 * @returns 该日触发的 UTC ISO 时间列表，按时间升序
 */
export function enumerateCronRunsOnDate(
  expression: string,
  dateKey: string,
  timeZone: string,
  options: CronEnumerationOptions = {},
): string[] {
  const fields = parseCronExpression(expression);
  if (!fields) {
    return [];
  }
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  const limit = Number.isFinite(options.limit)
    ? Math.max(0, Math.floor(options.limit as number))
    : Number.POSITIVE_INFINITY;
  if (limit === 0) {
    return [];
  }

  // 从该日期键 00:00（本地时区）开始扫，逐分钟最多 24*60 个候选；
  // 用 findNextCronRunAt 从 dateKey 前一天 23:59 起步反复推进，直到跨日为止。
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  const startProbe = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  // 起步设为本地时区当日 00:00 之前一分钟，让 findNext 的步进恰好落到当日首分钟。
  // 因为 findNextCronRunAt 跳过 reference 那一分钟（+60s），需要提前 60s。
  let cursor = new Date(startProbe.getTime() - 60_000);

  const results: string[] = [];
  for (let safety = 0; safety < 24 * 60 + 60 && results.length < limit; safety += 1) {
    const next = findNextCronRunAtBounded(fields as [string, string, string, string, string], cursor, timeZone, dateKey);
    if (!next) break;
    results.push(next);
    cursor = new Date(Date.parse(next));
  }
  return results;

  function findNextCronRunAtBounded(
    parsed: [string, string, string, string, string],
    reference: Date,
    tz: string,
    boundDateKey: string,
  ): string | null {
    let candidate = new Date(reference.getTime() + 60_000);
    candidate.setUTCSeconds(0, 0);
    // 最多扫 36 小时，足够覆盖夏令时切换带来的多走/少走 1 小时。
    for (let index = 0; index < 36 * 60; index += 1) {
      const parts = readCronCandidateParts(candidate, tz);
      // 一旦超出目标日期且时间已经到次日，就停。
      if (parts.dateKey > boundDateKey) {
        return null;
      }
      if (
        parts.dateKey === boundDateKey
        && matchesCronField(parsed[0], parts.minute)
        && matchesCronField(parsed[1], parts.hour)
        && matchesCronField(parsed[2], parts.day)
        && matchesCronField(parsed[3], parts.month)
        && matchesCronField(parsed[4], parts.weekday)
      ) {
        return candidate.toISOString();
      }
      candidate = new Date(candidate.getTime() + 60_000);
    }
    return null;
  }
}

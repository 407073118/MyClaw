/** 解析 `YYYY-MM-DDTHH:mm` 形式的本地时间输入，供桌面时间表单复用。 */
export function localDateTimeToUtcIso(localValue: string, timeZone: string): string {
  const [datePart, timePart] = localValue.split("T");
  const [year, month, day] = datePart.split("-").map((value) => Number(value));
  const [hour, minute, second = 0] = timePart.split(":").map((value) => Number(value));

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = resolveOffsetMinutes(new Date(utcGuess), timeZone);
  const firstPass = utcGuess - firstOffset * 60_000;
  const secondOffset = resolveOffsetMinutes(new Date(firstPass), timeZone);
  const finalValue = secondOffset === firstOffset
    ? firstPass
    : utcGuess - secondOffset * 60_000;

  return new Date(finalValue).toISOString();
}

/** 基于 ISO 时间戳生成时区内的 `YYYY-MM-DD` 日期键，便于做日视图与计划扫描。 */
export function isoToDateKey(iso: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(iso));
}

/** 为日期键加减天数，避免在规划器里直接操作本地时区对象。 */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  const next = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return next.toISOString().slice(0, 10);
}

/** 根据日期键获取星期索引，保持与可用时段策略中的 weekday 取值一致。 */
export function weekdayFromDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

/** 按日期键与时分拼接后转换为 UTC ISO，供工作时段窗口生成使用。 */
export function dateKeyAndClockToUtcIso(dateKey: string, clock: string, timeZone: string): string {
  return localDateTimeToUtcIso(`${dateKey}T${clock}`, timeZone);
}

/** 解析指定时区的 UTC 偏移分钟数，支撑本地时间输入标准化。 */
function resolveOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const token = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";

  if (token === "GMT" || token === "UTC") {
    return 0;
  }

  const match = token.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

import React, { useMemo } from "react";

import { localDateTimeToUtcIso } from "@shared/time/local-time";

import {
  defaultFrequencyForKind,
  formatFrequency,
  type FrequencyKind,
  type FrequencyValue,
} from "../../utils/frequency";

type Props = {
  value: FrequencyValue;
  onChange: (next: FrequencyValue) => void;
  timezone: string;
};

const KIND_OPTIONS: ReadonlyArray<{ kind: FrequencyKind; label: string }> = [
  { kind: "once", label: "一次性" },
  { kind: "every-day", label: "每天" },
  { kind: "weekdays", label: "工作日" },
  { kind: "weekends", label: "周末" },
  { kind: "weekly", label: "每周指定" },
  { kind: "monthly", label: "每月" },
  { kind: "interval-minutes", label: "每 N 分钟" },
  { kind: "interval-hours", label: "每 N 小时" },
  { kind: "custom-cron", label: "自定义 Cron" },
];

const WEEKDAYS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
];

/** 频率选择器：8 种预设 + 自定义 cron 兜底。受控组件，编辑模式可直接预填 value。 */
export default function FrequencyPicker({ value, onChange, timezone }: Props) {
  const previewText = useMemo(
    () => formatFrequency(value, { formatDateTime: (iso) => formatLocalDateTime(iso, timezone) }),
    [value, timezone],
  );

  function handleKindChange(nextKind: FrequencyKind) {
    if (nextKind === value.kind) return;
    onChange(defaultFrequencyForKind(nextKind));
  }

  return (
    <div className="frequency-picker">
      <div className="frequency-picker__chips" role="radiogroup" aria-label="频率类型">
        {KIND_OPTIONS.map((option) => {
          const active = option.kind === value.kind;
          return (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={active}
              className={active ? "frequency-picker__chip is-active" : "frequency-picker__chip"}
              onClick={() => handleKindChange(option.kind)}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="frequency-picker__detail">
        {value.kind === "once" ? (
          <label className="frequency-picker__field">
            <span>触发时间</span>
            <input
              type="datetime-local"
              value={isoToLocalDateTimeInput(value.startsAt, timezone)}
              onChange={(event) => {
                const localValue = event.target.value;
                if (!localValue) return;
                const iso = localDateTimeToUtcIso(localValue, timezone);
                onChange({ kind: "once", startsAt: iso });
              }}
            />
          </label>
        ) : null}

        {value.kind === "every-day" || value.kind === "weekdays" || value.kind === "weekends" ? (
          <label className="frequency-picker__field">
            <span>时刻</span>
            <input
              type="time"
              value={value.time}
              onChange={(event) => onChange({ ...value, time: event.target.value })}
            />
          </label>
        ) : null}

        {value.kind === "weekly" ? (
          <div className="frequency-picker__inline">
            <div className="frequency-picker__weekdays" role="group" aria-label="选择星期">
              {WEEKDAYS.map((day) => {
                const checked = value.weekdays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    className={checked ? "frequency-picker__weekday is-active" : "frequency-picker__weekday"}
                    onClick={() => {
                      const next = checked
                        ? value.weekdays.filter((v) => v !== day.value)
                        : [...value.weekdays, day.value].sort((a, b) => a - b);
                      onChange({ ...value, weekdays: next });
                    }}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            <label className="frequency-picker__field frequency-picker__field--inline">
              <span>时刻</span>
              <input
                type="time"
                value={value.time}
                onChange={(event) => onChange({ ...value, time: event.target.value })}
              />
            </label>
          </div>
        ) : null}

        {value.kind === "monthly" ? (
          <div className="frequency-picker__inline">
            <label className="frequency-picker__field frequency-picker__field--inline">
              <span>每月几号</span>
              <select
                value={value.day}
                onChange={(event) => onChange({ ...value, day: Number(event.target.value) })}
              >
                {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                  <option key={day} value={day}>{day} 号</option>
                ))}
              </select>
            </label>
            <label className="frequency-picker__field frequency-picker__field--inline">
              <span>时刻</span>
              <input
                type="time"
                value={value.time}
                onChange={(event) => onChange({ ...value, time: event.target.value })}
              />
            </label>
          </div>
        ) : null}

        {value.kind === "interval-minutes" ? (
          <label className="frequency-picker__field">
            <span>间隔分钟（5 - 1440）</span>
            <input
              type="number"
              min={5}
              max={1440}
              step={5}
              value={value.minutes}
              onChange={(event) => onChange({ kind: "interval-minutes", minutes: Number(event.target.value || 5) })}
            />
          </label>
        ) : null}

        {value.kind === "interval-hours" ? (
          <label className="frequency-picker__field">
            <span>间隔小时（1 - 24）</span>
            <input
              type="number"
              min={1}
              max={24}
              value={value.hours}
              onChange={(event) => onChange({ kind: "interval-hours", hours: Number(event.target.value || 1) })}
            />
          </label>
        ) : null}

        {value.kind === "custom-cron" ? (
          <label className="frequency-picker__field">
            <span>Cron 表达式（5 段：分 时 日 月 星期）</span>
            <input
              type="text"
              value={value.expression}
              onChange={(event) => onChange({ kind: "custom-cron", expression: event.target.value })}
              placeholder="例如 0 9 * * 1-5"
            />
          </label>
        ) : null}

        <p className="frequency-picker__preview">{previewText}</p>
      </div>
    </div>
  );
}

/** 把 ISO 转成 datetime-local 输入需要的 yyyy-MM-ddTHH:mm，按目标时区显示。 */
function isoToLocalDateTimeInput(iso: string, timezone: string): string {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        map[part.type] = part.value;
      }
    }
    if (!map.year || !map.month || !map.day || !map.hour || !map.minute) return "";
    const hour = map.hour === "24" ? "00" : map.hour;
    return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
  } catch {
    return "";
  }
}

/** 给 once 预览展示用的本地时间格式。 */
function formatLocalDateTime(iso: string, timezone: string): string {
  if (!iso) return "未设置";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

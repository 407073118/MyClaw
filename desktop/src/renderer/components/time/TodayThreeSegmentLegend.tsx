import React from "react";

type SegmentKey = "morning" | "afternoon" | "evening";

type Segment = {
  key: SegmentKey;
  label: string;
  range: string;
  startHour: number;
  endHour: number;
};

const SEGMENTS: Segment[] = [
  { key: "morning", label: "上午", range: "07:00–12:00", startHour: 7, endHour: 12 },
  { key: "afternoon", label: "下午", range: "12:00–18:00", startHour: 12, endHour: 18 },
  { key: "evening", label: "今晚", range: "18:00–22:00", startHour: 18, endHour: 22 },
];

/** 解析当前时间属于哪个段，落在工作日范围外（如凌晨）返回 null。 */
function getCurrentSegment(timezone: string): SegmentKey | null {
  try {
    const hourPart = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date()).find((p) => p.type === "hour")?.value ?? "0";
    const hour = Number(hourPart);
    const seg = SEGMENTS.find((s) => hour >= s.startHour && hour < s.endHour);
    return seg?.key ?? null;
  } catch {
    return null;
  }
}

type Props = {
  timezone: string;
};

/**
 * 渲染"上午 / 下午 / 今晚"三段时间分区图例。
 *
 * 设计来源见 desktop/docs/plans/2026-05-07-today-first-redesign.md §2 原则 4。
 * 借 Things 的 Evening 概念给时间轴提供"段语义"，让 AI 把跑批/汇总类工作流
 * 排到今晚段时，用户能直接读出"为什么排在这"。
 */
export default function TodayThreeSegmentLegend({ timezone }: Props) {
  const currentSegment = getCurrentSegment(timezone);
  return (
    <div className="three-segment-legend" role="presentation" data-testid="today-three-segment-legend">
      {SEGMENTS.map((seg) => (
        <span
          key={seg.key}
          className={[
            "three-segment-chip",
            seg.key === currentSegment ? "three-segment-chip--active" : "",
          ].filter(Boolean).join(" ")}
          data-segment={seg.key}
          data-active={seg.key === currentSegment ? "true" : "false"}
        >
          <span className="three-segment-chip__label">{seg.label}</span>
          <span className="three-segment-chip__range">{seg.range}</span>
        </span>
      ))}
      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .three-segment-legend {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .three-segment-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-secondary);
    transition: all 0.18s ease;
  }

  .three-segment-chip__label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .three-segment-chip__range {
    font-size: 11px;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    color: var(--text-muted);
  }

  .three-segment-chip--active {
    color: #f8fff8;
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.20), rgba(59, 130, 246, 0.20));
    border-color: rgba(255, 255, 255, 0.10);
  }

  .three-segment-chip--active .three-segment-chip__range {
    color: rgba(248, 255, 248, 0.78);
  }
`;

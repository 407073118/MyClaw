import { useMemo, useState } from "react";

import type { StructuredTranscript, TranscriptSegment } from "@shared/contracts";

/**
 * 结构化转写展示。
 *
 * - 以发言人分组渲染（同一说话人相邻的 segment 合并展示）
 * - 点击某句 → onSeek 回调（父组件驱动 AudioPlayer 跳转）
 * - 说话人标签支持点击编辑（双击进入输入态）
 * - 根据 currentTimeMs 高亮当前正在播放的片段
 */
export type TranscriptViewProps = {
  transcript: StructuredTranscript;
  /** 用户自定义说话人标签 { 0: "张经理", 1: "李总" }。 */
  speakerLabels?: Record<number, string>;
  /** 当前播放时间（ms），用于高亮。 */
  currentTimeMs?: number;
  /** 点击句子时触发。 */
  onSeek?: (startMs: number) => void;
  /** 修改说话人标签时触发。 */
  onUpdateSpeaker?: (speakerIndex: number, label: string) => void;
};

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type Group = {
  speaker: number;
  startMs: number;
  segments: TranscriptSegment[];
};

function groupBySpeaker(segments: TranscriptSegment[]): Group[] {
  const groups: Group[] = [];
  for (const seg of segments) {
    if (!seg.text.trim()) continue;
    const last = groups[groups.length - 1];
    if (last && last.speaker === seg.speaker) {
      last.segments.push(seg);
    } else {
      groups.push({ speaker: seg.speaker, startMs: seg.startMs, segments: [seg] });
    }
  }
  return groups;
}

export function TranscriptView({
  transcript,
  speakerLabels,
  currentTimeMs,
  onSeek,
  onUpdateSpeaker,
}: TranscriptViewProps) {
  const [editingSpeaker, setEditingSpeaker] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const groups = useMemo(() => groupBySpeaker(transcript.segments), [transcript.segments]);

  const commitEdit = () => {
    if (editingSpeaker != null && editingValue.trim()) {
      onUpdateSpeaker?.(editingSpeaker, editingValue.trim());
    }
    setEditingSpeaker(null);
    setEditingValue("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {groups.map((group, groupIdx) => {
        const label = speakerLabels?.[group.speaker] || `发言人${group.speaker}`;
        const isEditing = editingSpeaker === group.speaker;

        return (
          <div
            key={`${group.speaker}-${groupIdx}`}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "10px 14px",
              borderLeft: "3px solid var(--accent-cyan)",
              background: "rgba(255, 255, 255, 0.02)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {isEditing ? (
                <input
                  type="text"
                  value={editingValue}
                  autoFocus
                  onChange={(e) => setEditingValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") {
                      setEditingSpeaker(null);
                      setEditingValue("");
                    }
                  }}
                  style={{
                    padding: "2px 8px",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    background: "var(--bg-base)",
                    border: "1px solid var(--accent-cyan)",
                    borderRadius: "var(--radius-sm)",
                    outline: "none",
                    minWidth: 120,
                  }}
                />
              ) : (
                <button
                  type="button"
                  onDoubleClick={() => {
                    setEditingSpeaker(group.speaker);
                    setEditingValue(label);
                  }}
                  title="双击重命名"
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--accent-cyan)",
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              )}
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {formatTimestamp(group.startMs)}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {group.segments.map((seg, segIdx) => {
                const isActive =
                  currentTimeMs != null && currentTimeMs >= seg.startMs && currentTimeMs < seg.endMs;
                return (
                  <button
                    key={`${groupIdx}-${segIdx}`}
                    type="button"
                    onClick={() => onSeek?.(seg.startMs)}
                    style={{
                      textAlign: "left",
                      background: isActive ? "rgba(16, 163, 127, 0.14)" : "transparent",
                      border: "none",
                      padding: "4px 6px",
                      fontSize: 14,
                      color: isActive ? "var(--text-primary)" : "var(--text-primary)",
                      cursor: "pointer",
                      borderRadius: "var(--radius-sm)",
                      lineHeight: 1.6,
                    }}
                  >
                    {seg.text}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {groups.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
          无可展示的转写内容
        </div>
      )}
    </div>
  );
}

export default TranscriptView;

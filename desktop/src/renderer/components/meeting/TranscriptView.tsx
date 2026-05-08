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
    <div className="meeting-transcript">
      {groups.map((group, groupIdx) => {
        const label = speakerLabels?.[group.speaker] || `发言人${group.speaker}`;
        const isEditing = editingSpeaker === group.speaker;

        return (
          <div key={`${group.speaker}-${groupIdx}`} className="meeting-transcript__group">
            <div className="meeting-transcript__group-header">
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
                  className="meeting-transcript__speaker-input"
                />
              ) : (
                <button
                  type="button"
                  onDoubleClick={() => {
                    setEditingSpeaker(group.speaker);
                    setEditingValue(label);
                  }}
                  title="双击重命名"
                  className="meeting-transcript__speaker-btn"
                >
                  {label}
                </button>
              )}
              <span className="meeting-transcript__time">
                {formatTimestamp(group.startMs)}
              </span>
            </div>

            <div className="meeting-transcript__segments">
              {group.segments.map((seg, segIdx) => {
                const isActive =
                  currentTimeMs != null && currentTimeMs >= seg.startMs && currentTimeMs < seg.endMs;
                return (
                  <button
                    key={`${groupIdx}-${segIdx}`}
                    type="button"
                    onClick={() => onSeek?.(seg.startMs)}
                    className={`meeting-transcript__segment${isActive ? " is-active" : ""}`}
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
        <div className="meeting-transcript__empty">
          无可展示的转写内容
        </div>
      )}
    </div>
  );
}

export default TranscriptView;

import React, { useState } from "react";

import { localDateTimeToUtcIso } from "@shared/time/local-time";

export type TaskCommitmentEditorSubmitInput = {
  title: string;
  description?: string;
  dueAt?: string;
  durationMinutes?: number;
  priority: "low" | "medium" | "high" | "urgent";
  timezone: string;
};

type TaskCommitmentEditorProps = {
  timezone: string;
  initialTitle?: string;
  initialDescription?: string;
  initialDueAt?: string;
  initialDurationMinutes?: string;
  initialPriority?: "low" | "medium" | "high" | "urgent";
  onSave: (input: TaskCommitmentEditorSubmitInput) => void | Promise<void>;
};

/** 渲染时间承诺编辑器，首版聚焦截止时间、时长与优先级。 */
export default function TaskCommitmentEditor({
  timezone,
  initialTitle = "",
  initialDescription = "",
  initialDueAt = "",
  initialDurationMinutes = "60",
  initialPriority = "medium",
  onSave,
}: TaskCommitmentEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [dueValue, setDueValue] = useState(initialDueAt);
  const [durationValue, setDurationValue] = useState(initialDurationMinutes);
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">(initialPriority);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }

    console.info("[日程规划] 提交任务编辑器", {
      title: title.trim(),
      dueAt: dueValue || null,
      durationMinutes: durationValue ? Number(durationValue) : null,
      priority,
    });
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt: dueValue ? localDateTimeToUtcIso(dueValue, timezone) : undefined,
        durationMinutes: durationValue ? Number(durationValue) : undefined,
        priority,
        timezone,
      });
      setTitle("");
      setDescription("");
      setDueValue("");
      setDurationValue("60");
      setPriority("medium");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="time-editor-form" onSubmit={handleSubmit}>
      <label className="time-editor-field">
        <span>标题</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <div className="time-editor-grid">
        <label className="time-editor-field">
          <span>截止时间</span>
          <input
            type="datetime-local"
            value={dueValue}
            onChange={(event) => setDueValue(event.target.value)}
          />
        </label>

        <label className="time-editor-field">
          <span>预计时长</span>
          <input
            type="number"
            min="15"
            step="15"
            value={durationValue}
            onChange={(event) => setDurationValue(event.target.value)}
          />
        </label>
      </div>

      <div className="time-editor-grid">
        <label className="time-editor-field">
          <span>优先级</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
            <option value="urgent">紧急</option>
          </select>
        </label>

        <label className="time-editor-field">
          <span>时区</span>
          <input value={timezone} readOnly />
        </label>
      </div>

      <label className="time-editor-field">
        <span>说明</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
      </label>

      <button type="submit" className="time-editor-submit" disabled={saving}>
        {saving ? "保存中..." : "保存任务"}
      </button>
    </form>
  );
}

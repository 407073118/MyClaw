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
  onSave: (input: TaskCommitmentEditorSubmitInput) => void | Promise<void>;
};

/** 渲染时间承诺编辑器，首版聚焦截止时间、时长与优先级。 */
export default function TaskCommitmentEditor({ timezone, onSave }: TaskCommitmentEditorProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueValue, setDueValue] = useState("");
  const [durationValue, setDurationValue] = useState("60");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }

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
        <span>Title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <div className="time-editor-grid">
        <label className="time-editor-field">
          <span>Due</span>
          <input
            type="datetime-local"
            value={dueValue}
            onChange={(event) => setDueValue(event.target.value)}
          />
        </label>

        <label className="time-editor-field">
          <span>Duration</span>
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
          <span>Priority</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </select>
        </label>

        <label className="time-editor-field">
          <span>Timezone</span>
          <input value={timezone} readOnly />
        </label>
      </div>

      <label className="time-editor-field">
        <span>Description</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
      </label>

      <button type="submit" className="time-editor-submit" disabled={saving}>
        {saving ? "Saving..." : "Save Task"}
      </button>
    </form>
  );
}

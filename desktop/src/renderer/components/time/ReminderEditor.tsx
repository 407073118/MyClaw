import React, { useState } from "react";

import { localDateTimeToUtcIso } from "@shared/time/local-time";

export type ReminderEditorSubmitInput = {
  title: string;
  body?: string;
  triggerAt: string;
  timezone: string;
};

type ReminderEditorProps = {
  timezone: string;
  onSave: (input: ReminderEditorSubmitInput) => void | Promise<void>;
};

/** 渲染提醒编辑器，并把本地时间标准化为 UTC 时间戳。 */
export default function ReminderEditor({ timezone, onSave }: ReminderEditorProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [triggerValue, setTriggerValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !triggerValue) {
      return;
    }

    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        body: body.trim() || undefined,
        triggerAt: localDateTimeToUtcIso(triggerValue, timezone),
        timezone,
      });
      setTitle("");
      setBody("");
      setTriggerValue("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="time-editor-form" onSubmit={handleSubmit}>
      <label className="time-editor-field">
        <span>Reminder Title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <label className="time-editor-field">
        <span>Reminder Time</span>
        <input
          type="datetime-local"
          value={triggerValue}
          onChange={(event) => setTriggerValue(event.target.value)}
        />
      </label>

      <label className="time-editor-field">
        <span>Reminder Note</span>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} />
      </label>

      <button type="submit" className="time-editor-submit" disabled={saving}>
        {saving ? "Saving..." : "Save Reminder"}
      </button>
    </form>
  );
}

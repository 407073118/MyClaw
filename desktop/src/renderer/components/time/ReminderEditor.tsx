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
  initialTitle?: string;
  initialBody?: string;
  initialTriggerAt?: string;
  onSave: (input: ReminderEditorSubmitInput) => void | Promise<void>;
};

/** 渲染提醒编辑器，并把本地时间标准化为 UTC 时间戳。 */
export default function ReminderEditor({
  timezone,
  initialTitle = "",
  initialBody = "",
  initialTriggerAt = "",
  onSave,
}: ReminderEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [triggerValue, setTriggerValue] = useState(initialTriggerAt);
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
        <span>提醒标题</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <label className="time-editor-field">
        <span>提醒时间</span>
        <input type="datetime-local" value={triggerValue} onChange={(event) => setTriggerValue(event.target.value)} />
      </label>

      <label className="time-editor-field">
        <span>提醒备注</span>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} />
      </label>

      <button type="submit" className="time-editor-submit" disabled={saving}>
        {saving ? "保存中..." : "保存提醒"}
      </button>
    </form>
  );
}

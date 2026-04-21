import React, { useState } from "react";

import { localDateTimeToUtcIso } from "@shared/time/local-time";

export type CalendarEventEditorSubmitInput = {
  title: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

type CalendarEventEditorProps = {
  timezone: string;
  onSave: (input: CalendarEventEditorSubmitInput) => void | Promise<void>;
};

/** 渲染手动日历事件编辑器，负责把本地时间输入标准化为 UTC 时间戳。 */
export default function CalendarEventEditor({ timezone, onSave }: CalendarEventEditorProps) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [startValue, setStartValue] = useState("");
  const [endValue, setEndValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !startValue || !endValue) {
      return;
    }

    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        startsAt: localDateTimeToUtcIso(startValue, timezone),
        endsAt: localDateTimeToUtcIso(endValue, timezone),
        timezone,
      });
      setTitle("");
      setLocation("");
      setDescription("");
      setStartValue("");
      setEndValue("");
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
          <span>Start</span>
          <input
            type="datetime-local"
            value={startValue}
            onChange={(event) => setStartValue(event.target.value)}
          />
        </label>

        <label className="time-editor-field">
          <span>End</span>
          <input
            type="datetime-local"
            value={endValue}
            onChange={(event) => setEndValue(event.target.value)}
          />
        </label>
      </div>

      <div className="time-editor-grid">
        <label className="time-editor-field">
          <span>Location</span>
          <input value={location} onChange={(event) => setLocation(event.target.value)} />
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
        {saving ? "Saving..." : "Save Event"}
      </button>
    </form>
  );
}

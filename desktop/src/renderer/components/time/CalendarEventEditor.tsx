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
  initialTitle?: string;
  initialLocation?: string;
  initialDescription?: string;
  initialStartsAt?: string;
  initialEndsAt?: string;
  onSave: (input: CalendarEventEditorSubmitInput) => void | Promise<void>;
};

/** 渲染日程事件编辑器，并把本地时间输入标准化为 UTC 时间戳。 */
export default function CalendarEventEditor({
  timezone,
  initialTitle = "",
  initialLocation = "",
  initialDescription = "",
  initialStartsAt = "",
  initialEndsAt = "",
  onSave,
}: CalendarEventEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [location, setLocation] = useState(initialLocation);
  const [description, setDescription] = useState(initialDescription);
  const [startValue, setStartValue] = useState(initialStartsAt);
  const [endValue, setEndValue] = useState(initialEndsAt);
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
        <span>标题</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <div className="time-editor-grid">
        <label className="time-editor-field">
          <span>开始时间</span>
          <input type="datetime-local" value={startValue} onChange={(event) => setStartValue(event.target.value)} />
        </label>

        <label className="time-editor-field">
          <span>结束时间</span>
          <input type="datetime-local" value={endValue} onChange={(event) => setEndValue(event.target.value)} />
        </label>
      </div>

      <div className="time-editor-grid">
        <label className="time-editor-field">
          <span>地点</span>
          <input value={location} onChange={(event) => setLocation(event.target.value)} />
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
        {saving ? "保存中..." : "保存日程"}
      </button>
    </form>
  );
}

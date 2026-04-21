import React, { useEffect, useState } from "react";

import type { AvailabilityPolicy } from "../../../../shared/contracts";

type AvailabilityPolicyFormProps = {
  policy: AvailabilityPolicy | null;
  timezone: string;
  onSave: (policy: AvailabilityPolicy) => void | Promise<void>;
};

/** 渲染本地时间规则表单，统一承接工作时段与静默时段配置。 */
export default function AvailabilityPolicyForm({
  policy,
  timezone,
  onSave,
}: AvailabilityPolicyFormProps) {
  const [workdayStart, setWorkdayStart] = useState("09:00");
  const [workdayEnd, setWorkdayEnd] = useState("18:00");
  const [quietEnabled, setQuietEnabled] = useState(true);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const nextWorkingHours = policy?.workingHours ?? [];
    const defaultWindow = nextWorkingHours[0];
    setWorkdayStart(defaultWindow?.start ?? "09:00");
    setWorkdayEnd(defaultWindow?.end ?? "18:00");
    setQuietEnabled(policy?.quietHours.enabled ?? true);
    setQuietStart(policy?.quietHours.start ?? "22:00");
    setQuietEnd(policy?.quietHours.end ?? "08:00");
  }, [policy]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        timezone,
        workingHours: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          start: workdayStart,
          end: workdayEnd,
        })),
        quietHours: {
          enabled: quietEnabled,
          start: quietStart,
          end: quietEnd,
        },
        notificationWindows: policy?.notificationWindows ?? [],
        focusBlocks: policy?.focusBlocks ?? [],
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="time-editor-form" onSubmit={handleSubmit}>
      <div className="time-editor-grid">
        <label className="time-editor-field">
          <span>Workday Start</span>
          <input
            type="time"
            aria-label="Workday Start"
            value={workdayStart}
            onChange={(event) => setWorkdayStart(event.target.value)}
          />
        </label>

        <label className="time-editor-field">
          <span>Workday End</span>
          <input
            type="time"
            aria-label="Workday End"
            value={workdayEnd}
            onChange={(event) => setWorkdayEnd(event.target.value)}
          />
        </label>
      </div>

      <label className="time-editor-field time-editor-checkbox">
        <span>Quiet Hours Enabled</span>
        <input
          type="checkbox"
          checked={quietEnabled}
          onChange={(event) => setQuietEnabled(event.target.checked)}
        />
      </label>

      <div className="time-editor-grid">
        <label className="time-editor-field">
          <span>Quiet Start</span>
          <input
            type="time"
            aria-label="Quiet Start"
            value={quietStart}
            onChange={(event) => setQuietStart(event.target.value)}
          />
        </label>

        <label className="time-editor-field">
          <span>Quiet End</span>
          <input
            type="time"
            aria-label="Quiet End"
            value={quietEnd}
            onChange={(event) => setQuietEnd(event.target.value)}
          />
        </label>
      </div>

      <button type="submit" className="time-editor-submit" disabled={saving}>
        {saving ? "Saving..." : "Save Rules"}
      </button>
    </form>
  );
}

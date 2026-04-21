import React, { useMemo, useState } from "react";

import { localDateTimeToUtcIso } from "@shared/time/local-time";

export type ScheduleJobEditorSubmitInput = {
  title: string;
  description?: string;
  scheduleKind: "once" | "interval" | "cron";
  timezone: string;
  startsAt?: string;
  intervalMinutes?: number;
  cronExpression?: string;
  executor: "workflow" | "silicon_person" | "assistant_prompt";
  executorTargetId?: string;
};

type ScheduleJobEditorProps = {
  timezone: string;
  ownerScope?: "personal" | "silicon_person";
  ownerId?: string;
  onSave: (input: ScheduleJobEditorSubmitInput) => void | Promise<void>;
};

/** 渲染计划任务编辑器，支持 once / interval / cron 三种首版调度模式。 */
export default function ScheduleJobEditor({
  timezone,
  ownerScope = "personal",
  ownerId,
  onSave,
}: ScheduleJobEditorProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduleKind, setScheduleKind] = useState<"once" | "interval" | "cron">("interval");
  const [startValue, setStartValue] = useState("");
  const [intervalValue, setIntervalValue] = useState("60");
  const [cronValue, setCronValue] = useState("0 9 * * 1-5");
  const [executor, setExecutor] = useState<"workflow" | "silicon_person" | "assistant_prompt">(
    ownerScope === "silicon_person" ? "workflow" : "assistant_prompt",
  );
  const [executorTargetId, setExecutorTargetId] = useState(ownerId ?? "");
  const [saving, setSaving] = useState(false);

  const scheduleSummary = useMemo(() => {
    if (scheduleKind === "once") {
      return "Run once at the selected time.";
    }
    if (scheduleKind === "cron") {
      return "Use a cron expression for repeat execution.";
    }
    return "Run on a fixed-minute interval from the selected start time.";
  }, [scheduleKind]);

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
        scheduleKind,
        timezone,
        startsAt: startValue ? localDateTimeToUtcIso(startValue, timezone) : undefined,
        intervalMinutes: scheduleKind === "interval" ? Number(intervalValue || "0") : undefined,
        cronExpression: scheduleKind === "cron" ? cronValue.trim() || undefined : undefined,
        executor,
        executorTargetId: executorTargetId.trim() || undefined,
      });
      setTitle("");
      setDescription("");
      setStartValue("");
      setIntervalValue("60");
      setCronValue("0 9 * * 1-5");
      setExecutor(ownerScope === "silicon_person" ? "workflow" : "assistant_prompt");
      setExecutorTargetId(ownerId ?? "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="time-editor-form" onSubmit={handleSubmit}>
      <label className="time-editor-field">
        <span>Job Title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <div className="time-editor-grid">
        <label className="time-editor-field">
          <span>Schedule Type</span>
          <select
            aria-label="Schedule Type"
            value={scheduleKind}
            onChange={(event) => setScheduleKind(event.target.value as typeof scheduleKind)}
          >
            <option value="once">once</option>
            <option value="interval">interval</option>
            <option value="cron">cron</option>
          </select>
        </label>

        <label className="time-editor-field">
          <span>Job Start</span>
          <input
            type="datetime-local"
            aria-label="Job Start"
            value={startValue}
            onChange={(event) => setStartValue(event.target.value)}
          />
        </label>
      </div>

      {scheduleKind === "interval" ? (
        <label className="time-editor-field">
          <span>Interval Minutes</span>
          <input
            type="number"
            min="5"
            step="5"
            aria-label="Interval Minutes"
            value={intervalValue}
            onChange={(event) => setIntervalValue(event.target.value)}
          />
        </label>
      ) : null}

      {scheduleKind === "cron" ? (
        <label className="time-editor-field">
          <span>Cron Expression</span>
          <input
            aria-label="Cron Expression"
            value={cronValue}
            onChange={(event) => setCronValue(event.target.value)}
          />
        </label>
      ) : null}

      <div className="time-editor-grid">
        <label className="time-editor-field">
          <span>Executor</span>
          <select value={executor} onChange={(event) => setExecutor(event.target.value as typeof executor)}>
            <option value="assistant_prompt">assistant_prompt</option>
            <option value="workflow">workflow</option>
            <option value="silicon_person">silicon_person</option>
          </select>
        </label>

        <label className="time-editor-field">
          <span>Executor Target</span>
          <input
            value={executorTargetId}
            onChange={(event) => setExecutorTargetId(event.target.value)}
            placeholder="workflow-id / silicon-person-id"
          />
        </label>
      </div>

      <label className="time-editor-field">
        <span>Job Note</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
      </label>

      <p className="time-editor-helper">{scheduleSummary}</p>

      <button type="submit" className="time-editor-submit" disabled={saving}>
        {saving ? "Saving..." : "Save Job"}
      </button>
    </form>
  );
}

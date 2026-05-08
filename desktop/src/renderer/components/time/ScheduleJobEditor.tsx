import React, { useEffect, useMemo, useState } from "react";

import type { ScheduleJob, ScheduleJobExecutor, TimeOwnerScope } from "@shared/contracts";

import {
  defaultFrequencyForKind,
  frequencyToScheduleInput,
  parseFrequency,
  type FrequencyValue,
} from "../../utils/frequency";
import FrequencyPicker from "./FrequencyPicker";

export type ScheduleJobEditorSubmitInput = {
  title: string;
  description?: string;
  timezone: string;
  executor: ScheduleJobExecutor;
  executorTargetId?: string;
  modelProfileId?: string;
  scheduleKind: "once" | "interval" | "cron";
  startsAt?: string;
  intervalMinutes?: number;
  cronExpression?: string;
};

export type ScheduleJobEditorMode = "create" | "update";

export type WorkflowOption = { id: string; name: string };
export type SiliconPersonOption = { id: string; name: string };
export type ModelOption = { id: string; name: string };

type Props = {
  timezone: string;
  executor: ScheduleJobExecutor;
  initialJob?: ScheduleJob;
  workflows: WorkflowOption[];
  siliconPersons: SiliconPersonOption[];
  modelOptions: ModelOption[];
  ownerScope?: TimeOwnerScope;
  ownerId?: string;
  onSave: (input: ScheduleJobEditorSubmitInput, mode: ScheduleJobEditorMode) => void | Promise<void>;
  onCancel?: () => void;
};

const EXECUTOR_LABELS: Record<ScheduleJobExecutor, string> = {
  assistant_prompt: "Prompt 任务",
  workflow: "Workflow 任务",
  silicon_person: "调用员工任务",
};

/** 计划任务编辑器：按 executor 渲染不同字段，支持新建与编辑两种模式。 */
export default function ScheduleJobEditor({
  timezone,
  executor,
  initialJob,
  workflows,
  siliconPersons,
  modelOptions,
  ownerScope = "personal",
  ownerId,
  onSave,
  onCancel,
}: Props) {
  const mode: ScheduleJobEditorMode = initialJob ? "update" : "create";

  const [title, setTitle] = useState(initialJob?.title ?? "");
  const [description, setDescription] = useState(initialJob?.description ?? "");
  const [frequency, setFrequency] = useState<FrequencyValue>(() =>
    initialJob ? parseFrequency(initialJob) : defaultFrequencyForKind("every-day"),
  );
  const [executorTargetId, setExecutorTargetId] = useState<string>(
    initialJob?.executorTargetId ?? (executor === "silicon_person" ? ownerId ?? "" : ""),
  );
  const [modelProfileId, setModelProfileId] = useState<string>(initialJob?.modelProfileId ?? "");
  const [saving, setSaving] = useState(false);

  // executor 切换时（理论上 ComposerModal 已锁，但保险起见兼容）：清掉 target
  useEffect(() => {
    if (initialJob) return;
    setExecutorTargetId(executor === "silicon_person" ? ownerId ?? "" : "");
  }, [executor, ownerId, initialJob]);

  const submitDisabled = useMemo(() => {
    if (saving) return true;
    if (!title.trim()) return true;
    if (executor === "workflow" && !executorTargetId) return true;
    if (executor === "silicon_person" && !executorTargetId) return true;
    if (executor === "assistant_prompt" && !description.trim()) return true;
    if (executor === "silicon_person" && !description.trim()) return true;
    return false;
  }, [saving, title, description, executor, executorTargetId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) return;

    setSaving(true);
    try {
      const scheduleFields = frequencyToScheduleInput(frequency);
      await onSave(
        {
          title: title.trim(),
          description: description.trim() || undefined,
          timezone,
          executor,
          executorTargetId: executorTargetId.trim() || undefined,
          modelProfileId: modelProfileId.trim() || undefined,
          ...scheduleFields,
        },
        mode,
      );
      if (mode === "create") {
        setTitle("");
        setDescription("");
        setFrequency(defaultFrequencyForKind("every-day"));
        setExecutorTargetId(executor === "silicon_person" ? ownerId ?? "" : "");
        setModelProfileId("");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="time-editor-form schedule-job-editor" onSubmit={handleSubmit}>
      <div className="schedule-job-editor__type-line">
        <span className={`job-type-chip job-type-chip--${executor}`}>{EXECUTOR_LABELS[executor]}</span>
        {mode === "create" && onCancel ? (
          <button type="button" className="schedule-job-editor__back" onClick={onCancel}>
            ← 换类型
          </button>
        ) : null}
        {mode === "update" ? (
          <span className="schedule-job-editor__mode-hint">编辑模式</span>
        ) : null}
      </div>

      <label className="time-editor-field">
        <span>任务标题</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="给任务起个名字" />
      </label>

      <fieldset className="time-editor-field schedule-job-editor__frequency">
        <legend>频率</legend>
        <FrequencyPicker value={frequency} onChange={setFrequency} timezone={timezone} />
      </fieldset>

      {executor === "assistant_prompt" ? (
        <>
          <label className="time-editor-field">
            <span>使用模型</span>
            <select
              value={modelProfileId}
              onChange={(event) => setModelProfileId(event.target.value)}
            >
              <option value="">默认主模型</option>
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
            <span className="schedule-job-editor__hint">
              不选则跟随 workspace 默认主模型；选定后该任务始终用这一个，能力（工具 / 技能 / MCP）继承聊天主链路。
            </span>
          </label>
          <label className="time-editor-field">
            <span>提示词</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
              placeholder="例如：用 5 个要点总结今天的科技热点新闻，每点 2 句话以内。"
            />
          </label>
        </>
      ) : null}

      {executor === "workflow" ? (
        <label className="time-editor-field">
          <span>选择工作流</span>
          <select
            value={executorTargetId}
            onChange={(event) => setExecutorTargetId(event.target.value)}
          >
            <option value="">— 请选择 —</option>
            {workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
            ))}
          </select>
          {workflows.length === 0 ? (
            <span className="schedule-job-editor__hint">还没有可用的工作流，先去工作流页面新建。</span>
          ) : null}
        </label>
      ) : null}

      {executor === "silicon_person" ? (
        <>
          <label className="time-editor-field">
            <span>选择员工</span>
            <select
              value={executorTargetId}
              onChange={(event) => setExecutorTargetId(event.target.value)}
            >
              <option value="">— 请选择 —</option>
              {siliconPersons.map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>
            {siliconPersons.length === 0 ? (
              <span className="schedule-job-editor__hint">还没有员工，先去硅基员工页面创建。</span>
            ) : null}
          </label>
          <label className="time-editor-field">
            <span>派发消息</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder="任务触发时发送给员工的消息内容。"
            />
          </label>
        </>
      ) : null}

      {executor === "workflow" ? (
        <label className="time-editor-field">
          <span>备注（可选）</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            placeholder="给自己留一句关于这个任务的说明。"
          />
        </label>
      ) : null}

      <div className="schedule-job-editor__actions">
        {onCancel && mode === "update" ? (
          <button type="button" className="time-editor-cancel" onClick={onCancel}>取消</button>
        ) : null}
        <button type="submit" className="time-editor-submit" disabled={submitDisabled}>
          {saving ? "保存中..." : mode === "update" ? "保存修改" : "保存定时任务"}
        </button>
      </div>
    </form>
  );
}

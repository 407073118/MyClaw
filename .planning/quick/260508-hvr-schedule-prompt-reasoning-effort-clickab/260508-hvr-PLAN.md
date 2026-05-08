---
quick_id: 260508-hvr
description: 定时任务 Prompt 加推理深度选择 + 执行历史行可点击查看详情
date: 2026-05-08
mode: quick
must_haves:
  truths:
    - "ScheduleJob 与 ScheduleJobUpsertInput 都有可选 reasoningEffort + reasoningEnabled，旧 job 缺字段不影响读取"
    - "Prompt 任务首次执行新建 session 时把 reasoningEffort/reasoningEnabled 写入 session.runtimeIntent，与硅基员工同链路（send-message 主链路自动 honor）"
    - "ScheduleJobEditor Prompt 表单显示 4 档「推理深度」chip 组（快速/思考/深度/极深 = low/medium/high/xhigh），默认 medium，编辑模式预填"
    - "ExecutionHistoryDrawer 每条 run 行在 job.sessionId 存在时变成 button，hover 高亮，右下「查看详情 →」link，点击 selectSession + close drawer + navigate('/chat')"
    - "无 sessionId 的旧 job 行保持 static（不可点击），不破坏向后兼容"
  artifacts:
    - desktop/shared/contracts/time-orchestration.ts
    - desktop/src/main/services/time-orchestration-store.ts
    - desktop/src/main/index.ts
    - desktop/src/renderer/components/time/ScheduleJobEditor.tsx
    - desktop/src/renderer/pages/TimeCenterPage.tsx
  key_links:
    - desktop/shared/contracts/session-runtime.ts:52 # SessionReasoningEffort 4 档
    - desktop/src/main/services/silicon-person-session.ts:106 # runtimeIntent 写入 pattern
    - desktop/src/main/index.ts:220 # runAssistantPrompt（260508-hcp 已重写）
    - desktop/src/renderer/components/time/ScheduleJobEditor.tsx:1 # editor 主体
---

# Quick 260508-hvr — Plan

## Tasks

### Task 1 — schema 加 reasoning 字段

**files:**
- `desktop/shared/contracts/time-orchestration.ts`：`ScheduleJob` 在 `modelProfileId?` 后追加：
  ```ts
  /** 推理深度（low=快速 / medium=思考 / high=深度 / xhigh=极深）；不填默认 medium。 */
  reasoningEffort?: SessionReasoningEffort;
  /** 是否显式启用推理；不填走 session 默认。 */
  reasoningEnabled?: boolean;
  ```
  顶部加 `import type { SessionReasoningEffort } from "./session-runtime";`
- `desktop/src/main/services/time-orchestration-store.ts`：`ScheduleJobUpsertInput` 加同样两个字段；`upsertScheduleJob` 构造 job 对象时透传。

### Task 2 — runAssistantPrompt 创建 session 时写 runtimeIntent

**files:** `desktop/src/main/index.ts`

**action:** 在创建 session 的对象里、`runtimeVersion` 之后加：
```ts
session = {
  ...,
  messages: [],
};
if (job.reasoningEffort || job.reasoningEnabled !== undefined) {
  session.runtimeIntent = {
    ...(job.reasoningEffort ? { reasoningEffort: job.reasoningEffort } : {}),
    ...(job.reasoningEnabled !== undefined ? { reasoningEnabled: job.reasoningEnabled } : {}),
  };
}
```
upsertScheduleJob 写回时也带上 `reasoningEffort: job.reasoningEffort`、`reasoningEnabled: job.reasoningEnabled`。

### Task 3 — Editor 加推理深度 4 档 chip

**files:** `desktop/src/renderer/components/time/ScheduleJobEditor.tsx`

**action:**
1. import `SessionReasoningEffort` 类型。
2. `ScheduleJobEditorSubmitInput` 加 `reasoningEffort?: SessionReasoningEffort;` `reasoningEnabled?: boolean;`
3. state：`const [reasoningEffort, setReasoningEffort] = useState<SessionReasoningEffort>(initialJob?.reasoningEffort ?? "medium");`
4. 仅 `executor === "assistant_prompt"` 时，在「使用模型」select 之后、「提示词」之前加：
   ```tsx
   <div className="time-editor-field">
     <span>推理深度</span>
     <div className="reasoning-chip-group" role="radiogroup" aria-label="推理深度">
       {REASONING_PRESETS.map((preset) => (
         <button
           key={preset.level}
           type="button"
           role="radio"
           aria-checked={reasoningEffort === preset.level}
           className={reasoningEffort === preset.level ? "reasoning-chip is-active" : "reasoning-chip"}
           onClick={() => setReasoningEffort(preset.level)}
           title={preset.description}
         >
           {preset.label}
         </button>
       ))}
     </div>
     <span className="schedule-job-editor__hint">low（快速）/ medium（思考，默认）/ high（深度）/ xhigh（极深）。模型不支持时降级到默认。</span>
   </div>
   ```
   PRESETS 常量定义在文件顶部：
   ```ts
   const REASONING_PRESETS = [
     { level: "low", label: "快速", description: "低延迟响应，适合简单任务" },
     { level: "medium", label: "思考", description: "默认推理深度，平衡速度与质量" },
     { level: "high", label: "深度", description: "展开更多中间推理，适合复杂任务" },
     { level: "xhigh", label: "极深", description: "拉满思考预算，处理高复杂度问题" },
   ] as const;
   ```
5. handleSubmit 透传 `reasoningEffort` + `reasoningEnabled: true`（默认开启；不开就走默认 medium 不传 enabled）。
6. mode === "create" 重置：`setReasoningEffort("medium");`

### Task 4 — TimeCenterPage 透传

**files:** `desktop/src/renderer/pages/TimeCenterPage.tsx`

**action:** `handleSaveScheduleJob` create / update 两条路径都透传 `reasoningEffort: input.reasoningEffort`、`reasoningEnabled: input.reasoningEnabled`。

### Task 5 — 执行历史行可点击 + 「查看详情 →」

**files:** `desktop/src/renderer/pages/TimeCenterPage.tsx`

**action:**
1. `ExecutionHistoryDrawer` 内已有 `navigate` 与 `job.sessionId`。
2. run li 改造：`job.sessionId` 存在时变成 `<li role="button" tabIndex={0} onClick onKeyDown>`，加 `is-clickable` class 与 `aria-label`。
3. 行底部 outputSummary 之后追加：
   ```tsx
   {job.sessionId ? (
     <span className="execution-history-row__detail-hint">查看详情 →</span>
   ) : null}
   ```
4. 点击逻辑：`useWorkspaceStore.getState().selectSession(job.sessionId!); onClose(); void navigate("/chat");`
5. CSS：
   ```css
   .execution-history-row.is-clickable {
     cursor: pointer;
     transition: background 0.15s ease, border-color 0.15s ease;
   }
   .execution-history-row.is-clickable:hover {
     background: rgba(255, 255, 255, 0.05);
     border-color: var(--glass-border-hover);
   }
   .execution-history-row.is-clickable:focus-visible {
     outline: 2px solid var(--accent-cyan);
     outline-offset: -2px;
   }
   .execution-history-row__detail-hint {
     align-self: flex-end;
     font-size: 11px;
     font-weight: 600;
     color: var(--accent-cyan);
     margin-top: 2px;
   }
   .execution-history-row.is-clickable:hover .execution-history-row__detail-hint {
     text-decoration: underline;
   }
   ```

**verify:**
- typecheck 全绿
- 创建一个 prompt job，「推理深度」选「深度」→ 保存。
- 执行该 job → ChatPage 出现 [定时] xxx session，点开看 runtimeIntent 含 reasoningEffort: "high"。
- 编辑该 job → 推理深度 chip 预填到「深度」。
- 抽屉内每条 run hover 出灰底，点击行跳到 ChatPage 且 selectSession 该任务的 session。
- 旧 job（无 sessionId）行不可点击。

## Out of scope
- 推理深度的 token 预算自定义（沿用 session 默认）
- 推理过程在抽屉内可视化（详情页才有）
- 精准滚动到该次执行的具体消息（需要 ExecutionRun 加 sessionMessageId + ChatPage URL 参数支持，独立任务）
- workflow / silicon_person 类型加推理选项

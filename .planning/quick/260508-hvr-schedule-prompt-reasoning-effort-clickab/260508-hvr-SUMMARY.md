---
quick_id: 260508-hvr
description: 定时任务 Prompt 加推理深度选择 + 执行历史行可点击查看详情
date: 2026-05-08
status: completed
---

# Quick 260508-hvr — Summary

## What changed

### Schema（向后兼容）
- `desktop/shared/contracts/time-orchestration.ts`：`ScheduleJob` 加可选 `reasoningEffort?: SessionReasoningEffort` + `reasoningEnabled?: boolean`，import `SessionReasoningEffort` from session-runtime。
- `desktop/src/main/services/time-orchestration-store.ts`：`ScheduleJobUpsertInput` 同步加；`upsertScheduleJob` 透传到 job。

### 主链路 — runtimeIntent 写入
`desktop/src/main/index.ts` runAssistantPrompt 新建 session 时，在 messages 之后追加（与 `silicon-person-session.ts:106` 同款 pattern）：
```ts
if (job.reasoningEffort || job.reasoningEnabled !== undefined) {
  session.runtimeIntent = {
    ...(job.reasoningEffort ? { reasoningEffort: job.reasoningEffort } : {}),
    ...(job.reasoningEnabled !== undefined ? { reasoningEnabled: job.reasoningEnabled } : {}),
  };
}
```
upsertScheduleJob 写回时也带上 reasoningEffort + reasoningEnabled。send-message 主链路自动 honor session.runtimeIntent，模型不支持时降级。

### Editor — 4 档推理深度 chip 组
`desktop/src/renderer/components/time/ScheduleJobEditor.tsx`：
- import `SessionReasoningEffort`
- `ScheduleJobEditorSubmitInput` 加 `reasoningEffort?` + `reasoningEnabled?`
- 顶部 const `REASONING_PRESETS`：4 档（low=快速 / medium=思考 / high=深度 / xhigh=极深），each with title + description
- state：`reasoningEffort` 默认 medium，编辑模式预填 `initialJob.reasoningEffort`
- 仅 `executor === "assistant_prompt"` 时在「使用模型」之后渲染 `<div class="reasoning-chip-group" role="radiogroup">`，4 个 button role="radio" + aria-checked + title=description
- 提交时 prompt 类型透传 `reasoningEffort` + `reasoningEnabled: true`，其他类型透传 undefined
- mode === "create" 重置到 medium

### TimeCenterPage 透传
`handleSaveScheduleJob` create / update 两条路径都透传 `reasoningEffort` + `reasoningEnabled`。

### 执行历史行可点击
`ExecutionHistoryDrawer` 内：
- 每条 run li 在 `job.sessionId` 存在时变成 `<li role="button" tabIndex={0} aria-label>`，加 `is-clickable` class
- onClick / onKeyDown(Enter|Space) → `selectSession(sessionId) + onClose() + navigate("/chat")`
- 行右下加 `<span class="execution-history-row__detail-hint">查看详情 →</span>`
- 无 sessionId 的旧 job 行保持 static（不可点击，无 hint），向后兼容
- CSS：
  - `.is-clickable:hover` 升 `rgba(255,255,255,0.05)` + `--glass-border-hover`
  - `.is-clickable:focus-visible` 加 cyan outline-offset:-2px
  - `.is-clickable:hover .__detail-hint` 文字下划线

### Reasoning chip CSS
`.reasoning-chip-group / .reasoning-chip / .reasoning-chip.is-active` 跟项目现有 chip 风格统一（999px pill + cyan active），与 FrequencyPicker chip 视觉协调。

## How to verify

1. `cd desktop && pnpm run typecheck` 全绿。
2. desktop dev：
   - 「定时任务」+ 进入 Prompt 表单 → 「使用模型」之后看到「推理深度」4 个 chip（默认「思考」），title hover 出 description。
   - 选「深度」保存 prompt job → 触发执行 → ChatPage 看到 `[定时] xxx` session，inspect runtimeIntent 含 `reasoningEffort: "high"`。
   - 编辑该 job → 推理深度 chip 预填到「深度」。
3. 抽屉中：
   - 已有 sessionId 的 run 行 hover 变亮，右下显「查看详情 →」cyan 字
   - 点击行 → 跳到 ChatPage 且自动 selectSession
   - 键盘 Enter / Space 同样可触发
   - 旧 job 跑出来无 sessionId 的行不可点击，无 hint
4. workflow / 员工类型表单不显示「推理深度」chip（仅 prompt 类型）。

## Out of scope (deferred)
- 推理深度的 token budget 自定义（沿用 session 默认）
- 抽屉内可视化推理过程（详情页才有）
- ExecutionRun 加 sessionMessageId 实现精准滚动到该次执行的消息（需 ChatPage URL 参数 + scroll，独立任务）
- workflow / silicon_person 类型加推理选项（员工本来就有自己的推理设置）

## Files
- `desktop/shared/contracts/time-orchestration.ts` (+5 行)
- `desktop/src/main/services/time-orchestration-store.ts` (+4 行)
- `desktop/src/main/index.ts` (+8 行 runtimeIntent + upsert 字段)
- `desktop/src/renderer/components/time/ScheduleJobEditor.tsx` (+50 行 reasoning chip + state)
- `desktop/src/renderer/pages/TimeCenterPage.tsx` (+50 行 clickable row + 透传 + CSS)

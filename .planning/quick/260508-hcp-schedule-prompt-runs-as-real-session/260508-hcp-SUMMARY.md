---
quick_id: 260508-hcp
description: 定时任务 Prompt 走真 session（复用 session:send-message 主链路）
date: 2026-05-08
status: completed
---

# Quick 260508-hcp — Summary

## What changed

### Schema（向后兼容，无 migration）
- `desktop/shared/contracts/time-orchestration.ts`：`ScheduleJob` 加可选 `sessionId?: string` + `modelProfileId?: string`。
- `desktop/src/main/services/time-orchestration-store.ts`：`ScheduleJobUpsertInput` 同步加这两个字段，`upsertScheduleJob` 透传到 job 对象（payload_json 自动持久化）。

### 主链路重写（核心）
`desktop/src/main/services/time-job-executor.ts`：
- `TimeJobExecutorDeps.runAssistantPrompt` 签名从 `({ prompt })` 改为 `({ job, prompt })`，让上层能读到 job.sessionId / modelProfileId 并写回。

`desktop/src/main/index.ts`：runAssistantPrompt 整段重写：
1. 从 `state.sessions` 找 `job.sessionId` 对应 session；找不到则新建：
   - title = `[定时] ${job.title}`
   - modelProfileId = `job.modelProfileId ?? defaultModelProfileId ?? models[0]?.id`
   - 走 `randomUUID` + `SESSION_RUNTIME_VERSION` + `saveSession(paths, session)` 全套（与 session:create handler 完全一致的初始化）
   - `await timeStore.upsertScheduleJob({...job, sessionId: session.id})` 把 sessionId 持久化回去
2. `await invokeRegisteredSessionSendMessage(session.id, { content: prompt })` 走与 ChatPage 相同的主链路，工具/技能/MCP/审批/流式/历史 全继承
3. 从 `sendResult.session.messages` 倒序找最后一条 `role==="assistant"` 用 `textOfContent` 抽出 outputSummary

裸 `callModel` 路径删除。

### Editor 加「使用模型」select
`desktop/src/renderer/components/time/ScheduleJobEditor.tsx`：
- Props 加 `modelOptions: ModelOption[]`。
- `ScheduleJobEditorSubmitInput` 加 `modelProfileId?: string`。
- 仅 `executor === "assistant_prompt"` 时在「提示词」前面加「使用模型」select：
  - `<option value="">默认主模型</option>` + `models[].name`。
  - 编辑模式预填 `initialJob.modelProfileId`。
  - hint 文案说明：「不选则跟随 workspace 默认主模型；选定后该任务始终用这一个，能力（工具 / 技能 / MCP）继承聊天主链路。」

### TimeCenterPage 透传 + Drawer 跳转
`desktop/src/renderer/pages/TimeCenterPage.tsx`：
- 订阅 `state.models`；派生 `modelOptions`；ComposerModal + ScheduleJobEditor 透传。
- handleSaveScheduleJob create / update 两条路径都透传 `modelProfileId`。
- ExecutionHistoryDrawer：
  - `useNavigate()` from react-router-dom；
  - header 右侧（关闭按钮左边）当 `job.sessionId` 存在时显示「在对话中查看 →」按钮 → `selectSession(sessionId) + onClose() + navigate("/chat")`。
  - 按钮样式：cyan 描边 + 浅 cyan 底，与项目 accent 一致。
  - 旧 job（sessionId 为空）不显示该按钮，体验降级安全。

## How to verify

1. `cd desktop && pnpm run typecheck` —— main + renderer 全绿。
2. desktop dev：
   - 「定时任务」+ 卡 Prompt → 表单顶部多了「使用模型」select（默认「默认主模型」+ 列出 state.models）。
   - 写一条 prompt（例如"用 5 个要点总结今天的科技热点新闻"）保存。
   - 等到点 / 点立即执行：
     - 第一次执行：后台新建一条 `[定时] xxx` 的 session，把 sessionId 写回 job 持久化；ChatPage 出现该 session。
     - 之后每次执行：往同一 session 发 user message 走主链路，工具调用/技能/MCP 全可触发；outputSummary 是该轮 assistant 最终回复。
   - 抽屉 header 出现「在对话中查看 →」→ 点击跳到 ChatPage 且自动切到对应 session，能看到完整对话过程（user prompt + assistant + 工具调用细节）。
   - 关掉 desktop 重启，job.sessionId 仍在；再次执行复用该 session。
3. 旧 prompt job（无 sessionId）首次到点执行也能跑：自动初始化一个 session 并写回。
4. 不指定 modelProfileId 的任务跑默认主模型；指定了 modelProfileId 的任务始终用该模型。

## Out of scope (deferred)
- 工具白名单 / MCP 选择（默认全开继承 session）
- 「附加目录」(attachedDirectory) 配置入口
- silicon_person 任务的 modelProfileId 覆盖（员工 model 走 soul/identity，链路另算）
- 「每次新 session」开关（当前默认复用同一 session）
- workflow 任务的 modelProfileId 字段（workflow 内部由节点自定）
- ChatPage 上对「定时任务关联 session」的特殊角标 / 折叠

## Files
- `desktop/shared/contracts/time-orchestration.ts` (+5 行)
- `desktop/src/main/services/time-orchestration-store.ts` (+4 行)
- `desktop/src/main/services/time-job-executor.ts` (+1 行 sig + 1 行 call)
- `desktop/src/main/index.ts` (~+50 行重写 runAssistantPrompt + 4 行 imports)
- `desktop/src/renderer/components/time/ScheduleJobEditor.tsx` (~+30 行 model select)
- `desktop/src/renderer/pages/TimeCenterPage.tsx` (~+50 行 modelOptions + drawer chat link + CSS)

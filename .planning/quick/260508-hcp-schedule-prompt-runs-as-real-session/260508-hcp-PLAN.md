---
quick_id: 260508-hcp
description: 定时任务 Prompt 走真 session（复用 session:send-message 主链路，工具/技能/MCP/审批全继承）
date: 2026-05-08
mode: quick
must_haves:
  truths:
    - "ScheduleJob 与 ScheduleJobUpsertInput 都有可选 sessionId / modelProfileId 字段，旧 job 缺字段不影响读取"
    - "Prompt 类型定时任务到点执行时，调 invokeRegisteredSessionSendMessage（与 ChatPage 同一条链路），工具/技能/MCP/审批全部继承"
    - "首次执行：从 state.sessions 找 sessionId 对应 session，找不到时新建命名为 \"[定时] {job.title}\" 的 session，把 sessionId 写回 job 持久化"
    - "outputSummary 从 sendResult.session.messages 倒序找最后一条 role=='assistant' 的消息提取（textOfContent）"
    - "ScheduleJobEditor Prompt 表单显示「使用模型」select（options 从 state.models 拉，显示 name），编辑模式预填 initialJob.modelProfileId；不指定时跑默认主模型"
    - "ExecutionHistoryDrawer header 在 job.sessionId 存在时显示「在对话中查看 →」按钮，点击 navigate('/chat') 并 workspace.selectSession(sessionId)"
  artifacts:
    - desktop/shared/contracts/time-orchestration.ts
    - desktop/src/main/services/time-orchestration-store.ts
    - desktop/src/main/services/time-job-executor.ts
    - desktop/src/main/index.ts
    - desktop/src/renderer/components/time/ScheduleJobEditor.tsx
    - desktop/src/renderer/pages/TimeCenterPage.tsx
  key_links:
    - desktop/src/main/index.ts:189                    # createTimeJobExecutor wiring
    - desktop/src/main/index.ts:220                    # 旧 runAssistantPrompt（裸 callModel）
    - desktop/src/main/ipc/sessions.ts:279             # invokeRegisteredSessionSendMessage
    - desktop/src/main/ipc/sessions.ts:2298            # session:create handler 参考创建逻辑
    - desktop/src/main/services/silicon-person-session.ts:269 # saveSession 用法
    - desktop/shared/contracts/session.ts:53           # textOfContent
    - desktop/src/renderer/stores/workspace.ts:847     # selectSession action
---

# Quick 260508-hcp — Plan

## 决策

`silicon_person` 已经走 `invokeRegisteredSessionSendMessage` 主链路（参 `index.ts:209-218`），这条路带工具/技能/MCP/审批/流式/历史。`assistant_prompt` 当前走裸 `callModel`，全丢。把它接到同一条路，每个 Prompt job 关联**一条长期 session**（job.sessionId 写回持久化），用户能在 ChatPage 看完整对话历史，工具调用、MCP、审批等同 ChatPage。

## Tasks

### Task 1 — schema 加 sessionId / modelProfileId

**files:**
- `desktop/shared/contracts/time-orchestration.ts`
- `desktop/src/main/services/time-orchestration-store.ts`

**action:**
1. 在 `ScheduleJob` 类型加（紧贴 `executorTargetId?: string;` 后）：
   ```ts
   /** Prompt 类型定时任务关联的 ChatSession id；首次执行时自动创建并写回。 */
   sessionId?: string;
   /** 指定模型 profile id；不指定时执行器走 workspace 默认主模型。 */
   modelProfileId?: string;
   ```
2. `ScheduleJobUpsertInput`（store.ts:103）同样加：`sessionId?: string;` `modelProfileId?: string;`
3. `upsertScheduleJob` 在构造 job 对象时把这两个字段从 input 透传：
   ```ts
   const job: ScheduleJob = {
     ...
     executorTargetId: input.executorTargetId,
     sessionId: input.sessionId,
     modelProfileId: input.modelProfileId,
     lastRunAt: input.lastRunAt,
     ...
   };
   ```
   payload_json 已经是 `JSON.stringify(job)`，新字段自动持久化，无需 schema migration。

**verify:** typecheck；老 job 反序列化时 sessionId/modelProfileId 为 undefined，不影响后端逻辑。

---

### Task 2 — time-job-executor deps 改造

**files:** `desktop/src/main/services/time-job-executor.ts`

**action:**
1. `TimeJobExecutorDeps.runAssistantPrompt` 签名从 `(input: { prompt: string })` 改为 `(input: { job: ScheduleJob; prompt: string })`。
2. case "assistant_prompt" 调用处：`await deps.runAssistantPrompt({ job, prompt })`。

**verify:** typecheck。

---

### Task 3 — main/index.ts 重写 runAssistantPrompt

**files:** `desktop/src/main/index.ts`

**action:** 把 line 220-233 整段替换为下面的实现（imports 顶部追加 `randomUUID`、`saveSession`、`SESSION_RUNTIME_VERSION`、`invokeRegisteredSessionSendMessage`、`textOfContent`）：

```ts
runAssistantPrompt: async ({ job, prompt }) => {
  // 复用或创建该 prompt job 的长期 session
  let session = job.sessionId
    ? sessions.find((s) => s.id === job.sessionId) ?? null
    : null;
  if (!session) {
    const now = new Date().toISOString();
    const profileId = job.modelProfileId
      ?? defaultModelProfileId
      ?? models[0]?.id
      ?? "";
    if (!profileId) {
      throw new Error("未配置任何模型，assistant_prompt 计划任务无法执行");
    }
    session = {
      id: randomUUID(),
      title: `[定时] ${job.title}`,
      modelProfileId: profileId,
      attachedDirectory: null,
      createdAt: now,
      runtimeVersion: SESSION_RUNTIME_VERSION,
      messages: [],
    };
    sessions.push(session);
    await saveSession(paths, session);
    // 把 sessionId 写回 job 持久化（保留所有现有字段）
    await timeStore.upsertScheduleJob({
      id: job.id,
      title: job.title,
      description: job.description,
      scheduleKind: job.scheduleKind,
      timezone: job.timezone,
      ownerScope: job.ownerScope,
      ownerId: job.ownerId,
      status: job.status,
      source: job.source,
      externalRef: job.externalRef,
      startsAt: job.startsAt,
      intervalMinutes: job.intervalMinutes,
      cronExpression: job.cronExpression,
      executor: job.executor,
      executorTargetId: job.executorTargetId,
      sessionId: session.id,
      modelProfileId: job.modelProfileId,
      lastRunAt: job.lastRunAt,
      nextRunAt: job.nextRunAt,
    });
  }

  const sendResult = await invokeRegisteredSessionSendMessage(session.id, {
    content: prompt,
  });

  // 主链路返回的是更新后的 session（包含工具调用 + 助手回复全过程）
  const lastAssistant = [...sendResult.session.messages].reverse().find(
    (message) => message.role === "assistant",
  );
  const outputSummary = lastAssistant ? textOfContent(lastAssistant.content) : "";
  return { outputSummary };
},
```

**verify:** typecheck；启动 desktop dev 创建 prompt job 跑一次 → 在 ChatPage 看到 `[定时] xxx` session 出现且包含一轮对话。

---

### Task 4 — ScheduleJobEditor 加「使用模型」select

**files:** `desktop/src/renderer/components/time/ScheduleJobEditor.tsx`

**action:**
1. Props 加 `modelOptions: { id: string; name: string }[];`
2. `ScheduleJobEditorSubmitInput` 加 `modelProfileId?: string;`
3. 状态加 `const [modelProfileId, setModelProfileId] = useState(initialJob?.modelProfileId ?? "");`
4. **仅在 executor === "assistant_prompt" 时** 在「提示词」字段上方加：
   ```tsx
   <label className="time-editor-field">
     <span>使用模型</span>
     <select value={modelProfileId} onChange={(e) => setModelProfileId(e.target.value)}>
       <option value="">默认主模型</option>
       {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
     </select>
     <span className="schedule-job-editor__hint">不选则跟随 workspace 默认主模型；选定后该任务始终用这一个。</span>
   </label>
   ```
5. handleSubmit 提交时透传：`modelProfileId: modelProfileId || undefined`。
6. mode === "create" 后的重置加：`setModelProfileId("");`

**verify:** typecheck；编辑器 Prompt 表单出现「使用模型」select；编辑模式预填 initialJob.modelProfileId。

---

### Task 5 — TimeCenterPage 透传 modelOptions + modelProfileId

**files:** `desktop/src/renderer/pages/TimeCenterPage.tsx`

**action:**
1. 顶层加：`const models = useWorkspaceStore((state) => state.models);`
2. `useMemo` 派生：`const modelOptions = useMemo(() => (models ?? []).map((m) => ({ id: m.id, name: m.name })), [models]);`
3. `ComposerModal` 调用透传 `modelOptions={modelOptions}`，定义里加 prop：`modelOptions: { id: string; name: string }[];`
4. `<ScheduleJobEditor ... modelOptions={modelOptions} ... />` 传入。
5. `handleSaveScheduleJob`：create 路径 + update 路径都透传 `modelProfileId: input.modelProfileId`（create 路径直接放进 createScheduleJob 输入；update 路径替换 editingJob.modelProfileId）。

**verify:** 创建 prompt job 选「使用模型」→ 列表保存后编辑这个 job 看到预填正确。

---

### Task 6 — Drawer header 加「在对话中查看 →」

**files:** `desktop/src/renderer/pages/TimeCenterPage.tsx`

**action:**
1. 文件顶部 import：`import { useNavigate } from "react-router-dom";`
2. `ExecutionHistoryDrawer` 内：`const navigate = useNavigate();`
3. header 内 close 按钮左侧（job.sessionId 存在时）：
   ```tsx
   {job.sessionId ? (
     <button
       type="button"
       className="schedule-job-editor__back execution-history-drawer__chat-link"
       onClick={() => {
         useWorkspaceStore.getState().selectSession(job.sessionId!);
         onClose();
         navigate("/chat");
       }}
     >
       在对话中查看 →
     </button>
   ) : null}
   ```
4. CSS：`.execution-history-drawer__chat-link { font-size: 12px; }` —— 复用 `.schedule-job-editor__back` 的 cyan 链接风格。

**verify:** 创建 prompt job 跑一次 → 抽屉 header 出现「在对话中查看 →」→ 点击跳到 ChatPage 且自动激活该 session。旧 job（无 sessionId）不显示。

---

## Out of scope
- 工具白名单 / MCP 选择（默认全开继承 session）
- 让用户在编辑器为 prompt 任务绑定「附加目录」(attachedDirectory)
- 让 silicon_person 类型也支持指定 modelProfileId（silicon_person 的 model 走员工 soul/identity 配置，链路另算）
- 「每次新 session」开关（当前默认复用同一 session）
- workflow 类型的 modelProfileId 字段（workflow 内部模型由节点自己决定）

## Files
- `desktop/shared/contracts/time-orchestration.ts` (+2 行)
- `desktop/src/main/services/time-orchestration-store.ts` (+4 行)
- `desktop/src/main/services/time-job-executor.ts` (+1 行 deps 签名 + 1 行调用点)
- `desktop/src/main/index.ts` (~+50 行重写 runAssistantPrompt)
- `desktop/src/renderer/components/time/ScheduleJobEditor.tsx` (~+30 行 model select)
- `desktop/src/renderer/pages/TimeCenterPage.tsx` (~+20 行 modelOptions + Drawer 链接)

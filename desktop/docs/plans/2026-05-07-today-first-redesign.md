# 时间规划重设计：以「今日」为入口，把日历、硅基员工、定时任务收敛到一台状态机

> 本方案完全重写，**不继承** `desktop/docs/plans/2026-04-21-time-planning-today-design.md` 与 `desktop/docs/plans/2026-05-07-time-planning-comprehensive-plan.md`。两份历史方案被否决，本文不引用其结论。
>
> 锚点：2026-05-07，以现行代码为基线（`desktop/shared/time/cron.ts`、`desktop/shared/contracts/{calendar,time-planning,time-orchestration}.ts`、`desktop/src/renderer/pages/TimeCenterPage.tsx`、`desktop/src/main/services/time-scheduler.ts`、`desktop/src/main/ipc/time-orchestration.ts`、`desktop/shared/contracts/silicon-person.ts`）。

---

## 0. 一句话定位

MyClaw 桌面端打开第一屏就是「**今日**」：左侧时间轴呈现今天会发生的所有有时间承诺的事（会议、AI 已排程的工作流、用户自定的提醒），右侧呈现今天还没承诺时间的事（待办池、AI 派出去正在跑或等审批的任务）。硅基员工不是另一个 Tab，而是「今日」上**派出去干活的人**；定时任务不是另一个 Tab，而是「今日」上**到点会自动发生的事**。

---

## 1. 现状盘点（事实，按价值倒序）

### 1.1 已经够用、不要重做
- `desktop/shared/time/cron.ts:15-175` — 5/6 段 cron 解析、时区感知的 `findNextCronRunAt`、为时间轴渲染设计的 `enumerateCronRunsOnDate`，分钟粒度、夏令时安全。**这块代码企业级，不要碰**。
- `desktop/shared/contracts/calendar.ts:1-78` — `CalendarEvent` / `TaskCommitment` 已带 `ownerScope: "personal" | "silicon_person"`、`source: "manual" | "meeting" | "agent" | "workflow" | "imported"`、`externalRef`。**多来源 + 双 ownership 的语义已就位**，不需要新加字段就能区分"我的会议"和"硅基员工的工作流任务"。
- `desktop/src/main/services/time-scheduler.ts` — main 进程 reminder/job 扫描循环、`recordExecutionRun` 已存在，骨架不动。
- `desktop/src/main/services/silicon-person-workflow.ts` — workflow 节点投影到 `session.tasks` 的桥已经搭好，**Today 页只要消费这套投影就行，不要再造一遍**。
- `desktop/src/main/ipc/silicon-persons.ts:24-113` — 每员工独立消息队列、串行执行、并发隔离。**这台执行机就是"派出去的活"的后端，方案直接挂到它上面**。

### 1.2 半成品、需要收口
- `desktop/src/renderer/pages/TimeCenterPage.tsx` — 已有 `today` / `automation` 双 Tab、`SuggestedTimebox` 建议时间块、`TodayBrief` 简报、`AgendaEntry`/`PendingAttentionEntry`/`TeamExecutionEntry` 多重聚合，但**信息密度过高、没有视觉层级、把所有东西平铺**。问题不是缺东西，是没把已有的东西收成 1 屏可读。
- `desktop/src/renderer/components/time/*` — 4 个 Editor + AvailabilityPolicyForm + TimeAssistantCapsule 都在，但缺一个「自然语言转结构化」的入口（用户应该能说"每周一 9 点帮我..."，不是去填 cron 字段）。
- `MeetingsPage` 的"导入到时间规划"是单向的：会议结束 → 提取跟进。**反向链路缺**：日历事件 → 会议室 prep 卡。

### 1.3 真正缺的
1. **统一的 TimeBoundRun 状态机**：现在 `ScheduleJob`、`ExecutionRun`、硅基员工的 session 消息队列是三条线，UI 要把它们手工拼。需要一个抽象把三者收敛。
2. **Pending Approvals 的一等公民地位**：硅基员工 `approvalMode` 已存在，但"今天有 N 件事等你拍板"没有页面承诺位。
3. **AI 排程的"建议 → 接受/拒绝"循环**：`SuggestedTimebox` 已生成，但**用户拒绝时没有结构化反馈被吃回去**，导致下次还是错的。
4. **失败/补跑的可见性**：定时任务凌晨失败，用户早上打开看不到 receipts。
5. **自然语言派任务**：能省掉 80% 的 cron 字段填写，企业员工的真实输入方式。
6. **云日历同步**（不在本期范围，明确写在 §11）。

---

## 2. 五条设计原则（基于行业对标，每条都带理由）

### 原则 1 — 来源用视觉通道区分，优先级用排序表达
会议 / 用户提醒 / AI 排程 这三类条目用**边框样式 + 左侧来源 icon** 区分（不是用色填充），AI 排程额外加虚线边框表达"建议态"。优先级**只**通过纵向排序表达。

> 理由：Motion 用颜色编码"AI 排的 vs 自己排的"是对的，但同时用颜色表达优先级会冲突；Things 3 把"今天但稍晚"放到 Evening 区是对的，但完全不画时间在企业语境会丢会议这条硬约束。

### 原则 2 — AI 任务必须可见 confidence 与可干预，不做黑盒后台 cron
每条 AI 即将运行的任务必须显式呈现：下次运行时间、上次结果、失败原因（如有）、一键 Skip / 改时间 / 立刻跑。

> 理由：ChatGPT Scheduled Tasks 失败的最大教训——通知不到达、失败静默、任务编辑后跳回原 chat 改不了。MyClaw 一开始就避开。

### 原则 3 — 已承诺时间 vs 未承诺时间分两侧渲染
左侧 = 时间轴（会议 + 已 timebox 的 task + AI 已排好时间的工作流）；右侧 = 池子（今天要做但没时间的 task + 派出去等结果的 agent run + 等你拍板的审批）。

> 理由：Sunsama 的 timebox 拖拽就是把右侧的项往左侧放——这个动作在 MyClaw 里也是用户对 AI 排程的最自然干预方式。

### 原则 4 — 三段分区：上午 / 下午 / 今晚
时间轴顶部固定切成三段。AI 排程默认倾向把跑批/汇总类工作流排到午休或下班后的"今晚"段。

> 理由：借 Things 的 Evening 概念，时段语义本身在解释 AI 的选择，"AI 22:00 帮你跑日报汇总" 比 "22:00 任务" 直觉化。

### 原则 5 — 顶部 Catch-up 是 receipts，不是 advice
顶部 banner 写"昨夜：3 个任务完成、1 个失败、2 个等你审批"，**不**写"建议你先处理 X"。AI 排序在所有产品里都不够准，Copilot 因此挨骂；陈述事实让用户自己决定，是更稳的策略。

> 理由：Copilot Daily Brief 把 AI 主观排序当默认值，社区 backlash 集中在这一点。

---

## 3. 核心心智模型：一台 TimeBoundRun 状态机

把以下三种东西统一成同一类对象，仅入口不同：
- 用户在 Chat 里说"帮我跑下周报"——`adhoc-from-chat`
- 用户在 Today 页配置"每周五 17:00 跑周报"——`scheduled-cron`
- 硅基员工自己排程把工作流塞到 14:00 跑——`agent-proposed`

```
TimeBoundRun
├── id, ownerScope, ownerId(siliconPersonId | userId)
├── trigger: { kind: "cron" | "once" | "adhoc" | "agent-proposed", expression?, plannedAt? }
├── workflowId | sessionMessageId   // 真正要跑的东西
├── state: idle → scheduled → running → paused → awaiting-approval → done | failed | skipped
├── plannedRunAt, startedAt, endedAt
├── lastResult: { success, summary, errorCode?, artifactRefs[] }
├── confidence?: number   // 仅 agent-proposed 有
└── userDecision?: { acceptedAt | rejectedAt, rejectReason? }
```

**关键决策：复用现有 `ExecutionRun` 而不是新建表**。`time-orchestration.ts` 的 `ExecutionRun` 已经有大半字段，只需要加：
- `trigger.kind` 区分四种入口
- `confidence` 与 `userDecision` 给 AI 提议态
- 把 `state` 从二态扩展为六态

> 这条原则来自 LangGraph + Durable Execution：**定时任务和聊天里发起的 agent 任务必须是同一类对象**，否则用户会面对两套不互通的 inbox。

---

## 4. 页面架构（Today Page 视觉骨架）

```
┌────────────────────────────────────────────────────────────────────────┐
│ Catch-up Banner (24px banner, dismissible)                             │
│ 昨夜 3 完成 · 1 失败「日报汇总」· 2 等审批 → [查看]                   │
├──────────────────────────────────┬─────────────────────────────────────┤
│  时间轴 / 已承诺时间 (60% 宽)    │  今日池子 / 未承诺时间 (40%)        │
│                                  │                                     │
│  ── 上午 (07:00–12:00) ──        │  · Pending Approvals (3) ▼          │
│   09:00 ▣ 站会 [会议]            │     ⚠ 硅基员工 A 想发邮件给 X      │
│   10:30 ▣ 客户答疑 [会议]        │       [批准] [改] [拒]              │
│   11:30 ◇ AI 准备答疑材料         │     ⚠ 硅基员工 B 想跑数据分析       │
│         [建议态 · 84% conf]      │                                     │
│         [接受] [改时间] [拒绝]    │  · 派出去的活 (4 in flight) ▼       │
│                                  │     ◐ 周报汇总 · Step 3/7 · 4m      │
│  ── 下午 (12:00–18:00) ──        │       [接管] [取消]                 │
│   14:00 ▣ 1on1 [会议]            │     ◐ 客户邮件起草 · Step 2/4 · 12s │
│   15:30 ▣ 工作流: 跑数据 (运行中) │     ✔ 招聘汇总 · 完成 · [打开]      │
│         ───────────────          │     ✗ 日报 · 失败 · [详情] [重跑]   │
│         step 3/5 ··· 取消        │                                     │
│                                  │  · 待办池 (今日未排) ▼              │
│  ── 今晚 (18:00–22:00) ──        │     □ 准备月度复盘材料 (3h est)     │
│   20:00 ◇ 日报汇总 [定时,每日]    │       [让 AI 帮我排] [手动放日历]   │
│         下次跑: 今晚 20:00       │     □ 给 X 的反馈 (30m est)         │
│         上次: 昨晚 ✓             │                                     │
│         [立即跑] [改时间] [跳过] │  · 偏好反馈 (上周拒了 5 次) → [看]  │
└──────────────────────────────────┴─────────────────────────────────────┘
                                                                           
快捷输入条 (固定底部, Cmd-K 唤起):                                        
┌────────────────────────────────────────────────────────────────────────┐
│  💬 派个活 / 设个定时 …  例:"每周一 9 点让员工 A 帮我汇总上周数据"      │
└────────────────────────────────────────────────────────────────────────┘
```

### 8 个第一性 UI 元素与代码挂载

| # | UI 元素 | 现有代码挂载 | 状态 |
|---|---|---|---|
| 1 | Catch-up Banner | 新组件 `<TodayCatchUpBanner>`，消费 `time.executionRuns` 过昨夜 + `time.scheduleJobs` failed | 新做 |
| 2 | 三段时间轴 | 改造 `TimeCenterPage` 现有 `TIMELINE_HOURS` 渲染逻辑，按 12/18 切三段 header | 重写部分 |
| 3 | Pending Approvals 区 | 消费现有 `approval` IPC + `silicon-person.approvalMode`；新组件 `<PendingApprovalsList>` | 新做 |
| 4 | 派出去的活 (Agent Inbox) | 消费 `time.executionRuns` 过 `state in {running, paused, awaiting-approval}` + 硅基员工 session.tasks | 新做 |
| 5 | Active Run 控制 | 嵌在派出去的活每行；调用现有 `silicon-person:cancel-message` / 新 `time:pause-run` | 新做 + 新 IPC |
| 6 | 待办池 + 让 AI 排 | 复用现有 `TaskCommitmentEditor` + `SuggestedTimebox` planner | 重组 |
| 7 | 快捷输入条 | 新组件 `<QuickScheduleComposer>`，Cmd-K 全局快捷键，调用新 `time:propose-schedule-from-text` IPC | 新做 |
| 8 | 偏好反馈入口 | 新组件 `<SchedulingPreferenceTrail>`，消费新增 `time.schedulingFeedback[]` | 新做 |

---

## 5. 五个核心交互故事板

每个故事必须在 1 屏内闭环，不跳页。

### 故事 1 — 早晨 9:03 打开桌面
1. 应用打开 → AppShell 默认路由跳 `/time`（**改默认入口，从 chat 改成 time**）。
2. 顶部 Banner 立刻出现："昨夜 3 完成、1 失败 "日报汇总"、2 等审批"。点 [查看] → 直接展开右侧 Pending Approvals 区，不跳页。
3. 时间轴上当前时刻有红线，09:30 站会卡片以"即将开始"样式高亮。
4. 站会卡片右上角有 prep 角标——hover 浮出"上次站会 action item 还有 2 项未完成 + AI 起草的 talking point"。

> 设计要点：banner 的 receipts 立刻可点开 = 不需要用户记忆"我去哪查失败原因"。

### 故事 2 — 自然语言派定时任务
1. 用户按 Cmd-K，底部 composer 聚焦。
2. 输入"每周一早上 9 点让员工 A 帮我汇总上周客户咨询数据"。
3. AI round-trip 出结构化预览卡片：
   ```
   我理解为：
   • 触发：每周一 09:00（你的时区 Asia/Shanghai）
   • 执行者：硅基员工"小客服 A"
   • 工作流：客户咨询周汇总（你之前创建过）
   • 预计耗时：约 8 分钟
   • 失败重试：1 次
   [先跑一次试看] [保存] [改]
   ```
4. 用户点 [先跑一次试看] → 立即触发一次 adhoc run，结果出现在右侧"派出去的活"区。
5. 试跑成功后 [保存] → 下次周一 09:00 自动跑，时间轴上午段出现一条循环条目。

> 设计要点：永远 round-trip 让用户确认结构化解析，**不做静默落库**。「先跑一次」是 ChatGPT Tasks 官方教训。

### 故事 3 — AI 提议把任务排到 14:00，用户拒绝
1. 待办池里有 "准备月度复盘材料 (3h est)"，用户点 [让 AI 帮我排]。
2. 时间轴下午段 13:00–16:00 出现虚线边框的建议块，附 confidence 84%。
3. 用户点 [拒绝] → 弹一行 reason chip：[这时段要专注] [这事不该今天做] [工具用错了] [时间不对]。
4. 用户选 [这事不该今天做] → 建议块消失、`time.schedulingFeedback` 落一条 `{reason: "wrong_day", taskId, proposedSlot}`。
5. 下次 AI 排程时，这条偏好作为上下文喂回 planner，避免再排同类时段。

> 设计要点：拒绝必须结构化。Reclaim 的口碑就在"告诉它它错了它会学"。

### 故事 4 — 接管运行中的硅基员工
1. 派出去的活区某条显示 "周报汇总 · Step 3/7 · 4 分钟"。
2. 用户点 [接管] → 弹模态：
   ```
   暂停硅基员工 A 当前会话？
   它现在在跑：步骤 3 "拉取上周 commit"
   暂停后你可以查看会话、修改它接下来要做的事，
   然后告诉它从哪一步继续。
   [暂停并打开会话] [取消]
   ```
3. 确认后 → 状态机切到 paused → 跳转该硅基员工 session 详情页。
4. 用户在 session 里手动调整后，点 [让员工继续] → 强制弹"告诉员工你做了什么"输入框（避免 agent 重复用户已经做过的步骤）。

> 设计要点：仿 Devin 的 Pause / Take-over 范式。**接管后必须有 user-to-agent 沟通入口**，否则 agent 不知道自己应该跳过哪些 step。

### 故事 5 — 凌晨任务失败，早上呈现
1. 02:00 定时任务"日报汇总"失败（工具调用超时）。
2. **不弹系统通知**（夜间打扰红线）。
3. main 进程 `time-scheduler` 把失败写入 `executionRun`，`lastResult.errorCode = "tool_timeout"`、`failureSummary = "MCP 工具 X 在第 5 步超时 30s"`。
4. 用户 09:03 打开应用 → Catch-up Banner 第一行 "1 失败 「日报汇总」"，时间轴今晚段 20:00 那条循环任务卡片左上角有红点 + "上次失败"标签。
5. 点卡片 → 展开 [查看错误日志] [立即重跑] [跳过下一次] [改时间] 四操作。

> 设计要点："pull-on-wake" 而不是 "push-as-it-happens"。失败必须 receipts 化但不打扰。

---

## 6. 数据模型变更（向已有 contract 增量）

### 6.1 `desktop/shared/contracts/time-orchestration.ts` 扩展 `ExecutionRun`
```typescript
type ExecutionRunTrigger =
  | { kind: "cron"; expression: string; jobId: string }
  | { kind: "once"; plannedAt: string }
  | { kind: "adhoc"; sourceMessageId: string }
  | { kind: "agent-proposed"; proposerId: string; confidence: number };

type ExecutionRunState =
  | "scheduled"        // 还没开跑
  | "running"          // 在跑
  | "paused"           // 用户接管
  | "awaiting-approval" // interrupt() 等用户拍板
  | "done"
  | "failed"
  | "skipped"          // 用户主动跳过
  | "cancelled";       // 用户中途取消

// 现有 ExecutionRun 上新增：
trigger: ExecutionRunTrigger;     // 替代现在零散的 sourceKind
state: ExecutionRunState;          // 扩展现在的二态
userDecision?: {
  acceptedAt?: string;
  rejectedAt?: string;
  rejectReason?: "wrong_day" | "wrong_time" | "tool_misused" | "task_unimportant" | "focus_block";
};
failureSummary?: string;          // 给 Catch-up banner 直接读
```

### 6.2 新增 `desktop/shared/contracts/scheduling-preference.ts`
```typescript
export type SchedulingFeedback = {
  id: string;
  taskId?: string;
  proposedSlot: { startsAt: string; endsAt: string };
  reason: "wrong_day" | "wrong_time" | "tool_misused" | "task_unimportant" | "focus_block";
  createdAt: string;
};

// 落到 workspace store: time.schedulingFeedback: SchedulingFeedback[]
// AI planner 在产生 SuggestedTimebox 前读最近 30 天的 feedback 作为上下文
```

### 6.3 新增 `time:propose-schedule-from-text` IPC
```typescript
// preload
proposeScheduleFromText(text: string): Promise<{
  parsed: {
    trigger: ExecutionRunTrigger;
    targetSiliconPersonId?: string;
    targetWorkflowId?: string;
    estimatedDurationMinutes: number;
    confidence: number;
  };
  ambiguities: string[];  // "我没找到员工 'A'，你是指 '小客服 A' 吗？"
}>
```

实现：main 进程调用当前选中的 model profile 跑一个 small prompt，schema-constrained 输出。

### 6.4 不动的字段
- `CalendarEvent` / `TaskCommitment` / `Reminder` 不动（已经够用）。
- `SiliconPerson.approvalMode` 不动（直接消费）。
- `cron.ts` 一个字符不改。

---

## 7. UI 组件清单

### 新做（11 个）
| 组件 | 路径 | 说明 |
|---|---|---|
| `<TodayCatchUpBanner>` | `components/time/TodayCatchUpBanner.tsx` | 顶部 receipts 条 |
| `<TodayThreeSegmentTimeline>` | `components/time/TodayThreeSegmentTimeline.tsx` | 上午/下午/今晚分段时间轴 |
| `<TimelineEventCard>` | 同上 | 区分"会议/AI 排程/已确认"三类样式 |
| `<TimelineSuggestionCard>` | 同上 | 虚线建议态卡片 |
| `<PendingApprovalsList>` | `components/time/PendingApprovalsList.tsx` | 一等公民审批列表 |
| `<AgentInboxPanel>` | `components/time/AgentInboxPanel.tsx` | "派出去的活"区，多过滤器 |
| `<ActiveRunControls>` | 同上 | 每行的 Pause/Take-over/Cancel/Retry |
| `<QuickScheduleComposer>` | `components/time/QuickScheduleComposer.tsx` | Cmd-K 自然语言入口 |
| `<ScheduleProposalCard>` | 同上 | round-trip 结构化预览 |
| `<SchedulingPreferenceTrail>` | `components/time/SchedulingPreferenceTrail.tsx` | 偏好反馈入口 |
| `<MeetingPrepPopover>` | `components/time/MeetingPrepPopover.tsx` | 会议卡 hover 出 prep |

### 重写
- `pages/TimeCenterPage.tsx` — 砍掉现在 today/automation 双 Tab，单页布局；buildAgendaEntries / buildPendingAttentionEntries / buildTeamExecutionEntries 多个聚合函数合并成一次 `buildTodayView(workspace.time)` 顶层组合。

### 删
- `automation` Tab 整个删除，定时任务并入"派出去的活"区呈现。
- `TimeAssistantCapsule` 评估后决定：如果它的"常驻摘要胶囊"功能被新 Banner 替代，则删；否则保留作 minimized 形态。

---

## 8. 与硅基员工的耦合点

1. **每个员工的当前 session 在 Today 上的呈现**：派出去的活区里，每条 ExecutionRun 都标员工头像 + 名字 + 当前 step。
2. **派出去的任务的 step 进度回投**：复用现有 `silicon-person-workflow.ts` 的 `applyWorkflowEventToSessionTasks`，在 main 进程同步把进度写到 `executionRun.progress = { current, total, currentStepLabel }`。
3. **approvalMode 决定建议态默认行为**：
   - `auto_approve` 员工 → AI 提议的时间块**直接落库**，UI 仍显示"AI 排"标记，给 [改] 不给 [拒]。
   - `always_ask` 员工 → 提议进 Pending Approvals 区，需要用户接受才落库。
   - `inherit` → 继承全局策略。
4. **session take-over 跳转规则**：从 ActiveRunControls 点 [接管] → `router.push('/silicon-persons/' + ownerId + '?session=' + currentSessionId)`，**不**新开 Tab，**不**离开 desktop 主壳。

---

## 9. 与现有 cron / scheduler 的耦合

1. **不改 `cron.ts`**——能力已足。
2. **`time-scheduler.ts` 补三件事**：
   - 失败补跑：`maxRetries` 从 0 改可配置，默认 1。重试间隔指数回退。
   - 触发幂等：执行前检查 `executionRun.plannedRunAt + jobId` 唯一键，防止应用重启后重复触发。
   - 状态写回：跑完后 `state` 写 `done`/`failed`，不只是写日志。
3. **新 IPC**：
   - `time:pause-run(runId)` — 设置 state=paused，main 不再 fire 后续 step。
   - `time:resume-run(runId, userMessage?)` — 用户接管后恢复，可附带"我做了什么"消息塞进 session。
   - `time:skip-next(jobId)` — 跳过下一次，写入 `job.skippedRuns[]`。
   - `time:propose-schedule-from-text(text)` — 见 §6.3。

---

## 10. 里程碑切片（4 周内可见进展，每周一个里程碑）

### M1（Week 1）— Today 主面骨架
- 拆掉 `automation` Tab，单页布局。
- `<TodayCatchUpBanner>` + `<TodayThreeSegmentTimeline>` 上线，消费现有 `time.*` 数据，不引入新模型。
- 默认路由从 chat 改 time。
- **可见效果**：用户打开桌面就看到今日时间轴。

### M2（Week 2）— Agent Inbox + Active Run 控制
- 扩展 `ExecutionRun.state` 六态、新增 pause/resume/skip IPC。
- `<AgentInboxPanel>` + `<ActiveRunControls>` 上线。
- "派出去的活"区把现有 ScheduleJob、ExecutionRun、运行中 session 三种来源统一渲染。
- **可见效果**：用户能看见所有 AI 在跑什么、能接管。

### M3（Week 3）— 自然语言派任务 + Pending Approvals
- `time:propose-schedule-from-text` IPC + `<QuickScheduleComposer>` + `<ScheduleProposalCard>`。
- `<PendingApprovalsList>` 一等公民区。
- **可见效果**：用户用一句话就能设定时任务，审批不再藏在弹窗。

### M4（Week 4）— AI 排程的接受/拒绝循环 + 失败 receipts
- 新增 `SchedulingFeedback` 数据流，AI planner 消费近 30 天 feedback。
- 失败补跑、Catch-up banner 失败定位。
- `<MeetingPrepPopover>`。
- **可见效果**：AI 越用越准，失败不再静默。

---

## 11. 不做的事（Out of scope）

- **云日历双向同步**（Outlook/Google Calendar）—— 等 MCP 工具就绪后单独立项。本期日历来源仅 manual + meeting + agent + workflow。
- **月视图 / 周视图**—— Today 收口，多日视图本期不做。
- **多人共享日历 / 排会**—— 个人助手定位，团队功能不在范围。
- **手机端**—— Electron 桌面优先。

---

## 12. 验收标准（goal-backward）

5 条用户路径必须在 1 屏内、不跳页地闭环：

1. **早晨打开** — 3 秒内能看到昨夜 receipts + 今日时间轴 + 待我审批数。
2. **自然语言派定时** — 30 秒内完成"我说一句话 → AI round-trip 确认 → 试跑一次 → 保存"。
3. **AI 排程被拒并喂回偏好** — 拒绝按钮 → reason chip → 落库 → 下次 planner 读到，全程不离开 Today。
4. **接管运行中** — 从 Today 点 [接管] → 跳转 session → 沟通 → 让 agent 继续，user message 必须传进 agent 上下文。
5. **凌晨失败回放** — 凌晨失败不弹通知，早上 banner 第一眼看到失败条目，一键重跑或改时间。

每条路径的 Definition of Done 写到对应里程碑的 phase plan（M1–M4）里。

---

## 附录 A — 行业对标速记（不展开，留底用）

- **Sunsama** — timebox 拖拽是 Today 唯一时间承诺动作；强制双仪式不抄。
- **Motion** — 颜色编码"AI 排 vs 自己排"抄；AI 全自主重排无 diff 视图不抄。
- **Reclaim.ai** — "柔性时间块 + 没做完滚到明天"抄；寄生在 Google Cal 不做独立 Today 不抄。
- **Notion Calendar** — Cmd-K command palette 抄；多日历 overlay 信息密度太低不抄。
- **Things 3** — Evening 三段分区抄；完全不画时间不抄。
- **ChatGPT Tasks** — 自然语言 round-trip 抄；scheduled task 藏在菜单不可见不抄。
- **Microsoft Copilot for Outlook** — Catch-up 模式抄；"建议先做 X"主观排序不抄。
- **Devin / Lindy / LangGraph** — Pause / Take-over 抄；interrupt() 四态决策抄；agent 失败静默不抄。

## 附录 B — 现行代码不改清单

| 文件 | 不改原因 |
|---|---|
| `desktop/shared/time/cron.ts` | 企业级，分钟粒度 + 时区 + DST 安全 |
| `desktop/src/main/ipc/silicon-persons.ts` | 消息队列模型已是正确抽象 |
| `desktop/src/main/services/silicon-person-workflow.ts` | workflow → task 投影桥已建好 |
| `desktop/shared/contracts/calendar.ts` | source / ownerScope 字段已够用 |
| `desktop/shared/contracts/silicon-person.ts` | approvalMode / workflowIds 已足 |

—— 完 ——

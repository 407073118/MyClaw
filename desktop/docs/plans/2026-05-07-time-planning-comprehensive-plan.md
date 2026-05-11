# 时间规划完全完善方案

> 日期：2026-05-07
> 范围：桌面端 `时间规划` 模块（原 `时间中心`）
> 立场：从"功能合集"升级为"个人企业助手的时间总控台"
> 上一版基础：`desktop/docs/plans/2026-04-21-time-planning-today-design.md`

---

## 0. 写在前面

这次不是再补几个组件，而是回答一个更根的问题：

**当一个企业员工每天早上打开 MyClaw 桌面端，第一眼看到什么，他才会觉得"这是我的助手"？**

行业里这件事已经反复回答过：Sunsama 是早晨仪式 + 傍晚 shutdown，Motion 是 "top priority each hour"，TickTick 是 Suggested Tasks，Reclaim 是 auto-locking habits，Microsoft Copilot Cowork 是 "60 秒早会"，Things 3 是 Today / This Evening 二段式，Fellow / Granola 是 "会议结束 → action items"，Anthropic 自己的 Claude Code 已经有 `/loop` cron。

我们的差异点是：**我们有"硅基员工"——一个真正会在用户睡觉时跑工作的 AI 个体**。所以"今日时间规划"不是日历和待办的合体，而是一个"个人 + 硅基员工团队"的指挥面板。

---

## 1. 行业对标抽出来的 9 条模式

| # | 来源 | 模式 | 是否采纳 | 落到 MyClaw |
|---|------|------|----------|-------------|
| 1 | Sunsama | 早晨规划仪式 + 傍晚 shutdown | 采纳 | 见 §5.1 |
| 2 | Motion | AI 自动调度任务到日历，每天 re-optimize 数百次 | 部分采纳 | 仅做"建议"，不做强制；见 §5.2 |
| 3 | Motion | "Top priority each hour" 每小时只指一件事 | 采纳 | Today 顶部 hero 卡片；见 §4.1 |
| 4 | Motion | Due date vs Do date 区分 | 采纳 | TaskCommitment 增加 `doAt`；见 §7.3 |
| 5 | Reclaim | Habits（重复事项 + 健康度跟踪） | 采纳 | 与现有 ScheduleJob.cron 合并语义；见 §5.5 |
| 6 | Reclaim | Two-phase locking（free → busy）| 采纳 | SuggestedTimebox 增加 `lockState`；见 §7.3 |
| 7 | Akiflow | Inbox 与 Schedule 分离 | 采纳 | 未排期任务池 = Inbox；见 §4.5 |
| 8 | Akiflow | Command bar + 自然语言创建 | 采纳 | "明天下午开会" 一键创建；见 §5.4 |
| 9 | Things 3 | Today / This Evening 二段式 | 采纳 | 我的日程内分白天/晚上；见 §4.4 |
| 10 | TickTick | Suggested Tasks（AI 推荐今天聚焦什么）| 采纳 | 见 §5.2 |
| 11 | Fellow / Granola | 会议结束自动产出 action items | 采纳 | 见 §5.3 |
| 12 | Notion Calendar | Two-way sync（任何"带日期的数据"自动出现在日历）| 采纳 | 工作流产出 / 会议产出 / 邮件追踪都自动落 calendar；见 §6.3 |
| 13 | Microsoft Copilot Cowork | "60 秒早会" Daily Briefing skill | 采纳 | TodayBrief 接入模型；见 §5.1 |
| 14 | Anthropic /loop | 自然语言 → cron 表达式生成 | 采纳 | ScheduleJobEditor 加自然语言入口；见 §5.4 |
| 15 | Linear My Issues | "我被分配的所有 issue" 单一收件视图 | 采纳 | "待我处理" 即此意；见 §4.2 |

不采纳的（怕走错）：

- Motion 那种"全自动重排日历"——企业员工不接受 AI 把已经定好的会议挪走，只做"建议"。
- Granola 那种 always-on 录音——隐私在企业里不可控，必须用户主动开启。

---

## 2. 现状盘点（事实，不是推测）

### 2.1 已有契约（齐全）

`desktop/shared/contracts/` 下：

- `calendar.ts` — `CalendarEvent` / `TaskCommitment`，已带 `ownerScope`（personal / silicon_person）
- `time-orchestration.ts` — `Reminder` / `ScheduleJob` / `ExecutionRun` / `AvailabilityPolicy` / `TodayBrief`
- `time-planning.ts` — `SuggestedTimebox` / `PlanTimeboxesInput`
- `silicon-person.ts` — 已有 `soul` / `sessions` / `workflowIds` / `approvalMode` / `modelProfileId`
- `meeting.ts` — `MeetingRecord`（audio + transcript + summary 三件套，speaker labels）

### 2.2 已有服务

`desktop/src/main/services/`：

- `time-scheduler.ts` — 5 段 cron 解析 + 分钟粒度巡检触发
- `time-job-executor.ts` — 三种 executor：`workflow` ✅ / `silicon_person` ✅ / `assistant_prompt` ❌（第 62-66 行明确"当前以空操作完成"）
- `time-application-service.ts` — 业务层 + `buildTodayBriefItems`（**当前是规则模板，不是模型**）
- `time-orchestration-store.ts` / `time-orchestration-database.ts` — 持久化
- `time-notification-service.ts` — 桌面通知
- `timebox-planner.ts` — 规则版建议时间块
- `silicon-person-workspace.ts` / `silicon-person-runtime-store.ts` — 硅基员工管理
- `workflow-engine/` — 工作流引擎

### 2.3 已有 IPC

`desktop/src/main/ipc/`：`time-orchestration.ts` / `silicon-persons.ts` / `meetings.ts` / `workflows.ts`。preload `window.myClawAPI.time.*` 完整 CRUD：calendarEvents / taskCommitments / reminders / scheduleJobs / availabilityPolicy / todayBrief / suggestTimeboxes。

### 2.4 已有页面

- `TimeCenterPage.tsx`：已经有 today / automation 两 tab；已有 `buildAgendaEntries` / `buildPendingAttentionEntries` / `buildTeamExecutionEntries` / `buildTodaySnapshot` / `buildDailyControlFeed` / `buildTodayDigest` 计算函数；已有 `pendingSourceKeys` 跨模块去重；已有"五块布局"的逻辑骨架。
- `MeetingsPage.tsx`：录音 + 转写 + 纪要 + speaker 分离齐全。
- `SiliconPersonWorkspacePage.tsx`：硅基员工工作空间已存在。

### 2.5 缺口（按优先级）

P0（这次必做）：

1. **TodayBrief 接入模型** — 现在是字符串模板（`Reminder at xxx`），不是设计文档要求的"3-4 句行动判断"。
2. **`assistant_prompt` executor 落地** — 让"早 9 点让助手帮我看一下今天日报"这种最常见诉求能跑。
3. **会议 → action items 通道** — `MeetingRecord` 有 `summaryArtifactId`，但**没有把 summary 中的 "@张三 周三前提交方案" 转成 `TaskCommitment` 的链路**。
4. **页面/路由/标题统一为"时间规划"** — 文件名 `TimeCenterPage` 暂不重命名（避免 git 历史断），但路由 path、AppShell 菜单文案、`<title>`、面包屑里所有"时间中心" → "时间规划"。
5. **Top Priority Hero 卡** — Today 顶部增加"现在 / 接下来 1 小时最重要的一件事"。

P1（紧接着做）：

6. **每日仪式：Morning Plan + Evening Shutdown** — Sunsama 模式。
7. **AI 推荐今日聚焦（Suggested Tasks）** — 综合截止时间、改期次数、关联会议、硅基员工进度推荐 3-5 条。
8. **自然语言创建（命令栏）** — "明天下午 2 点和销售部开会 30 分钟" → 一键创 CalendarEvent。
9. **建议时间块的二阶段锁定** — `SuggestedTimebox.lockState`：suggested → user_confirmed → confirmed_locked。

P2（再往后）：

10. **重复事项 Habits 健康度** — "本周已完成 2/3 次锻炼"。
11. **未排期任务池（Inbox）独立** — 与时间轴隔离，按 source 分组（手动 / 会议 / 工作流 / 邮件 / 硅基员工）。
12. **周视图 / 月视图** — TimeCenterPage 当前 `viewMode = "day"` 写死。
13. **失败 ExecutionRun 自动归集到"待我处理"** — 已有数据，未做联动。
14. **跨硅基员工容量看板** — 团队周视图。

P3（远期）：

15. **企业内部系统接入** — OA / 邮件 / IM / 会议系统的 calendar 双向同步（Notion Calendar two-way sync 模式）。
16. **跨设备 / Today widget** — 系统级通知中心、桌面小组件。

---

## 3. 产品骨架：一天的三段心智

不要再用"时间数据库"的方式组织页面。一天分三个心智阶段：

```
┌────────────────────────────────────────────────────────────────┐
│   早晨（08:30-09:30）        全天（工作时段）          傍晚（18:00 后）  │
│   Plan                       Run                       Review            │
│   ─────                      ─────                     ──────            │
│   Morning Briefing           Top Priority 卡片          Shutdown 仪式      │
│   规划仪式（拖任务到日历）    待我处理流转回路           今日完成 / 未完  │
│   AI 推荐今日聚焦             团队执行动态推送           迁到明天          │
│   今日重点 3 件事             命令栏自然语言新建         重复事项打卡      │
└────────────────────────────────────────────────────────────────┘
```

页面结构上这三段是 **同一个 Today 视图** 在不同时间点的不同侧重，不是三个独立页面。系统按时段（结合 `availabilityPolicy.workingHours`）自动给出当下最相关的行动建议（hero 卡片切换提示词："早上好，先看一下今天的安排" → "下面 1 小时最重要的事" → "今天差不多了，要不要做个收尾"）。

---

## 4. Today 页五大模块的具体方案

继承 2026-04-21 的五块布局，但每块都重新定义内容。

### 4.1 顶部：今日总控带（Today Header）

**新形态（这是这次最显眼的改动）：**

```
┌─────────────────────────────────────────────────────────┐
│ 时间规划                                                │
│ ─────────                                               │
│ ▎ 早上好，张三                                          │
│ ▎ 现在最重要的一件事 →   客户方案确认（待你拍板）       │
│ ▎                          预计 25 分钟·上次推迟 2 次    │
│ ▎  [立刻开始]   [推到下午]   [让助手先起草]             │
│                                                         │
│ 待处理 3 · 团队节点 5 · 时间块建议 2 · 完成度 0/8        │
└─────────────────────────────────────────────────────────┘
```

要点：
- **唯一一件事**（Motion 的 top priority each hour）。不是把所有 pending 排成 list，而是**算法选 1 件**给出。
- 卡片三件套行动：开始 / 推迟 / 委托给硅基员工——后者直接调起 silicon_person 接管入口。
- 卡片下方一行 metric 给数据全貌（不在 hero 里展开）。

**算法**（在 `time-application-service.ts` 加 `selectTopPriority()`）：

输入：`pendingAttentionEntries` + `myDayEntries` + `executionRuns`
排序优先级：
1. 失败的 ExecutionRun（自动任务卡了 → 必须人介入）
2. 1 小时内开始的 CalendarEvent（开会必须上）
3. 今天逾期的高优 TaskCommitment
4. 硅基员工 needs_approval 状态的 session
5. 距 dueAt 最近且 priority>=high 的 TaskCommitment

### 4.2 待我处理（Pending Inbox）

继承 2026-04-21 的"只收三类"，但**每条增加"为什么需要你 + 一键操作"**：

```
┌─ 待我处理 ───────────────────────────────────────────────┐
│ 客户方案确认                              [拍板]  [起草] │
│   待拍板·张三 提交了 v3，等你确认                         │
│   ↪ 由 张三（硅基员工）发起 · 1 小时前                    │
│                                                          │
│ 周报数据校对失败                          [查看]  [重试] │
│   自动任务失败·9:00 触发，模型超时                       │
│   ↪ 触发自 "周一周报-cron" · 半小时前                    │
│                                                          │
│ 张三审批申请                              [批准]  [驳回] │
│   团队等你确认·张三申请访问财务系统                       │
└──────────────────────────────────────────────────────────┘
```

要点：

- **行动按钮直接出现在条目上**，不要"点进去看再操作"。"拍板"= silicon_person 工作流回到用户决策节点；"重试"= 重新触发 ExecutionRun；"批准"= approval IPC。
- 每条带"为什么"和"由谁触发"——这是用户判断要不要现在做的依据。
- 数据来源在 §6 里详细列。

### 4.3 团队执行动态（Silicon Person Activity Stream）

把硅基员工的活动织成一条**事件流**而不是数据列表：

```
┌─ 团队执行动态 ──────────────────────────────────────────┐
│ 09:15  张三 完成了 "客户方案 v3 起草"                    │
│        ↳ 产出已附在"待我处理-客户方案确认"               │
│ 10:30  李四 即将开始 "周报数据采集" (cron)              │
│        ↳ 预计 15 分钟，完成后会回写到日历                │
│ 14:00  王五 等待你的资料补充                            │
│        ↳ 已在"待我处理"列出                              │
│ 18:00  张三 计划下班前提交"周度小结"                    │
└─────────────────────────────────────────────────────────┘
```

要点：

- **完成 / 即将开始 / 等你 / 计划** 四种事件类型，每种一个动词。
- 时间排序，不是按员工分组（员工分组在硅基员工工作空间页，不在 Today）。
- 与"待我处理"互斥（用 `pendingSourceKeys` 已有机制扩展）：如果某条已经在 pending 里，这里只显示一行链接"已在待我处理"。

### 4.4 我的日程（Today Timeline）

时间轴主体，但有 **Things 3 式的二段**：

```
┌─ 我的日程 ──────────────  日 / 周 / 月  ─ ◀ 今天 ▶ ──┐
│                                                       │
│ 白天 (07:00 – 18:00)                                  │
│   09:00 ─ 10:00  晨会                                 │
│   10:00 ─ 11:00  深度工作（建议时间块·灰色虚线）      │
│   11:00 ─ 11:30  客户电话                             │
│   14:00 ─ 14:30  审 张三 提交的方案 ⓘ ← 来自硅基员工  │
│   ───── 现在 15:42 ─────                             │
│   16:00 ─ 17:00  周报评审                             │
│                                                       │
│ 晚上 (18:00 – 23:00)  ▾ 折叠                         │
│   20:00 ─ 21:00  英语学习（Habit·本周 2/3）            │
│                                                       │
└──────────────────────────────────────────────────────┘
```

要点：

- **白天 / 晚上 折叠分段**（Things 3 模式）——晚上默认折叠，避免视觉压力。
- **建议时间块**用灰色虚线 + "确认"小按钮（Reclaim 二阶段锁定）。
- **来自硅基员工的事项**用 ⓘ 角标标识，避免和用户自己的事项混。
- **当前时间线**用细横线 + "现在 HH:MM"标签。
- 日 / 周 / 月切换：周视图按 §8 P2 阶段做（这次先把切换器禁用变占位文案"周视图开发中"）。

### 4.5 右侧辅助区（Sidebar Stack）

四块从上到下：

1. **命令栏（Command Bar）** — 一直可见的输入框。
   - 自然语言："明天 14:00 和销售开会 30 分钟" → 一键创 CalendarEvent。
   - 自然语言："每周一 9:00 让张三跑周报采集" → 一键创 ScheduleJob (cron + executor=silicon_person)。
   - 模型把自然语言映射到结构化 input 后**预览，再让用户一键确认**（不直接创建，避免误解析）。
2. **未排期任务池（Inbox）** — Akiflow 模型。按 source 分组：
   - 来自会议（含会议链接）
   - 来自工作流产出
   - 来自邮件追踪
   - 自己手动创建
   - 拖到时间轴 = 排期。
3. **迷你月历** — 切日期；圆点密度反映"那天有多少事"。
4. **快速创建** — 兜底入口（事件 / 任务 / 提醒 / 自动任务），保留传统表单。

---

## 5. 关键工作流方案

### 5.1 早晨规划仪式 + 傍晚 Shutdown

**触发条件**：进入 MyClaw 时，**首次落在 `availabilityPolicy.workingHours` 起点 ±30 分钟**——弹出 Morning Plan 浮窗（不是单独页面，是 Today 页上的 modal-like overlay）。

Morning Plan 步骤：

1. **AI 摘要昨天**："昨天完成 5/8，剩 3 件迁到今天"
2. **导入未排期任务**：从 Inbox 一键拖到时间轴
3. **检查硅基员工今日计划**：他们今天会做什么、哪几件可能回来找你
4. **拖时间块**：为深度工作预留 1-2 块整时段
5. **确认今日 3 件重点**：Top Priority 候选

**触发条件**：进入 MyClaw 时，**落在 `availabilityPolicy.workingHours` 终点 ±30 分钟 且未做 Shutdown**——浮窗：

Evening Shutdown：

1. **AI 总结今日**：完成 / 未完成数量、最大成就、最大阻塞
2. **未完成事项处置**：迁明天 / 排到下周 / 取消（每条都要一次确认，避免无声漂移）
3. **重复事项打卡**：本周 Habits 进度
4. **明天预告**：硅基员工明天会做什么、有没有需要你提前准备的资料
5. **完成 Shutdown**：今天的 ritual 完结。

**契约扩展**（详见 §7.3）：新增 `DailyRitual` 记录 `{ dateKey, planAt, planSummary, shutdownAt, shutdownSummary }`。Shutdown 后这一天进入"已封存"，不再弹规划浮窗。

### 5.2 AI 推荐今日聚焦（Suggested Tasks + Top Priority Hero）

两层模型推断：

**A. 今日候选池（Suggested Tasks）**

输入：所有 `pending`/`scheduled` 状态的 TaskCommitment + 今日 CalendarEvent + 今日 cron-due ScheduleJob + 失败 ExecutionRun。
推断：模型按"重要度"打分，给出 3-5 条建议进入今日。
输出形态：在 Inbox 顶部"今天建议聚焦这些"，每条带"为什么推荐"。

**B. Top Priority Hero（每小时）**

每 30 分钟（或事件触发：完成一条任务、新事件进入）重算。模型只看"未来 2 小时"的窗口给出 1 条建议。

**模型契约**（新文件 `desktop/shared/contracts/today-priority.ts`）：

```ts
export type TodayPriorityCandidate = {
  sourceKey: string;
  title: string;
  reason: string;       // 模型给的"为什么是它"
  confidence: number;   // 0-1
  suggestedActions: Array<"start_now" | "delegate_to_agent" | "defer_to_evening" | "split">;
};
```

**失败兜底**：模型不可用时回退到规则版（§4.1 算法），UI 上不让用户察觉。

### 5.3 会议 → Action Items 通道

**这是最大空白，需要新代码。**

会议状态机已有 `summarizing` → `done`。新增"提取动作"步骤：

```
recording → transcribing → summarizing → extracting_actions → done
```

`extracting_actions` 阶段调用模型，输入 `StructuredTranscript` + `summary`，输出：

```ts
// desktop/shared/contracts/meeting.ts 增加：
export type MeetingActionItem = {
  id: string;
  meetingId: string;
  title: string;        // "提交客户方案 v4"
  ownerLabel?: string;  // "张三"（来自 speakerLabels），可能是用户也可能是同事/硅基员工
  ownerScope?: TimeOwnerScope; // 自动绑：能匹配到硅基员工就 silicon_person，否则 personal
  ownerId?: string;
  dueAt?: string;       // "周三前" 转 ISO
  source: "meeting";
  sourceQuoteOffset?: { startMs: number; endMs: number }; // 可点回原音频
  status: "draft" | "accepted" | "rejected"; // 默认 draft，需用户确认
};
```

**UI 流程**：
1. 会议结束后 1-2 分钟，MeetingsPage 顶部弹横幅 "AI 提取了 5 条 action items"。
2. 点开 → 浮层列出每条，附原话引用，可点跳回音频片段（用 `sourceQuoteOffset`）。
3. 用户勾选要变成 task_commitment 的条目，一键全部转换。
4. 转换后：
   - `ownerScope=personal` 的 → 落 `TaskCommitment(source=meeting)`，自动出现在 Inbox。
   - `ownerScope=silicon_person` 的 → 同上 + **自动派发消息给那个硅基员工**（"在客户会议中你被指派做 X，你看一下"）。

**端到端责任**：
- 新服务 `desktop/src/main/services/meeting-action-extractor.ts`：调模型抽 action items。
- `meetings.ts` IPC 增加 `extractActionItems(meetingId)` 和 `acceptActionItem(meetingId, itemId, overrides)`。
- preload 暴露 `window.myClawAPI.meetings.extractActionItems` / `acceptActionItem`。

### 5.4 自然语言 → 结构化（Command Bar）

参考 Akiflow 的 Command Bar + Anthropic /loop 的"自然语言转 cron"。

**单一入口**，三类意图：

| 模式词 | 动作 |
|--------|------|
| "明天/今晚/下周三 + 时间 + 主题" | 创 CalendarEvent |
| "提醒我 + 时间 + 内容" | 创 Reminder |
| "每天/每周 + 让 + 谁 + 做什么" | 创 ScheduleJob (cron + executor) |
| "@xxx + 动作 + 时间" | 创 TaskCommitment + 自动派发 |

**后端服务** `desktop/src/main/services/nlp-time-parser.ts`：

```ts
export type NlpTimeParseResult =
  | { kind: "calendar_event"; payload: CalendarEventUpsertInput }
  | { kind: "reminder"; payload: ReminderUpsertInput }
  | { kind: "schedule_job"; payload: ScheduleJobUpsertInput }
  | { kind: "task_commitment"; payload: TaskCommitmentUpsertInput }
  | { kind: "ambiguous"; candidates: NlpTimeParseResult[] };
```

**预览-确认** UI 模式（不直接创建）：

```
[输入]      每周一 9 点让张三跑周报采集
   ↓
[预览]      ScheduleJob
            cron: 0 9 * * 1
            executor: silicon_person
            target: 张三
            内容: 跑周报采集
   ↓
[确认创建]  [改一下]  [取消]
```

### 5.5 Habits（重复事项 + 健康度）

现有 `ScheduleJob.scheduleKind = "cron"` 已经支持 cron 触发。但是缺少"健康度"概念——用户不关心 cron 跑了几次，关心"我这周该做的事做了几次"。

**契约扩展**（`time-orchestration.ts` 加）：

```ts
export type HabitFrequency = {
  per: "day" | "week" | "month";
  count: number;     // 每周 3 次
  windowDays?: number; // 滑窗，默认按 per
};

// 在 ScheduleJob 上加可选字段（不破坏向后兼容）：
export type ScheduleJob = { ... existing fields ...
  habit?: {
    frequency: HabitFrequency;
    flexible: boolean;  // 可弹性挪到当周其他时间
    completedThisCycle: number; // 本周期已完成次数（运行时计算）
  };
};
```

**UI**：
- "我的日程"上的 Habit 块右上角显示 "本周 2/3"。
- "团队执行动态"上硅基员工的 Habit 也显示进度（"张三本周日报 3/5"）。
- Habit 缺勤连续超过 1 周自动进入"待我处理"——"是不是要调整频率？"

### 5.6 团队容量健康度（Phase 2 落地点）

设计文档 Phase 2 提到"团队周负载"。这次方案在数据层做好准备，UI 留到下阶段：

- `time-application-service.ts` 加 `computeTeamLoad(weekKey)`：聚合所有 `ownerScope=silicon_person` 的事项，计算每个员工本周的"占用时间 / 可用时间"。
- 周视图实现时直接调用该方法即可。

---

## 6. 与硅基员工的深度联动（这次的差异化重点）

### 6.1 硅基员工自我安排（Self-scheduling）

**目标**：让硅基员工能在自己的工作空间内创建 `ownerScope=silicon_person` 的 CalendarEvent / TaskCommitment / ScheduleJob，且这些事项自动出现在用户的"团队执行动态"。

**工具暴露**：在 `desktop/src/main/services/tool-schemas.ts` 中已有时间相关 tool（grep `ownerScope.*silicon` 命中），需要补：
- `time.createSiliconScheduleJob` — 员工给自己排 cron。
- `time.createSiliconTaskCommitment` — 员工给自己定 deliverable。
- `time.proposeUserCommitment` — 员工**建议**用户在某时段做某事（落 SuggestedTimebox + reason="silicon_person_proposed"）。

**约束**：员工不能直接修改 `ownerScope=personal` 的事项——避免"AI 偷偷把你的会议改了"。员工的"建议"必须用户确认才落地。

### 6.2 用户拍板回路（Pending → Silicon Person Inbox）

**场景**：硅基员工跑到一半需要拍板（"客户方案两个版本，你选哪个？"）。

链路：
1. 员工 session 进入 `needs_approval` 状态（`SiliconPerson.needsApproval = true`）。
2. `time-application-service` 把所有 `needsApproval` 的硅基员工 session 加到 `pendingAttentionEntries`，sourceKey=`silicon_session:<id>`。
3. Today 页"待我处理"列出，行动按钮：
   - **拍板** → 展开浮层，看员工提出的选项，选一个 → 调 silicon_person.respondToApproval。
   - **让员工自己决定** → 切 `approvalMode=auto_approve`（仅本次）。
   - **稍后** → 推迟（员工继续等）。

### 6.3 团队节点反馈（ExecutionRun → TodayBrief）

**场景**：硅基员工 cron 跑完，结果应该回到 Today。

链路：
1. `time-job-executor.execute` 跑完后写 ExecutionRun（已有）。
2. **新增**：成功的 run 中如果 outputSummary 里包含**新事项**（模型识别的 "@user 请确认...）"），自动创 task_commitment。
3. 失败的 run 自动加 sourceKey=`run:<id>` 到 pendingAttentionEntries（**已有 status=failed 数据，缺联动**）。
4. TodayBrief 摘要把"今天 5 个 cron 跑了 4 个，1 个失败"作为单独一句。

---

## 7. 架构变更与契约增量

### 7.1 新增 IPC

`desktop/src/main/ipc/time-orchestration.ts` 增加：

| 通道 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `time:select-top-priority` | `{ now }` | `{ priority: TodayPriorityCandidate }` | Hero 卡 |
| `time:get-suggested-focus` | `{ dateKey }` | `{ candidates: TodayPriorityCandidate[] }` | Inbox 顶部建议 |
| `time:morning-plan-overview` | `{ dateKey }` | `{ summary, unscheduledItems, siliconPlans }` | 早晨仪式数据 |
| `time:evening-shutdown-overview` | `{ dateKey }` | `{ completed, deferred, blocked, habits }` | 傍晚仪式数据 |
| `time:save-daily-ritual` | `DailyRitual` | `{ ok }` | 完成仪式 |
| `time:parse-natural-language` | `{ input, now }` | `NlpTimeParseResult` | 命令栏 |
| `time:compute-habit-progress` | `{ dateKey }` | `{ habits: HabitProgress[] }` | Habits |

`desktop/src/main/ipc/meetings.ts` 增加：

- `meetings:extract-action-items` / `meetings:accept-action-item`

### 7.2 新增 Service

| 服务 | 文件 | 职责 |
|------|------|------|
| `today-priority-engine.ts` | services | 算 Top Priority + Suggested Focus |
| `daily-ritual-store.ts` | services | 仪式记录持久化 |
| `nlp-time-parser.ts` | services | 自然语言 → 结构化 |
| `meeting-action-extractor.ts` | services | 会议提取 action items |
| `habit-progress-tracker.ts` | services | Habit 完成率统计 |
| `today-brief-model-generator.ts` | services | 替换当前规则版 brief 生成 |

`time-job-executor.ts` 改造：

- 第 62-66 行的 `assistant_prompt` 改成调用 `silicon-person-runtime` 创一个临时会话执行 prompt（默认硅基员工 = 用户的"通用助手"）。

### 7.3 契约增量

新增 `desktop/shared/contracts/today-priority.ts`（§5.2 已列）。

新增 `desktop/shared/contracts/daily-ritual.ts`：

```ts
export type DailyRitualStage = "morning_plan" | "evening_shutdown";

export type DailyRitual = {
  dateKey: string;       // YYYY-MM-DD（按用户时区）
  timezone: string;
  morningPlan?: {
    completedAt: string;
    topPriorityIds: string[];
    summary: string;     // 模型生成或用户写的
  };
  eveningShutdown?: {
    completedAt: string;
    completedCount: number;
    deferredCount: number;
    blockedCount: number;
    summary: string;
  };
};
```

扩展 `desktop/shared/contracts/calendar.ts` 的 `TaskCommitment`（向后兼容）：

```ts
export type TaskCommitment = { ... existing fields ...
  doAt?: string;         // Motion: do date（实际计划做的日期，区别于 dueAt 截止）
  sourceMeetingId?: string; // 来自会议时反向追踪
  sourceQuoteOffset?: { startMs: number; endMs: number }; // 引用片段
};
```

扩展 `desktop/shared/contracts/time-planning.ts` 的 `SuggestedTimebox`：

```ts
export type SuggestedTimebox = { ... existing fields ...
  lockState?: "suggested" | "user_confirmed" | "confirmed_locked";
  origin?: "rule" | "model" | "silicon_person_proposed";
  reason?: string;
};
```

扩展 `desktop/shared/contracts/meeting.ts`（§5.3 已列 `MeetingActionItem`）。

---

## 8. 阶段拆分

### Phase 1（4-6 周·这一阶段）

P0 全部 + Top Priority Hero + 仪式入口（先用规则，模型可后接）。

具体：
1. 路由/菜单/标题统一为"时间规划"
2. `today-brief-model-generator` 服务接入模型，规则兜底
3. `assistant_prompt` executor 落地（调通用硅基员工）
4. `meeting-action-extractor` + UI 横幅
5. Top Priority Hero（先规则版）
6. ExecutionRun 失败自动归集到"待我处理"

**验收**：用户早上打开第一眼看到 hero 卡（一件事 + 三按钮）；会议结束自动弹"5 条 action items"；周报 cron 失败时 Today 自动列。

### Phase 2（4-6 周）

P1 全部。

1. Morning Plan / Evening Shutdown 浮窗 + 持久化
2. AI Suggested Focus
3. 命令栏自然语言创建（4 类意图全开）
4. 建议时间块二阶段锁定

**验收**：用户能跑完一天的完整 ritual；命令栏一句话创定时任务给硅基员工。

### Phase 3（4-6 周）

P2。

1. Habits 健康度 UI
2. 未排期任务池独立 + source 分组
3. 周视图（基于 `computeTeamLoad`）
4. 跨硅基员工容量看板

### Phase 4（远期）

P3。月视图、企业内部系统接入、Today widget。

---

## 9. 风险与边界

| 风险 | 影响 | 缓解 |
|------|------|------|
| 模型 brief 失败 | Today 顶部空 | 规则兜底（已有 `buildTodayBriefItems`） |
| 模型解析自然语言出错 | 创错事项 | 强制预览-确认，不直接创建 |
| 硅基员工行为不可信 | 偷改用户日程 | 员工不能直接改 `ownerScope=personal`，只能"建议" |
| Action items 误抽 | 用户 inbox 被噪声塞满 | 默认 status=draft，用户必须勾选 |
| 仪式弹窗扰民 | 烦 | 完成一次本日不再弹；用户可关闭仪式功能（`availabilityPolicy` 加 `enableRituals`） |
| ExecutionRun 重试风暴 | 失败任务被反复触发 | 失败后自动暂停 cron（已有 `status=paused` 状态），需用户手动重启 |
| 会议录音隐私 | 企业合规 | 录音前提示，转写在本地完成（现状已是），summary 可选不发云端 |
| 跨时区 | DST、出差 | `time-scheduler` 已 36 小时滑窗保护，新逻辑必须复用 `local-time` 工具，不要自行算 |

---

## 10. 立刻可做的"第一刀"（最小可见价值）

挑 5 件 1-2 天内能让 Today 页"看起来不一样"的：

1. **路由/菜单"时间中心"→"时间规划"** — 仅文案改动，1 小时。
2. **Top Priority Hero（规则版）** — 把现有 `pendingAttentionEntries` 第 1 条提升到顶部，配三按钮。1 天。
3. **`assistant_prompt` executor 跑通** — 第 62-66 行从空操作改成调用通用硅基员工。半天。
4. **ExecutionRun failed 自动归到 pending** — `buildPendingAttentionEntries` 的输入加 `runs.filter(r => r.status === "failed")`。半天。
5. **会议 action items（最简版）** — `MeetingsPage` 详情页加"提取 action items"按钮（不自动），点了调模型，列结果，让用户勾选转 task_commitment。2-3 天。

做完这 5 件后，Today 页的"个人助手感"会立刻肉眼可见，再进 Phase 1 的剩余项。

---

## 11. 一句话总结

`时间规划` = `Today 是入口` + `三段心智（Plan / Run / Review）` + `硅基员工是第一公民` + `会议/工作流/cron 自动产事项` + `AI 只建议、人拍板`。

现在的代码骨架已经够支撑这一切——缺的不是地基，是**最后一公里的产品胶水**：模型化的摘要、会议的延伸、仪式的闭环、Top Priority 的算法。这套方案就是把这一公里铺完。

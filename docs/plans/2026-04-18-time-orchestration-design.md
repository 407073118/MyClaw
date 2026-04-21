# MyClaw 时间编排与日历能力设计稿

> 日期：2026-04-18
> 状态：设计草案
> 范围：根层产品设计，指导后续 `desktop/` 为主、`cloud/` 为辅的分阶段落地

## 一、问题定义

MyClaw 当前已经具备三类核心能力：

- `task`：描述“要做什么”
- `workflow`：描述“如何做”
- `silicon person`：描述“谁来做”

但系统仍缺失一层统一的时间语义，导致以下问题无法被稳定承接：

- 用户说“明天下午三点提醒我”时，系统缺少正式的提醒对象与触发持久化机制。
- 用户说“每天早上给我今日简报”时，系统缺少周期调度、静默成功、失败告警、多渠道投递等能力。
- 用户说“把这件事安排到我本周空闲时间”时，系统缺少任务与日历事件的区分，也没有时间块自动安排能力。
- 硅基员工需要“工作时间”“值守时间”“巡检频率”“SLA 超时升级”时，当前只能靠 workflow 或会话内 task 勉强表达，语义不完整。
- 会议纪要、行动项、提醒、跟进会议之间缺少统一衔接链路，用户仍要手工转抄。

因此，MyClaw 需要新增一层独立的 `时间编排层（Time Orchestration Layer）`，统一承接提醒、日历、定时任务、时间块规划、值守和升级。

这层能力不是一个“小提醒功能”，而是个人助手与硅基员工都必须依赖的基础设施。

## 二、产品目标

### 2.1 从个人助手视角

MyClaw 要成为用户的时间代理，而不只是对话窗口。它需要帮助用户完成：

- 记录和管理固定时点事件：会议、出行、截止节点、值班窗口。
- 记录和管理可移动工作：待办、深度工作、习惯、复盘、清理类任务。
- 提供日计划与周计划：把会议、任务、空闲时间和风险放到同一视图里。
- 在正确的时间、正确的渠道、用正确的语气提醒用户。
- 在会议前、中、后自动完成准备、记录、行动项沉淀与跟进。

### 2.2 从硅基员工视角

硅基员工不应只在被动收到消息时工作，而应拥有自己的时间化执行能力：

- 定时执行 workflow、例行巡检、日报周报、周期同步。
- 在工作时段内主动处理任务，在静默时段内只记录或只告警。
- 面对失败和阻塞时执行升级策略，而不是无声卡死。
- 具备“值守”和“轮班”语义，未来支持多个硅基员工协同接力。

### 2.3 从系统演进视角

时间层的设计必须支持从个人到组织的扩展：

- 第一阶段先服务本地个人助手和本地硅基员工。
- 第二阶段支持多终端通知、多日历同步、跨会话连续性。
- 第三阶段支持云端共享、团队协同、审计、代理权限与组织级策略。

## 三、设计原则

### 3.1 时间对象必须分层，不混概念

MyClaw 必须明确区分：

- 固定时点的事件
- 可弹性安排的任务
- 纯提醒
- 精确定时触发器
- 周期性感知检查

不能把所有内容都塞进 `session.tasks`，否则个人助手和硅基员工都会在后续扩展中失去可维护性。

### 3.2 精确定时与周期性感知分离

参考 OpenClaw 的 `cron vs heartbeat` 思路，MyClaw 也应明确区分：

- `精确调度`：到某个时间点必须触发
- `感知巡检`：按频率扫一遍上下文，看是否有需要主动处理的事

前者适合提醒、定时报表、值守触发；后者适合看邮箱、看未来 2 小时日程、看未完成任务、做轻量 check-in。

### 3.3 任务与日历事件分离

参考 Motion、Reclaim、Sunsama 的产品抽象：

- 事件是固定时间，不应被自动挪动。
- 任务是有持续时间和截止点的工作块，可以被自动安排和重排。

MyClaw 必须先把这两个抽象拆开，后面才有可能做 timeboxing、自动重排、工作量预测和风险预警。

### 3.4 结构化 UI 优先

时间相关能力高度结构化，不适合依赖纯文本长对话维护：

- 新建提醒
- 编辑重复规则
- 决定通知渠道
- 设定工作时段
- 调整时间块

这些能力必须优先使用结构化 UI，聊天输入只作为自然语言入口，而不是唯一维护方式。

### 3.5 静默成功，失败告警

大量周期任务不应频繁打扰用户。系统应支持：

- 正常成功时静默
- 发现异常时提醒
- 需要确认时升级到审批或强提醒

这对个人用户体验和硅基员工值守都很关键。

## 四、核心领域模型

时间层新增以下一等公民对象。

### 4.1 `CalendarEvent`

表示固定时点事件，例如：

- 会议
- 出行
- 课程
- 截止节点
- 值班窗口

关键字段建议：

- `id`
- `title`
- `description`
- `startAt`
- `endAt`
- `timezone`
- `attendees`
- `location`
- `source`
- `externalRef`
- `status`
- `metadata`

语义约束：

- 默认不可自动漂移。
- 可以由外部日历同步而来。
- 可以被 workflow、meeting recorder、follow-up 流程引用。

### 4.2 `TaskCommitment`

表示需要完成、但不要求固定时点的工作承诺，例如：

- 写报告
- 跟进客户
- 提交报销
- 做每周回顾

关键字段建议：

- `id`
- `title`
- `description`
- `estimatedMinutes`
- `priority`
- `deadlineAt`
- `earliestStartAt`
- `latestFinishAt`
- `chunkingPolicy`
- `ownerType`（user / silicon_person）
- `ownerId`
- `status`
- `blockingTaskIds`
- `calendarBindingMode`
- `metadata`

语义约束：

- 可以被自动 timebox 到日历。
- 可以拆分为多个时间块。
- 可以随着会议插入、优先级变化而重排。

### 4.3 `Reminder`

表示提醒语义，而非任务本体。例如：

- 提醒我给医生打电话
- 两小时后提醒我看一下部署结果
- 客户休假结束当天提醒我跟进

关键字段建议：

- `id`
- `title`
- `body`
- `triggerAt`
- `timezone`
- `recurrenceRule`
- `relatedEntityType`
- `relatedEntityId`
- `deliveryPolicy`
- `ackPolicy`
- `status`

语义约束：

- 只负责提醒，不承担任务生命周期。
- 可以附着到任务、事件、workflow run、硅基员工运行记录上。

### 4.4 `ScheduleJob`

表示精确调度器中的作业定义。它是时间层里的“执行触发器”，不是提醒本身。

支持：

- 一次性执行
- 固定周期
- cron 表达式
- 时区
- 静默成功
- 重试与退避
- 指定渠道投递

关键字段建议：

- `id`
- `name`
- `scheduleKind`（at / every / cron）
- `scheduleExpr`
- `timezone`
- `payloadKind`（reminder / workflow / agent_turn / digest / custom）
- `payload`
- `targetType`（user / silicon_person / session / workflow）
- `targetId`
- `deliveryMode`
- `retryPolicy`
- `enabled`
- `lastRunAt`
- `nextRunAt`

### 4.5 `AwarenessRoutine`

表示周期性感知任务，用于替代“所有事情都靠 cron”的粗暴方案。

典型例子：

- 每 30 分钟检查未来 2 小时是否有会议
- 每 1 小时检查有无卡住的任务
- 工作时间内偶发 check-in

它与 `ScheduleJob` 的区别是：

- `ScheduleJob` 追求确定触发点
- `AwarenessRoutine` 追求定期感知与轻量决策

### 4.6 `AvailabilityPolicy`

表示人类用户或硅基员工的时间政策。

关键字段建议：

- `timezone`
- `workingHours`
- `focusBlocks`
- `quietHours`
- `meetingPreferences`
- `autoAcceptRules`
- `notificationWindows`
- `escalationWindows`

这决定：

- 什么时候可以提醒
- 什么时候可以执行自动任务
- 什么时候需要静默
- 什么时候需要升级告警

### 4.7 `ExecutionRun`

表示某次由时间层触发的实际运行记录。

关键字段建议：

- `id`
- `jobId`
- `startedAt`
- `finishedAt`
- `status`
- `summary`
- `artifacts`
- `deliveredTo`
- `error`
- `workflowRunId`
- `sessionId`

它是审计、可观测性和失败复盘的基础。

## 五、核心机制设计

### 5.1 双引擎模型：`精确调度` + `感知巡检`

MyClaw 时间层应包含两个引擎：

#### A. 精确调度引擎

负责：

- 到点提醒
- 每日简报
- 周报/月报
- 到点执行 workflow
- 硅基员工值守任务

特点：

- 强时区语义
- 持久化
- 重启后恢复
- 失败重试
- 有运行记录

#### B. 感知巡检引擎

负责：

- 未来 2 小时会议感知
- 今日任务超载识别
- 长时间未跟进事项提醒
- 日程冲突检测
- 硅基员工运行健康检测

特点：

- 不要求分秒级精确
- 适合聚合多个检查项
- 适合主上下文或轻上下文运行

### 5.2 Timeboxing 与自动重排

对 `TaskCommitment`，系统应支持：

- 手动放入某个时间块
- 自动安排到可用时间
- 当会议插入后自动建议重排
- 当截止时间逼近时发出风险提示

第一版不需要做到 Motion/Reclaim 那种复杂的全局智能排程，但必须先建立以下最小语义：

- 任务有时长
- 任务有截止时间
- 任务可以被切块
- 任务可以绑定到日历事件
- 任务的时间块可以失效并重排

### 5.3 会议后处理链路

参考 Lindy 的会后链路，MyClaw 应把会议变成时间层的重要输入：

- 会议开始前：生成 briefing
- 会议进行中：录音、转写、纪要
- 会议结束后：抽取 action items
- 动作为以下三类：
  - 创建 `TaskCommitment`
  - 创建 `Reminder`
  - 创建 `CalendarEvent`（如 follow-up meeting）

这样会议不再只是一个 artifact，而是后续时间编排的启动器。

### 5.4 硅基员工值守模型

每个硅基员工应拥有自己的时间配置：

- 工作时段
- 可被唤醒时段
- 静默时段
- 例行任务
- 巡检频率
- 失败升级路径

例如：

- 工作日 09:00 自动整理销售线索
- 每周一 08:30 生成团队周报草稿
- 每天 18:00 检查是否有未提交审批
- 若连续三次失败，则通过主聊天和桌面通知升级给用户

这使硅基员工从“被消息驱动”升级为“受时间与职责共同驱动”。

## 六、主要用户路径

### 6.1 个人用户

#### 路径 A：自然语言提醒

用户输入：

- “明天下午三点提醒我给医生打电话”

系统流程：

1. 解析时间、时区、提醒文本
2. 生成 `Reminder`
3. 写入时间层存储
4. 到时通过桌面通知或聊天提醒

#### 路径 B：任务自动上日历

用户输入：

- “这周找两个小时把季度复盘做了”

系统流程：

1. 生成 `TaskCommitment`
2. 估计时长为 120 分钟
3. 找到本周可用时间窗
4. 建议生成时间块
5. 用户确认后写入日历绑定

#### 路径 C：每日简报

系统在工作日 08:30 触发：

- 聚合当天会议
- 聚合高优先级任务
- 聚合逾期事项
- 聚合昨日遗留事项
- 输出“今日简报”

### 6.2 硅基员工

#### 路径 D：定时执行

销售助理硅基员工每天 09:00：

- 拉取新增线索
- 去重
- 生成跟进建议
- 将高优先级项目推送到用户工作台

#### 路径 E：巡检升级

运营硅基员工每 1 小时巡检：

- 是否存在超过 SLA 未处理事项
- 若发现异常，先在自身会话记录
- 达到升级条件后通知用户

### 6.3 会议驱动

会议结束后自动：

- 生成纪要
- 抽取动作项
- 根据语义区分：
  - 是任务
  - 是提醒
  - 是下次会议

用户只做确认，不再手工二次录入。

## 七、交互与界面设计

### 7.1 入口层

第一版建议提供四个入口：

- 聊天输入：自然语言创建提醒、安排任务、询问日程
- 时间中心页面：统一管理日历、提醒、定时作业、今日计划
- 硅基员工工作台：查看该员工的值守规则和例行任务
- 系统通知中心：查看提醒、失败告警、日报周报

### 7.2 时间中心建议分区

- `Today`
  - 今日会议
  - 今日任务块
  - 今日提醒
  - 风险提示
- `Calendar`
  - 日/周视图
- `Tasks`
  - 可安排任务
  - 逾期
  - 待排程
- `Jobs`
  - 定时作业
  - 最近执行记录
- `Rules`
  - 工作时段
  - 免打扰
  - 通知策略

### 7.3 结构化编辑器

至少需要以下结构化编辑器：

- 提醒编辑器
- 重复规则编辑器
- 工作时段编辑器
- 时间块编辑器
- 定时作业编辑器
- 硅基员工值守规则编辑器

## 八、架构落点建议

### 8.1 工作区边界

该能力主落点在 `desktop/`，因为：

- 时间层首先服务本地个人助手与本地硅基员工
- 需要操作本地通知、桌面 UI、本地持久化
- 需要与现有 `workflow`、`task`、`silicon person` 深度耦合

`cloud/` 在后续阶段主要承担：

- 外部日历凭据托管或代理
- 团队共享日历
- 组织级审计
- 共享策略下发

### 8.2 建议新增模块

`desktop/shared/contracts/`

- `calendar.ts`
- `time-orchestration.ts`
- `schedule-job.ts`

`desktop/src/main/services/`

- `calendar-store.ts`
- `schedule-job-store.ts`
- `time-orchestrator.ts`
- `reminder-service.ts`
- `availability-policy-service.ts`
- `timebox-planner.ts`
- `notification-center.ts`

`desktop/src/main/ipc/`

- `calendar.ts`
- `schedule-jobs.ts`
- `time-planning.ts`

`desktop/src/renderer/pages/`

- `TimeCenterPage.tsx`

`desktop/src/renderer/components/`

- `ReminderEditor`
- `ScheduleJobEditor`
- `WeekTimeline`
- `TodayBriefPanel`
- `AvailabilityPolicyForm`

### 8.3 与现有模块关系

- `task-store`：继续保存轻量 task，但长期应逐步承接到 `TaskCommitment`
- `workflow-engine`：被 `ScheduleJob` 触发
- `silicon-person-workflow`：接入值守和例行任务
- `meeting-recorder`：输出会后时间对象
- `session-background-task`：记录 detached run，但不替代 schedule job

## 九、分阶段路线

### Phase 1：本地时间底座

目标：

- 提醒
- 一次性/周期 schedule job
- 时区
- 运行记录
- 桌面通知
- 今日简报

不做：

- 外部日历双向同步
- 复杂自动排程
- 团队共享

### Phase 2：个人日历与时间块

目标：

- 外部日历读取
- `CalendarEvent` / `TaskCommitment` 分离
- timeboxing
- 轻量自动重排
- 会前 briefing / 会后 follow-up

### Phase 3：硅基员工值守

目标：

- 员工工作时段
- 例行 workflow
- 巡检与升级
- 静默成功 / 失败告警

### Phase 4：云端协同

目标：

- 团队共享
- 代理权限
- 组织级策略
- 审计与报表

## 十、主要风险

### 10.1 过早追求“智能排满整周”

如果第一版直接追求 Motion/Reclaim 级自动重排，复杂度会爆炸。应先打好：

- 事件/任务分层
- schedule job
- 提醒
- 简单 timeboxing

### 10.2 把提醒做成孤立功能

如果只做提醒而不做时间层抽象，后续会议、硅基员工值守、日报周报都会重复造轮子。

### 10.3 让定时任务直接污染主会话

周期任务需要可审计、可静默、可重试、可失败升级。若全部走主聊天上下文，会造成上下文污染和不可控噪声。

### 10.4 时区与免打扰策略缺失

没有明确的时区、quiet hours、notification windows，提醒能力很容易“能跑不能用”。

## 十一、外部样本带来的关键结论

本设计重点吸收了以下模式：

- OpenClaw：`cron` 与 `heartbeat` 分离，精确定时与周期性感知分层。
- Hermes：统一 `cronjob` 工具、多平台投递、静默成功、fresh session、递归防护。
- work buddy：把日计划、任务、日历、通知、工作流放在同一套个人工作操作系统里。
- Motion / Reclaim：任务与事件分离，支持时间块安排与重排。
- Sunsama：强调“每日计划流程”和工作量可承受性，而不是只堆清单。
- Lindy：把会议后的 action item、提醒和 follow-up meeting 串成自动链路。
- 腾讯 WorkBuddy：证明“办公智能体”会天然走向多任务、自动化和会议/文档管理，而不仅是聊天问答。

## 十二、结论

MyClaw 下一阶段不应仅增加“提醒”或“日历接入”两个孤立功能，而应建立独立的时间编排层。

这层能力的本质不是：

- 又一个 Todo
- 又一个 Calendar View
- 又一个 cron 配置器

而是把以下四种能力统一起来：

- 时间理解
- 时间触发
- 时间安排
- 时间化执行

当这层完成后，MyClaw 才能真正从“会说话的助手”进化为“能按时间持续交付的个人智能体与硅基员工系统”。

## 参考样本

- OpenClaw Scheduled Tasks: https://docs.openclaw.ai/automation/cron-jobs
- OpenClaw Cron vs Heartbeat: https://docs.openclaw.ai/cron-vs-heartbeat
- Hermes Scheduled Tasks: https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/
- Hermes Persistent Memory: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/
- work buddy 官网: https://work-buddy.ai/
- work buddy Morning Routine: https://docs.work-buddy.ai/handbook/morning/
- 腾讯 WorkBuddy 快速开始: https://www.codebuddy.cn/docs/workbuddy/Quickstart
- 腾讯 WorkBuddy 产品介绍: https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Product-Guide
- Motion AI Task Manager: https://www.usemotion.com/features/ai-task-manager.html
- Reclaim AI Calendar: https://reclaim.ai/
- Sunsama Daily Planning: https://help.sunsama.com/docs/daily-planning
- Lindy Post-Meeting Scheduling: https://www.lindy.ai/academy-lessons/scheduling-action-items-reminders-and-next-steps-after-meetings

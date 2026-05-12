# 硅基员工 Agent Team 主聊天交互设计草案

> 日期：2026-05-12  
> 范围：`desktop/`，聚焦主聊天里的硅基员工交互、任务分派、团队协作与回报链路。  
> 结论：先做 **Supervisor + Workers**，不要直接做自由 swarm。主聊天是用户的指挥台，硅基员工是可并行执行的 worker；员工间通信先通过受控 handoff/task 工具进入队列和审计。

## 1. 当前代码事实

### 1.1 已经具备的基础

- `desktop/shared/contracts/silicon-person.ts` 已有 `SiliconPerson`、`approvalMode`、`currentSessionId`、`sessions`、`workflowIds`、`modelProfileId`、`reasoningEffort`。
- `desktop/shared/contracts/session.ts` 的 `ChatSession.siliconPersonId` 已经把硅基员工私域 session 和主聊天 session 分开。
- `desktop/src/main/ipc/silicon-persons.ts` 已有每员工独立消息队列：同一个员工串行，不同员工并发。
- `desktop/src/main/services/silicon-person-session.ts` 已能创建、切换、标记已读、同步员工 session summary。
- `desktop/src/renderer/pages/ChatPage.tsx` 已经复用同一套聊天 UI 展示主聊天或某个员工的私域 session。
- `desktop/src/renderer/components/SiliconRail.tsx` 已有右侧员工头像栏，能显示 `running`、`needsApproval`、`hasUnread`。
- `desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx` 已有员工工作台、配置、能力、任务 tab、独立 skills/MCP、绑定 workflow、定时任务。
- `desktop/shared/contracts/task.ts` 的 `Task.owner` 已预留多 agent 场景。
- `desktop/shared/contracts/time-orchestration.ts` 和 TimeCenter 已有 `ownerScope="silicon_person"`、`ScheduleJob.executor="silicon_person"`、`ExecutionRun`，但主要服务定时任务，不覆盖主聊天临时派单。

### 1.2 现在的主聊天问题

当前 `@员工` 的行为是 `fire-and-forget`：

1. 用户在主聊天输入 `@Ada`，ChatPage 只设置本地 `mentionTargetSiliconPersonId`。
2. 下一条消息调用 `workspace.sendSiliconPersonMessage(personId, draft)`。
3. 主进程把消息塞进该员工队列，然后调用通用 session 执行链。
4. 执行结果进入该员工自己的 currentSession。
5. 主聊天只出现 5 秒临时投递痕迹，没有持久任务卡、没有回报消息、没有可追踪 run id。

这导致几个明显断点：

- 用户在主聊天派出去的活，主聊天里看不到完整生命周期。
- 员工执行完不会把结果回报到发起它的主聊天。
- 同一员工的 currentSession 容易混入多个主聊天派单，任务边界不清。
- 没有 Agent Team 概念，右侧 rail 只是头像切换，不是团队工作台。
- 没有员工间通信、handoff、ask teammate、delegate work。
- 没有队列长度、取消、追问、转派、接管这些团队运行控制。
- 现有审批是 session 级可见，但缺少“这件派出去的活卡在哪里等我处理”的主聊天呈现。

## 2. 外部模式对照

### 2.1 LangGraph：Supervisor 与 Handoff

LangGraph supervisor 的核心是一个中央 supervisor 控制通信流和任务分派，worker agent 只处理自己的专长。它还强调 message history 管理，可以选择只带最终结果或完整历史。对应到 MyClaw：主聊天应该是 supervisor desk，硅基员工是 worker；派单时只传明确任务 payload，不应默认把整段主聊天历史塞给员工。

参考：

- https://langchain-ai.github.io/langgraphjs/reference/modules/langgraph-supervisor.html
- https://langchain-ai.lang.chat/langgraphjs/agents/multi-agent/

### 2.2 CrewAI：Delegate Work 与 Ask Question

CrewAI 的协作模型提供两类基础动作：delegate work 和 ask question。它也明确建议复杂项目使用 manager agent 协调，专员 agent 专注执行，并用清晰角色避免 delegation loops。对应到 MyClaw：先让用户或主聊天 supervisor 发起派单；员工间通信只开放受控工具，不能无限互相转派。

参考：

- https://docs.crewai.com/en/concepts/collaboration

### 2.3 AutoGen：Conversable Agents 与 Human-in-the-loop

AutoGen 强调 agent 可以互相发送/接收消息，拓扑可以静态也可以动态，同时保留 human-in-the-loop。对应到 MyClaw：最终可以做员工间对话，但要有可观察的 conversation/task record，而不是隐藏在模型上下文里的自然语言互聊。

参考：

- https://autogenhub.github.io/autogen/docs/Use-Cases/agent_chat/

### 2.4 Anthropic 多 Agent 研究系统：适用范围与成本

Anthropic 的多 agent 实践指出，多 agent 对“广度优先、可并行、上下文很大”的任务收益明显，但 token 成本很高，且不适合依赖强、实时协调要求高的任务。对应到 MyClaw：Agent Team 应该是用户显式派出、可见、可取消、可审计的能力，不应该每条聊天自动拆成多员工。

参考：

- https://www.anthropic.com/engineering/multi-agent-research-system

## 3. 推荐产品模型

### 3.1 命名

把主聊天里的硅基员工能力从“进入某个员工聊天”提升为：

- **Agent Team**：用户拥有的一组硅基员工。
- **派出去的活**：从主聊天、Today、会议、定时任务发起的任务。
- **员工私域会话**：员工实际执行任务的运行记录。
- **回报卡**：任务在主聊天里的持久状态卡和最终 receipt。

主聊天不应该被右侧头像切换成“另一个人的聊天”作为主要体验。头像切换可以保留作为详情入口，但主路径应该是：在主聊天里派任务、看进度、收结果、必要时进入员工会话。

### 3.2 交互主线

用户在主聊天中有三种自然动作：

1. **问团队**：选择一个或多个员工，让他们给出意见或材料。
2. **派任务**：给某个员工一个明确 deliverable，后台执行，完成后回报。
3. **转交/接管**：对运行中的任务追加说明、取消、转派给另一个员工，或进入私域会话手动处理。

建议主聊天 composer 支持：

- `@Ada`：选择单个员工，默认模式是“派任务”。
- `@Team` 或工具栏团队按钮：打开结构化“派给团队”面板。
- `/team`：命令入口，适合 keyboard-first 用户。

派单不是临时 toast，而是生成一张持久回报卡：

```text
已派给 Ada
任务：整理这段需求里的三个风险点
状态：排队中 / 执行中 / 等你审批 / 已完成 / 失败
操作：查看详情 / 追问 / 取消 / 转派 / 插入结果
```

## 4. 推荐架构

### 4.1 采用 Supervisor + Workers

第一阶段不要做自由 swarm。原因：

- 当前代码已经是“主聊天 + 多个员工私域 session + 每员工队列”的形态，天然适配 supervisor-worker。
- 用户需要知道任务在哪里、谁在做、卡在哪，不适合先做隐藏式员工互聊。
- 员工间自由对话会立刻遇到循环、上下文膨胀、审批责任归属、成本不可控问题。
- 现有审批、路径权限、工具开关都是 session 级和员工级，先保持中央调度更稳。

### 4.2 新增核心概念：AgentTask

新增一个桌面端本地持久化对象，连接“主聊天派单”和“员工私域执行”。

```ts
export type AgentTaskMode = "delegate" | "ask" | "review" | "broadcast";

export type AgentTaskStatus =
  | "queued"
  | "running"
  | "waiting_user"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentTask = {
  id: string;
  title: string;
  instruction: string;
  mode: AgentTaskMode;
  sourceSessionId: string;
  sourceMessageId?: string;
  parentTaskId?: string;
  assigneeIds: string[];
  leadAssigneeId?: string;
  childSessionIds: Record<string, string>;
  status: AgentTaskStatus;
  resultSummary?: string;
  errorMessage?: string;
  approvalIds?: string[];
  contextPolicy: {
    includeLastMessages: number;
    includeArtifacts: boolean;
    includeSelectedFiles: boolean;
  };
  createdAt: string;
  updatedAt: string;
};
```

这个对象不要替代 `ChatSession`。员工仍然用自己的 session 执行；`AgentTask` 只负责把“谁派的、派给谁、执行到哪、结果如何”串起来。

### 4.3 队列改造

把 `silicon-persons.ts` 里的队列项从 `{ content }` 扩展为：

```ts
type QueuedMessage = {
  content: string;
  taskId?: string;
  targetSessionId?: string;
  sourceSessionId?: string;
};
```

关键变化：

- 主聊天派单时，为每个员工创建一个独立任务 session，而不是默认复用 currentSession。
- 队列执行时优先使用 `targetSessionId`，避免多个任务混进同一个员工会话。
- 执行开始、完成、失败、审批等待时同步更新 `AgentTask`。
- 每次状态变化广播 `silicon-team:task-updated`，renderer 更新主聊天回报卡和团队面板。

### 4.4 员工间通信

分两期：

**V1：用户可见的人工 handoff**

- 回报卡上提供“转派给...”和“请某员工补充意见”。
- 这些动作创建 child `AgentTask`，`parentTaskId` 指向原任务。
- 用户明确知道谁把什么交给了谁。

**V2：受控 agent handoff tools**

在硅基员工系统提示里暴露两个低风险团队工具：

- `team.ask_teammate({ coworkerId, question, context })`
- `team.delegate_work({ coworkerId, task, context, expectedOutput })`

约束：

- 默认需要用户审批，除非该员工 `approvalMode=auto_approve` 且任务不触碰文件/命令/MCP。
- `maxDepth=2`，`maxChildren=5`，禁止 self-delegation。
- 每个 handoff 都必须生成 `AgentTaskEvent`，在主聊天和团队面板可见。
- 子任务完成后只把摘要和关键 artifact 回填给父员工 session，不把完整子会话塞进父上下文。

## 5. 主聊天 UI 设计

### 5.1 Composer

现有 `@员工` 不再只是本地目标 chip，而是派单草稿：

- chip 文案从“投递给 @Ada”改成“派给 Ada”。
- 输入框上方增加轻量选项：`任务` / `问一下` / `评审`。
- 发送后清空输入，并在消息流中插入回报卡。

`@Team` 或团队按钮打开结构化面板：

- 任务标题
- 任务说明
- 模式：派任务 / 问问题 / 评审 / 广播
- 执行者：单选或多选员工
- 上下文：最近 6 条消息、当前会话文件、选中的 artifact
- 期望输出：摘要 / 清单 / 文件 / 方案

### 5.2 回报卡

回报卡应在主聊天消息流里常驻，并随状态更新：

- queued：显示排队位置和目标员工。
- running：显示当前员工、运行时长、最近一条能力轨迹或 task step。
- waiting_user：高亮审批或待用户补充。
- succeeded：显示结果摘要、产物入口、插入结果按钮。
- failed：显示失败原因、重试、改派。

这张卡不要默认把完整员工结果写入主聊天上下文。用户点击“插入结果”时，再把结果摘要作为用户可见消息写入主聊天，避免上下文污染。

### 5.3 Agent Team 面板

右侧 `SiliconRail` 保留头像，但增加一个团队抽屉：

- 队列：queued / running / waiting_user / done / failed
- 员工负载：每人当前任务数、运行中、待审批、未读
- 最近 receipts：今天完成了什么、失败了什么
- 快捷操作：进入员工会话、暂停/取消、追问、转派

Rail 头像只表达状态是不够的；团队面板才是主聊天里的 agent team 交互核心。

## 6. 数据流

### 6.1 单员工派单

```text
ChatPage composer
  -> workspace.createAgentTask(...)
  -> preload/main silicon-team:create-task
  -> AgentTaskStore 持久化 queued
  -> createSiliconPersonSession(title=任务标题)
  -> enqueueSiliconPersonMessage(taskId, targetSessionId, content)
  -> broadcast task-updated
  -> employee session runtime 执行
  -> syncSiliconPersonExecutionResult
  -> AgentTaskStore 写 succeeded/failed/waiting_user
  -> ChatPage 回报卡更新
```

### 6.2 多员工并行

- 一个 `AgentTask` 可以有多个 `assigneeIds`，也可以展开为一个 parent task + 多个 child task。
- 当前每员工队列天然保证单员工串行；不同员工队列天然并行。
- UI 汇总 parent task 状态：只要有一个 child waiting_user，parent 就 waiting_user；全部 succeeded 才 succeeded。

### 6.3 追问与接管

追问：

- 用户在回报卡点“追问”，输入补充说明。
- 系统把消息追加到对应员工的任务 session，并保留同一个 `taskId`。

接管：

- 用户点“进入会话”。
- 打开员工私域 session。
- 返回主聊天后，回报卡仍可继续更新。

## 7. 与现有能力的关系

- 不替代 SiliconPersonWorkspacePage。工作台仍是员工配置、能力和私域会话详情页。
- 不替代 TimeCenter。TimeCenter 继续管理定时任务；AgentTask 可以作为临时派单层，后续再和 ExecutionRun 做统一视图。
- 不替代 Workflow。workflow 是结构化自动化；AgentTask 是用户从聊天发起的团队运行记录。员工可以启动 workflow，但回报仍归属 AgentTask。
- 不引入 LangGraph/CrewAI/AutoGen 运行时依赖。当前 Electron main 已有 session runtime、工具执行、审批、MCP、workflow，先借鉴模式，不引入另一套 agent runtime。

## 8. 实施切片建议

### M1：主聊天派单持久化

目标：解决“派出去就丢了”的最大问题。

- 新增 `AgentTask` contract 和本地 store。
- 新增 `silicon-team:create-task/list-tasks` IPC。
- 改造 `@员工` 发送路径：创建任务卡，而不是只显示 5 秒 dispatch trace。
- 队列支持 `taskId` 和 `targetSessionId`。
- ChatPage 渲染任务回报卡。
- 测试覆盖：`@员工` 创建 task、回报卡展示、员工完成后主聊天卡更新。

### M2：Agent Team 面板

目标：让用户在主聊天里看见团队状态。

- 扩展 `SiliconRail` 为头像 + 团队抽屉入口。
- 增加 `AgentTeamPanel`。
- 展示任务队列、待审批、运行中、失败和最近完成。
- 支持追问、取消、进入会话。

### M3：受控员工间 handoff

目标：补上真正的“通信/协作”。

- 新增 `team.ask_teammate` 和 `team.delegate_work` 内置工具。
- 新增 child task、parent task 汇总状态。
- 加审批和防循环限制。
- 在员工 session 里把子任务摘要作为工具结果返回。

### M4：Supervisor 自动拆分

目标：让主聊天可以建议“要不要派给团队”。

- 复用现有 Plan Mode 的 lane/workstream 概念。
- 当模型生成并行 lane 时，允许用户一键分派给对应员工。
- 不自动执行，必须用户确认。

## 9. 不做的事

- 不做默认自动 swarm。
- 不让员工无限互相发消息。
- 不把完整主聊天历史默认传给每个员工。
- 不把员工私域 session 全量合并进主聊天上下文。
- 不先引入外部多 agent 框架。
- 不把所有定时任务、workflow、聊天派单一次性合并成一个大状态机；先从主聊天派单闭环开始。

## 10. 成功标准

第一阶段完成后，用户从主聊天派一个任务给硅基员工，应满足：

1. 主聊天立即出现持久任务卡，而不是 5 秒临时提示。
2. 任务卡能显示 queued/running/waiting_user/succeeded/failed。
3. 员工执行使用独立任务 session，不污染该员工 currentSession 里的其他任务。
4. 完成后结果摘要回到主聊天任务卡。
5. 用户能从任务卡进入员工会话、追问、取消或重试。
6. 现有 SiliconRail、SiliconPersonWorkspacePage、审批流、模型配置和员工私域 session 不被破坏。

## 11. 推荐下一步

先执行 M1。它改动范围小，但能立刻修掉最大体验问题：主聊天派出的硅基员工任务不再消失。M1 完成后，再做 Team 面板和受控 handoff；不要反过来先做员工互聊，否则会在没有任务账本的情况下制造不可追踪的后台通信。

# Task 功能优化方案设计

> 日期：2026-04-09
> 范围：desktop 端
> 状态：方案讨论

---

## 一、问题总结

| # | 问题 | 严重程度 | 位置 |
|---|------|---------|------|
| P1 | Task 工具调用在执行链里显示原始 JSON，和 fs/exec 工具混在一起，视觉噪音大 | 高 | ChatPage 执行链渲染 |
| P2 | 系统提示词对 task 的引导太弱，默认 medium 下模型把 task 当可选功能 | 高 | sessions.ts buildSystemPrompt |
| P3 | Task 跨轮次累积不清理，面板显示所有历史 task，越来越乱 | 高 | task-store + PlanStatePanel |
| P4 | Task 面板无法手动关闭，一直挂在输入框上方 | 中 | PlanStatePanel |

---

## 二、优化设计

### 2.1 执行链隐藏 Task 工具调用（P1）

**目标**：Task 操作是"思维结构化"，不是"工具执行"，不应在执行链中展示。Task 状态变化只通过 PlanStatePanel 呈现。

**涉及文件**：
- `desktop/src/renderer/pages/ChatPage.tsx` — `groupedMessages` 分组逻辑 + 执行链渲染

**改动设计**：

#### 2.1.1 消息分组阶段过滤

在 `groupedMessages` 的 `useMemo`（当前 L419-442）中，增加对纯 task 消息的识别和过滤：

```typescript
// 判断一个助手消息的 tool_calls 是否全部为 task 工具
function isAllTaskCalls(message: ChatMessage): boolean {
  const calls = (message as any).tool_calls as Array<{ function: { name: string } }> | undefined;
  if (!calls || calls.length === 0) return false;
  return calls.every((tc) => tc.function.name.startsWith("task_"));
}

// 判断一个 tool 消息是否为 task 工具的输出
function isTaskToolOutput(message: ChatMessage): boolean {
  if (message.role !== "tool") return false;
  // tool_call_id 的对应调用是 task_* —— 需要通过消息上下文判断
  // 方案: 在 tool 消息的 content 中检测 task 输出特征
  // 或者: 维护一个 taskCallIds Set（更精确）
}
```

**方案选择**：

**方案 A — 渲染时过滤（推荐）**：在 `groupedMessages` 构建时，为每个 technical group 过滤掉 task 相关消息。如果过滤后 group 为空，则整个 group 不渲染。

优点：改动最小，只在渲染层处理，不影响数据层。

具体逻辑：
1. 构建 `taskToolCallIds: Set<string>` — 遍历所有 assistant 消息的 `tool_calls`，收集 `name.startsWith("task_")` 的 call ID
2. 在 technical group 的 `items` 中过滤：
   - assistant 消息：如果所有 `tool_calls` 都是 task，整条跳过；如果部分是 task，保留消息但后续渲染时隐藏 task 调用部分
   - tool 消息：如果 `tool_call_id` 在 `taskToolCallIds` 中，跳过
3. 过滤后 items 为空的 group 不渲染

**方案 B — 后端不广播 task 工具消息**：在 sessions.ts 中，task 工具执行后不将 assistant(tool_calls) 和 tool(output) 消息追加到 `session.messages`。

缺点：破坏消息完整性，debug 困难，不推荐。

**推荐方案 A**。

#### 2.1.2 执行链标题优化

当前 `toolChainTitle(items)` 会把 `task_create, task_update, fs_read` 拼在一起作为标题。过滤 task 消息后，标题自然只显示真正的工具名。

无需额外改动，跟随消息过滤自动生效。

---

### 2.2 系统提示词强化（P2）

**目标**：将 task 从"可选的多步骤追踪"提升为"必须的需求拆解框架"。模型收到任何请求后，第一步应该是用 task 拆解需求、展示计划，然后逐个执行。

**涉及文件**：
- `desktop/src/main/ipc/sessions.ts` — `buildSystemPrompt` 函数 L522-541
- `desktop/src/main/services/tool-schemas.ts` — task 工具 description L295-357

#### 2.2.1 提示词重写（核心改动）

**当前问题**：
- medium 下：`"For requests with 2+ distinct steps"` — 阈值太高，大部分请求被跳过
- high 下：`"For ANY request with 2+ steps"` — 仍以步骤数判断
- 整体定位是"追踪工具"而非"思维框架"

**新设计** — 按 effort 分级：

```
effort = "low":
  不变，仅显式要求时使用。

effort = "medium" (默认):
  # 任务规划（必须）

  你拥有任务管理工具，用于拆解和追踪用户的请求。**每次收到用户新请求时，你必须：**

  1. **分析** — 理解用户真正想要什么，识别需要完成的步骤
  2. **拆解** — 对每个步骤调用 `task_create`，生成任务列表，让用户看到你的执行计划
  3. **执行** — 逐个执行任务：`task_update(id, status: "in_progress")` → 执行 → `task_update(id, status: "completed")`

  工具说明：
  - `task_create({ subject, description, activeForm })` — subject 用祈使句（如"修复登录Bug"），activeForm 用进行时（如"正在修复登录Bug"）
  - `task_update({ id, status })` — 开始前标记 in_progress，完成后立即标记 completed
  - 同一时间只能有一个 in_progress 的任务

  重要规则：
  - 即使只有一个步骤也要创建 task — 这是向用户展示"我理解了你的需求"的方式
  - 先创建所有 task，再开始执行第一个 — 让用户先看到完整计划
  - 如果执行中发现需要额外步骤，创建新 task 追加到列表中
  - 简单问答（如"什么是 TypeScript"）不需要 task，直接回答

effort = "high":
  在 medium 的基础上追加：

  **深度推理协议（强制）：**
  - 在创建 task 之前，先输出你的分析过程：用户的核心需求是什么？有哪些约束？有哪些风险？
  - task 之间的依赖关系必须通过 blocks/blockedBy 表达
  - 如果某个 task 失败或被阻塞，更新其 description 说明原因，并创建后续补救 task
  - 每个 task 完成后验证结果，确认无误再标记 completed
  - 对每个 task 都要考虑边缘情况和失败模式
```

#### 2.2.2 Tool Description 优化

当前 `task_create` 的 description 是：
> "Create a new task to track multi-step work. Use when the user's request requires 3+ steps..."

**问题**："3+ steps" 阈值太高，且定位为"追踪"而非"规划"。

**新 description**：
```
task_create: "Create a task as part of your execution plan. When you receive a user request, decompose it into tasks BEFORE starting work. Each task represents one logical step you will execute."

task_update: "Update a task's status or details. Set 'in_progress' before you start working on a task, 'completed' immediately after you finish. Only ONE task should be in_progress at a time."

task_list: "List all tasks in the current execution plan."

task_get: "Get details of a specific task by ID."
```

---

### 2.3 Task 按轮次分组 + 自动清理（P3）

**目标**：每次用户发送新消息时，前一轮已完成的 tasks 自动清理，PlanStatePanel 展示的始终是当前问题的 task 列表。

**涉及文件**：
- `desktop/shared/contracts/task.ts` — Task 类型（可选：加 roundId）
- `desktop/src/main/services/task-store.ts` — 清理逻辑
- `desktop/src/main/ipc/sessions.ts` — 新轮次触发清理
- `desktop/src/renderer/components/plan-state-panel.tsx` — 展示逻辑

#### 方案选择

**方案 C1 — roundId 分组**：给 Task 加 `roundId` 字段，每次用户消息生成新 roundId，PlanStatePanel 只展示最新 round。

优点：历史 task 数据完整保留，可回溯。
缺点：需要改 Task 类型、task-store、PlanStatePanel，改动面较大。

**方案 C2 — 新轮次自动清理已完成 task（推荐）**：用户发新消息时，清除上一轮所有 `completed` 的 task。

优点：改动小，逻辑简单，面板自然保持干净。
缺点：历史 task 丢失（但本身就是临时性的执行追踪，不需要长期保留）。

**推荐方案 C2**，理由：
1. Task 是瞬态执行追踪，不是持久化数据，清理符合直觉
2. 用户在新问题开始时看到干净的面板，体验更好
3. 实现简单可靠

#### C2 详细设计

**触发时机**：在 `sessions.ts` 的用户消息处理流程中，发送给模型之前执行清理。

**清理逻辑**（新增到 `task-store.ts`）：
```typescript
/** 新轮次开始时清理已完成的任务。 */
export function clearCompletedTasks(tasks: Task[]): {
  tasks: Task[];
  cleared: number;
} {
  const remaining = tasks.filter((t) => t.status !== "completed");
  return {
    tasks: remaining,
    cleared: tasks.length - remaining.length,
  };
}
```

**集成点**（在 `sessions.ts` 中）：

在模型 run 开始、用户新消息到达时，调用 `clearCompletedTasks`：

```
用户发消息 → clearCompletedTasks(session.tasks) → saveSession → broadcastTasksUpdated → 开始模型推理
```

这样：
- 第一个问题创建 5 个 task → 全部完成 → 面板显示 5/5 ✓
- 第二个问题发出 → 清理 5 个 completed → 面板变空（隐藏）
- 模型开始新一轮 task_create → 面板重新出现，只有新 task

**边界情况处理**：
- 如果有 `pending` 或 `in_progress` 的 task（上一轮未完成），**保留不清理**
- 只清理 `completed` 状态的 task
- 如果清理后 tasks 为空，PlanStatePanel 自动隐藏（已有逻辑 `if (total === 0) return null`）

---

### 2.4 Task 面板可关闭（P4）

**目标**：用户可以手动关闭 task 面板，不再占据输入框上方空间。新一轮 task 创建时自动重新显示。

**涉及文件**：
- `desktop/src/renderer/components/plan-state-panel.tsx` — 增加关闭按钮和隐藏状态
- `desktop/src/renderer/pages/ChatPage.tsx` — 管理面板显隐状态

#### 详细设计

**PlanStatePanel 增加 `onDismiss` 回调**：

```typescript
type PlanStatePanelProps = {
  tasks?: Task[];
  onDismiss?: () => void;  // 新增
};
```

**关闭按钮** — 在 summary 行右侧添加 `×` 按钮：

```
┌──────────────────────────────────────────────────────────┐
│ ⌄ 3/3 已完成  [██████████████]  正在分析代码...     [×]  │
└──────────────────────────────────────────────────────────┘
```

点击 `×` → 调用 `onDismiss()` → 父组件设置 `dismissed = true` → 面板隐藏。

**ChatPage 管理状态**：

```typescript
const [taskPanelDismissed, setTaskPanelDismissed] = useState(false);

// tasks 数量增加时（有新 task 创建），自动取消 dismissed
useEffect(() => {
  const count = session?.tasks?.length ?? 0;
  if (count > prevTaskCount) {
    setTaskPanelDismissed(false);
  }
  prevTaskCount = count;
}, [session?.tasks?.length]);

// 渲染
{!taskPanelDismissed && (
  <PlanStatePanel
    tasks={session?.tasks ?? []}
    onDismiss={() => setTaskPanelDismissed(true)}
  />
)}
```

**关闭按钮样式要求**：
- 半透明圆形按钮，hover 时变亮
- 不抢视觉焦点，但可发现
- `stopPropagation()` 防止触发 details 展开/折叠

---

## 三、改动汇总

| 文件 | 改动类型 | 复杂度 |
|------|---------|--------|
| `desktop/src/main/ipc/sessions.ts` — buildSystemPrompt | 重写 task 提示词段落 | 中 |
| `desktop/src/main/services/tool-schemas.ts` | 更新 4 个 task 工具的 description | 低 |
| `desktop/src/main/services/task-store.ts` | 新增 `clearCompletedTasks` 函数 | 低 |
| `desktop/src/main/ipc/sessions.ts` — 消息处理 | 新轮次开始时调用清理 | 低 |
| `desktop/src/renderer/pages/ChatPage.tsx` — groupedMessages | 过滤 task 工具消息 | 中 |
| `desktop/src/renderer/pages/ChatPage.tsx` — 面板状态 | 管理 dismissed 状态 | 低 |
| `desktop/src/renderer/components/plan-state-panel.tsx` | 增加关闭按钮 + onDismiss | 低 |
| `desktop/shared/contracts/task.ts` | 无改动 | — |

**总改动量**：约 6 个文件，核心变更集中在提示词重写和渲染过滤，无架构变更、无数据模型变更、无新依赖。

---

## 四、实施顺序

1. **Phase 1 — 提示词强化**（P2）：改 buildSystemPrompt + tool descriptions → 立即生效
2. **Phase 2 — 执行链过滤**（P1）：改 ChatPage groupedMessages → 减少视觉噪音
3. **Phase 3 — 轮次清理 + 关闭按钮**（P3 + P4）：改 task-store + PlanStatePanel → 面板体验优化

Phase 1 可独立完成并验证效果，Phase 2-3 可并行开发。

---

## 五、验证标准

- [ ] 默认 medium effort 下，模型对任何非简单问答的请求都会先创建 task 列表
- [ ] 执行链中不再显示 `task_create` / `task_update` 的调用和输出
- [ ] 用户发新消息后，上一轮已完成的 task 被清理，面板从新开始
- [ ] PlanStatePanel 有 `×` 按钮可关闭，新 task 创建时自动重新出现
- [ ] 简单问答（如"解释这个函数"）模型直接回答，不创建 task

# Silicon UI Product Redesign

日期：2026-05-13

## 设计结论

`silicon` V1 不做功能导航大全，而做一个本地 AI 员工运行控制台。第一版必须让用户不用 CLI 就能完成一个完整闭环：

1. 初始化 runtime。
2. 创建 employee。
3. 创建 task。
4. 触发 heartbeat 或 daemon tick。
5. 处理 approval。
6. 查看 run、artifact、review、memory。
7. 对 blocked 或 failed 做 retry、doctor、policy 检查。

UI 的中心不是聊天，也不是项目看板，而是 `Workbench + Inspector`。Workbench 负责全局态势和动作，Inspector 负责解释单个 employee、task、approval、run 的证据链。

边界不变：只做 `silicon/`，不修改、不读取、不接入 `desktop/**`。

## 设计取舍

推荐方案：运行控制台式。

理由：

- silicon 的核心模型是 employee、task、approval、run、artifact、review、memory、doctor。
- 这些对象需要审计、恢复和人工决策，聊天界面承载不了。
- AI-native UI 的关键不是“像人聊天”，而是“每一步可追问、可暂停、可恢复”。

舍弃：

- 舍弃首页欢迎页。启动后直接进入 Workbench。
- 舍弃大卡片墙。员工和任务使用表格、时间线、drawer。
- 舍弃全屏聊天框。聊天以后可以作为 create task 的一种输入方式，但 V1 不作为中心。
- 舍弃复杂日历、memory 编辑器、真实 shell/network 执行。

## 信息架构重构

上一版页面过多。V1 收敛为 5 个主入口：

1. `Workbench`：默认首页，显示全局运行态势、待处理动作、最近运行流。
2. `Employees`：员工列表和员工详情。
3. `Tasks`：任务队列、任务详情、attempt history。
4. `Approvals`：安全审批中心。
5. `Library`：Runs、Artifacts、Reviews、Memory、Schedule、Doctor 的统一检索和详情。

`Library` 不是弱化这些能力，而是避免第一版导航爆炸。用户多数时候从 Workbench 或对象详情进入 run、artifact、review、memory、doctor。

## App Shell

桌面布局：

- 左侧固定窄导航，宽度 64px，只放图标和 tooltip。
- 顶部状态条，高度 44px，显示 runtime root、daemon 状态、最近 tick、全局错误。
- 主区域使用两栏到三栏：
  - 左侧对象列表或队列。
  - 中间主内容。
  - 右侧 Inspector drawer，可固定或收起。

移动布局：

- 底部 5 项导航。
- Inspector 变成全屏 sheet。
- 表格切换为密集 list，不做横向滚动为主体验。

稳定尺寸规则：

- 顶部状态条、导航、toolbar、表格行高固定。
- badge、按钮、状态点不改变行高。
- loading 用骨架占位，避免布局跳动。

## Workbench 首屏

Workbench 是第一版最重要的页面。

顶部状态条：

- `runtimeRoot`
- `daemonStatus`
- `lastTickAt`
- `employees`
- `running`
- `waitingApproval`
- `blocked`
- `failed`

主体分三列。

左列：Employees

- 显示 employeeId、displayName、status、currentTask、lastBeat。
- 支持按状态过滤：All、Running、Waiting、Blocked、Failed。
- 行内动作：tick、create task、doctor。

中列：Queue Stream

- 按时间排序显示 task、run、approval、schedule 派发事件。
- 每条记录显示对象类型、标题、状态、阻塞类型、更新时间。
- 点击后右侧 Inspector 打开对象详情。

右列：Action Required

- Requested approvals。
- Blocked tasks。
- Failed health checks。
- Stale locks。
- Malformed records。

主按钮：

- Create Employee。
- Create Task。
- Runtime Doctor。
- Daemon Tick。

V1 如果 daemon start/stop 后端还不够稳，按钮先不放首屏，只放 status 和 tick。

## Employee 设计

员工是运行单元，不是联系人。

列表字段：

- employeeId
- displayName
- template
- status
- currentTaskId
- currentRunId
- lastBeatAt
- lastError
- openTasks
- waitingApprovals
- blockedTasks
- doctorStatus

详情页结构：

- Header：身份、模板、状态、当前 task/run、最后 heartbeat。
- Overview：当前工作、最近 run、最近 approval、doctor 摘要。
- Queue：该员工 task 和 todo 合并视图。
- Runs：该员工 run 历史。
- Approvals：该员工审批。
- Output：artifact 和 review。
- Memory：memory journal。
- Policy：soul、policy、loadout 只读解释。
- Doctor：员工 CI 和 record 健康。

重要交互：

- Create Task 使用结构化表单：title、instruction、capability。
- Tick Heartbeat 后刷新当前 employee、task、approval、run。
- 单个 profile 或 JSONL 损坏只影响该员工行，不拖垮整页。

## Task 设计

任务是 work order，不是聊天消息。

任务列表使用状态列：

- Queued
- Waiting Approval
- Running
- Blocked
- Failed
- Succeeded
- Cancelled

任务详情分区：

- Intent：title、instruction、createdAt。
- Capability Gate：requestedCapability、policy decision、approval requirement。
- Lifecycle：状态流转图。
- Attempts：attempt、runId、status、artifact、review、finishedAt。
- Recovery：cancel、retry、open approval、open run、open doctor。

按钮规则：

- `Cancel` 只在 queued、waiting_approval、running 可见。
- `Retry` 只在 blocked、failed、cancelled 可见。
- `Open Artifact` 只在 artifactPath 存在时可见。
- `Open Review` 只在 reviewPath 存在时可见。

Retry 必须提示：下一次会生成新 attempt 和新 run，不覆盖历史。

## Approval 设计

审批是安全控制台，不是确认弹窗。

列表分组：

- Requested
- Approved
- Denied
- Invalid or Suspicious

详情必须展示：

- approvalId
- employeeId
- taskId
- capability
- reason
- policy decision
- task instruction
- risk level
- expected next state

关键文案：

- 对 `artifact.write`：批准后可继续本地最小执行。
- 对 `filesystem.read`：批准后仅限 employee 边界内读取。
- 对 `shell.execute`：批准后仍会 blocked，因为 executor adapter 未接入。
- 对 `network.external`：批准后仍会 blocked，因为 executor adapter 未接入。
- 对 `employee.cross_access`：始终 forbidden，不提供批准按钮。

这能避免用户把 approval 误解成真实授权执行。

## Run Inspector

Run Inspector 是 AI-native 解释层，应该是 V1 的质量核心。

布局：

- Header：runId、taskId、attempt、status、executorMode、blockedReason。
- 左侧 Timeline：run_started、task_observed、approval_checked、artifact_written、review_written、memory_written、run_succeeded、run_blocked、run_failed。
- 中间 Step Ledger：observe_task、load_soul、load_policy、load_skill、produce_artifact、write_review、write_memory。
- 右侧 Evidence：state.json、context.json、plan.json、events.jsonl、steps.jsonl 摘要。

状态表达：

- succeeded：绿色。
- blocked：琥珀色，强调安全阻塞和恢复动作。
- failed：红色，强调异常。
- simulated：灰蓝色，说明是 local minimal harness，不等同真实外部工具执行。
- missing_adapter：紫灰色，不使用成功色。

Run Inspector 必须回答三个问题：

1. 这次运行读了什么？
2. 这次运行根据什么 policy 和 approval 做决定？
3. 这次运行写了什么，为什么停下？

## Artifact 和 Review

Artifact 是交付物，Review 是复盘。

界面不做普通文件浏览器，而做两栏：

- 左栏 Artifact Preview，渲染 Markdown。
- 右栏 Review Preview，展示观察、决策、行动、反馈。

侧边 metadata：

- employeeId
- taskId
- runId
- attempt
- artifactPath
- reviewPath
- executorMode
- blockedReason
- createdAt

每个 artifact/review 都必须能跳回 run inspector。

## Memory 设计

Memory 是事实流，不是聊天历史。

字段：

- eventId
- type
- subjectId
- summary
- confidence
- sourcePath
- createdAt

展示规则：

- 按事件类型分组。
- confidence 低的弱化展示。
- blocked 和 failed 事件突出恢复线索。
- 每条 memory 必须能回跳 source。

V1 只读，不做编辑。

## Schedule 设计

Schedule 是未来任务队列。

列表字段：

- scheduleId
- employeeId
- title
- dueAt
- status
- requestedCapability
- dispatchedTaskId

交互：

- Create Schedule。
- Cancel Scheduled。
- Open Dispatched Task。
- Daemon Tick 后刷新派发结果。

V1 不做重复规则，不做复杂日历。

## Doctor 设计

Doctor 是安全底座。

全局 Doctor 检查：

- runtime root。
- templates。
- employees。
- daemon status。
- stale locks。
- malformed records。
- invalid employee folders。
- policy parse failures。

员工 Doctor 检查：

- required directories。
- profile parse。
- heartbeat state。
- task records。
- approval records。
- schedule records。
- memory journal。
- policy required rules。
- lock metadata。

错误分级：

- Info：只读提示。
- Recoverable：可以 tick、retry、doctor refresh。
- Manual Fix Required：坏 JSON、缺目录、坏 policy。
- Fail Closed：未知 capability、越界路径、cross access。

## 视觉系统

风格：安静、密集、工程化、可扫描。

颜色：

- 背景：`#f7f5ef` 或 `#101214`。
- 面板：`#ffffff` / `#171a1d`。
- 主文本：`#1f2328`。
- 次文本：`#6b7280`。
- Running：`#2563eb`。
- Waiting Approval：`#b45309`。
- Blocked：`#c2410c`。
- Failed：`#dc2626`。
- Succeeded：`#15803d`。
- Simulated：`#64748b`。
- Focus：`#0f766e`。

说明：

- 不使用紫蓝大渐变。
- 不使用装饰性光斑。
- 不做卡片套卡片。
- 卡片只用于单个 employee 或 action item，主要结构使用表格、分栏、drawer。

字体：

- UI 字体使用系统 sans，保证本地工具加载稳定。
- 数字、路径、id 使用 monospace。
- 页面标题不超过 24px。
- 表格正文 13px 到 14px。

组件：

- StatusBadge
- RiskBadge
- CapabilityChip
- RuntimeStatusBar
- EmployeeTable
- TaskQueue
- ActionRequiredList
- InspectorDrawer
- Timeline
- StepLedger
- EvidencePanel
- MarkdownPreview
- DoctorCheckTable
- EmptyState
- ErrorState
- ConfirmActionDialog

## 数据契约

前端不直接读取文件系统，不直接依赖 core store 结构。

新增契约：

- `RuntimeDashboardView`
- `EmployeeListItemView`
- `EmployeeDetailView`
- `TaskListItemView`
- `TaskDetailView`
- `ApprovalListItemView`
- `ApprovalDetailView`
- `RunTimelineView`
- `ArtifactReviewView`
- `MemoryEventView`
- `ScheduleItemView`
- `DoctorReportView`
- `UiErrorView`

统一错误：

```ts
type UiErrorView = {
  code: string;
  message: string;
  target?: {
    kind: "runtime" | "employee" | "task" | "approval" | "run" | "file";
    id?: string;
    path?: string;
  };
  recoverable: boolean;
  suggestedAction?: string;
};
```

## 实现落点

推荐结构：

```text
silicon/
  src/
    contracts/
      view-models.ts
      errors.ts
      events.ts
    services/
      runtime-dashboard.ts
      employee-detail.ts
      task-detail.ts
      approval-detail.ts
      run-timeline.ts
      artifact-review.ts
      doctor-report.ts
    http/
      server.ts
      routes/
      static-ui.ts
  apps/
    ui/
      package.json
      index.html
      src/
        main.tsx
        api/
        shell/
        views/
        components/
        styles/
```

V1 依赖方向：

```text
apps/ui -> http api -> services -> core/runtime/harness/policy/testing
```

禁止：

```text
apps/ui -> core files
apps/ui -> desktop
src/http -> desktop
src/services -> desktop
```

## V1 开发顺序

1. Contract first：定义 view models 和 UiErrorView。
2. Services：实现 dashboard、employee detail、task detail、run timeline。
3. HTTP：实现 runtime、employee、task、approval、run、doctor API。
4. UI shell：实现导航、状态条、Workbench。
5. Core flows：创建员工、创建任务、tick、approval、artifact/review。
6. Inspector：实现 task、approval、run、doctor 的右侧详情。
7. Hardening：轮询刷新、错误态、空态、窄屏、乱码门禁、测试。

## V1 完成标准

- 打开 UI 后直接看到 Workbench。
- 不使用 CLI，可以完成 runtime init、create employee、create task、tick。
- approval 可以 approve/deny。
- shell/network 审批通过后仍显示 missing adapter blocked。
- artifact/review 可以预览。
- run inspector 能展示 timeline、step ledger、evidence。
- doctor 能展示 runtime 和 employee 健康。
- 所有中文文案 UTF-8 正常。
- `desktop/**` 无改动。

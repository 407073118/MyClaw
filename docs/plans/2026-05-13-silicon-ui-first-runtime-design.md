# Silicon UI-First Runtime Design

日期：2026-05-13

## 结论

`silicon` 第一版必须提供独立 UI。旧方案中的 `CLI + daemon` 优先、复杂 UI 暂不做，只保留为测试和调试基线，不再作为产品入口。新的第一版目标是：用户可以通过 `silicon` 自带 UI 完成员工创建、派工、审批、运行观察、产物查看、复盘和诊断闭环。

本方案只面向 `silicon/`。不得修改 `desktop/**`，不得引入 desktop IPC、renderer、session 或工作流依赖。

## 作废与保留

作废：

- 作废 `CLI-only MVP`。CLI 继续存在，但不再是唯一入口。
- 作废 `复杂 UI 暂不做`。第一版必须有结构化 UI。
- 作废纯文本伪表单。创建员工、创建任务、审批、定时任务都必须是结构化控件。

保留：

- `silicon` 独立于 `desktop`。
- 本地文件型 runtime 是唯一真实数据源，UI 不维护第二套状态。
- 高风险能力继续 fail-closed。`shell.execute`、`network.external` 在没有真实 adapter 前只能显示审批、阻塞和原因，UI 不得绕过 executor。
- CLI 和测试继续作为回归基线。同一操作经 CLI 与 UI 执行后，落盘状态机语义必须一致。

## AI-native UI 调研摘要

公开 AI-native 编程产品的共同形态不是单一聊天框，而是任务化、可观察、可审计的工作台：

- OpenAI Codex 和 GitHub Copilot cloud agent 都强调后台任务、并行任务、进度追踪、日志和 PR 审核。
- Replit Agent 用 checkpoint 和 rollback 表达 AI 工作的可恢复性。
- Google Jules 把任务拆成计划、差异和人工确认。
- v0 与 Lovable 强调 live preview、设计编辑和快速迭代。

调研来源：

- OpenAI Codex cloud：后台并行任务、独立环境、PR 输出。
- GitHub Copilot coding agent：agent session、进度、日志、PR review。
- Cursor Background Agents：异步 agent、状态查看、接管和跟进。
- Replit Agent：checkpoint、rollback、history。
- Google Jules：计划审批、activity feed、diff review。
- v0 和 Lovable：preview、version、visual edit。

对 `silicon` 的启发：

1. 主界面应是 control room，而不是 chat shell。
2. 所有 agent 行为必须能解释：输入、策略、步骤、证据、输出、阻塞原因。
3. 人工审批是一级入口，不应藏在日志里。
4. 运行结果必须可恢复：retry、cancel、doctor、artifact/review 回看。
5. UI 要让用户一眼回答：谁在工作、谁卡住、我需要批准什么、这次运行写了什么。

## 产品定位

`silicon` UI 是本地 AI employee control room。

它的核心用户任务是：

- 创建和管理多个 silicon employee。
- 给员工派发结构化任务。
- 观察任务队列、运行状态和阻塞原因。
- 审批高风险能力请求。
- 查看 artifact、review、memory 和 run timeline。
- 用 doctor 找到 runtime、员工文件夹、policy、lock、记录损坏等问题。

它不是：

- 不是营销页。
- 不是 desktop 子页面。
- 不是聊天壳。
- 不是 shell/network 的权限绕行入口。

## V1 信息架构

### Runtime 工作台

第一屏显示全局运行状态：

- runtime root、templates、employees、daemon status、pid、tick count。
- 员工数、运行中任务数、待审批数、blocked 数、failed 数。
- 需要人工注意的聚合队列：approval、blocked task、failed employee、stale lock、malformed record。
- 最近 run timeline：started、artifact written、review written、succeeded、blocked、failed。

关键操作：

- 初始化 runtime。
- daemon tick。
- daemon start 和 stop。如果后端暂未实现后台 supervisor，V1 只暴露 tick 和 status。
- runtime doctor。
- create employee。

### 员工列表

员工列表使用高密度表格，不使用卡片墙。

字段：

- employeeId、displayName、templateName、status。
- currentTaskId、currentRunId、lastErrorMessage。
- tickCount、lastBeatAt、lastResult。
- open tasks、waiting approvals、blocked tasks、failed tasks。
- schedule count、memory count、doctor status。

交互：

- 搜索 employeeId、name、template。
- 状态筛选：all、idle、running、waiting approval、failed。
- 行内动作：tick heartbeat、create task、doctor。
- 单个员工记录损坏时只标红该行，不阻塞整表。

### 员工详情

员工详情用 tabs：

- Overview
- Queue
- Runs
- Approvals
- Artifacts
- Memory
- Schedule
- Doctor
- Soul & Policy

Overview 显示 profile、heartbeat、当前任务、当前 run、最后错误、policy 能力摘要。

### 任务队列

任务队列合并 task 和 todo 投影。

列：

- Open
- Waiting Approval
- Running
- Terminal

任务详情 drawer 显示：

- title、instruction、requestedCapability、status、attempt。
- approvalId、runId、artifactPath、reviewPath。
- runHistory、errorMessage、createdAt、updatedAt。

操作：

- create task。
- cancel queued、running、waiting approval。
- retry failed、blocked、cancelled。
- open run、artifact、review。

### Run 时间线

Run timeline 是 AI-native 解释层。

分区：

- run header：runId、taskId、status、startedAt、finishedAt、executorMode、blockedReason。
- context：soulPath、policyPath、loadoutPath、memoryPath、requestedCapability、selectedSkillIds。
- plan steps：observe_task、load_soul、load_policy、load_skill、produce_artifact、write_review、write_memory。
- event ledger：run_started、task_observed、artifact_written、review_written、run_succeeded、run_blocked、run_failed。
- step evidence：path、readable、byteLength。

规则：

- `simulated` 必须与真实执行视觉区分。
- `missing_adapter` 必须解释为“审批通过但执行器未接入”。
- blocked run 必须给恢复动作：approve、retry、doctor、查看 policy。

### 审批中心

审批是全局一级页面，也在员工详情中有局部入口。

字段：

- approvalId、employeeId、taskId、capability、reason、status、createdAt、resolvedAt。
- 风险等级：filesystem、artifact、shell、network、cross employee。

操作：

- approve。
- deny。
- 查看关联 task 和 run。

约束：

- cross employee access 始终 forbidden。
- shell 和 network 即使批准，也只能在没有 adapter 时进入 blocked。

### Artifact / Review

Artifact 和 review 合并成交付与复盘视图。

组件：

- Markdown artifact preview。
- Review preview。
- 元数据侧栏：taskId、runId、attempt、paths、status。
- attempt history 切换。

错误状态：

- artifactPath 缺失时显示尚未产生产物。
- 文件不可读时显示路径和读取错误。

### Memory

Memory 是可追溯事实流，不是自由知识库。

字段：

- eventId、type、subjectId、summary、confidence、createdAt、sourcePath。

交互：

- 按 type、subject、confidence 筛选。
- sourcePath 跳转到 task、approval 或 run。
- V1 不做 memory 编辑，因为 runtime 还没有 update/delete API。

### Schedule

Schedule 是任务来源，不做复杂日历系统。

字段：

- scheduleId、title、instruction、dueAt、status、requestedCapability、dispatchedTaskId。

交互：

- create schedule。
- cancel scheduled。
- dispatched schedule 跳转 task。
- daemon tick 后刷新派发状态。

### Doctor

Doctor 是修复控制台。

分区：

- Runtime health。
- Employee CI。
- Runtime records。
- Locks。
- Policy parse。

展示：

- summary badges：passed、failed、stale locks、malformed records。
- check table：name、passed、message、suggested action。
- affected object links：employee、task、approval、schedule。

## UI 视觉方向

界面应是安静、密集、可扫描的运维控制台：

- 主色用中性浅底或深浅双模式，不使用大面积紫蓝渐变。
- 用状态色表达运行语义：running、waiting approval、blocked、failed、succeeded。
- 表格、分栏、drawer、tabs 是主结构；卡片只用于单个重复对象，不做卡片套卡片。
- 按钮使用图标加短标签，未知图标有 tooltip。
- 表单使用 input、select、segmented control、date-time picker、checkbox，不让用户在长文本中手填复杂字段。
- loading 使用骨架屏，保持布局尺寸稳定。
- error 不空白，必须显示对象 id、路径或下一步动作。

## 技术架构

推荐新增目录：

```text
silicon/
  src/
    contracts/
      api-types.ts
      error-codes.ts
      event-types.ts
      view-models.ts
    services/
      runtime-dashboard.ts
      employee-query.ts
      task-output-reader.ts
      run-reader.ts
      daemon-controller.ts
    http/
      server.ts
      errors.ts
      request-schema.ts
      sse.ts
      routes/
        runtime-routes.ts
        employee-routes.ts
        task-routes.ts
        approval-routes.ts
        schedule-routes.ts
        daemon-routes.ts
        artifact-routes.ts
  apps/
    ui/
      index.html
      src/
        main.tsx
        api-client.ts
        app-state.ts
        views/
        components/
        styles/
  tests/
    http/
    services/
    web/
```

前端选择：

- V1 使用 Vite + React + TypeScript + CSS modules。
- 不引入复杂状态库。先用轻量 reducer 或 store。
- 图标使用现有或新增的轻量图标库；如果不加依赖，先用文本标签和 CSS 状态点，后续再补图标。
- UI 放在 `silicon/apps/ui`，由 `silicon/src/http` 在本地服务静态资源；不得移动到 `desktop/**`。

后端选择：

- V1 可用 Node `http` 实现最小 router，减少依赖。
- 如果后续路由和校验明显增多，再评估 Hono 或 Fastify。
- 所有路径必须复用现有 id/path guard，不允许浏览器输入直接拼路径。
- 页面只依赖 `contracts` 和 HTTP API，不直接读取 `core` 文件布局。

## API 草案

Runtime：

- `GET /api/runtime/status`
- `POST /api/runtime/init`
- `GET /api/runtime/doctor`
- `GET /api/templates`

Employee：

- `GET /api/employees`
- `POST /api/employees`
- `GET /api/employees/:employeeId`
- `POST /api/employees/:employeeId/heartbeat/tick`
- `GET /api/employees/:employeeId/doctor`

Task：

- `GET /api/employees/:employeeId/tasks`
- `POST /api/employees/:employeeId/tasks`
- `GET /api/employees/:employeeId/tasks/:taskId`
- `POST /api/employees/:employeeId/tasks/:taskId/cancel`
- `POST /api/employees/:employeeId/tasks/:taskId/retry`

Run and output：

- `GET /api/employees/:employeeId/runs`
- `GET /api/employees/:employeeId/runs/:runId`
- `GET /api/employees/:employeeId/tasks/:taskId/artifact`
- `GET /api/employees/:employeeId/tasks/:taskId/review`

Approval：

- `GET /api/approvals`
- `GET /api/employees/:employeeId/approvals`
- `POST /api/employees/:employeeId/approvals/:approvalId/approve`
- `POST /api/employees/:employeeId/approvals/:approvalId/deny`

Schedule：

- `GET /api/employees/:employeeId/schedules`
- `POST /api/employees/:employeeId/schedules`
- `POST /api/employees/:employeeId/schedules/:scheduleId/cancel`

Daemon：

- `GET /api/daemon/status`
- `POST /api/daemon/tick`
- `POST /api/daemon/start`
- `POST /api/daemon/stop`

Events：

- `GET /api/events`

V1 可以先用 polling；如果实现实时更新，优先 SSE，不先做 WebSocket。

## 必须补的服务层

为避免 UI 拼低层文件 API，需要新增聚合服务：

- `getRuntimeDashboard(runtimeRoot)`：汇总员工、任务、审批、daemon、doctor 摘要。
- `listEmployees(runtimeRoot)`：公开员工列表查询，不依赖 CLI 私有函数。
- `getEmployeeDetail(employeeDir)`：聚合 profile、heartbeat、tasks、approvals、schedules、memory count。
- `readRunTimeline(employeeDir, runId)`：结构化读取 state、context、plan、events、steps。
- `readTaskOutput(employeeDir, taskId)`：安全读取 artifact 和 review。
- `controlDaemon(runtimeRoot)`：包装 start、stop、tick、status，避免 HTTP 请求 await 长循环。

## 分阶段计划

### Phase 1：UI 数据面

- 新增 services 聚合层。
- 新增 run reader 和 artifact/review reader。
- 新增 dashboard 查询。
- 补服务层测试。

验收：

- 无 UI 时服务层已能返回 dashboard、employee detail、run timeline、artifact/review。

### Phase 2：HTTP API

- 新增本地 HTTP server。
- 实现 runtime、employee、task、approval、schedule、daemon、artifact route。
- 统一错误格式。
- 统一 request schema 和 id 校验。

验收：

- 测试可通过 HTTP 完成初始化、创建员工、创建任务、审批、tick、查看输出。

### Phase 3：第一版 UI 壳

- 新增 Vite React UI。
- 实现 app shell、导航、runtime status、员工列表、任务列表、审批中心。
- 实现空态、加载态、错误态。

验收：

- 用户不用 CLI 就能初始化 runtime、创建员工、创建任务、查看状态、处理审批。

### Phase 4：AI-native 观测层

- 实现 run timeline。
- 实现 artifact/review preview。
- 实现 memory timeline。
- 实现 schedule 页面。
- 实现 doctor 页面。

验收：

- 用户能从 blocked task 追踪到审批、policy、executor decision 和恢复动作。

### Phase 5：实时与恢复体验

- 增加 polling 或 SSE。
- 增加 cancel、retry、daemon tick/start/stop 的 UI 状态反馈。
- 增加 route-level refresh 和 toast/event log。

验收：

- 任务状态变化后 UI 能自动或半自动刷新，不需要重启页面。

### Phase 6：硬化和打包

- UI E2E smoke。
- HTTP 并发和路径穿越测试。
- 构建脚本和静态资源服务。
- 文档和乱码门禁。

验收：

- `pnpm --dir silicon test`
- `pnpm --dir silicon typecheck`
- `pnpm --dir silicon build`
- 本次修改文件乱码门禁无命中。

## V1 验收清单

- UI 独立运行，不依赖 `desktop/**`。
- UI 能初始化 runtime。
- UI 能显示 runtime dashboard 和 doctor 摘要。
- UI 能从模板创建员工。
- UI 能显示员工列表和员工详情。
- UI 能创建、取消、重试 task。
- UI 能触发 employee heartbeat tick 和 daemon tick。
- UI 能查看 task status、run history、artifact、review。
- UI 能查看和处理 approval。
- UI 能查看 memory、schedule、doctor。
- UI 对 missing adapter、policy denied、malformed record、stale lock 都有明确错误状态。
- UI 不绕过 executor 和 policy。
- CLI 测试继续通过。

## 自动化验证

每个阶段至少运行：

```powershell
pnpm --dir silicon test
pnpm --dir silicon typecheck
```

涉及构建或静态资源时运行：

```powershell
pnpm --dir silicon build
```

完成前对本次修改文件执行乱码门禁：

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern docs/plans/2026-05-13-silicon-ui-first-runtime-design.md silicon
```

## 不做事项

- 不修改 `desktop/**`。
- 不把 UI 放进 desktop。
- 不引入真实 shell/network 执行。
- 不做跨员工文件访问。
- 不做复杂多租户、账号、远程同步。
- 不做 memory 编辑器。
- 不做复杂 recurrence 日历。

## 主要风险

- 旧计划文档中有乱码，后续不要在乱码文件上做大范围重写。
- HTTP server 如果直接 await daemon loop，会导致请求挂死，必须通过 controller 管理。
- UI 如果绕过服务层直接拼文件路径，会破坏 path boundary。
- 只展示 succeeded 而不展示 simulated/missing_adapter，会误导用户。
- 缺少 run timeline 会让 AI 行为不可审计，不能算完整 V1。

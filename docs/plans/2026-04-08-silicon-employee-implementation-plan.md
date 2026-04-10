# 硅基员工 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `desktop/` 内直接重写旧 `employees` 模块，建立以 `SiliconPerson` 为核心的主聊天、右侧 `Silicon Rail`、员工工作空间、多 session、审批状态和创建流。

**Architecture:** 这次不是做兼容层，而是把旧的 pseudo employees 模块替换成一套明确的桌面端产品结构。主线程负责统一状态、持久化和 IPC；renderer 负责 Commander Console、Silicon Rail 和 workspace；preload 只暴露稳定桥接；shared contracts 作为唯一契约边界。整个改造要支持多 agent 并行开发，因此必须提前切清晰写入边界，避免多人同时碰同一条契约或同一个页面。

**Tech Stack:** Electron main process, React, Zustand, TypeScript, preload bridge, IPC contracts, existing desktop persistence layer, Vitest.

**Status:** 设计已完成，代码实现仍以旧 `employees` 模块为主；以下进度表为基于当前仓库现状的人工盘点结果（更新于 2026-04-08）。

**Key files to read before starting:**
- `desktop/src/renderer/pages/EmployeesPage.tsx`
- `desktop/src/renderer/pages/ChatPage.tsx`
- `desktop/src/renderer/stores/workspace.ts`
- `desktop/src/preload/index.ts`
- `desktop/src/renderer/types/electron.d.ts`
- `desktop/src/main/ipc/*.ts`
- `desktop/src/main/services/*.ts`
- `desktop/shared/contracts/*.ts`
- `desktop/tests/*employees*`
- `desktop/tests/*session*`
- `desktop/tests/*workspace*`

---

## Multi-Agent Execution Topology

### Wave 1

- Agent A ownership: renderer 页面、workspace store、右侧栏、workspace 视图、主聊天交互
- Agent B ownership: shared contracts、main IPC、持久化、session/currentSession 规则、统一状态
- Agent C ownership: 创建流、模板复制、能力绑定、审批模式、与模型配置的接入细节

### Wave 2

- Main agent ownership: 合并波次成果、统一命名、跑全量验证、处理重叠契约和状态口径

### Hard write boundaries

- Agent A 不要改 `desktop/src/main/**` 和 `desktop/shared/contracts/**`
- Agent B 不要改 `desktop/src/renderer/**`
- Agent C 不要改 renderer 页面和 broad IPC orchestration
- Main agent 是唯一允许统一调整事件名、状态名和跨层 payload 口径的人

---

## Phase 0-5 完成进度

> 说明：这里的百分比是基于当前仓库代码与测试的保守估算，用来表达”离该 phase 目标还有多远”，不是 Git 提交量占比。
> **最后更新：2026-04-09**

| Phase | 完成度 | 状态 | 当前结论 | 下一步 |
|-------|--------|------|----------|--------|
| Phase 0: 彻底切断旧 `employees` 假实现 | 95% | 已完成 | 旧 `employee.ts` 契约已删除；页面已重命名为 `SiliconPersonEntryPage.tsx` / `SiliconPersonWorkspacePage.tsx`；侧边栏和标题栏已改为”硅基员工”；IPC 通道已重命名为 `cloud:import-silicon-person-package`；`employee-package` 作为云端 API 协议值保留。 | 无重大遗留。 |
| Phase 1: Shared Contracts First | 95% | 已完成 | `silicon-person.ts` 完整定义（含 baseIdentity、rolePersona、soul、modelBindingSnapshot、skillIds）；统一状态枚举 `SiliconPersonStatus`；`resolveSiliconPersonCurrentSessionId` 工具函数；测试全部 PASS。 | 无重大遗留。 |
| Phase 2: Main Process, Persistence, and IPC | 98% | 已完成 | 9 个 IPC handler 完整实现；存储升级为目录式 `<id>/person.json` + `runtime.db`（SQLite，sessions/messages/tasks/approvals/kv 五张表）；审批策略运行时解析已实现；创建时传递全部新字段。 | 无重大遗留。 |
| Phase 3: Preload 与 Renderer 基础重写 | 95% | 已完成 | Preload 桥接完整暴露所有 SiliconPerson API；Silicon Rail 右侧头像栏已实现（状态灯、未读、待审批）；ChatPage 已集成 @ mention 投递 + 轻量痕迹卡片。 | 无重大遗留。 |
| Phase 4: Workspace 与 Tabs | 95% | 已完成 | 四 tab 系统（聊天/资料/任务/能力）已落地；资料 tab 支持编辑（含 baseIdentity、rolePersona、soul、模型快照展示）；任务 tab 展示 tasklist；能力 tab 展示工作流绑定与运行态；tasklist 已通过 runtime.db tasks 表持久化。 | 无重大遗留。 |
| Phase 5: Two-Step Creation Flow | 95% | 已完成 | 两段式创建（身份 + 能力绑定）已完成；模板复制（从已有员工复制）已实现；模型快照集成（冻结当前默认模型）已实现；审批模式选择已集成。 | 后续可补模板库（系统模板/用户模板）。 |

### 当前仓库证据

- 旧契约已删除：`employee.ts` 不再存在
- 页面已重命名：`SiliconPersonEntryPage.tsx`、`SiliconPersonWorkspacePage.tsx`
- 核心实现文件：`silicon-person.ts`、`silicon-persons.ts`（IPC）、`silicon-person-session.ts`、`silicon-person-workflow.ts`、`silicon-person-runtime-store.ts`（SQLite）、`SiliconRail.tsx`
- IPC 通道统一为 `silicon-person:*` 和 `cloud:import-silicon-person-package`
- 11 个测试文件全部 PASS（30+ tests）

### 剩余增强项（非阻塞，可后续迭代）

| 项目 | 优先级 | 说明 |
|------|--------|------|
| ~~runtime.db SQLite 存储~~ | ~~中~~ | ✅ 已完成（2026-04-09）：`SiliconPersonRuntimeStore` 类实现，sessions/messages/tasks/approvals/kv 五张表，集成到 session 创建和执行结果同步链路 |
| 头像上传与 assets 目录 | 低 | SiliconPerson 缺 avatarPath 字段和上传 IPC |
| schedules 定时触发 | 低 | 无 schedule 实体和调度运行时 |
| 模板库（系统模板/用户收藏） | 低 | 当前只支持从已有员工复制，无正式模板库 |
| 模型快照版本追踪 | 低 | modelBindingSnapshot 有冻结语义但无版本历史 |

### 建议的滚动更新规则

- 每完成一个 task，就同步更新对应 phase 的完成度、状态和“当前结论”。
- 只有当代码、测试和契约都落地后，phase 才能标记为“进行中”或“已完成”。
- 如果只是新增设计文档、讨论结论或草稿文件，不单独抬高 phase 完成度。

---

## Phase 0: 彻底切断旧 `employees` 假实现

### Task 1: 盘点并删除旧入口假设

**Owner:** Main agent

**Files:**
- Modify: `desktop/src/renderer/pages/EmployeesPage.tsx`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Modify: `desktop/src/main/ipc/*.ts`
- Modify: `desktop/shared/contracts/*.ts`
- Test: `desktop/tests/*employees*.test.ts`

**Step 1: 写下失败测试**

先补测试，确认旧 `employees` 页面和旧字段不再作为产品主入口存在，且新入口以 `SiliconPerson` 为准。

**Step 2: 断开旧实现**

把旧 `employees` 模块视为可直接删除或重写的伪代码，不做迁移兼容，不保留双写层，不保留旧字段 alias。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run`
Expected: 旧测试按预期失败或被替换，新契约测试开始出现。

**Step 4: 记录重写边界**

确认最终只保留 `SiliconPerson` 语义，不再让 UI 和 IPC 继续围绕 `employees` 命名工作。

---

## Phase 1: Shared Contracts First

### Task 2: 定义 `SiliconPerson` 核心契约

**Owner:** Agent B

**Files:**
- Create: `desktop/shared/contracts/silicon-person.ts`
- Modify: `desktop/shared/contracts/index.ts`
- Modify: `desktop/shared/contracts/session.ts`
- Modify: `desktop/shared/contracts/events.ts`
- Test: `desktop/tests/silicon-person-contracts.test.ts`

**Step 1: 写失败测试**

覆盖以下最小契约：

- `SiliconPerson` 基础字段
- status 统一枚举
- currentSession 引用
- 多 session 标识
- 审批状态字段

**Step 2: 实现最小契约**

把 `SiliconPerson` 作为主实体显式导出，保证 renderer 和 main process 用同一套字段。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run tests/silicon-person-contracts.test.ts`
Expected: PASS

### Task 3: 统一 session 与状态 payload

**Owner:** Agent B

**Files:**
- Modify: `desktop/shared/contracts/session.ts`
- Modify: `desktop/shared/contracts/events.ts`
- Modify: `desktop/shared/contracts/plan.ts` 视需要
- Test: `desktop/tests/session-state-contracts.test.ts`

**Step 1: 写失败测试**

覆盖：

- `idle / running / needs_approval / done / error`
- 需要时的 `canceling` 或 `canceled`
- currentSession 缺失时的默认创建语义

**Step 2: 统一状态枚举**

让右侧 rail、工作空间和主聊天都引用同一组状态，不允许各自解释。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run tests/session-state-contracts.test.ts`
Expected: PASS

---

## Phase 2: Main Process, Persistence, and IPC

### Task 4: 重建 employees 相关 IPC 为 SiliconPerson IPC

**Owner:** Agent B

**Files:**
- Create or modify: `desktop/src/main/ipc/silicon-persons.ts`
- Modify: `desktop/src/main/ipc/index.ts`
- Modify: `desktop/src/main/services/state-persistence.ts`
- Modify: `desktop/src/main/index.ts`
- Test: `desktop/tests/silicon-person-ipc.test.ts`

**Step 1: 写失败测试**

确认主线程提供：

- 列表读取
- 创建身份
- 绑定能力
- 切换 currentSession
- 右侧状态更新

**Step 2: 让主线程成为唯一写入者**

持久化和状态变更都应该先落 main process，再广播给 renderer，避免页面自己拼状态。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run tests/silicon-person-ipc.test.ts`
Expected: PASS

### Task 5: 约束默认 session 与 @ 投递规则

**Owner:** Agent B

**Files:**
- Modify: `desktop/src/main/ipc/silicon-persons.ts`
- Modify: `desktop/src/main/ipc/sessions.ts`
- Test: `desktop/tests/silicon-person-session-routing.test.ts`

**Step 1: 写失败测试**

覆盖：

- `@` 投递到 `currentSession`
- 没有 session 时自动创建默认 session
- 新建 session 后可切换 currentSession

**Step 2: 实现 session 路由**

保证主聊天和员工工作空间都能通过同一条 session 语义协作。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run tests/silicon-person-session-routing.test.ts`
Expected: PASS

---

## Phase 3: Preload 与 Renderer 基础重写

### Task 6: 暴露新桥接 API

**Owner:** Agent A

**Files:**
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Test: `desktop/tests/silicon-person-preload.test.ts`

**Step 1: 写失败测试**

验证 renderer 可以调用：

- `listSiliconPersons`
- `createSiliconPerson`
- `updateSiliconPerson`
- `sendToCurrentSession`
- `switchSiliconPersonSession`

**Step 2: 实现 preload 桥接**

只暴露稳定 API，不把业务逻辑塞进 preload。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run tests/silicon-person-preload.test.ts`
Expected: PASS

### Task 7: 重写 Commander Console 与 Silicon Rail

**Owner:** Agent A

**Files:**
- Modify: `desktop/src/renderer/pages/ChatPage.tsx`
- Modify: `desktop/src/renderer/pages/EmployeesPage.tsx`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/silicon-rail-ui.test.ts`
- Test: `desktop/tests/commander-console-ui.test.ts`

**Step 1: 写失败测试**

覆盖：

- 右侧竖排头像 rail
- 状态灯、未读、待审批
- 点击头像进入工作空间
- 主聊天保留轻量痕迹
- `@` 投递逻辑

**Step 2: 重建页面职责**

把 `EmployeesPage.tsx` 从旧员工视图重写为硅基员工入口页或 workspace 容器页，ChatPage 则成为 Commander Console。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run tests/silicon-rail-ui.test.ts tests/commander-console-ui.test.ts`
Expected: PASS

---

## Phase 4: Workspace 与 Tabs

### Task 8: 建立硅基员工工作空间骨架

**Owner:** Agent A

**Files:**
- Modify: `desktop/src/renderer/pages/EmployeesPage.tsx`
- Create or modify: `desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/silicon-person-workspace.test.ts`

**Step 1: 写失败测试**

覆盖四个 tab：

- 聊天
- 资料
- 任务
- 能力

**Step 2: 搭建骨架**

先把路由和页面壳子立起来，再逐步填内容。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run tests/silicon-person-workspace.test.ts`
Expected: PASS

### Task 9: 让主聊天与 workspace 使用同一 session 语义

**Owner:** Agent A + Agent B

**Files:**
- Modify: `desktop/src/renderer/pages/ChatPage.tsx`
- Modify: `desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx`
- Modify: `desktop/src/main/ipc/sessions.ts`
- Test: `desktop/tests/silicon-person-session-coherence.test.ts`

**Step 1: 写失败测试**

覆盖：

- 主聊天不回灌完整结果
- 用户想看完整结果时可点头像进入 workspace
- 当前 session 的状态能在两个区域一致显示

**Step 2: 修正跨层状态同步**

把 session 状态、未读、审批、完成态统一收敛到主线程事件。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run tests/silicon-person-session-coherence.test.ts`
Expected: PASS

---

## Phase 5: Two-Step Creation Flow

### Task 10: 创建身份 + 绑定能力

**Owner:** Agent C

**Files:**
- Modify: `desktop/src/renderer/pages/EmployeesPage.tsx`
- Create or modify: `desktop/src/renderer/components/SiliconPersonCreateDialog.tsx`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Modify: `desktop/src/main/ipc/silicon-persons.ts`
- Test: `desktop/tests/silicon-person-create-flow.test.ts`

**Step 1: 写失败测试**

覆盖两段式流程：

- Step 1 创建身份
- Step 2 绑定能力
- 支持从模板复制
- 支持集成当前模型配置
- 支持设置审批模式

**Step 2: 实现分段创建**

不要把所有表单塞进同一屏，保持身份和能力分离。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run tests/silicon-person-create-flow.test.ts`
Expected: PASS

### Task 11: 绑定模板复制与模型配置

**Owner:** Agent C

**Files:**
- Modify: `desktop/src/main/ipc/silicon-persons.ts`
- Modify: `desktop/src/main/services/model-profile.ts`
- Modify: `desktop/shared/contracts/model.ts`
- Test: `desktop/tests/silicon-person-template-copy.test.ts`

**Step 1: 写失败测试**

确认创建时可以：

- 从模板复制
- 继承当前模型配置
- 设置审批模式
- 保留可覆盖字段和锁定字段边界

**Step 2: 实现模型与模板绑定**

让创建流程知道哪些字段是系统托管，哪些字段可编辑。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run tests/silicon-person-template-copy.test.ts`
Expected: PASS

---

## Phase 6: Status, Feedback, and Light-weight Trace

### Task 12: 主聊天只保留轻量协作痕迹

**Owner:** Agent A

**Files:**
- Modify: `desktop/src/renderer/pages/ChatPage.tsx`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/commander-console-light-trace.test.ts`

**Step 1: 写失败测试**

确认主聊天不自动展开完整执行结果，只保留摘要、状态卡片或跳转提示。

**Step 2: 限制回灌内容**

把完整结果留给 workspace，把轻量痕迹留在 Commander Console。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run tests/commander-console-light-trace.test.ts`
Expected: PASS

### Task 13: 统一状态灯与审批提示

**Owner:** Agent B

**Files:**
- Modify: `desktop/src/main/ipc/silicon-persons.ts`
- Modify: `desktop/shared/contracts/events.ts`
- Modify: `desktop/src/renderer/pages/ChatPage.tsx`
- Modify: `desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx`
- Test: `desktop/tests/silicon-person-status-ui.test.ts`

**Step 1: 写失败测试**

覆盖：

- 绿色对号 = done
- 黄色 = needs_approval
- idle / running / error 的统一展示
- 待审批在 rail 和 workspace 的一致提示

**Step 2: 统一事件到 UI 的映射**

避免 renderer 自己猜状态颜色。

**Step 3: 跑测试**

Run: `cd F:/MyClaw/desktop && pnpm vitest run tests/silicon-person-status-ui.test.ts`
Expected: PASS

---

## Phase 7: Cleanup and Verification

### Task 14: 删除旧 employees 相关死代码

**Owner:** Main agent

**Files:**
- Delete or rewrite: `desktop/src/renderer/pages/EmployeesPage.tsx`
- Modify: `desktop/src/renderer/routes/*`
- Modify: `desktop/src/main/ipc/*`
- Modify: `desktop/shared/contracts/*`

**Step 1: 扫描残留引用**

确认仓库里没有继续把旧 `employees` 当成主产品入口的残留路径。

**Step 2: 收口到 SiliconPerson**

所有页面、IPC、状态和测试都只围绕 `SiliconPerson` 工作。

**Step 3: 跑全量验证**

Run:

```bash
cd F:/MyClaw/desktop && pnpm vitest run
cd F:/MyClaw/desktop && pnpm typecheck
```

Expected: PASS

### Task 15: 最终复核与文档同步

**Owner:** Main agent

**Files:**
- Modify: `docs/plans/2026-04-08-silicon-employee-ui-design.md`
- Modify: `docs/plans/2026-04-08-silicon-employee-implementation-plan.md`
- Optional modify: `docs/architecture/*` 或 `docs/design/*` 视需要

**Step 1: 复核契约和命名**

确认以下内容统一：

- `SiliconPerson`
- `Commander Console`
- `Silicon Rail`
- currentSession
- 统一状态枚举

**Step 2: 复核验证结果**

确认 renderer、main、preload、contracts、tests 的变更边界清晰，没有多人互相覆盖。

**Step 3: 归档**

如果 implementation 期间发现产品边界有新的稳定结论，再补到架构或设计文档里。

---

## Recommended Order

1. 先定 `shared contracts`
2. 再定 `main process + persistence`
3. 再重写 `preload + renderer`
4. 然后落 `workspace + create flow`
5. 最后做 `cleanup + verification`

## Likely Rewrite Targets

以下文件大概率会被重写或大幅移动，但不一定全部保留最终命名：

- `desktop/src/renderer/pages/EmployeesPage.tsx`
- `desktop/src/renderer/pages/ChatPage.tsx`
- `desktop/src/renderer/stores/workspace.ts`
- `desktop/src/preload/index.ts`
- `desktop/src/renderer/types/electron.d.ts`
- `desktop/src/main/ipc/employees.ts`
- `desktop/src/main/ipc/sessions.ts`
- `desktop/src/main/services/state-persistence.ts`
- `desktop/shared/contracts/session.ts`
- `desktop/shared/contracts/events.ts`
- `desktop/shared/contracts/model.ts`

## Main-Thread Coordination Points

实现时需要主线程统一补充的点有：

- 统一 `SiliconPerson` 的持久化 schema
- 统一状态枚举与事件名
- 统一 currentSession 的创建规则
- 统一审批模式与待审批提示的语义
- 统一主聊天轻量痕迹的落库边界

## Done Criteria

- 旧 `employees` 伪实现被替换，不再作为主路径
- 主聊天变成 Commander Console
- 右侧变成 Silicon Rail
- 点击头像能进入硅基员工工作空间
- 每个硅基员工支持多个 session
- `@` 能投递到 currentSession，没有 session 时自动创建默认 session
- 主聊天只保留轻量协作痕迹，不回灌完整结果
- 创建流程明确分为身份创建与能力绑定两步
- 文档、契约和测试都围绕 `SiliconPerson` 统一

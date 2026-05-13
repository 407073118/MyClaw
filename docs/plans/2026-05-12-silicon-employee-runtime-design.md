# Silicon Employee Runtime 设计方案

> 日期：2026-05-12
> 范围：根仓库新增独立工作区 `silicon/` 的前置设计。
> 结论：先把 Silicon Employee Runtime 设计成本地硅基员工操作系统，不接入 `desktop/`，先完成独立自治最小闭环。

## 1. 总判断

Silicon Employee Runtime 不是 `myclaw-desktop` 的一个页面，也不是一个单独员工项目。它应该是当前仓库下第三个独立工作区：

```text
F:\MyClaw\
  desktop\    # 人类工作台和现有桌面产品
  cloud\      # 云端能力
  silicon\    # 本地硅基员工运行时
```

`silicon/` 的职责是孵化、运行、测试、审计无数个本地硅基员工。每个员工不是代码仓库，而是平台里创建出来的运行实例。点击“新建员工”时，平台生成一个完整的员工文件夹生命体，里面包含 soul、心跳、待办、记忆、技能、工具、审批、运行日志、产物和测试。

第一阶段不做 `desktop` 通信层。`desktop` 可以继续独立迭代，`silicon/` 先用 CLI 和本地 daemon 跑通最小闭环。等运行时稳定后，`desktop` 只通过协议把任务派给 `silicon/`，并订阅状态、审批和产物。

## 2. 钱学森工程控制论映射

这个项目必须按工程控制论设计，而不是按聊天机器人设计。控制论关心的是目标、系统、测量、反馈、扰动和稳定性。硅基员工的自治能力来自受控闭环，不来自一次大模型回答。

```text
控制目标：Task / Todo / Schedule / Human Intent
被控对象：Employee Instance
控制器：Harness
执行机构：Skills / Tools / MCP / Shell / File operations
传感器：Heartbeat / Logs / File state / Tool output / Test result
反馈链路：Event Ledger / Review / Memory / Approval
扰动来源：模型失败、工具失败、权限不足、预算耗尽、上下文污染、用户意图变化
稳定机制：Watchdog / Anti-loop / Budget / Sandbox / Recovery / Tests
```

用控制论语言描述一次运行：

1. 用户或系统给出目标，形成任务输入。
2. Heartbeat 和 Scheduler 观测员工状态、任务队列、审批、上次失败和环境变化。
3. Harness 把目标、soul、policy、memory、skill 组合成受限执行计划。
4. Executor 调用工具、脚本、MCP 或模型。
5. Verifier 检查产物是否满足目标。
6. Ledger 记录所有观测、决策、工具调用和结果。
7. Review 把本次运行的误差、失败、经验写成复盘。
8. Memory 只沉淀可追溯、高置信、可删除的长期经验。
9. Watchdog、Anti-loop、Budget、Approval 负责把系统拉回稳定区间。

核心原则：自治不是无限运行，而是有退出条件的受控推进。

## 3. 产品定位

Silicon Employee Runtime 是一个本地员工操作系统：

```text
像游戏一样创建角色
像 CI/CD 一样执行任务
像控制论系统一样反馈纠偏
像操作系统一样隔离资源
像审计系统一样记录事实
```

它需要支持三类对象：

- 平台对象：定义、策略、能力、测试、审计。
- 员工对象：实例、soul、记忆、待办、心跳、运行状态。
- 执行对象：任务、会话、运行、工具调用、审批、产物、复盘。

## 4. MVP 目标

MVP 只证明“一个本地平台能安全创建和运行多个员工”：

1. CLI 创建员工模板。
2. CLI 从模板创建多个员工实例。
3. 每个员工生成完整文件夹生命体。
4. CLI 投递任务到指定员工 inbox。
5. 本地 heartbeat 扫描 queued task。
6. Harness 执行一个 bounded run。
7. 关键事件写入 run ledger。
8. 运行产出 artifact 和 review。
9. 员工 CI 能验证模板、skill、policy、sandbox。

暂不做：

- `desktop` 通信。
- 云同步。
- 员工商店。
- 多机分布式。
- 自由 swarm。
- 复杂 UI。
- 自动改 soul。
- 自动扩大权限。

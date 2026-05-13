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

## 4. 平台和员工边界

源码项目实现平台，不实现具体员工。

```text
silicon/ 源码
  负责 runtime、harness、scheduler、policy、sandbox、testing。

runtime-data/employees/{employeeId}/
  保存每个员工自己的生命体数据。
```

员工是 definition、instance、policy、memory、workspace、skills、tools 的组合。员工数量增长不应该让源码仓库膨胀。

### 4.1 Employee Definition

员工模板，描述“这种员工是什么职业”，不保存运行态。

示例：

```text
research-analyst
code-maintainer
meeting-assistant
customer-support-agent
document-organizer
```

定义内容：

- 默认 soul 模板。
- 默认 skill 集合。
- 默认 tool loadout。
- 默认审批策略。
- 默认预算策略。
- 默认测试集。

### 4.2 Employee Instance

员工实例，是真正运行的本地生命体。

核心字段：

```text
employeeId
definitionId
displayName
status
soulVersion
policyVersion
workspaceId
modelProfile
createdAt
updatedAt
```

实例可以被创建、暂停、恢复、克隆、归档、删除、导出。

## 5. 员工文件夹生命体

新建员工时生成完整目录：

```text
runtime-data/
  employees/
    ada/
      soul/
        current.md
        changelog.md
      profile.json
      policy.yaml
      heartbeat/
        state.json
        events.jsonl
      inbox/
      todos/
      runs/
      memory/
      skills/
      tools/
      loadouts/
      approvals/
      artifacts/
      reviews/
      logs/
      tests/
```

这些目录的语义：

| 目录 | 含义 |
| --- | --- |
| `soul/` | 员工宪法，定义职责、风格、边界、汇报标准 |
| `profile.json` | 员工身份、状态摘要、模型绑定 |
| `policy.yaml` | 权限、审批、预算、运行限制 |
| `heartbeat/` | 心跳状态和心跳事件 |
| `inbox/` | 外部投递任务 |
| `todos/` | 员工内部意图队列 |
| `runs/` | 每次任务运行的状态、检查点和事件 |
| `memory/` | 分层记忆 |
| `skills/` | 员工私有技能包 |
| `tools/` | MCP、shell、文件、网络等工具配置 |
| `loadouts/` | 不同任务场景启用的技能和工具组合 |
| `approvals/` | 待审批动作和审批结果 |
| `artifacts/` | 稳定产物 |
| `reviews/` | 运行复盘和经验沉淀 |
| `logs/` | 人类可读日志 |
| `tests/` | 员工能力测试和 golden cases |

## 6. Soul 设计

Soul 不是人格装饰，而是员工宪法。它决定员工如何判断、如何拒绝、如何汇报。

`soul/current.md` 建议包含：

```text
# 身份
你是谁，你服务什么目标。

# 职责
你负责哪些领域，不负责哪些领域。

# 工作原则
如何处理不确定性，如何引用来源，如何保护用户数据。

# 行为边界
禁止事项、必须审批事项、必须停止事项。

# 汇报标准
完成时输出什么，失败时输出什么，卡住时输出什么。

# 记忆规则
哪些信息可以沉淀为长期记忆，哪些不能沉淀。

# 测试标准
这个员工被认为可用前必须通过哪些测试。
```

Soul 必须版本化。自动运行不能随意改 soul，只能提出 soul 变更建议，经过人类确认后写入新版本。

## 7. Heartbeat 设计

Heartbeat 是生命脉冲，也是控制论里的观测 tick。它不是每次都调用大模型，而是优先做轻量确定性扫描。

每次 heartbeat 做：

1. 检查员工是否启用。
2. 检查 inbox 是否有新任务。
3. 检查 todos 是否有到期或阻塞事项。
4. 检查 runs 是否有 interrupted、stalled、waiting_approval。
5. 检查 approvals 是否有新结果。
6. 检查 budget 是否足够。
7. 检查 memory 是否需要压缩或沉淀。
8. 写入 heartbeat event。

Heartbeat 输出三类结果：

```text
noop          无事发生
enqueue_task 发现可推进任务
escalate     发现需要人类注意的问题
```

心跳必须限流。MVP 建议每个员工默认 60 秒或 5 分钟检查一次，且每次只推进有限数量的任务。

## 8. Todo 和自动战斗

Todo 是员工自己的意图队列。它不是用户待办，也不是聊天上下文里的自然语言列表。

```text
inbox  = 外部给员工的任务
todo   = 员工自己承诺要做的动作
run    = 一次实际执行
review = 执行后的复盘
```

Todo 状态机：

```text
queued
  -> running
  -> waiting_approval
  -> blocked
  -> done
  -> failed
  -> cancelled
```

自动战斗映射为受控执行循环：

```text
observe -> plan -> act -> verify -> adjust -> report
```

自动战斗必须有规则：

- 最大模型轮数。
- 最大工具调用数。
- 最大运行时长。
- 最大重试次数。
- 重复动作检测。
- 无进展检测。
- 预算检查。
- 审批门禁。
- 可解释停止。

## 9. Memory 设计

Memory 不能是黑箱。MVP 先做可审计记忆账本，再考虑向量检索。

分层：

```text
working-memory      当前任务短期记忆
episodic-memory     运行经历和战报摘要
semantic-memory     稳定事实和项目知识
preference-memory   用户偏好
tool-memory         工具可用性、失败模式、路径约定
reflection-memory   复盘、错误、改进建议
pinned-memory       人类固定上下文
```

每条 memory 必须有来源：

```json
{
  "id": "mem_001",
  "type": "semantic",
  "content": "用户偏好中文输出，并喜欢结构化方案。",
  "source": {
    "runId": "run_001",
    "eventId": "evt_009"
  },
  "confidence": 0.82,
  "createdAt": "2026-05-12T10:10:00Z",
  "lastUsedAt": null
}
```

禁止把审批历史自动升级为永久权限。记忆只影响上下文，不直接扩大权限。

## 10. Skills 和 Loadout

Skill 是员工培训手册和可执行 SOP。结构建议：

```text
skills/document-organizer/
  SKILL.md
  references/
  scripts/
  templates/
  tests/
```

`SKILL.md` 必须声明：

- 适用场景。
- 输入输出。
- 标准步骤。
- 可用工具。
- 风险等级。
- 验收标准。
- 失败处理。
- 测试用例。

Loadout 是某类任务启用的一组技能和工具：

```text
loadouts/research.yaml
loadouts/code-review.yaml
loadouts/file-organize.yaml
```

执行前必须固定本次 loadout，避免运行中突然获得过大权限。

## 11. Harness 状态机

Harness 是控制器。它推进一次 bounded run。

Run 状态机：

```text
created
  -> analyzing
  -> planning
  -> executing
  -> verifying
  -> reviewing
  -> succeeded
```

异常路径：

```text
executing -> waiting_approval
executing -> budget_exhausted
executing -> anti_loop_stopped
executing -> failed
executing -> cancelled
executing -> interrupted
```

Harness 每一轮必须写事件：

```json
{
  "eventId": "evt_001",
  "runId": "run_001",
  "employeeId": "ada",
  "type": "tool_called",
  "capability": "filesystem.read",
  "createdAt": "2026-05-12T10:00:00Z"
}
```

Ledger 是事实源，不能被员工改写。

## 12. Policy、Sandbox 和 Approval

Policy 是权限边界，必须在工具执行层强制，不只写进 prompt。

MVP 权限层：

- 文件读写边界。
- shell 命令边界。
- 网络边界。
- MCP server 边界。
- secret 引用边界。
- 单次运行预算。
- 员工每日预算。

默认策略：

```text
读员工 workspace：允许
写员工 artifacts：允许
写用户授权目录：需要审批
删除文件：需要审批
shell 命令：需要审批
外部网络：需要审批
跨员工目录访问：禁止
secret 读取：只能通过引用，不能写入日志或记忆
```

Approval 是一等状态：

```text
requested -> approved -> resumed
requested -> denied -> replanned
requested -> expired -> blocked
```

## 13. Watchdog、Anti-loop 和预算

Watchdog 检查运行健康：

- run 超时。
- 模型调用超时。
- 工具调用卡住。
- heartbeat 长期未更新。
- running 状态没有活跃执行器。
- 应用重启后遗留 running。
- 连续失败过多。
- 审批长期未处理。

Anti-loop 检查自治稳定性：

- 相同工具和相似参数重复调用。
- 连续多轮没有新增产物。
- 连续多轮没有 todo 状态变化。
- 反复请求同一审批。
- 反复读同一无效文件。

RunBudget 包含：

```text
tokenBudget
toolCallBudget
timeBudgetMs
costBudget
retryBudget
approvalBudget
heartbeatBudget
```

预算耗尽进入 `budget_exhausted`，并生成可解释结果，而不是静默失败。

## 14. 员工 CI 和自动化测试

自主 agent 的流程应按 CI/CD 设计。运行时的可靠性靠 pipeline、测试、门禁、产物和日志，而不是靠“模型看起来聪明”。

映射：

```text
CI trigger       -> inbox / heartbeat / schedule
Pipeline         -> Employee Run
Stage            -> analyze / plan / execute / verify / review
Job              -> skill step / tool call / todo step
Runner           -> employee runtime
Artifacts        -> 员工产物
Logs             -> event ledger
Cache            -> memory
Secrets          -> credential references
Manual approval  -> approval gate
Retry            -> controlled retry
Rollback         -> checkpoint recovery
```

测试分层：

| 类型 | 目标 |
| --- | --- |
| contract tests | 验证 Employee、Task、Run、Skill、Memory schema |
| state-machine tests | 验证状态转换合法 |
| policy tests | 验证危险动作被拦截 |
| sandbox tests | 验证路径逃逸、跨员工访问、危险命令失败 |
| skill golden tests | 验证固定输入下 skill 输出结构稳定 |
| fake-model tests | 用假模型测试 harness，不依赖真实 LLM |
| replay tests | 用 events.jsonl 重放一次 run |
| recovery tests | 中途 kill 进程后可恢复 |
| chaos tests | 模型超时、工具卡死、审批超时、预算耗尽 |
| eval tests | 某类员工能力基准集 |

员工模板发布前必须跑 employee CI：

```text
validate soul
validate policy
validate skill manifests
run sandbox tests
run golden tasks
check artifact output
check memory write rules
check audit completeness
```

## 15. MVP 范围

MVP 只证明“一个本地平台能安全创建和运行多个员工”。

必须实现：

1. CLI 创建员工模板。
2. CLI 从模板创建多个员工实例。
3. 每个员工生成完整文件夹生命体。
4. CLI 投递任务到指定员工 inbox。
5. 本地 daemon 扫描 heartbeat。
6. Harness 执行一个 bounded run。
7. 文件读写走 sandbox。
8. 高风险动作进入 approval。
9. 所有关键事件写入 ledger。
10. 运行产出 artifact 和 review。
11. 进程中断后可恢复。
12. 员工 CI 能验证模板、skill、policy、sandbox。

暂不做：

- `desktop` 通信。
- 云同步。
- 员工商店。
- 多机分布式。
- 自由 swarm。
- 复杂 UI。
- 大规模向量库。
- 自动改 soul。
- 自动扩大权限。

## 16. 建议源码结构

```text
silicon/
  apps/
    daemon/
    cli/
    console/
  packages/
    core/
    harness/
    scheduler/
    skills/
    capabilities/
    policy/
    sandbox/
    memory/
    observability/
    testing/
  definitions/
    employees/
    skills/
    policies/
  docs/
  tests/
```

职责：

| 路径 | 职责 |
| --- | --- |
| `apps/daemon` | 本地常驻运行时，负责 heartbeat 和 task 推进 |
| `apps/cli` | 创建员工、投递任务、查询状态、跑测试 |
| `packages/core` | 领域对象和状态机 |
| `packages/harness` | 控制论闭环 |
| `packages/scheduler` | heartbeat、todo、重试、恢复 |
| `packages/skills` | skill 发现、校验、加载 |
| `packages/capabilities` | 文件、shell、MCP、网络等 adapter |
| `packages/policy` | 审批、预算、风险裁决 |
| `packages/sandbox` | 文件、进程、网络隔离 |
| `packages/memory` | 分层记忆 |
| `packages/observability` | ledger、log、trace、metrics |
| `packages/testing` | employee CI、replay、fake model、chaos |

## 17. 技术选型原则

先定思路，再定技术。当前建议：

- 第一版继续 TypeScript + Node，与现有仓库生态一致。
- 包管理继续 pnpm workspace。
- 本地存储优先 SQLite，用于 state、tasks、runs、approvals、ledger 索引。
- 大体积事件可用 JSONL，便于 append-only、回放和人工检查。
- CLI 用 Node 实现，先不要做 UI。
- 测试用 Vitest。
- 模型适配层先抽接口，MVP 可先用 fake model 和一个真实 provider。
- MCP 作为后续 capability adapter，不作为 MVP 第一任务。
- Rust/Go daemon 暂不引入，避免过早增加构建复杂度。

## 18. 第一阶段验收标准

第一阶段完成后，应能执行：

```text
silicon employee create --template document-organizer --name Ada
silicon employee create --template code-reviewer --name Lin
silicon task create --employee Ada --input examples/tasks/organize-docs.json
silicon daemon start
silicon task status <taskId>
silicon employee test Ada
```

验收结果：

1. `Ada` 和 `Lin` 各自有完整文件夹生命体。
2. `Ada` 能从 inbox 接收任务。
3. heartbeat 能发现任务并创建 run。
4. run 能写入 events.jsonl。
5. 文件读取和产物写入受 sandbox 限制。
6. 高风险动作会生成 approval。
7. run 结束生成 artifact 和 review。
8. fake model 测试可稳定通过。
9. kill daemon 后重启能恢复 interrupted run。
10. `employee test` 能跑模板、skill、policy、sandbox 的门禁。

## 19. 后续接入 desktop 的原则

接入 `desktop` 只做协议，不做代码耦合。

`desktop` 只能调用：

```text
createTask
cancelTask
approveAction
listEmployees
getTaskStatus
subscribeEvents
openArtifact
sendFollowUp
```

`desktop` 不直接读员工内部目录，不 import `silicon` 内部 runtime 代码，不绕过 policy 和 sandbox。

## 20. 参考资料

- GitLab CI Jobs: https://docs.gitlab.com/ci/jobs/
- GitLab Pipelines: https://docs.gitlab.com/ci/pipelines/
- GitHub Actions: https://docs.github.com/en/actions/learn-github-actions/understanding-github-actions
- MCP Tools: https://modelcontextprotocol.io/docs/concepts/tools
- Claude Skills: https://claude.com/docs/skills/overview
- Engineering cybernetics: 60 years in the making: https://link.springer.com/article/10.1007/s11768-014-4031-0


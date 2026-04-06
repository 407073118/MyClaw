# Desktop Model Capability Amplifier Design

**Date:** 2026-04-06  
**Scope:** `desktop/` runtime, session orchestration, provider adapters, planning runtime, delegation runtime  
**Status:** Design baseline with historical shipping summaries; phase scorecards are the canonical shipped-state source

## Background

`MyClaw desktop` 当前已经具备比较强的上下文工程基础，包括模型能力契约、能力解析、上下文预算、上下文压缩、工具审批、多轮工具循环与部分 provider-aware 兼容逻辑。这些基础说明当前系统并不缺“工程组织能力”，真正缺的是一个能够持续放大模型能力上限的统一运行时。

当前问题不在于是否还能继续接更多模型，也不在于是否能展示 reasoning，而在于模型能力增强逻辑仍然分散在多个层次：有些增强在 `model-client`，有些在 `sessions` 的 agentic loop，有些在特定模型诊断逻辑里，有些只停留在设计文档或局部补丁。这样会导致四类关键能力难以持续增长：

1. 多轮工具调用稳定性不足，assistant 回合中的 reasoning、tool_call 与 provider 特有字段不能稳定回放。
2. 深度推理能力没有统一运行时控制面，reasoning 更像“可显示元数据”，而不是会话级执行模式。
3. 复杂任务规划仍主要依赖 prompt 与模型自身发挥，缺少结构化 task state。
4. 并行委派还不是运行时一级能力，无法作为复杂任务完成率的放大器。

本设计的目标不是“让 `MyClaw` 长得像别的项目”，而是把它重构为一个 `Capability Amplifier Runtime`：让 thinking、reasoning replay、planning、delegation、provider patch、降级与验证都成为统一能力底座的一部分，从而真正榨干模型的执行上限。

## Goals

1. 在 `desktop/` 内建立统一的 `Capability Runtime`，让每次模型调用都先形成明确的执行计划，再进入 provider adapter 与执行核心。
2. 让 `MiniMax + OpenAI-compatible` 成为第一批 `Tier-1` 能力放大对象，优先解决 reasoning 保真、多轮工具稳定性、兼容回退与 replay。
3. 把 `planning` 与 `delegation` 从“未来能力”升级为可阶段接入的运行时插件，而不是零散功能点。
4. 建立一套面向“能力提升”的验证体系，证明模型真的更稳、更深、更能完成复杂任务，而不只是代码更复杂。
5. 允许激进重构，优先追求能力上限，而不是维持当前内部主链路不变。

## Non-Goals

1. 本轮不追求最先完成产品化模式包装；`Thinking / Planner / Ultra` 等模式名称不是优先目标。
2. 本轮不要求一开始就把所有 provider 一次性做深；`MiniMax + OpenAI-compatible` 是第一优先。
3. 本轮不把 `desktop` 与 `cloud` 同步统一设计；云侧能力可在后续阶段对齐。
4. 本轮不把“展示 reasoning”当作成功标准；真正标准是多轮稳定性、任务完成率与能力上限提升。

## Phase 1 Shipping Summary

Phase 1 已经落地到运行时底座层，不再停留在设计草图。当前 shipped 的范围是 contracts、runtime shell、adapter 边界、transport 拆分与 session 串接；planner / delegator 仍然留在后续 phase。规范性的 shipped-state 记录以 `docs/plans/2026-04-06-phase1-capability-scorecard.md` 为准，本节只保留摘要。

### What Actually Shipped

- Session runtime contracts + `runtimeVersion` / `runtimeIntent` metadata
- `reasoning-runtime` shell + `buildExecutionPlan`
- provider adapters: `br-minimax`, `openai-compatible`
- `model-transport`
- `model-sse-parser`
- `model-client` now flows through `executionPlan` + adapter + transport / parser boundaries
- `sessions.ts` now generates execution plans before model calls
- `ipc/models` and `br-minimax-runtime` reuse `buildRequestHeaders`

### Verification Snapshot

- Focused Phase 1 batch passed: 11 files / 33 tests
- The batch expanded beyond the original 9-file list because transport / parser tests were added
- `desktop` typecheck passed

### Remaining Gaps Before Phase 2

- `ExecutionPlan` is still a thin Phase 1 shell; the full `intent -> plan -> execute` runtime is not in place
- planner runtime, delegation runtime, and structured task state are still future work
- broader regression and golden transcript coverage still needs to be expanded before the Phase 2 cutover

See `docs/plans/2026-04-06-phase1-capability-scorecard.md` for the canonical Phase 1 shipped-state appendix, exact file list, and verification commands.

## Phase 2 Shipping Summary

Phase 2 已经把 Phase 1 的 runtime shell 推进为可解释、可持久化、可验证的 execution-plan runtime。当前 shipped 的重点是让每次会话调用在执行前先完成能力决策、replay 策略选择、降级路径判断与上下文装配协同，并让这些结果能在 session 生命周期里保留与回放。planner / delegator 仍然没有进入本 phase。规范性的 shipped-state 记录以 `docs/plans/2026-04-06-phase2-capability-scorecard.md` 为准，本节只保留历史摘要。

### What Actually Shipped

- session runtime now carries the richer intent and execution metadata needed to explain how a turn will run
- execution planning now decides replay behavior, adapter path, and degradation handling before model execution
- context assembly and compaction now preserve replay-aware behavior instead of treating reasoning as generic carry-over
- session send flow now follows one consistent `intent -> plan -> context -> execute` pipeline
- persisted sessions now round-trip `executionPlan` and Phase 2 runtime metadata without losing fidelity
- degradation and integration coverage now locks the Phase 2 runtime cutover in place

### Verification Snapshot

- Authoritative verification for Phase 2 is the focused 11-file batch rerun plus `desktop` typecheck
- Focused Phase 2 batch passed: 11 files / 34 tests

### Remaining Gaps Before Phase 3

- planner runtime has not started
- delegation runtime has not started
- a small low-risk follow-up remains available if needed later: centralize replay-policy precedence into one helper instead of leaving it distributed across Phase 2 call sites

See `docs/plans/2026-04-06-phase2-capability-scorecard.md` for the canonical Phase 2 shipped-state appendix, exact file list, and verification commands.

## Architecture Direction

新的能力放大架构建议分为五层：

### 1. Session Intent Layer

当前会话状态以 `modelProfileId` 为核心，这更接近“选择模型”，而不是“声明本轮希望模型如何工作”。新架构需要补充一层与 provider 无关的会话运行时意图，例如：

- `thinkingEnabled`
- `reasoningEffort`
- `reasoningReplayPolicy`
- `planningEnabled`
- `delegationEnabled`
- `toolStrategy`
- `failurePolicy`

这一层只表达产品级与运行时级抽象，不直接暴露 provider 原始字段。

### 2. Capability Runtime

新增统一的 `Capability Runtime` 作为真正中枢。它的职责是把以下输入整合成一份 `ExecutionPlan`：

- Session intent
- Model profile
- Resolved capability
- Provider diagnostics
- Recent run telemetry
- 当前消息上下文

`ExecutionPlan` 至少需要描述：

- 是否开启 reasoning
- reasoning effort 使用哪档
- 是否回放 assistant reasoning
- 是否回放 provider 特定字段
- 是否启用 planner runtime
- 是否允许 delegation runtime
- 请求使用哪条 adapter path
- 如果失败，应如何降级

### 3. Provider Adapter Layer

`Provider Adapter` 负责承接 provider-specific 能力与限制，并把其封装为 runtime 可消费的稳定能力。

第一批优先实现：

- `provider-adapters/minimax.ts`
- `provider-adapters/openai-compatible.ts`
- `provider-adapters/base.ts`

后续再补：

- `provider-adapters/anthropic.ts`
- `provider-adapters/openrouter.ts`

这里的重点不是简单字段映射，而是：

- reasoning / thinking 请求 patch
- assistant reasoning replay
- tool-call replay
- provider 特有字段 replay
- fallback / degrade path
- 失败诊断与遥测

### 4. Execution Core

保留并增强当前已有的执行优势：

- context assembler
- token budget / compaction
- approval system
- tool loop
- loop detection
- A2UI / structured UI

但执行核心不再直接决定 provider thinking 逻辑，而是消费 `ExecutionPlan`。

### 5. Runtime Plugins

把规划与委派做成插件式运行时能力：

- `planning-runtime`
- `delegation-runtime`

它们不是一开始就铺满全链路，而是按阶段挂到 runtime 上。

## Core Design Principles

### Principle 1: Replay Is a First-Class Capability

如果 assistant reasoning、tool calls、provider 特有字段不能在多轮中稳定回放，模型能力会逐轮衰减。`Replay` 不是显示层元数据，而是 agentic runtime 的核心设施。

### Principle 2: Intent and Protocol Must Be Separated

会话层只表达“我要更深推理”“我要计划”“我要允许委派”；provider adapter 决定这些意图如何翻译为具体协议。

### Principle 3: Planning and Delegation Are Runtime Powers

复杂任务完成率不应主要依赖 prompt。planning 与 delegation 必须以可观测、可验证、可禁用、可降级的运行时能力接入。

### Principle 4: Validation Must Measure Capability Gain

每个阶段都必须用真实任务证据证明模型能力提升，而不是只靠架构整洁度。

## Capability Tracks

本方案同时覆盖四条能力路线，但按基础设施优先级推进。

### Track A: Multi-Turn Tool Stability

目标：让模型在 5 到 20 轮工具循环后依然不明显钝化。

关键机制：

- 完整 assistant turn replay
- reasoning replay policy
- tool-call replay policy
- provider patch/fallback
- loop-aware telemetry

### Track B: Deep Reasoning Quality

目标：让模型在复杂任务中更敢拆、更能保留中间推理、更少保守回答。

关键机制：

- 会话级 thinking intent
- reasoning effort runtime
- provider-specific thinking path
- reasoning replay 与 degradation policy

### Track C: Complex Task Completion

目标：让模型不只会回答，而是真的更能持续推进复杂任务。

关键机制：

- planning runtime
- structured task state
- progress updates
- planner telemetry

### Track D: Parallel Delegation

目标：让模型在复杂任务中真正拥有拆分与并行探索能力。

关键机制：

- delegation runtime
- subtask state
- worker result merge
- budget guard
- anti-loop guard

## Recommended Phase Path

### Phase 1: Replay + Adapter Core

这一阶段只做最值钱的基础设施，不急着做 planner 或 subagent。

交付目标：

- 新建 `reasoning-runtime.ts` 雏形
- 建立 `provider-adapters/base.ts`
- 实现 `MiniMax` 与 `OpenAI-compatible` adapter
- 把 `model-client.ts` 下沉成 transport 层
- 建立 assistant reasoning replay / tool-call replay 机制
- 建立 provider fallback 机制

成功标准：

- 多轮工具任务中 reasoning 不丢
- MiniMax reasoning path 能自动探测与回退
- provider patch 不再散落在单文件特判中

### Phase 2: Execution Plan Runtime

这一阶段把“能力增强逻辑”从若干实现细节升级为真正的执行计划。

交付目标：

- 建立 `ExecutionPlan`
- 将 session intent 与 runtime diagnostics 汇总到 plan
- `sessions.ts` 改为 `intent -> plan -> execute`
- `context-assembler` 接入 replay policy
- 引入失败降级链路与 plan telemetry

成功标准：

- 每次模型调用都可解释“为什么这么执行”
- reasoning / replay / adapter / degrade 决策不再散落

### Phase 3: Planning Runtime

这一阶段开始真正提升复杂任务完成率。

交付目标：

- 新建 `runtime-plugins/planner.ts`
- 定义结构化 plan state / task state
- 将 plan state 接入 session 持久化
- 在 tool loop 中维护 task progress
- 增加最小展示与调试能力

成功标准：

- 复杂任务可持续推进，不靠 prompt 临时发挥
- 中间任务状态可见、可回放、可验证

### Phase 4: Delegation Runtime

这一阶段把复杂任务拆解与并行变成真正能力。

交付目标：

- 新建 `runtime-plugins/delegator.ts`
- 定义 subtask state / worker result contract
- 实现 lane 调度与预算隔离
- 结果合并、超时、失败与循环保护

成功标准：

- 在复杂任务中，delegation 能提升完成率而不是只增加噪音

### Phase 5: Productization

最后才进行面向用户的产品化封装。

交付目标：

- 运行时 preset，例如 `Direct / Think / Plan / Delegate`
- 能力诊断页面
- 失败原因解释
- 试验开关与回归矩阵

成功标准：

- 用户看到的模式只是 runtime preset，而不是逻辑散落包装

## File Impact

### High Priority New Files

- `desktop/shared/contracts/session-runtime.ts`
- `desktop/src/main/services/reasoning-runtime.ts`
- `desktop/src/main/services/provider-adapters/base.ts`
- `desktop/src/main/services/provider-adapters/minimax.ts`
- `desktop/src/main/services/provider-adapters/openai-compatible.ts`
- `desktop/src/main/services/runtime-plugins/planner.ts`
- `desktop/src/main/services/runtime-plugins/delegator.ts`
- `desktop/src/main/services/execution-plan.ts`

### High Priority Existing Files To Refactor

- `desktop/shared/contracts/session.ts`
- `desktop/shared/contracts/model.ts`
- `desktop/src/main/ipc/sessions.ts`
- `desktop/src/main/services/model-client.ts`
- `desktop/src/main/services/context-assembler.ts`
- `desktop/src/main/services/model-capability-resolver.ts`
- `desktop/src/renderer/pages/ChatPage.tsx`
- `desktop/src/renderer/pages/ModelDetailPage.tsx`

## Multi-Agent Execution Plan

整个方案适合按写入边界拆成稳定并行 lanes。

### Leader Lane

职责：

- 维护总架构约束
- 审核接口契约
- 决定 phase 顺序与合并顺序
- 维护验证基线

不承担大块实现，只负责 orchestration。

### Lane 1: Runtime Core

写入范围：

- `desktop/shared/contracts/*`
- `desktop/src/main/services/reasoning-runtime.ts`
- `desktop/src/main/services/execution-plan.ts`
- `desktop/src/main/ipc/sessions.ts`

职责：

- 定义 session intent
- 定义 execution plan
- 串起 runtime 主链路

### Lane 2: Provider Adapter

写入范围：

- `desktop/src/main/services/provider-adapters/*`
- `desktop/src/main/services/model-client.ts`
- `desktop/shared/br-minimax.ts`

职责：

- 处理 MiniMax / OpenAI-compatible adapter
- 处理 replay / fallback / provider diagnostics

### Lane 3: Planning Runtime

写入范围：

- `desktop/src/main/services/runtime-plugins/planner.ts`
- session plan state 相关契约与最小 UI

职责：

- 建立结构化 planning
- 维护 task state

### Lane 4: Delegation Runtime

写入范围：

- `desktop/src/main/services/runtime-plugins/delegator.ts`
- subtask state / orchestration contracts

职责：

- 建立 delegation 执行面
- 处理结果聚合、超时与 budget

### Lane 5: Verification

写入范围：

- `desktop/tests/*`
- `desktop/docs/plans/*` 或验证报告目录

职责：

- 维护 provider contract tests
- 维护 golden transcripts
- 输出 capability scorecard

## Verification Strategy

验证必须围绕“模型能力真的变强了”展开。

### 1. Provider Contract Tests

验证：

- provider request patch
- reasoning replay
- tool-call replay
- fallback / degrade path

### 2. Multi-Turn Golden Transcripts

选取高价值任务，固定输入、工具与目标，对比：

- 3 轮
- 8 轮
- 15 轮

观察是否出现：

- reasoning 丢失
- 工具循环
- 能力钝化
- 过度保守

### 3. Runtime Telemetry

记录：

- 本轮 execution plan
- reasoning / replay 是否开启
- provider 走了哪条 adapter path
- 是否发生降级
- 工具回合数
- planner/delegator 是否触发

### 4. Capability Scorecard

每个 phase 均评估：

- 多轮工具稳定性
- 深度推理质量
- 复杂任务完成率
- 并行委派收益

## Risks

1. 先做 UI 模式而不是先做 runtime，会形成新的包装层而不是能力提升。
2. provider patch 如果继续散落在 `model-client`，后续 planning 与 delegation 会持续受阻。
3. 只展示 reasoning、不定义 replay 语义，会让视觉上更高级，但执行上仍然脆弱。
4. 过早接入 delegation，会把当前链路的混乱并行放大。
5. 如果没有 golden transcripts 和 capability scorecard，后续很难证明能力是否真的增强。

## Decision Summary

最终方向确定为：

- 目标是榨干 `MyClaw desktop` 的模型能力，而不是对标其他项目
- 采用 `Runtime-First Capability Amplifier` 路线
- `desktop` 单工作区优先
- 允许激进重构
- 第一批 `Tier-1` 聚焦 `MiniMax + OpenAI-compatible`
- 所有能力路线都要实现，但按基础设施优先顺序推进：
  - Replay + Adapter
  - Execution Plan Runtime
  - Planning Runtime
  - Delegation Runtime
  - Productization

## Program Delivery Model

为了让这份方案能真正执行，而不是停留在“架构漂亮”，整个计划采用 `Program + Phase + Wave` 三层交付模型。

### Program-Level Rules

1. 任何阶段都不允许只交“实现”，必须同时交：
   - 代码
   - 契约测试
   - golden transcripts
   - telemetry 字段
   - capability scorecard
2. 同一时刻最多运行 6 个并发 child agents。
3. 所有并行 lane 必须按写入边界拆分，禁止多个 lane 同时改同一主入口文件。
4. 每个 phase 都必须先冻结接口，再并行开发，再由 leader 统一集成。
5. 每个 phase 完成后都要形成可复用基础设施，禁止“只对当前模型生效的一次性补丁”。

### Standard Team Composition

每个 phase 采用一个稳定的多-agent 形态：

| Lane | Recommended role | Primary responsibility |
| --- | --- | --- |
| Leader | `architect` + 主代理 | 维护总方案、冻结契约、决定合并顺序 |
| Contract Guard | `architect` / `critic` | 审核 `session/runtime/adapter` 契约 |
| Runtime Core | `executor` | 执行计划主链路、session/runtime 集成 |
| Provider Adapter | `executor` | provider patch、fallback、replay |
| Plugin Lane | `executor` | planner 或 delegator 插件 |
| Verification | `test-engineer` + `verifier` | contract tests、transcripts、scorecard |

当某阶段不需要 plugin lane 时，该 lane 可以让位给 `writer` 或 `code-reviewer` 做文档与合并审计。

### Phase Execution Template

每个 phase 统一拆成 4 个 wave：

1. `Wave 0: Contract Freeze`
   - 明确数据结构
   - 明确写入边界
   - 明确验证矩阵
2. `Wave 1: Parallel Build`
   - Runtime、Adapter、Plugin、Verification 各 lane 并行推进
3. `Wave 2: Integration`
   - Leader 合并到主链路
   - 修复跨 lane 接口不一致
4. `Wave 3: Proof`
   - 跑 golden transcripts
   - 输出 capability scorecard
   - 通过阶段门禁

## Detailed Capability Matrix

为了避免“所有路线都做，但谁也没做透”，每条路线都需要明确增强对象、主要机制和阶段分布。

| Track | Core outcome | Primary phases | Proof target |
| --- | --- | --- | --- |
| Multi-turn tool stability | 10+ 轮工具调用后仍稳定 | Phase 1, 2 | reasoning 不丢、tool replay 完整、循环率下降 |
| Deep reasoning quality | 更深、更敢拆、更少保守 | Phase 1, 2, 5 | 更长 reasoning、较少中途收缩 |
| Complex task completion | 中长任务持续推进 | Phase 3, 5 | task completion rate 提升 |
| Parallel delegation | 并行探索与拆分收益为正 | Phase 4, 5 | 完成率提升且噪音受控 |

## Detailed Phase Plan

### Phase 1: Replay + Adapter Core

#### Objective

先解决最根的问题：模型多轮执行时的“失忆”和“能力钝化”。这一阶段不追求 planner，不追求 UI 模式，不追求 delegation，而是建立所有后续能力的前置底座。

#### Why This Phase Comes First

如果 assistant turn 无法完整回放，后面无论接 planning 还是 delegation，都会在长任务里越来越不稳。Replay 是所有能力的地基。

#### Main Workstreams

##### Workstream 1A: Runtime Shell

- 新建 `desktop/src/main/services/reasoning-runtime.ts`
- 定义 `ReasoningRuntimeInput`
- 定义 `ReplayDecision`
- 定义 `AdapterDecision`
- 为后续 `ExecutionPlan` 预留接口，但先不把完整 plan 体系一次做满

##### Workstream 1B: Provider Adapter Base

- 新建 `desktop/src/main/services/provider-adapters/base.ts`
- 统一 adapter 接口：
  - `prepareRequest`
  - `normalizeResponse`
  - `buildReplayPayload`
  - `buildFallbackVariants`
  - `describeDiagnostics`
- 将 `MiniMax` 现有探测、兼容回退、request body 组装收编进 adapter

##### Workstream 1C: Tier-1 Provider Adapters

- 新建 `provider-adapters/minimax.ts`
- 新建 `provider-adapters/openai-compatible.ts`
- 明确以下能力：
  - reasoning 开关如何映射
  - reasoning replay 如何映射
  - provider 特有字段如何保留
  - fallback 顺序如何定义

##### Workstream 1D: Model Client Transport Demotion

- 将 `model-client.ts` 从“策略 + patch + transport 混合体”削成传输层
- transport 只负责：
  - URL / headers
  - SSE 消费
  - response normalization hooks
- provider-specific 策略迁出到 adapters

##### Workstream 1E: Replay Persistence

- 确认 `ChatMessage.reasoning` 在 session 持久化中是稳定字段
- 定义 assistant replay 物料：
  - final content
  - reasoning
  - tool_calls
  - provider raw metadata（按需）

##### Workstream 1F: Verification Harness

- 增加 replay contract tests
- 增加 MiniMax fallback tests
- 增加 multi-turn golden transcript baseline
- 增加 first-pass telemetry schema

#### Multi-Agent Split

| Lane | Write scope | Output |
| --- | --- | --- |
| Runtime Core | `services/reasoning-runtime.ts`, `shared/contracts/session.ts` | runtime shell |
| Adapter Lane | `services/provider-adapters/*`, `shared/br-minimax.ts` | provider adapters |
| Transport Lane | `services/model-client.ts` | transport-only client |
| Verification Lane | `desktop/tests/*` | replay/fallback/golden tests |

#### Wave Plan

##### Wave 0

- 冻结 `AdapterContract`
- 冻结 replay payload shape
- 冻结 telemetry schema v1

##### Wave 1

- Runtime Core lane 建 `reasoning-runtime.ts`
- Adapter lane 接入 MiniMax / OpenAI-compatible
- Transport lane 清洗 `model-client.ts`
- Verification lane 写 contract tests

##### Wave 2

- Leader 合并 adapter 到 runtime shell
- 接通 `sessions -> runtime -> adapter -> transport`
- 修复 replay 与 fallback 路径

##### Wave 3

- 跑 golden transcripts
- 产出 `PHASE1-CAPABILITY-SCORECARD.md`
- 判断是否进入 Phase 2

#### Exit Criteria

1. `MiniMax` 在 reasoning split / fallback 两条路径上都稳定。
2. assistant reasoning 与 tool calls 能被稳定回放到下一轮。
3. `model-client.ts` 中不再承担核心 provider 策略决策。
4. 至少 5 个高价值任务的 8+ 轮工具循环不出现明显钝化。

### Phase 2: Execution Plan Runtime

#### Objective

把能力增强从“局部 adapter 逻辑”升级为统一执行计划，让每轮调用都有明确的运行时决策，而不是把判断散落在 session、context assembler 与 adapter 中。

#### Main Workstreams

##### Workstream 2A: Session Runtime Contract

- 新建 `desktop/shared/contracts/session-runtime.ts`
- 或扩展 `session.ts` 以容纳：
  - `thinkingEnabled`
  - `reasoningEffort`
  - `planningEnabled`
  - `delegationEnabled`
  - `replayPolicy`
  - `toolStrategy`
  - `runtimeVersion`

##### Workstream 2B: Execution Plan

- 新建 `desktop/src/main/services/execution-plan.ts`
- 定义 `ExecutionPlan`
- 明确 plan 字段：
  - `reasoningMode`
  - `adapterId`
  - `fallbackChain`
  - `replayPolicy`
  - `plannerEnabled`
  - `delegatorEnabled`
  - `toolPolicy`
  - `telemetryEnvelope`

##### Workstream 2C: Session Orchestration Refactor

- 重写 `desktop/src/main/ipc/sessions.ts`
- 新流程改为：
  - 读取 session intent
  - resolve capability
  - build execution plan
  - assemble context
  - call adapter/transport
  - persist telemetry

##### Workstream 2D: Context Policy Integration

- 让 `context-assembler.ts` 不再盲目携带 reasoning
- 引入 replay policy 与 budget 协调
- 允许不同 provider 的 replay 材料被不同权重保留

##### Workstream 2E: Failure & Degradation Chain

- 当 provider 路径失败时，plan 必须记录：
  - 为什么降级
  - 降到了哪条路径
  - 是否关闭了 replay / thinking
  - 本轮是否应提示用户

#### Multi-Agent Split

| Lane | Write scope | Output |
| --- | --- | --- |
| Contract Guard | `shared/contracts/*` | session runtime contract |
| Runtime Core | `services/execution-plan.ts`, `ipc/sessions.ts` | execution plan mainline |
| Context Lane | `services/context-assembler.ts`, `context-compactor.ts` | replay-aware context |
| Verification Lane | `tests/phase2-*` | plan + degrade + integration tests |

#### Wave Plan

##### Wave 0

- 冻结 `ExecutionPlan` schema
- 冻结 session runtime contract

##### Wave 1

- Contract Guard 扩展 session/runtime contract
- Runtime Core 构建 execution plan
- Context Lane 接入 replay policy
- Verification lane 写 plan resolution tests

##### Wave 2

- `sessions.ts` 迁到新主链路
- 联通 plan、context、adapter
- 打通 telemetry

##### Wave 3

- 跑 phase 1 transcripts 回归
- 新增 degrade/fallback 验证
- 生成 `PHASE2-CAPABILITY-SCORECARD.md`

#### Exit Criteria

1. 每轮模型调用都有可追踪的 `ExecutionPlan`。
2. `sessions.ts` 不再直接承载 reasoning/provider patch 细节。
3. degradation 路径可解释、可测试、可观测。
4. 所有 Phase 1 能力在新主链路上无回归。

### Phase 3: Planning Runtime

#### Objective

提升复杂任务完成率，让模型不只是更会“想”，而是更会“持续推进”。

#### Main Workstreams

##### Workstream 3A: Plan State Model

- 定义 `PlanState`
- 定义 `PlanTask`
- 定义 `TaskStatus`
- 设计 plan 与 session 的绑定方式

##### Workstream 3B: Planner Plugin

- 新建 `desktop/src/main/services/runtime-plugins/planner.ts`
- planner 作为 runtime plugin 被 `ExecutionPlan` 激活
- 负责：
  - 生成任务树
  - 更新任务状态
  - 暴露 planner telemetry

##### Workstream 3C: Tool Loop Coordination

- tool loop 在任务完成后自动更新 task state
- tool failure 时能生成 follow-up task 或 blocker state
- loop detect 能感知任务是否实质推进

##### Workstream 3D: Persistence & Minimal UI

- session 内保存 plan state
- renderer 仅提供最小展示，不做复杂产品化
- 支持调试 view 与导出

##### Workstream 3E: Planning Benchmarks

- 设计 5 类复杂任务模板
- 度量：
  - 是否完成关键子任务
  - 是否出现无意义循环
  - 是否过早收尾

#### Multi-Agent Split

| Lane | Write scope | Output |
| --- | --- | --- |
| Planner Core | `runtime-plugins/planner.ts` | planner runtime |
| Persistence Lane | `shared/contracts/session*.ts`, `ipc/sessions.ts` | persisted plan state |
| Tool Loop Lane | `ipc/sessions.ts`, tool loop helpers | task-progress integration |
| Renderer Lane | `renderer/pages/ChatPage.tsx` 或最小 planner panel | minimal planner UI |
| Verification Lane | `tests/phase3-*` | planner benchmarks |

#### Wave Plan

##### Wave 0

- 冻结 plan state schema
- 冻结 planner plugin interface

##### Wave 1

- Planner Core 搭 plugin
- Persistence Lane 接 session 存储
- Tool Loop Lane 接执行更新
- Verification lane 建 benchmark suite

##### Wave 2

- 接通 planner runtime 与 execution plan
- 接入 minimal UI 与 telemetry

##### Wave 3

- 跑复杂任务基准
- 生成 `PHASE3-CAPABILITY-SCORECARD.md`

#### Exit Criteria

1. planner state 可以被生成、更新、持久化、回放。
2. 复杂任务 completion rate 较 Phase 2 有可测提升。
3. planner 不是 prompt 文本，而是结构化 runtime state。

### Phase 4: Delegation Runtime

#### Objective

将 subtask 拆解与并行探索升级为真正的系统能力，让大任务从“单线程长上下文思考”进化到“受控多 lane 执行”。

#### Main Workstreams

##### Workstream 4A: Delegation Contract

- 定义 `DelegationPlan`
- 定义 `SubtaskState`
- 定义 `WorkerResult`
- 定义 `MergePolicy`

##### Workstream 4B: Delegator Plugin

- 新建 `desktop/src/main/services/runtime-plugins/delegator.ts`
- 支持：
  - subtask 拆分
  - lane 调度
  - worker 超时
  - worker 预算限制

##### Workstream 4C: Merge & Anti-Noise

- 把 worker 结果聚合回主 session
- 限制结果噪音
- 避免把重复探索结果无限拼回主上下文

##### Workstream 4D: Planning Integration

- delegator 必须消费 planner state，而不是独立乱拆
- 只对 planner 标记为可拆分的任务开启 delegation

##### Workstream 4E: Delegation Evaluation

- 设计并行适用任务集
- 评估：
  - 完成率提升
  - 噪音是否可控
  - 平均成本是否可接受

#### Multi-Agent Split

| Lane | Write scope | Output |
| --- | --- | --- |
| Delegation Core | `runtime-plugins/delegator.ts` | delegator runtime |
| Planning Bridge | `planner.ts`, delegation contracts | planner-delegator bridge |
| Merge Lane | `ipc/sessions.ts`, merge helpers | result aggregation |
| Guard Lane | loop/budget/failure guard files | anti-noise + guardrail |
| Verification Lane | `tests/phase4-*` | delegation benchmarks |

#### Wave Plan

##### Wave 0

- 冻结 delegation contracts
- 冻结 worker merge policy

##### Wave 1

- Delegation Core 搭 runtime
- Planning Bridge 接 planner state
- Merge Lane 接主会话
- Guard Lane 加预算与循环保护

##### Wave 2

- 接入 execution plan
- 接入 telemetry 与 transcript capture

##### Wave 3

- 跑 delegation benchmark
- 生成 `PHASE4-CAPABILITY-SCORECARD.md`

#### Exit Criteria

1. delegation 只能在 planner 允许的任务上开启。
2. worker 结果聚合可控，不造成主上下文爆炸。
3. 并行任务完成率提升且 loop/noise 没有明显恶化。

### Phase 5: Productization

#### Objective

把前四个 phase 沉淀的 runtime 能力，封装成用户可感知、可调试、可选择、可验证的产品层能力。

#### Main Workstreams

##### Workstream 5A: Preset System

- 设计 runtime preset：
  - `Direct`
  - `Think`
  - `Plan`
  - `Delegate`
- preset 只是 `ExecutionPlan` 默认值集合，不新增隐藏逻辑

##### Workstream 5B: Capability Diagnostics UI

- 模型能力页面显示：
  - provider diagnostics
  - replay status
  - planner/delegator availability
  - recent degrade history

##### Workstream 5C: Failure Explainability

- 当 runtime 降级时，用户能知道：
  - 为什么降级
  - 降级后的能力变化
  - 如何恢复

##### Workstream 5D: Experiment & Rollout Controls

- 引入 feature flags
- 允许 A/B 比较不同 runtime 策略
- 保留 transcript export 与 debug switches

##### Workstream 5E: Full Regression Matrix

- 所有 Tier-1 provider
- 所有 preset
- 所有核心任务集

#### Multi-Agent Split

| Lane | Write scope | Output |
| --- | --- | --- |
| Preset Lane | session/runtime preset files | runtime presets |
| Diagnostics Lane | `ModelDetailPage`, diagnostics helpers | capability diagnostics |
| Explainability Lane | chat/runtime status UI | degrade explanation |
| Verification Lane | regression matrix tests | end-to-end proof |

#### Exit Criteria

1. 模式只是 runtime preset，不重复承载底层逻辑。
2. 用户可感知 runtime 当前实际能力。
3. 整套系统具备实验、回归和可解释性。

## Cross-Phase Dependency Graph

### Hard Dependencies

- Phase 2 依赖 Phase 1 的 adapter/replay 基础
- Phase 3 依赖 Phase 2 的 execution plan
- Phase 4 依赖 Phase 3 的 planner state
- Phase 5 依赖 Phase 1-4 都已沉淀为可配置 runtime

### Soft Dependencies

- diagnostics UI 可以在 Phase 2 后先做内测版
- 部分 telemetry 能在 Phase 1 就提前落地
- golden transcripts 从 Phase 1 就要持续积累，不能拖到最后

## Detailed Verification Matrix

### Transcript Categories

建议维护至少以下任务集：

1. `Tool Replay`
   - 多轮读文件
   - 多轮搜索
   - 搜索后修改
2. `Reasoning Preservation`
   - 复杂推理后调用工具
   - 工具返回后继续推理
3. `Planning`
   - 3 到 8 步任务
   - 中途失败后改计划
4. `Delegation`
   - 可并行检索
   - 可并行比对
5. `Failure Recovery`
   - provider 400/429/5xx
   - replay 不兼容
   - 超长上下文降级

### Metrics

每次阶段验收至少记录：

- `tool_round_survival_rate`
- `reasoning_replay_preservation_rate`
- `fallback_success_rate`
- `loop_incidence_rate`
- `complex_task_completion_rate`
- `delegation_gain_ratio`
- `mean_round_count_to_completion`
- `mean_error_recovery_latency`

## Migration and Cutover Strategy

虽然本方案允许激进重构，但仍需要有序切换。

### Session Migration

- 旧 session 不强制一次性迁移
- 新字段采用 lazy backfill
- 当 session 首次进入新 runtime 时补入 `runtimeVersion`

### Runtime Cutover

- Phase 1-2 可先采用双路径：
  - `legacy path`
  - `capability runtime path`
- 当 capability runtime 在 transcripts 上稳定优于旧路径后，再移除旧路径

### Kill Switch

必须保留如下 kill switch：

- 关闭 reasoning replay
- 关闭 planner runtime
- 关闭 delegator runtime
- 强制降回兼容 adapter path

## Program-Level Deliverables

整个方案最终必须留下以下长期资产：

1. `Capability Runtime` 主链路代码
2. Provider adapter 框架与 Tier-1 adapter
3. Planning runtime
4. Delegation runtime
5. Golden transcript 数据集
6. Capability scorecard 历史记录
7. Diagnostics UI 与 explainability
8. Rollout / kill switch / migration 文档

## Recommended First Execution Order

如果按真实执行来排，推荐顺序不是“按文件”，而是按项目管理节奏：

1. Phase 1 Wave 0
2. Phase 1 Wave 1-3
3. Phase 2 Wave 0
4. Phase 2 Wave 1-3
5. Phase 3 全部
6. Phase 4 全部
7. Phase 5 全部

不建议：

- 在 Phase 1 期间提前做 planner UI
- 在 Phase 2 前提前做 delegation
- 在 Phase 3 前就定义大量 preset 名称

## Final Program Definition of Done

只有同时满足以下条件，这个能力放大计划才算真正完成：

1. `MiniMax + OpenAI-compatible` 在多轮工具任务里显著更稳。
2. 会话级 runtime intent、execution plan、adapter、planner、delegator 已形成统一主链路。
3. 复杂任务完成率相较现状有明确提升证据。
4. delegation 在适用任务上收益为正。
5. 所有增强都有 telemetry、tests、transcripts 与 diagnostics 支撑。
6. 用户看到的是“更强的执行能力”，而不是“更多的模式包装”。

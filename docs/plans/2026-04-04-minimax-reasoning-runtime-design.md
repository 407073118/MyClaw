# MiniMax-First Reasoning Runtime Design

**Date:** 2026-04-04  
**Scope:** `desktop/` chat runtime and model integration  
**Status:** Draft validated through discussion

## Background

`MyClaw desktop` 当前已经具备统一的会话、上下文组装、工具调用和模型请求主链路，但推理能力相关逻辑仍然偏分散。现状更像“能够解析部分 reasoning/thinking 返回值”，而不是“存在一个稳定的多模型推理运行时”。这在 MiniMax M2.5 场景下暴露得尤为明显：模型本身偏向 agent workload、工具调用和长任务分解，但桌面端当前更多是把它当作 generic-compatible chat model 在接，导致回答偏保守、历史回传不完整、provider 能力不能被一致解释。

本设计不把 MiniMax 当成一次性的特殊模型补丁，而是把它定义为“当前主力模型之一、第一优先验证对象”。目标不是让 `MyClaw` 长成 `Claude Code`，而是借鉴 `claude-code` 在 `thinkingConfig`、`effort`、`query/callModel` 单点汇合、完整 assistant/tool message 流处理方面的运行时抽象，把这些能力融入现有 Electron + React + main/renderer IPC 架构中。

同时有一个硬约束必须保持：用户现有的 MiniMax 调用方式不能被破坏。最初文档中的 OpenAI-compatible 请求入口、参数习惯和已有网关接法必须继续能通。新运行时应该在“保持旧路径可用”的前提下，增加更强的 provider-aware 策略，而不是用重构换来接口中断。

## Goals

1. 建立一个 provider-neutral 的推理运行时内核，让会话级 reasoning/thinking 状态、provider 能力解释、请求参数映射、降级策略和历史回传不再散落在 UI、IPC 和请求层。
2. 把 MiniMax 提升为 first-class provider adapter，优先解决其在 `MyClaw` 中“不够展开、不够稳定、不够像 agent model” 的体验问题。
3. 保持现有 MiniMax 调用方式继续可用，避免对当前网关接法造成破坏。
4. 为后续 OpenAI / Anthropic 接入相同运行时抽象预留扩展点，但第一批验证与优化优先围绕 MiniMax 展开。

## Non-Goals

1. 本轮不把 `MyClaw` 产品形态改造成 `Claude Code` 式终端 REPL。
2. 本轮不引入复杂的 low / medium / high / max 多档位 UI 选择器。
3. 本轮不把所有 provider 一次性深度适配完成；`Qwen` 保持参考，不纳入第一批正式适配目标。
4. 本轮不改动用户已有 MiniMax 网关协议约定，也不强制要求用户迁移到新的 endpoint。

## Architecture Direction

新的分层建议如下：

- `shared/contracts/session.ts`
  扩展会话级推理状态，只表达产品抽象，例如 `thinkingEnabled`、`reasoningModeSource`，不暴露 provider 原始字段。
- `shared/contracts/model.ts`
  扩展模型能力声明，区分 `supportsReasoning`、`supportsEffort`、`requiresReasoningReplay`、`preferredProtocol` 等语义。
- `src/main/services/reasoning-runtime.ts`（新建）
  作为运行时内核，负责把会话状态、模型 profile、能力信息和当前轮上下文汇总成统一的“执行计划”。
- `src/main/services/provider-adapters/*`（新建）
  按 provider 维护请求 patch、响应字段解析、回放要求和降级策略。
- `src/main/services/model-client.ts`
  下沉为 transport 层，主要负责发送请求、消费 SSE、返回规范化后的流事件，不再承担高层 reasoning 策略决策。
- `src/main/ipc/sessions.ts`
  负责把会话状态送入 reasoning runtime，保持 agentic loop 主干，但不再自己判断 provider thinking 策略。
- `src/renderer/pages/ChatPage.tsx` 与 `stores/workspace.ts`
  仅处理 reasoning 开关、状态展示、切换确认，不承载协议细节。

这套边界借鉴了 `claude-code` 的核心思想：`thinkingConfig` 与 `effort` 分离、在 query/callModel 单点汇合、把 assistant/thinking/tool_use/tool_result 视为完整消息流。但 `MyClaw` 仍然保持桌面应用的产品形态，避免把 Anthropic-specific 实现和终端 UI 直接搬入。

## MiniMax-First Strategy

MiniMax 在新架构中的特殊性应被集中收纳在 adapter 和 capability profile 中，而不是散落为大量 `if minimax` 分支。第一阶段至少要定义四类能力：

1. **协议偏好**
   MiniMax 当前既要继续兼容用户现有的调用方式，也要允许 runtime 知道它的“增强路径”是什么。运行时必须能够区分“保守兼容模式”和“增强模式”，并在 profile / capability 允许时选择更优策略。
2. **reasoning/thinking 回放**
   MiniMax 的工具调用体验不应只依赖 `reasoning_content` 展示。runtime 需要定义哪些返回片段应保留到历史中，以及何时只展示不回放，避免多轮工具调用中能力逐轮衰减。
3. **完整 assistant message 处理**
   当前 `MyClaw` 更像抽取正文与工具参数；MiniMax-first 适配要求我们保留更完整的 assistant turn 语义，为工具循环和后续 provider 兼容打基础。
4. **降级策略**
   当 MiniMax 某条请求路径不接受某个 thinking / reasoning 字段时，runtime 应自动回退到兼容模式，同时记录日志并在 UI 中暴露可解释状态，而不是直接请求失败。

这意味着 MiniMax 是第一优先 provider，但不会成为污染全局架构的特殊中心。后续 OpenAI / Anthropic 可以在同一 adapter 协议下逐步补齐。

## Recommended Phase Path

### Phase 9: Reasoning Runtime Core

聚焦运行时基础设施，而不是 provider 细节。主要交付包括：

- 会话级 reasoning 状态契约
- provider-neutral 的运行时执行计划
- reasoning / effort / replay 能力模型
- `sessions -> runtime -> transport` 的单点汇合路径
- 最小 UI 开关与状态透传

这个阶段的成功标准不是“MiniMax 已经最强”，而是“任何 provider 都不再需要把 thinking 逻辑散落在多层实现中”。

### Phase 10: MiniMax-First Provider Adapter

在不破坏现有 MiniMax 调用方式的前提下，引入正式的 MiniMax provider adapter。主要交付包括：

- MiniMax capability profile
- 兼容模式与增强模式的请求 patch builder
- MiniMax 响应字段规范化与 replay 策略
- 多轮工具调用中的完整 message 处理
- 降级日志与错误可解释性

这个阶段是第一批用户体验明显改善的重点阶段。

### Recommended Next Phases (Not Added Yet)

- **Phase 11: OpenAI / Anthropic Compatibility Bridge**
  在同一运行时抽象下补齐另外两类主流 provider 的兼容桥接，确保状态模型、请求映射、回放和降级语义一致。
- **Phase 12: Chat Controls + Verification Matrix**
  完成 UI 展示、切换确认、provider 能力面板和回归测试矩阵，明确验证“老调用继续可用、MiniMax 更强、其他 provider 不回归”。

## File Impact

高优先改动中心预计包括：

- `desktop/shared/contracts/model.ts`
- `desktop/shared/contracts/session.ts`
- `desktop/src/main/ipc/sessions.ts`
- `desktop/src/main/services/model-client.ts`
- `desktop/src/main/services/model-capability-resolver.ts`
- `desktop/src/preload/index.ts`
- `desktop/src/renderer/stores/workspace.ts`
- `desktop/src/renderer/pages/ChatPage.tsx`

新增文件预计包括：

- `desktop/src/main/services/reasoning-runtime.ts`
- `desktop/src/main/services/provider-adapters/minimax.ts`
- `desktop/src/main/services/provider-adapters/openai.ts`
- `desktop/src/main/services/provider-adapters/anthropic.ts`
- 对应 Vitest 合同测试与适配矩阵测试

## Verification Strategy

本路线必须把“调用继续能通”放到验证首位。验证分三层：

1. **协议层**
   现有 MiniMax 文档中的请求格式继续可用，不能因为引入 runtime 就让旧请求体失效。
2. **运行时层**
   reasoning 开关、provider patch、历史回放、降级策略都需要 contract test。
3. **体验层**
   用 MiniMax 做真实 agentic loop 验证，确认回答不再异常简略、多轮工具调用不明显钝化、失败路径可解释。

推荐新增测试方向：

- `phase9-reasoning-runtime.test.ts`
- `phase10-minimax-adapter.test.ts`
- `phase10-message-replay.test.ts`
- `phase11-provider-compatibility-bridge.test.ts`

## Risks

1. **把 provider 兼容细节泄漏到 UI 或 session 层**
   这会让后续新增模型继续放大复杂度。
2. **为了增强 MiniMax 体验而破坏现有调用方式**
   这是本路线最重要的禁区。
3. **误把 Claude Code 的 Anthropic 细节当成通用运行时逻辑**
   可以借架构，不应直接搬其 provider 特定实现。
4. **只展示 reasoning，不定义 replay 语义**
   这会让 UI 看起来“更高级”，但实际 agent loop 仍然不稳定。

## Decision Summary

最终方向确定为：

- `MyClaw` 保持自己的桌面产品形态
- 借鉴 `claude-code` 的运行时抽象，而不是复制其终端产品实现
- MiniMax 作为当前主力模型之一和第一优先验证对象
- 先做通用推理运行时内核，再做 MiniMax-first provider adapter
- 全程保持现有 MiniMax 调用方式继续可用

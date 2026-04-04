# Phase 10: Provider adapters for MiniMax-first reasoning runtime - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning
**Source:** User discussion + `10-RESEARCH.md` + root design doc + Phase 9 outputs

<domain>
## Phase Boundary

Phase 10 解决的是 “MiniMax-first provider adapter” 这一层，不重复建设 Phase 9 已经完成的通用 reasoning runtime 骨架。

本阶段必须完成：

- 为 MiniMax 建立正式的 provider adapter，而不是继续依赖零散的 `minimax` 特判
- 保持用户当前 MiniMax 调用方式继续可用，不能因为增强模式引入请求不通
- 在 runtime 中明确区分 MiniMax 的兼容模式与增强模式，并由 capability/adapter 决定走哪条路径
- 规范化 MiniMax 响应字段，保留完整 assistant turn 语义，支撑多轮 tool use / reasoning replay
- 让 `sessions -> reasoning-runtime -> model-client` 能消费 replay policy，而不是只展示 reasoning 文本
- 让模型配置入口、provider flavor 推断、catalog 归一化与 capability registry 同步认得 MiniMax
- 为兼容模式、增强模式、降级路径和旧调用不回归建立自动化测试

本阶段明确不做：

- 把 `MyClaw` 产品形态改成 Claude Code 式 REPL
- 一次性把所有 provider 的高级特性都做成 first-class adapter
- 新增复杂的多档位 UI 参数面板
- 强制用户迁移到新的 MiniMax endpoint 或彻底改写现有 requestBody 写法

</domain>

<decisions>
## Implementation Decisions

### Adapter ownership
- MiniMax 的特殊性必须集中放进 provider adapter 和 capability profile，不允许继续散落在 `sessions.ts`、`ChatPage.tsx`、`workspace.ts` 里。
- `model-client.ts` 逐步下沉为 transport；请求 patch 选择、响应 replay 语义和降级原因由 runtime + adapter 决定。

### Compatibility posture
- 当前 docx 中对应的 OpenAI-compatible 调用方式必须继续可用。
- 任何增强模式都必须在 “不破坏兼容模式” 的前提下启用，且允许根据 capability / error 自动回退。
- `profile.requestBody` 的用户自定义字段仍然保持高优先级，不能被 adapter 悄悄吞掉。

### Replay semantics
- Phase 10 不能停留在 “把 reasoning 文本显示出来”。
- 需要明确 MiniMax 多轮 tool use 时哪些 assistant 内容必须完整回放，包括 text / tool_calls / reasoning 或完整 content blocks。
- 回放策略应由 runtime 消费，例如 `replayPolicy`、`responseReplayPayload`、`degradedReason`，而不是临时字符串拼接。

### Product posture
- `MyClaw` 继续保持自己的桌面产品形态。
- 可以借鉴 `claude-code` 的 query/message 架构，但不直接搬其终端交互和 Anthropic 私有实现。
- UI 只暴露用户能理解的结果，例如 “当前是兼容模式还是增强模式” 或 “本轮发生了降级”，而不是裸露 provider 协议参数。

### Model settings scope
- Phase 10 不只是聊天请求链路改造。
- MiniMax 的 provider preset、provider flavor 判定、catalog 归一化、capability registry 也必须同步进入规划，否则会造成“设置页是一套语义，聊天 runtime 是另一套语义”。

### the agent's Discretion
- Adapter 目录可以命名为 `src/main/services/provider-adapters/`，也可以是 `provider-runtime/`，但必须表达 “统一 contract + MiniMax 实现”。
- 兼容模式与增强模式的具体命名可在实现时微调，但文档和测试必须清楚说明其选择条件。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing phase artifacts
- `.planning/phases/09-chat-thinking-effort/09-CONTEXT.md` — Phase 9 的边界与抽象约束
- `.planning/phases/09-chat-thinking-effort/09-RESEARCH.md` — 通用 reasoning runtime 的前置研究
- `.planning/phases/09-chat-thinking-effort/09-01-SUMMARY.md` — 会话 thinking 与 capability 契约已完成
- `.planning/phases/09-chat-thinking-effort/09-02-SUMMARY.md` — request body patch merge point 已完成
- `.planning/phases/09-chat-thinking-effort/09-03-SUMMARY.md` — Chat UI thinking 控制已完成

### Root design
- `../docs/plans/2026-04-04-minimax-reasoning-runtime-design.md` — MiniMax-first 路线、兼容要求、Phase 10 总体目标

### Runtime source of truth
- `src/main/services/reasoning-runtime.ts` — Phase 9 的 provider-neutral 执行计划入口
- `src/main/services/model-client.ts` — 当前 transport、endpoint 解析、SSE 规范化入口
- `src/main/ipc/sessions.ts` — agentic loop 主链路与 tool loop 回放入口
- `src/main/ipc/models.ts` — provider flavor 推断、catalog 拉取与归一化
- `src/main/services/model-capability-resolver.ts` — capability 合并与 preferred protocol 推断
- `src/main/services/model-capability-registry.ts` — 静态能力模板
- `src/renderer/pages/ModelDetailPage.tsx` — MiniMax preset、baseUrlMode 与模型配置入口

### Claude Code reference implementation
- `/Users/zhangjianing/WebstormProjects/claude-code/src/query.ts` — query/callModel 单点汇合模式
- `/Users/zhangjianing/WebstormProjects/claude-code/src/utils/messages.ts` — 完整 assistant/tool/thinking 消息流处理
- `/Users/zhangjianing/WebstormProjects/claude-code/src/utils/thinking.ts` — thinkingConfig 抽象

### Official MiniMax references
- `https://platform.minimax.io/docs/api-reference/text-ai-coding-refer` — M2.5 coding tools 总览，说明 Anthropic-compatible 为推荐路径之一
- `https://platform.minimax.io/docs/api-reference/text-anthropic-api` — Anthropic-compatible API 与 thinking 支持说明
- `https://platform.minimax.io/docs/api-reference/text-m2-function-call-refer` — tool use / interleaved thinking / 完整 assistant message 回放要求
- `https://platform.minimax.io/docs/solutions/mini-agent` — Mini-Agent 架构与 Anthropic-compatible、interleaved thinking 的官方示例

</canonical_refs>

<specifics>
## Specific Ideas

- 以 `P10-01` 到 `P10-06` 作为本阶段 provisional requirement IDs：
  - `P10-01`: MiniMax 拥有 first-class capability profile，能区分兼容模式与增强模式
  - `P10-02`: runtime 通过 adapter contract 生成 MiniMax 请求 patch，并保持现有调用方式继续可用
  - `P10-03`: MiniMax 响应被规范化为完整 assistant turn，可支撑 reasoning / tool replay
  - `P10-04`: sessions/tool loop 正确回放 MiniMax assistant + tool + reasoning 历史，并在失败时自动降级
  - `P10-05`: Model settings / catalog / provider flavor 对 MiniMax 语义一致
  - `P10-06`: 自动化验证覆盖旧调用不回归、增强模式、生效降级和 replay 语义
- Phase 10 优先沿用 Vitest，不新增新的测试框架
- 适配后的 UI 表达应保持克制，优先展示状态和可解释性，不新增复杂 provider 参数面板

</specifics>

<deferred>
## Deferred Ideas

- OpenAI / Anthropic compatibility bridge 延后到后续 phase
- 更复杂的 provider 诊断页、可视化 replay inspector 延后
- 多档 effort picker 与更细的 provider 实验开关延后

</deferred>

---

*Phase: 10-provider-adapters-for-minimax-first-reasoning-runtime*
*Context gathered: 2026-04-04 via user discussion, official MiniMax docs, and Phase 9 outputs*

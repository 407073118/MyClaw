# Phase 09: Chat 推理等级与 Thinking/Effort 适配 - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning
**Source:** User discussion + `09-RESEARCH.md` + root design doc

<domain>
## Phase Boundary

Phase 9 只解决“通用推理运行时内核”这一层，不在这一阶段把 MiniMax 的全部 provider 特性一次做完。

本阶段必须完成：

- 为会话新增抽象的 `thinkingEnabled` / reasoning 状态
- 为模型能力新增 reasoning/effort 相关解释位
- 在主进程建立统一的 reasoning runtime / request patch 入口
- 让 `sessions -> preload -> workspace -> ChatPage -> callModel()` 形成一条稳定通路
- 对 unsupported provider 保持安全降级，不发送未知 reasoning 参数
- Chat UI 提供轻量开关与状态展示，不做多档复杂选择器

本阶段明确不做：

- MiniMax first-class adapter 细节
- OpenAI / Anthropic / MiniMax 全矩阵深度适配
- 多档 effort picker
- 产品层大改版

</domain>

<decisions>
## Implementation Decisions

### Runtime ownership
- `model-client.ts` 继续保留为实际请求发送与 SSE 消费入口，但 reasoning 策略不再散落在调用方。
- Phase 9 可以先用一个轻量的 `reasoning runtime` / `reasoning mapper` 服务承接状态解释与请求 patch 组装，避免在 `sessions.ts`、`workspace.ts`、`ChatPage.tsx` 分别判断 provider。

### Product posture
- `MyClaw` 保持自己的桌面产品形态，不复制 `Claude Code` 的终端 REPL 交互。
- 可以借鉴 `claude-code` 的运行时抽象：`thinkingConfig` 与 `effort` 分离、单点汇合、完整消息流意识。

### Provider scope
- Phase 9 的主目标是建立 provider-neutral runtime。
- MiniMax 是当前主力模型之一，但 first-class provider adapter 放到 Phase 10。
- Phase 9 里只要求 runtime 对 OpenAI-style reasoning patch 和 unsupported provider 空 patch 有明确行为。

### Compatibility rule
- 现有 MiniMax 调用方式不能被破坏。
- 任何 reasoning patch 都必须 capability-gated，并允许完全不发送，确保旧路径继续可用。

### the agent's Discretion
- `thinkingEnabled` 字段的具体命名可以在实现时微调，但必须保持语义抽象，不能暴露 provider 原始字段名。
- Phase 9 若需要新增服务文件，可以命名为 `reasoning-runtime.ts` 或 `reasoning-mode.ts`，但职责必须聚焦“状态解释 + 请求 patch”，不要提前把 Phase 10 的 provider adapter 全塞进去。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing phase research
- `.planning/phases/09-chat-thinking-effort/09-RESEARCH.md` — 已确认的研究、风险、P9-01~P9-04 验证映射、借鉴来源

### Root design
- `../docs/plans/2026-04-04-minimax-reasoning-runtime-design.md` — 通用推理运行时与 MiniMax-first 路线的上层设计决策

### Runtime source of truth
- `shared/contracts/session.ts` — 当前会话结构，尚未包含 thinking 状态
- `shared/contracts/model.ts` — 当前模型能力定义，尚未区分 effort/replay 等语义
- `src/main/ipc/sessions.ts` — agentic loop 主入口
- `src/main/services/model-client.ts` — 当前请求体组装与 SSE 消费实现
- `src/preload/index.ts` — renderer/main IPC surface
- `src/renderer/stores/workspace.ts` — session create/sendMessage 状态流
- `src/renderer/pages/ChatPage.tsx` — reasoning 折叠展示的现有 UI 落点
- `src/renderer/types/electron.d.ts` — preload API 的 TS 契约

### External reference implementation
- `/Users/zhangjianing/WebstormProjects/claude-code/src/utils/thinking.ts` — `ThinkingConfig` 抽象
- `/Users/zhangjianing/WebstormProjects/claude-code/src/utils/effort.ts` — effort 抽象与优先级链
- `/Users/zhangjianing/WebstormProjects/claude-code/src/query.ts` — query/callModel 单点汇合模式

</canonical_refs>

<specifics>
## Specific Ideas

- 以 `P9-01` 到 `P9-04` 作为本阶段的 provisional requirement IDs：
  - `P9-01`: session 持有 `thinkingEnabled` 并在 create/load 后保持一致
  - `P9-02`: `callModel()` 根据 capability/provider 组装 reasoning patch
  - `P9-03`: unsupported model 不发送 thinking/effort 参数
  - `P9-04`: ChatPage 切换时中途会话弹确认，并展示状态 badge
- Phase 9 应优先使用 Vitest 补合同测试，不新增依赖
- reasoning 文本继续默认折叠，不抢正文

</specifics>

<deferred>
## Deferred Ideas

- MiniMax first-class provider adapter 细节延后到 Phase 10
- OpenAI / Anthropic compatibility bridge 延后到后续 phase
- 多档 effort picker、模型选择器联动、复杂 prompt trigger 机制延后

</deferred>

---

*Phase: 09-chat-thinking-effort*
*Context gathered: 2026-04-04 via user discussion and design consolidation*

# Phase 10: Provider adapters for MiniMax-first reasoning runtime - Research

**Date:** 2026-04-04  
**Status:** Complete  
**Sources:** Official MiniMax docs + local codebase + local `claude-code` reference

## Research Question

在不破坏现有 MiniMax 调用方式的前提下，`MyClaw desktop` 应如何把 MiniMax 提升为 first-class provider adapter，并让运行时真正适配其 tool-use / reasoning / replay 语义？

## Official MiniMax Findings

### 1. MiniMax 明确把 AI coding / agent workflow 当成主场景

MiniMax 官方 M2.5 coding tools 总览把模型定位成适合代码理解、多轮对话、推理和工具调用的 coding model，并同时提供 Anthropic-compatible 与 OpenAI-compatible 两种接法。官方材料没有把它仅仅描述为普通聊天模型，而是把它放在 AI coding harness 语境里。

Implication for Phase 10:

- `MyClaw` 不应只把 MiniMax 当 generic chat completions provider
- 规划里必须覆盖 tool loop、reasoning replay、能力发现和降级策略

Source:

- [M2.5 for AI Coding Tools](https://platform.minimax.io/docs/api-reference/text-ai-coding-refer)

### 2. 官方明确推荐兼容 Anthropic 的 thinking / tool-use 语义

MiniMax 的 Anthropic-compatible 文档显示其支持 `thinking`，并把兼容 Anthropic 语义当成正式能力，而不是临时 hack。

Implication for Phase 10:

- 当前代码里 “MiniMax 一律按 generic OpenAI-compatible 发请求” 的路径不足以代表完整适配
- provider adapter 需要能表达 MiniMax 的协议偏好和增强路径，而不是只看 provider kind

Source:

- [Compatible Anthropic API](https://platform.minimax.io/docs/api-reference/text-anthropic-api)

### 3. 官方对 tool-use / interleaved thinking 的关键要求是 “完整 assistant message 回放”

MiniMax 的 tool-use 文档明确指出，多轮 function call 会话里，完整模型响应必须追加回历史，以维持 reasoning chain 连续性；OpenAI-compatible 路径下需要回放完整 `response_message`，Anthropic-compatible 路径下需要回放完整 `response.content` blocks。

Implication for Phase 10:

- Phase 10 不能只保存 `content` 和 `tool_calls`
- 需要在 `model-client.ts` 和 `sessions.ts` 之间建立 response replay payload
- 需要 contract test 锁定 “tool loop 会回放完整 assistant turn”

Source:

- [Tool Use & Interleaved Thinking](https://platform.minimax.io/docs/api-reference/text-m2-function-call-refer)

### 4. 官方示例本身就是 Claude Code 类 harness 语义，而不是普通网页聊天

Mini-Agent 官方方案强调 Anthropic-compatible、interleaved thinking、完整 agent loop、上下文管理、skills 和 MCP。这证明 MiniMax 官方生态已经默认很多 Claude Code 类运行时约定。

Implication for Phase 10:

- 可以借鉴 `claude-code` 的运行时抽象
- 不需要复制终端产品形态，但需要让 `MyClaw` 的 conversation runtime 理解完整消息流和 replay

Source:

- [Mini-Agent](https://platform.minimax.io/docs/solutions/mini-agent)

## Local Codebase Findings

### 1. MiniMax 识别逻辑已存在，但语义仍然分散

当前代码已经在多处通过 `baseUrl/model` 推断 MiniMax：

- `src/main/services/model-client.ts`
- `src/main/ipc/models.ts`
- `src/renderer/pages/ModelDetailPage.tsx`

问题是这些分支各自解决不同问题：endpoint 解析、catalog 归一化、设置页 preset，但没有一个统一的 MiniMax adapter contract。

Conclusion:

- Phase 10 需要把这些散落的 `minimax` 判断收束到 adapter / capability / resolver 层

### 2. Phase 9 已经准备好了最关键的挂点

Phase 9 已完成：

- `reasoning-runtime.ts`
- `bodyPatch` 单点合并
- `session:update-thinking`
- provider-neutral capability fields

Conclusion:

- Phase 10 不需要重做基础设施
- 应直接在这些挂点上增加 provider adapter、response replay 和 capability-specific behavior

### 3. 现有 transport 对 “完整 assistant turn” 支持不够强

`model-client.ts` 当前主要规范化为：

- `content`
- `reasoning`
- `toolCalls`
- `finishReason`

这对普通 chat 足够，但对 MiniMax 官方要求的 “完整 assistant message 回放” 来说还不够，因为 replay 需要知道完整 assistant turn 结构，而不只是拆平后的文本和工具参数。

Conclusion:

- Phase 10 必须扩展 model-client 结果结构，至少提供 replay payload

### 4. 模型设置与能力发现也需要同步升级

`ModelDetailPage.tsx` 已提供 MiniMax preset，`ipc/models.ts` 已推断 `minimax-anthropic`，但 capability registry 里还没有 MiniMax 明确模板。

Conclusion:

- 如果不补 capability registry / models IPC / catalog normalization，聊天链路和设置链路会出现两套语义

## Claude Code Reference Findings

### 1. 可借鉴的是“单点汇合”和“完整消息流”，不是协议细节本身

本地 `claude-code` 源码最值得借鉴的点：

- `query.ts` 的单点汇合模式
- `utils/messages.ts` 的完整消息流建模
- `utils/thinking.ts` 的 thinking config 抽象

不应直接搬的点：

- Anthropic 私有消息协议细节
- 终端 REPL 交互
- Claude-only 的 model matrix

Conclusion:

- Phase 10 规划应借结构，不借产品层和 provider 私有实现

## Derived Constraints

1. 兼容模式必须先保底，增强模式必须可自动回退  
2. `profile.requestBody` 仍然保留最高优先级，防止破坏用户当前接法  
3. replay 语义必须进入 contract test，不能只靠 UI 观察  
4. provider flavor、catalog、capability registry 和 runtime 语义必须统一  
5. MiniMax 是第一优先 provider，但抽象层不能写成 “只为 MiniMax 服务”

## Recommended Breakdown

### Wave 1: Adapter contract + MiniMax capability profile

- 新建 provider adapter contract 与 MiniMax adapter
- 把 compatibility/enhanced mode 的选择收敛到 runtime
- 补 capability registry、resolver 和 models IPC 的 MiniMax 语义

### Wave 2: Response normalization + replay integration

- 扩展 model-client 规范化结果，保留 replay payload
- 更新 sessions/tool loop 使用 replay payload，而不是只回放拆平字段
- 增加降级日志与自动 fallback

### Wave 3: Settings alignment + verification matrix

- 调整模型设置与 catalog 逻辑，让 MiniMax preset / flavor / models list 与 adapter 语义一致
- 补测试矩阵，证明旧调用继续可用、增强模式有效、降级可解释

## Provisional Requirements Mapping

| Requirement | Meaning | Evidence Needed |
|---|---|---|
| P10-01 | MiniMax capability profile is first-class | registry/resolver/model tests |
| P10-02 | Runtime uses adapter-selected request patch without breaking legacy calls | adapter tests + request merge tests |
| P10-03 | model-client returns replay-capable normalized assistant payload | unit tests around transport normalization |
| P10-04 | tool loop replays complete assistant/tool history and degrades safely | session/runtime tests |
| P10-05 | settings/catalog/provider flavor all recognize MiniMax consistently | models IPC + settings tests |
| P10-06 | regression safety around legacy path, enhanced path, downgrade path | full phase10 suite |

## Recommendation

Phase 10 应按 “通用 adapter contract + MiniMax-first implementation” 执行，而不是 “在现有 OpenAI-compatible 代码里继续加 MiniMax 特判”。这样能同时满足：

- 用户当前接法不坏
- MiniMax 体验显著增强
- 后续 OpenAI / Anthropic 可复用同一抽象

---

*Phase: 10-provider-adapters-for-minimax-first-reasoning-runtime*
*Research completed: 2026-04-04*

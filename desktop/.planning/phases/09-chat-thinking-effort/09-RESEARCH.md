# Phase 9: Chat 推理等级与 Thinking/Effort 适配 - Research

**Researched:** 2026-04-04
**Domain:** Desktop chat runtime reasoning mode
**Confidence:** MEDIUM-HIGH

## Summary

MyClaw `desktop` 当前已经具备两个基础条件：一是主流程里有统一的模型调用入口，二是 `model-client` 已经能解析多家 OpenAI-compatible / Anthropic 风格的 reasoning/thinking 流式增量。但 Phase 9 的关键缺口不在“展示思考过程”，而在“没有一条从 Chat 会话状态到请求体组装的稳定运行时通路”。现在的 `session:create` / `session:send-message` / `workspace.sendMessage` / `preload.sendMessage` 都没有 thinking/effort 配置位，`callModel()` 也完全不发 reasoning/thinking 参数，只是被动接收返回值。

对照 `claude-code`，最值得借的是它的运行时分层，而不是 Anthropic 细节本身：`ThinkingConfig` 与 `effortValue` 分离建模，在单一 query/callModel 汇合点做能力判断和请求体映射。对 MyClaw 来说，最 lean 的设计不是引入 low/medium/high/max 选择器，而是先实现一个单一的、会话级的 `thinkingEnabled` 开关。开启后，runtime 根据模型能力做 provider-aware 映射：对 OpenAI GPT-5 类模型发送 `reasoning.effort`，建议先固定为 `medium`；对 Anthropic 类模型只在确认支持时发送对应 thinking 参数，否则不发。UI 只放一个轻量开关和状态提示，不做复杂档位选择。

**Primary recommendation:** 实现“会话级单开关 + 运行时统一映射 + Chat 内轻 UI 提示”，不要在 Phase 9 引入多档位 effort picker。

## Project Constraints (from CLAUDE.md)

- 本阶段属于 brownfield 优化，优先复用现有 `desktop` 架构，不做大规模重构。
- `desktop` 是当前主战场，方案必须直接提升桌面端员工使用体验。
- 不要把 `cloud` 内部实现耦合进 `desktop`。
- 改动要最小化，优先沿用既有 Electron IPC、main services、shared contracts、renderer store 结构。
- 修改共享契约后，必须同步更新调用端、runtime 和测试。
- 文本、代码、配置、文档必须使用 UTF-8。
- 方法必须保留中文注释；涉及新增方法时需要中文日志。
- 修改中文文件时要先读、再改、再复读，并执行乱码门禁检查。

## Standard Stack

### Core
| Library / Module | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Electron IPC session pipeline | repo local | 把 Chat UI 的 session 状态送入主进程 agentic loop | Phase 9 应直接挂到现有 `session:create` / `session:send-message` 流程上，不另起通道 |
| `src/main/services/model-client.ts` | repo local | 唯一模型请求组装与 SSE 消费入口 | thinking/effort 必须只在这里落请求体，避免多处散落 provider 逻辑 |
| `resolveModelCapability()` | repo local | 统一得到模型能力，含 `supportsReasoning` | MyClaw 已经有能力分层，Phase 9 应复用而不是手写新探测器 |
| React 18.3.1 + Zustand 5.0.2 | local package versions | ChatPage 状态展示与交互 | 足够承载一个轻量开关和状态标识，不需要新增 UI 状态库 |

### Supporting
| Library / Module | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `marked` 17.0.5 | local package version | 渲染 reasoning 折叠内容 | 继续用于思考摘要/返回 reasoning 的展示 |
| Vitest 3.2.4 | local package version | Phase 9 运行时与 UI 行为测试 | 为请求体映射、session 持久化、UI 开关补测试 |
| OpenAI official model docs | current official docs | 验证 GPT-5 `reasoning.effort` 当前能力 | 用于校准 MyClaw 对 OpenAI 类模型的默认映射 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| 单一 session 开关 | 多档位 selector（low/medium/high/max） | 现在会把 UI、持久化、兼容矩阵、测试面全部放大，不符合用户约束 |
| 运行时统一映射 | 每家 provider 在 UI 单独暴露参数 | UI 会变成协议配置面板，难以持续打磨 |
| capability-driven 参数注入 | prompt keyword hack（例如“请深度思考”） | 不稳定、不可测、无法和 provider 能力矩阵对齐 |

**Installation:**
```bash
# No new package should be added in Phase 9.
```

**Version verification:** 本阶段不建议新增依赖；直接复用仓库现有 `desktop/package.json` 中的 Electron/React/Zustand/Vitest 栈。

## Architecture Patterns

### Recommended Project Structure
```text
shared/contracts/
├── session.ts               # 会话级 thinking 状态契约
└── model.ts                 # reasoning 能力 / provider 映射元数据

src/main/ipc/
└── sessions.ts              # create/send-message 透传与持久化

src/main/services/
├── model-client.ts          # 唯一请求体组装点
└── model-capability-resolver.ts

src/preload/
└── index.ts                 # IPC surface 扩展

src/renderer/
├── stores/workspace.ts      # session 开关操作
└── pages/ChatPage.tsx       # 轻量 toggle / badge / reasoning 折叠
```

### Pattern 1: 会话级抽象状态先行，provider 参数后映射
**What:** 在 `ChatSession` 上新增一个抽象的 `thinkingEnabled` 或 `reasoningMode` 字段，UI 和主流程只理解这个抽象状态，不直接接触 `reasoning.effort` / `thinking.budget_tokens`。
**When to use:** 任何用户交互、session 创建、session 恢复、发送消息前。
**Example:**
```typescript
// Source: claude-code src/utils/thinking.ts + MyClaw session pipeline
export type SessionThinkingMode = {
  enabled: boolean;
  source: "default" | "user-toggle";
};
```

### Pattern 2: 单一模型调用入口统一汇合
**What:** 类似 `claude-code` 的 `query.ts -> callModel()` 设计，MyClaw 也应只在 `callModel()` 内把 session thinking 状态和模型能力合并成最终请求体。
**When to use:** 所有消息发送和 agentic loop 轮次。
**Example:**
```typescript
// Source: claude-code src/query.ts:659-699
const resolvedThinking = resolveThinkingRequest({
  sessionThinkingMode,
  capability,
  profile,
});

const requestBody = {
  model: profile.model,
  messages: wireMessages,
  stream: true,
  ...resolvedThinking.bodyPatch,
  ...(profile.requestBody ?? {}),
};
```

### Pattern 3: UI 只提供“开 / 关 + 状态文案”
**What:** Chat 页加一个单开关或 chip，文案例如“Thinking: On”。如果会话已有 assistant 消息，再切换时要先确认。
**When to use:** Chat 输入区或顶部会话工具栏。
**Example:**
```typescript
// Source: claude-code src/components/ThinkingToggle.tsx:96-123
if (isMidConversation && selected !== currentValue) {
  openConfirm("中途切换 thinking 会改变延迟与质量表现");
}
```

### Pattern 4: reasoning 结果默认折叠，不抢正文
**What:** 保持 reasoning 为 assistant 消息的附属信息，默认折叠，正文仍是主阅读路径。
**When to use:** assistant 返回了 `reasoning` 字段时。
**Example:**
```typescript
// Source: MyClaw ChatPage + claude-code AssistantThinkingMessage
<details>
  <summary>思考过程</summary>
  <div dangerouslySetInnerHTML={{ __html: renderedReasoningHtml }} />
</details>
```

### Borrow Analysis

#### Can Borrow Directly
| Item | Why | Reference |
|------|-----|-----------|
| `ThinkingConfig` 三态抽象：`adaptive` / `enabled` / `disabled` | 类型本身通用，适合作为 MyClaw runtime 内部抽象 | `claude-code/src/utils/thinking.ts:10-19` |
| “thinking 与 effort 分离，最后统一汇合”的管线思想 | 这是 Phase 9 的核心架构，不依赖 Anthropic UI | `claude-code/src/query.ts:659-699`, `claude-code/src/QueryEngine.ts:278-285` |
| 中途切换前确认 | 适用于任何聊天产品，能避免会话中段质量/延迟预期错乱 | `claude-code/src/components/ThinkingToggle.tsx:96-123` |
| reasoning 默认折叠展示 | MyClaw 已有类似 UI，可直接沿用交互方向 | `claude-code/src/components/messages/AssistantThinkingMessage.tsx:39-84`, `desktop/src/renderer/pages/ChatPage.tsx:859-871` |

#### Can Borrow Logic / Pattern Only
| Item | Why not direct copy | Best Reference |
|------|---------------------|----------------|
| `resolveAppliedEffort()` 优先级链 | 逻辑好，但里面的 env、model defaults、max 退化都偏 Claude 产品语义 | `claude-code/src/utils/effort.ts:149-180` |
| adaptive vs budget 分流 | 模式值得借，但具体 API 字段是 Anthropic `thinking` 协议 | `claude-code/src/services/api/claude.ts:1602-1639` |
| 请求缓存 / 参数一致性意识 | 思路可借，但 MyClaw 不需要照搬 prompt-cache latch 实现 | `claude-code/src/services/api/claude.ts:1458-1486` |
| PromptInput 中的 toggle 通知 | 交互节奏可借，Ink/CLI 组件本身不能用 | `claude-code/src/components/PromptInput/PromptInput.tsx:2088-2116` |

#### Should Not Borrow
| Item | Why |
|------|-----|
| `modelSupportsThinking()` / `modelSupportsAdaptiveThinking()` / `modelSupportsEffort()` 的具体实现 | 强绑定 Anthropic 型号命名、1P/3P 规则与内部 override 机制，不适用于 MyClaw 的多 provider 桌面端 |
| `configureEffortParams()` 和 beta headers 流程 | 完全是 Anthropic API 与内部 beta header 机制，不应迁入 MyClaw |
| `ultrathink` 关键词触发、高亮、GrowthBook 开关 | 过于 Anthropic/实验平台/CLI 产品化，不符合当前单模式目标 |
| `ModelPicker` 中的 effort 档位轮换 UI | Phase 9 明确不做 low/medium/high/max 多档位复杂选择器 |

### Anti-Patterns to Avoid
- **把 UI 开关直接映射成某个 provider 原始字段名:** UI 会被协议细节污染，后续切 provider 很难维护。
- **在 `sessions.ts`、`workspace.ts`、`ChatPage.tsx` 多处分别判断 provider:** provider 分支只能集中在 `model-client.ts` 的请求体组装函数。
- **默认展示全部原始 reasoning 文本:** 会压过正文，也容易和不同 provider 的“可展示摘要”语义冲突。
- **在 prompt 文案里手搓“请深度思考”替代 runtime 参数:** 不可测、不可控、无法稳定比较。

## MyClaw Current Gap

| Gap | Evidence | Impact |
|-----|----------|--------|
| 只解析 reasoning，不发送 reasoning/thinking 参数 | `desktop/src/main/services/model-client.ts:281-289`, `:576-583` | 现在没有真正的 thinking mode |
| session 层没有 thinking 配置位 | `desktop/src/main/ipc/sessions.ts:323-330` | 新会话无法持有模式状态 |
| 发送消息 IPC 不接受 thinking/effort 相关输入 | `desktop/src/preload/index.ts:77-81`, `desktop/src/renderer/stores/workspace.ts:456-482` | renderer 无法控制 runtime |
| Chat UI 只有 reasoning 展示，没有控制入口 | `desktop/src/renderer/pages/ChatPage.tsx:859-871` | 只能被动展示，不能主动启用 |
| 模型能力解析虽有 `supportsReasoning`，但请求层未使用 | `desktop/shared/contracts/model.ts:81`, `desktop/src/main/services/model-capability-resolver.ts:1-84` | 现有能力体系没有接入运行时决策 |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 推理模式抽象 | provider-specific UI schema | 会话级抽象布尔状态 + 单点映射函数 | 把协议差异锁在 runtime 内部 |
| 能力支持判断 | 基于字符串散落判断 | 复用 `resolveModelCapability()`，必要时只补一个小型 reasoning mapper | 能力来源已有 registry/discovered/manual override 分层 |
| 多档 effort 设计 | 先做完整 picker 与持久化矩阵 | 先固定 single-mode = `enabled -> medium` | Phase 9 目标是稳定、可控，不是参数面板 |
| reasoning 展示 | 新建复杂 transcript 组件 | 复用现有 `<details>` 折叠展示 | 当前 UI 已经能承载 |

**Key insight:** Phase 9 要打磨的是“参数从哪里来、在哪一层被解释、怎样稳定落请求体”，不是“把多少档位塞进 UI”。

## Common Pitfalls

### Pitfall 1: 把 thinking 和 effort 当成同一件事
**What goes wrong:** 代码里只有一个 `reasoningLevel` 字段，最终既想控制是否开启 thinking，又想控制 effort 档位。
**Why it happens:** 概念混淆，直接从 UI 倒推数据结构。
**How to avoid:** 内部保留两层语义：会话抽象状态和 provider 请求映射。
**Warning signs:** 同一个字段同时被 `ChatPage`、`sessions.ts`、`model-client.ts` 以不同方式解释。

### Pitfall 2: 中途切换没有确认
**What goes wrong:** 同一会话前半段和后半段延迟、成本、回复质量风格明显变化，用户以为系统不稳定。
**Why it happens:** 忽略会话连续性。
**How to avoid:** 会话中已经出现 assistant 消息时，切换先确认。
**Warning signs:** 用户在对话中点一下开关后，本轮和下轮表现差异很大。

### Pitfall 3: 假设 OpenAI-compatible provider 都认同一个字段
**What goes wrong:** 向所有 provider 发 `reasoning` 或 `reasoning_effort`，结果部分服务直接 400。
**Why it happens:** 把“OpenAI-compatible”误解成“所有高级参数完全兼容”。
**How to avoid:** 把 thinking/effort 映射做成 provider-aware patch，并允许 profile `requestBody` 覆盖。
**Warning signs:** 某些模型测试通过，另一些同类模型直接报未知字段。

### Pitfall 4: 让 reasoning 文本成为主消息
**What goes wrong:** UI 噪音变大，正文阅读路径被破坏。
**Why it happens:** 把“可见 reasoning”误认为主价值。
**How to avoid:** 保持 reasoning 默认折叠，只作为附属信息。
**Warning signs:** assistant 卡片大部分高度都被“思考过程”占据。

## Code Examples

Verified patterns from official sources and reference implementations:

### 单一入口透传 thinking / effort 状态
```typescript
// Source: claude-code/src/query.ts:663-699
deps.callModel({
  messages,
  thinkingConfig: toolUseContext.options.thinkingConfig,
  options: {
    model: currentModel,
    effortValue: appState.effortValue,
  },
});
```

### OpenAI 当前推荐的 reasoning.effort 请求形态
```json
// Source: https://developers.openai.com/api/docs/guides/latest-model
{
  "model": "gpt-5.4",
  "input": "How much gold would it take...",
  "reasoning": {
    "effort": "none"
  }
}
```

### MyClaw Phase 9 推荐的内部映射函数
```typescript
// Source: research recommendation
function buildReasoningPatch(input: {
  enabled: boolean;
  capabilitySupportsReasoning: boolean;
  providerFlavor?: string;
}): Record<string, unknown> {
  if (!input.enabled || !input.capabilitySupportsReasoning) return {};

  if (input.providerFlavor === "openai" || input.providerFlavor === "openrouter") {
    return { reasoning: { effort: "medium" } };
  }

  return {};
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 把 reasoning 视为固定多档 selector | 先做单一 runtime mode，再按 provider 映射 | 2025-2026 reasoning-capable APIs成熟后 | 先把系统稳定性做对，再逐步开放档位 |
| 只看“是否支持 reasoning” | 区分“thinking 开关”和“effort 档位” | 以 Claude Code / GPT-5 docs 为代表的现行实践 | 可以更清楚地控制 latency / quality / portability |
| prompt hack 模拟深度推理 | 显式请求参数 + 能力探测 | 近一年主流 reasoning API 稳定后 | 可测试、可观测、可回退 |

**Deprecated/outdated:**
- “先做 low / medium / high picker，再补 runtime” : 对 MyClaw 当前阶段是反顺序。
- “OpenAI-compatible = reasoning 参数必兼容” : 当前仍不成立，必须逐 provider 做保护。

## Open Questions

1. **Anthropic 模型在 MyClaw Phase 9 是否需要同批支持？**
   - What we know: MyClaw 已有 `anthropic` provider 路径，但 `model-client.ts` 尚未发送 thinking 参数。
   - What's unclear: 当前用户主要测试模型是否包含 Anthropic reasoning-capable 模型。
   - Recommendation: Phase 9 先把抽象状态和 OpenAI-style mapping 打通；Anthropic 映射放在同一函数里预留分支，但可以 capability-gated 后渐进启用。

2. **单模式默认值应不应该直接开？**
   - What we know: OpenAI 官方当前对 GPT-5.2+ 的默认 `reasoning.effort` 是 `none`，建议逐步上调。
   - What's unclear: MyClaw 用户更看重默认速度还是默认深度。
   - Recommendation: 产品默认先 `off`，显式开启后固定 `medium`。这样最可控，也最符合本 phase 的“runtime-first”目标。

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 |
| Config file | `desktop/vitest.config.ts` |
| Quick run command | `pnpm test -- tests/phase9-thinking-mode.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P9-01 | session 持有 `thinkingEnabled` 并在 create/load 后保持一致 | unit | `pnpm test -- tests/phase9-thinking-mode.test.ts` | ❌ Wave 0 |
| P9-02 | `callModel()` 根据 capability/provider 组装 reasoning patch | unit | `pnpm test -- tests/phase9-thinking-mode.test.ts` | ❌ Wave 0 |
| P9-03 | unsupported model 不发送 thinking/effort 参数 | unit | `pnpm test -- tests/phase9-thinking-mode.test.ts` | ❌ Wave 0 |
| P9-04 | ChatPage 切换时中途会话弹确认，并展示状态 badge | component | `pnpm test -- tests/phase9-thinking-ui.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test -- tests/phase9-thinking-mode.test.ts`
- **Per wave merge:** `pnpm test -- tests/phase9-thinking-mode.test.ts tests/phase9-thinking-ui.test.ts`
- **Phase gate:** `pnpm test`

### Wave 0 Gaps
- [ ] `tests/phase9-thinking-mode.test.ts` — 覆盖 session 契约、IPC 透传、request body 映射
- [ ] `tests/phase9-thinking-ui.test.ts` — 覆盖 ChatPage toggle、确认交互、badge 显示
- [ ] `tests/phase9-provider-reasoning-mapper.test.ts` — 覆盖 OpenAI / unsupported provider 的 patch 分支

## Sources

### Primary (HIGH confidence)
- Local repo inspection: `desktop/src/main/services/model-client.ts`, `desktop/src/main/ipc/sessions.ts`, `desktop/src/preload/index.ts`, `desktop/src/renderer/stores/workspace.ts`, `desktop/src/renderer/pages/ChatPage.tsx`
- Local repo inspection: `claude-code/src/utils/thinking.ts`, `claude-code/src/utils/effort.ts`, `claude-code/src/QueryEngine.ts`, `claude-code/src/query.ts`, `claude-code/src/services/api/claude.ts`
- OpenAI official latest model guide: https://developers.openai.com/api/docs/guides/latest-model
- OpenAI official GPT-5.4 model page: https://developers.openai.com/api/docs/models/gpt-5.4

### Secondary (MEDIUM confidence)
- `claude-code/src/components/ThinkingToggle.tsx`
- `claude-code/src/components/messages/AssistantThinkingMessage.tsx`
- `claude-code/src/components/PromptInput/PromptInput.tsx`

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - 不建议新增依赖，完全基于已存在 desktop 栈
- Architecture: HIGH - `claude-code` 与 MyClaw 都是 agentic chat runtime，借鉴点明确
- Pitfalls: MEDIUM - OpenAI / Anthropic reasoning 参数仍在快速演进，provider 兼容矩阵需继续验证

**Research date:** 2026-04-04
**Valid until:** 2026-04-11

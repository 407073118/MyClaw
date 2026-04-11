# Vendor Runtime Tier Upgrade Design

> **目标:** 将 MyClaw Desktop 当前的“单 family 单协议、兼容链路优先”模型运行时，升级为“厂商 family 多协议策略矩阵”，把 OpenAI、Anthropic、Qwen、Kimi、Volcengine Ark、MiniMax 全部提升为真正的一梯队运行时支持，同时保留现有 BR MiniMax 的稳定实现与兼容行为。
>
> **核心原则:**
> 1. **厂商与协议分离** — 一个 vendor family 可以官方支持多条协议路线，代码不应再把 family 硬绑定到唯一 protocol。
> 2. **能力收口到 registry** — tools、reasoning、prompt、replay、cache、fallback 等厂商知识统一收敛到 vendor policy registry，避免散落在多个 if/else 中。
> 3. **先兼容后替换** — 先让新抽象完整承载现有行为，再逐家打开更强协议路线；BR MiniMax 全程保持原状可用。

---

## 1. 背景与问题

### 1.1 当前代码已经有骨架，但支持深度不均衡

当前桌面端模型运行时已经具备：

- `providerFlavor` / `providerFamily` / `protocolTarget` 三层识别骨架
- `execution-gateway -> protocol driver -> transport` 的统一执行骨架
- `prompt-composer`、`tool-middleware`、`turn-execution-plan` 的 family-aware 雏形
- `provider-capability-probers/*` 的目录归一化能力

对应文件包括：

- `desktop/shared/contracts/model.ts`
- `desktop/src/main/services/model-runtime/family-policy-resolver.ts`
- `desktop/src/main/services/model-runtime/execution-gateway.ts`
- `desktop/src/main/services/model-runtime/prompt-composer.ts`
- `desktop/src/main/services/model-runtime/tool-middleware.ts`
- `desktop/src/main/ipc/models.ts`

但当前支持深度存在明显不对称：

- OpenAI / Anthropic 已有 native driver 骨架
- BR MiniMax 已有专用 adapter / replay / probe
- Qwen / Volcengine Ark 虽然已有 family，但仍停留在兼容协议
- Kimi 目前基本还停留在 Moonshot preset / OpenAI-compatible generic 语义
- OpenRouter / Vercel AI Gateway / Ollama 等更多是 catalog / capability 层支持

### 1.2 当前最核心的结构性限制

当前运行时最大的结构性限制不在某一个厂商，而在抽象本身：

1. `family-policy-resolver.ts` 仍是“单 family 单协议”思路：
   - `openai-native -> openai-responses`
   - `anthropic-native -> anthropic-messages`
   - 其余全部 `openai-chat-compatible`

2. `provider-adapters/index.ts` 当前只有两个 adapter：
   - `br-minimax`
   - `openai-compatible`

3. `model-client.ts` 的请求层 flavor 识别仍然很粗，只真正识别：
   - `anthropic`
   - `qwen`
   - `qwen-coding`
   - `generic`

4. `rollout-gates.ts` 当前 gate 维度是 `providerFamily -> boolean`，无法表达：
   - 同一厂商的不同协议灰度状态
   - 同一厂商的最佳协议与 fallback 协议的不同放量节奏

### 1.3 为什么旧分层已经不够

根据近期官方文档，以下厂商都已明确支持多条 agent/coding 路线：

- OpenAI: Responses API
- Anthropic: Messages API / Claude Code
- Qwen: OpenAI Chat / OpenAI Responses / Anthropic-compatible
- Kimi: OpenAI-compatible / Claude Code（Anthropic 路线）
- Volcengine Ark: OpenAI-compatible / Responses / Claude Code
- MiniMax: Compatible OpenAI API / Compatible Anthropic API / Claude Code

这意味着“OpenAI / Anthropic 第一梯队，其他只能第二梯队”的旧判断已经过时。真正合理的第一梯队定义应是：

> 官方能力明确、且我们实现了 vendor-specific protocol / prompt / tool / reasoning / replay policy 的厂商

按这个标准，OpenAI、Anthropic、Qwen、Kimi、Volcengine Ark、MiniMax 都可以进入第一梯队。

---

## 2. 目标状态

### 2.1 新的一梯队定义

一梯队不再定义为“都走同一种协议”，而定义为：

- 拥有正式的 vendor family
- 拥有官方支持的多协议能力声明
- 拥有厂商专属的 tool / reasoning / prompt / replay / cache / fallback 策略
- 能通过 probe / config / rollout 决定本轮最佳协议
- 失败时能给出明确、厂商感知的降级解释

目标纳入第一梯队的 vendor family：

- OpenAI
- Anthropic
- Qwen
- Kimi
- Volcengine Ark
- MiniMax

其中 BR MiniMax 不是单独被抛弃的旧实现，而是 MiniMax family 下保留的 `br-private` deployment profile。

### 2.2 第二梯队定义

第二梯队聚焦“网关和兼容容器”，强调可配置性与可回退，不强求重度 vendor policy：

- OpenRouter
- Vercel AI Gateway
- Ollama
- generic OpenAI-compatible
- generic local gateway
- 其他 custom/manual endpoint

第二梯队仍然可以很好用，但不作为“深度原生策略”的优先投入对象。

---

## 3. 新架构设计

### 3.1 两个核心维度

本次升级后的运行时应明确分成两个核心维度：

1. `vendorFamily`
   - 这家是谁
   - 决定 capability 模板、prompt overlay、tool policy、reasoning 策略、fallback 解释、诊断文案

2. `protocolTarget`
   - 这轮实际走哪条协议
   - 决定 driver、wire shape、流式事件解析、transport metadata

新的设计要求：

- 一个 vendor family 可以支持多条 protocol
- protocol 的推荐值不能只由 vendorFamily 静态写死
- 需要综合以下信息选择：
  - 用户保存的首选协议
  - 厂商支持矩阵
  - route probe 结果
  - 模型类型
  - rollout gate
  - fallback 历史

### 3.2 新增 vendor policy registry

新增：

- `desktop/src/main/services/model-runtime/vendor-policy-registry.ts`

这个 registry 是新运行时的唯一厂商知识中心。它为每个 vendor family 定义：

- `vendorFamily`
- `supportedProtocols`
- `recommendedProtocolsByUseCase`
- `toolProfiles`
- `reasoningProfiles`
- `promptProfiles`
- `replayProfiles`
- `cacheProfiles`
- `fallbackOrder`
- `diagnosticRules`
- `modelMatchers`
- `deploymentProfiles`

伪结构示意：

```ts
type VendorPolicy = {
  vendorFamily: VendorFamily;
  supportedProtocols: ProtocolTarget[];
  recommendedProtocolsByUseCase: {
    default: ProtocolTarget[];
    coding: ProtocolTarget[];
    longContext: ProtocolTarget[];
    review: ProtocolTarget[];
  };
  toolProfileIdByProtocol: Partial<Record<ProtocolTarget, string>>;
  reasoningProfileIdByProtocol: Partial<Record<ProtocolTarget, string>>;
  promptProfileIdByProtocol: Partial<Record<ProtocolTarget, string>>;
  replayProfileIdByProtocol: Partial<Record<ProtocolTarget, string>>;
  cacheProfileIdByProtocol: Partial<Record<ProtocolTarget, string>>;
  fallbackOrderByProtocol: Partial<Record<ProtocolTarget, ProtocolTarget[]>>;
  deploymentProfiles?: string[];
};
```

### 3.3 Family policy 升级为 vendor runtime policy

当前：

- `resolveFamilyPolicy()` 输出一个 `providerFamily + protocolTarget + 若干 policy id`

升级后：

- `resolveVendorRuntimePolicy()` 输出：
  - `vendorFamily`
  - `supportedProtocols`
  - `recommendedProtocolTarget`
  - `selectedProtocolTarget`
  - `toolProfileId`
  - `reasoningProfileId`
  - `promptProfileId`
  - `replayProfileId`
  - `cacheProfileId`
  - `fallbackChain`
  - `diagnosticProfileId`

也就是说，执行计划里保存的将不只是“走哪条协议”，还要保存：

- 为什么选了这条协议
- 下一跳 fallback 是什么
- 当前启用了哪套 tools / reasoning / replay 策略

### 3.4 Rollout gate 升级为 vendor+protocol 维度

当前：

- `ProviderFamily -> enabled`

升级后建议为：

- `VendorFamily + ProtocolTarget -> rollout state`

例如：

- `openai.responses = stable`
- `anthropic.messages = stable`
- `qwen.responses = beta`
- `qwen.anthropic-messages = beta`
- `qwen.chat-compatible = stable`
- `kimi.anthropic-messages = stable`
- `ark.responses = beta`
- `ark.chat-compatible = stable`
- `minimax.anthropic-messages = beta`
- `minimax.chat-compatible = stable`

这样才可以逐厂商、逐协议灰度，而不是一刀切地把整个 family 全开或全关。

### 3.5 Adapter 升级为 vendor-aware adapters

当前 adapter 只有：

- `br-minimax`
- `openai-compatible`

升级后建议最少扩成：

- `openai-native`
- `anthropic-native`
- `qwen`
- `kimi`
- `volcengine-ark`
- `minimax`
- `generic-openai-compatible`
- `generic-local-gateway`

这里 adapter 不一定直接决定 protocol，但要负责：

- reasoning 字段映射
- replay 消息物化
- request body patch
- vendor-specific fallback variant
- response normalization hints
- provider-specific diagnostics

BR MiniMax 继续保留为 `minimax` family 的 deployment-specific adapter/policy，不单独废弃。

---

## 4. 各厂商的一梯队目标形态

### 4.1 OpenAI

目标：

- 主协议：`openai-responses`
- fallback：`openai-chat-compatible`

特征：

- strict tools
- Responses-native event parser
- reasoning effort 原生映射
- prefix cache / server continuity
- GPT-specific prompt overlay

### 4.2 Anthropic

目标：

- 主协议：`anthropic-messages`

特征：

- `input_schema`
- thinking delta
- descriptive tool summaries
- breakpoint cache
- block-aware replay

### 4.3 Qwen

目标：

- 支持 `openai-chat-compatible`
- 支持 `openai-responses`
- 支持 `anthropic-messages`

默认协议由 probe 与模型类型共同决定。

特征：

- DashScope URL 规则
- conservative tools
- Qwen-specific reasoning / prompt overlay
- 无法使用更强协议时回退到 compatible-safe path

### 4.4 Kimi

目标：

- 主协议：`anthropic-messages`
- 次协议：`openai-chat-compatible`

说明：

- 当前已知官方明确支持 OpenAI-compatible 与 Claude Code / Anthropic 路线
- 暂不强行将 Responses 作为主目标，除非后续官方文档进一步明确

特征：

- reasoning_content / tool call 兼容语义
- Kimi-specific cache / long-context / prompt overlay
- Claude Code friendly profile

### 4.5 Volcengine Ark

目标：

- 主协议：`openai-responses`
- 次协议：`anthropic-messages`
- fallback：`openai-chat-compatible`

特征：

- Ark-specific tool compile mode
- Responses 路线与 Claude Code 路线并存
- 官方 coding/agent 接入优先

### 4.6 MiniMax

目标：

- 主协议：`anthropic-messages` 或官方推荐路线
- 次协议：`openai-chat-compatible`

说明：

- 现有 BR MiniMax 行为保持不变
- 公开 MiniMax 与 BR MiniMax 收敛到同一 `MiniMax vendor family`
- BR MiniMax 作为 deployment profile 保留

特征：

- 保留现有 `reasoning_split / reasoning_content` probe
- 保留 `<think>` replay 物化
- 将现有强 replay 能力上升为 MiniMax family policy，而不是继续作为孤立私有分支存在

---

## 5. BR MiniMax 保留与收敛策略

### 5.1 原则

BR MiniMax 不能被重写掉，也不应该被迁出主链。它应被视为：

- MiniMax family 下的一个私有部署 profile
- 当前仓库里最成熟的一份 vendor-specific runtime 实现样板

### 5.2 必须保留的现有行为

以下行为必须保持兼容：

- `providerFlavor=br-minimax`
- `adapterId=br-minimax`
- `createBrMiniMaxProfile()` 产出的受管 profile
- `coerceManagedProfileWrite()` 的受管写入
- `reasoning_split / reasoning_content` 探测
- `<think>` replay 物化
- 已有 profile 文件格式
- 已有测试 golden transcript

相关文件：

- `desktop/shared/br-minimax.ts`
- `desktop/src/main/services/provider-adapters/minimax.ts`
- `desktop/src/main/services/br-minimax-runtime.ts`
- `desktop/src/main/services/managed-model-profile.ts`

### 5.3 在新机制中的位置

新机制下：

- `BR MiniMax` 仍可继续暴露为 preset
- 它挂在 `MiniMax vendor family` 下
- 它对应 `deploymentProfile = br-private`
- 它可以复用 MiniMax family 的部分公共策略
- 但保留自己的 probe / replay / request patch 逻辑

换句话说，BR MiniMax 被“收编进统一机制”，但不被弱化。

---

## 6. 数据模型调整

### 6.1 新增 VendorFamily

建议新增：

```ts
type VendorFamily =
  | "openai"
  | "anthropic"
  | "qwen"
  | "kimi"
  | "volcengine-ark"
  | "minimax"
  | "generic-openai-compatible"
  | "generic-local-gateway";
```

说明：

- 现有 `ProviderFamily` 可逐步迁移为 `VendorFamily`，或保留兼容字段并新增映射层
- 若迁移成本过高，可先新增 `vendorFamily`，再逐步淘汰旧 `providerFamily`

### 6.2 扩展 ModelProfile

建议扩展：

- `vendorFamily?: VendorFamily`
- `savedProtocolPreferences?: ProtocolTarget[]`
- `deploymentProfile?: string`
- `protocolSelectionSource?: "saved" | "probe" | "registry-default" | "fallback"`

### 6.3 扩展 TurnExecutionPlan

建议新增字段：

- `vendorFamily`
- `supportedProtocolTargets`
- `selectedProtocolTarget`
- `recommendedProtocolTarget`
- `fallbackChain`
- `toolProfileId`
- `reasoningProfileId`
- `promptProfileId`
- `replayProfileId`
- `cacheProfileId`
- `diagnosticProfileId`
- `protocolSelectionReason`

---

## 7. 实施顺序

### Wave 1: 抽象收口，不改变外部行为

目标：

- 新建 `vendor-policy-registry`
- 让 `family-policy-resolver`、`prompt-composer`、`tool-middleware`、`rollout-gates` 读取 registry
- 默认输出与当前行为保持一致

原则：

- 不先改 UI
- 不先改 profile 文件
- 不先打开新的协议路线

### Wave 2: 六家厂商接入新机制

目标：

- OpenAI / Anthropic / Qwen / Kimi / Ark / MiniMax 全部进入 registry
- 明确每家的 supported protocols、tool/reasoning/prompt/replay policies
- BR MiniMax 收编进 MiniMax family，但保持现有行为

### Wave 3: 扩展 adapter / driver / probe

目标：

- adapter 扩展为 vendor-aware
- route probe 按厂商能力矩阵探测
- canonical/native driver 逐厂商逐协议放量

### Wave 4: UI 与体验增强

目标：

- 设置页展示厂商支持协议矩阵
- 模型页展示推荐协议与 fallback 解释
- 保存 profile 时记录协议选择来源与链路

---

## 8. 风险与防护

### 8.1 MiniMax 回归风险

风险：

- 现有 BR MiniMax 行为复杂，若粗暴并入新机制，容易打坏 replay / degradation / probe

防护：

- 保留原文件与原测试
- 先做“适配层包裹”，不做内部重写

### 8.2 官方多协议能力不等于所有模型都同等支持

风险：

- 某厂商虽然官方支持多协议，但不同模型子线能力可能不同

防护：

- 引入 vendor+protocol rollout
- route probe 必须逐协议验证
- 保存 probe 结果与诊断

### 8.3 Legacy shim 与 canonical path 并存的观测混乱

风险：

- 同一 protocol 名义下，实际可能仍走 legacy shim

防护：

- transport metadata 明确记录：
  - 选中的协议
  - 实际执行路径
  - 是否发生 shim fallback

---

## 9. 验证策略

新增测试类别：

1. `vendor policy contract tests`
   - 每家支持哪些协议
   - 每家 fallback 链是否完整
   - 每家 tool/reasoning/prompt/replay profile 是否存在

2. `protocol selection integration tests`
   - 同一 vendor 在不同 probe / config / rollout 下能否选到不同 protocol

3. `golden transcript / replay tests`
   - MiniMax
   - Anthropic
   - Kimi
   - Qwen / Ark 的多协议切换

保留并扩展现有测试：

- `desktop/tests/model-runtime/unit/turn-execution-plan-resolver.test.ts`
- `desktop/tests/model-runtime/integration/execution-gateway.test.ts`
- `desktop/tests/phase1-golden-transcripts.test.ts`
- `desktop/tests/phase11-provider-capability-probers.test.ts`

---

## 10. 最终建议

本次增强不应继续采用：

- “新增一个 preset”
- “在 model-client 里再加一个厂商 if/else”
- “在 generic adapter 上继续堆一层例外”

应采用：

- 用 vendor policy registry 统一承载厂商知识
- 把 protocol 从 family 的附属字段升级为独立选择维度
- 让 OpenAI、Anthropic、Qwen、Kimi、Volcengine Ark、MiniMax 全部进入第一梯队
- 将 BR MiniMax 作为 MiniMax family 下的私有部署 profile 完整保留

这样才能让后续新增厂商或新增协议路线时，改动集中、行为一致、可灰度、可验证。

---

## 11. 官方文档参考

以下链接均为本次设计参考的公开官方文档入口：

- OpenAI Responses API:
  - https://platform.openai.com/docs/api-reference/responses
- Anthropic Messages API:
  - https://docs.anthropic.com/en/api/messages
- Qwen / DashScope:
  - https://www.alibabacloud.com/help/en/model-studio/text-generation
  - https://www.alibabacloud.com/help/doc-detail/3016539.html
  - https://www.alibabacloud.com/help/en/model-studio/claude-code
- Kimi:
  - https://platform.kimi.com/docs/guide/kimi-k2-quickstart
  - https://platform.kimi.com/docs/guide/agent-support
- Volcengine Ark:
  - https://www.volcengine.com/docs/82379/1330626
  - https://www.volcengine.com/docs/82379/2121998
  - https://www.volcengine.com/docs/82379/1928262
- MiniMax:
  - https://platform.minimax.io/docs/api-reference/api-overview
  - https://platform.minimax.io/docs/api-reference/text-openai-api
  - https://platform.minimax.io/docs/api-reference/text-anthropic-api
  - https://platform.minimax.io/docs/coding-plan/claude-code
  - https://platform.minimax.io/docs/api-reference/anthropic-api-compatible-cache

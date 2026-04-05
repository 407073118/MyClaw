# `br-minimax` Private Deployment Design

**Date:** 2026-04-04  
**Scope:** `desktop/` model onboarding, model runtime, MiniMax private deployment  
**Status:** Draft

## Background

`MyClaw` 当前的模型接入路径默认面向“通用可编辑模型配置”。用户可以在模型详情页自由修改 `provider`、`baseUrl`、`model`、`headers` 和 `requestBody`。这条路径适合开放式 OpenAI-compatible provider，但不适合当前的私有部署 MiniMax 场景。

这次接入对象不是普通的 “MiniMax preset”，而是一个受控的企业私有部署模型：

- 类型名固定为 `br-minimax`
- 用户只需要填写 `apiKey`
- 其余字段必须由产品内置并锁定
- 在模型选择时应作为默认模型存在
- 需要兼容 MiniMax 官方能力模型，同时吸收私有网关文档中的特定约束

结合 MiniMax 官方文档与用户提供的私有部署文档，可以确认以下事实：

- 官方同时提供 OpenAI-compatible 和 Anthropic-compatible 两条接入路径
- 官方工具调用与思考能力强调完整 assistant turn 语义，而不是只展示 reasoning 文本
- 用户的私有部署文档明确采用 OpenAI-compatible `/v1/chat/completions`
- 用户的私有部署文档明确支持 `chat_template_kwargs.enable_thinking`
- 用户的私有部署文档明确支持函数调用与流式 `reasoning_content`
- 用户的私有部署文档给出了固定推荐参数：`temperature=1.0`、`top_p=0.95`、`top_k=40`

这意味着 `br-minimax` 应被视为“受管控私有模型类型”，而不是“一个用户可随意改写的通用配置”。

## Goals

1. 为 `br-minimax` 提供独立、受管控的接入路径，让用户只填写 `apiKey` 即可完成配置。
2. 让 `br-minimax` 成为产品内的默认模型类型与默认模型配置候选。
3. 固化私有部署要求的 `baseUrl`、`model`、`requestBody` 与运行时策略，避免用户误改导致接入失败。
4. 在不破坏现有通用模型体系的前提下，为 `br-minimax` 增加 provider-aware 的思考模式与工具调用优化。
5. 为后续 MiniMax 官方直连与其他私有模型类型保留扩展空间。

## Non-Goals

1. 本轮不移除现有通用模型配置能力。
2. 本轮不把所有 MiniMax 变体都统一进 `br-minimax`。
3. 本轮不把 `br-minimax` 做成完全不可诊断的黑盒；产品仍应暴露只读诊断信息。
4. 本轮不把 Anthropic-compatible 官方路径强制替换为当前私有部署路径。

## Recommendation

推荐将 `br-minimax` 设计为一条独立于通用 preset 的“受管控模型类型”，并采用双轨架构：

- `minimax`
  继续保留为通用 MiniMax / OpenAI-compatible 可编辑路径
- `br-minimax`
  专门服务当前私有部署，默认启用、字段锁定、运行时专属优化

不推荐继续复用现有 `minimax` preset 再通过隐藏字段做特殊分支。那样会把“通用可编辑模型”和“私有受管控模型”混在同一产品抽象下，后续难以解释默认值、锁定策略与降级行为。

## Product Shape

### 1. 类型层

新增模型类型 `br-minimax`，显示名称可以直接使用：

- `BR MiniMax`

该类型在模型类型下拉中可见，但行为上属于受管控类型，不等同于其他开放配置类型。

### 2. 创建流

当用户选择 `br-minimax` 时：

- 表单仅显示 `API Key`
- 其余字段全部隐藏或只读
- 页面顶部明确提示“企业私有部署模型，参数由系统托管”
- 创建后自动设为默认模型

建议在首次进入模型设置页、且尚未创建任何模型时，默认聚焦 `br-minimax`，而不是 `openai`。

### 3. 详情页

`br-minimax` 详情页不复用当前完全开放的编辑表单，而应进入“受管控详情模式”：

- `apiKey` 可编辑
- `baseUrl` 只读展示
- `model` 只读展示
- 推荐参数只读展示
- `thinking` 策略只读展示当前默认值
- 诊断区展示是否启用工具调用、思考模式、上下文长度、能力来源

### 4. 用户心智

产品文案不应把它描述为“自定义 OpenAI-compatible 模型”，而应描述为：

- “企业私有部署 MiniMax”
- “系统已预置推荐参数”
- “只需填写 API Key”

## Locked Configuration

`br-minimax` 应内置并锁定以下字段：

- `provider = openai-compatible`
- `providerFlavor = br-minimax`
- `baseUrl = {私有网关地址}`
- `baseUrlMode = provider-root` 或按网关实际要求固定
- `model = minimax-m2-5`
- `requestBody.temperature = 1.0`
- `requestBody.top_p = 0.95`
- `requestBody.top_k = 40`
- `requestBody.chat_template_kwargs.enable_thinking = true` 作为默认策略

需要保留的唯一可编辑字段：

- `apiKey`

可选的第二阶段只读或半锁定字段：

- `thinking mode`：默认 `Auto / Enabled`
- `max_tokens`：如果未来确有业务需要，再考虑开放受限编辑

## Architecture Shape

### 1. Shared Contracts

`desktop/shared/contracts/model.ts` 需要新增：

- `ProviderFlavor` 中加入 `br-minimax`
- `ModelCapability` 中补充更明确的 reasoning 运行时语义，例如：
  - `supportsReasoning`
  - `requiresReasoningReplay`
  - `preferredThinkingMode`
  - `managedProfile`

这里的关键不是暴露私有实现细节，而是让运行时知道：`br-minimax` 是一个受管控类型，并且具有明确的 reasoning 行为要求。

### 2. Model Profile Factory

应新增一个专门的 profile 构造入口，而不是让 UI 直接拼装字段：

- `createBrMiniMaxProfile(apiKey)`

该工厂负责输出完整的锁定配置，确保：

- 新建时字段正确
- 恢复时结构一致
- UI 不需要知道所有私有默认值

### 3. Renderer

`ModelDetailPage.tsx` 不应继续把 `br-minimax` 当作普通 preset 处理，而应进入条件化渲染：

- 普通类型：继续显示完整编辑器
- `br-minimax`：显示托管模式表单

如果后续模型创建入口继续保留下拉类型选择，也应让 `br-minimax` 拥有独立卡片说明，而不是和 `OpenAI`、`Custom` 在同一级信息密度下展示。

### 4. Main Process

`ipc/models.ts` 需要增加 `br-minimax` 受管控策略：

- 创建时校验锁定字段不能被外部覆盖
- 更新时只允许修改 `apiKey`
- 设为默认模型时优先支持首次初始化自动落地

换句话说，UI 隐藏字段只是第一层，主进程仍要做真正的写入门禁。

## Runtime Strategy

`br-minimax` 的独立路线不能只停留在“接入更简单”，还要在运行时上体现专属优化。

### 1. Request Patch

运行时遇到 `providerFlavor = br-minimax` 时，应自动附加私有部署需要的请求 patch：

- 推荐参数默认值
- `chat_template_kwargs.enable_thinking`
- 与工具调用兼容的请求体结构

### 2. Response Parsing

现有 `model-client.ts` 已能解析 `reasoning_content` 与 `reasoning_details`，但还不够。`br-minimax` 需要把 reasoning 看成 assistant turn 的一部分，而不是单独展示字段。

### 3. History Replay

当前 `context-assembler.ts` 与 `model-client.ts` 在出站消息中只保留 `role/content/tool_calls`，没有完整回放 reasoning 语义。这会削弱多轮工具调用表现。

因此 `br-minimax` 路线必须继续依赖先前已经识别出的 reasoning runtime 改造方向：

- 会话状态表达 thinking 策略
- provider adapter 定义 replay 规则
- 保留完整 assistant turn 语义

### 4. Degradation

当私有网关某个环境不接受特定 `chat_template_kwargs` 或 thinking patch 时：

- 自动降级到兼容模式
- 记录日志
- 在 UI 中显示“已降级到兼容模式”

不要把失败直接暴露为“模型不可用”。

## Capability Optimization Strategy

这部分是 `br-minimax` 路线的核心增强点。目标不是“能调通”，而是“尽可能发挥 MiniMax 官方能力模型在当前私有部署上的上限”。

### 1. 明确采用“官方能力模型 + 私有部署入口”的策略

这里要同时尊重两类事实：

- MiniMax 官方文档把 Anthropic-compatible 路径标记为推荐路径
- 当前用户私有部署文档明确提供的是 OpenAI-compatible `/v1/chat/completions`

因此本路线不应强行把私有部署改写成 Anthropic-compatible，而应采用：

- 能力设计参照官方 MiniMax 最佳实践
- 传输协议以当前私有部署实际暴露的 OpenAI-compatible 网关为准

换句话说，`br-minimax` 的优化目标不是“模拟 OpenAI”，而是“在私有 OpenAI-compatible 外壳下尽可能保留 MiniMax 原生 thinking / tool use 语义”。

### 2. 请求参数归一化

`br-minimax` 运行时应在发送请求前做 provider-aware 归一化，而不是简单合并 `requestBody`：

- 固定默认值：
  - `temperature = 1.0`
  - `top_p = 0.95`
  - `top_k = 40`
- thinking 默认策略：
  - `chat_template_kwargs.enable_thinking = true`
- 上下文能力默认值：
  - `contextWindowTokens = 102400`，以当前私有部署文档为准

同时应避免把通用 OpenAI 风格噪声参数原样透传给 `br-minimax`。例如：

- `presence_penalty`
- `frequency_penalty`
- `logit_bias`
- 已废弃的 `function_call`

这些字段在官方兼容文档中要么被忽略，要么不推荐使用。`br-minimax` 的托管模式不应继续暴露这些参数，以免用户把“兼容参数”误当成“高价值调优项”。

### 3. Thinking 策略不只是一开一关

用户文档证明私有网关支持 `chat_template_kwargs.enable_thinking`，但如果只把它实现为 UI 开关，收益仍然有限。`br-minimax` 需要的是分层 thinking 策略：

- 默认模式：开启 thinking
- 兼容降级：当网关拒绝该 patch 时自动关闭并记录原因
- 后续增强：在 provider adapter 中支持 `Auto` 语义，而不是永远裸 `true/false`

这意味着 `enable_thinking` 应首先是运行时策略字段，其次才可能是产品层控制项。

### 4. 优先实现完整 assistant replay

这是当前最影响效果的一项。MiniMax 官方文档已经明确强调：

- 多轮工具调用中必须把完整 assistant response 回传到历史
- OpenAI-compatible 路径中，如果使用 `reasoning_split=True`，`reasoning_details` 也必须完整保留
- 如果 `content` 中包含 `<think>` 内容，也必须完整保留

而 `MyClaw` 当前实现仍然主要在做：

- 展示 reasoning
- 回传 `content`
- 回传 `tool_calls`

但并没有把 thinking 视为下一轮上下文的一等公民。对于 `br-minimax`，这一点要改成强约束：

- assistant turn 必须保留完整结构
- tool-call 前后的 assistant message 不能被简化成“只留正文”
- reasoning replay 逻辑必须进入 contract test

### 5. 在 OpenAI-compatible 路径中优先支持 `reasoning_split`

MiniMax 官方 OpenAI-compatible 文档给出了一条更稳定的 interleaved thinking 方案：

- 通过 `extra_body={"reasoning_split": true}` 把 thinking 内容拆分到 `reasoning_details`

对于 `br-minimax`，推荐采用“能力探测 + 双路径兼容”策略：

- 第一优先：如果当前私有网关兼容 `reasoning_split`，则优先启用
- 第二优先：如果私有网关只支持 `reasoning_content`，则回退到文档中的当前部署方式
- 第三优先：如果 thinking patch 失败，则自动进入非 thinking 兼容模式

这样做的好处是：

- 不会被当前私有文档样例绑定死
- 可以随着私有网关能力升级自动吃到官方更优格式
- 仍然保持现有部署可用

### 6. Tool Calling 优化要和 thinking 一起做

MiniMax 的优势不是单点文本生成，而是 “thinking + tool use + long task decomposition” 的组合能力。因此 `br-minimax` 的优化不能只盯着 `reasoning_content` 展示，还要同时改：

- 工具调用前 assistant message 的保留策略
- 工具调用后历史追加顺序
- finish_reason 为 `tool_calls` 时的完整消息持久化
- 空正文但有 `tool_calls` / reasoning 的消息不能被当作无效消息丢弃

这里的目标是：让 `br-minimax` 在 agentic loop 里更像它在官方文档中展示的工作方式，而不是一个只会“多输出一段思考文本”的普通聊天模型。

### 7. Token 与上下文预算策略也要做专属优化

当前 `MyClaw` 的安全默认能力值偏保守，而用户私有部署文档明确给出：

- `max-model-len = 102400`
- 支持前缀缓存

因此 `br-minimax` 的能力解析与预算策略不应继续沿用 generic fallback。建议：

- 把 `br-minimax` 的默认 `contextWindowTokens` 提升到 102400
- 针对长任务适当放宽 recent turns 保留与 summary 触发阈值
- 为后续 prefix cache / prompt cache 接入预留 capability 字段

第一阶段不一定要真正接入缓存，但必须在类型与 runtime 设计里留出位置，否则后续很容易再次退化成“全局通用默认值”。

### 8. Prompt 侧也要做托管优化

用户私有部署文档已经给出默认系统提示与推荐参数，这说明 `br-minimax` 不是一个“完全让用户自由发挥 prompt”的接入对象。建议：

- 系统 prompt 保持当前产品语义，但在 `br-minimax` 路线上增加更明确的工具调用与规划偏好
- 避免过度压制 spec-writing / planning 倾向
- 不要再为这个类型默认叠加与 MiniMax 行为相冲突的通用限制性提示

这里的重点不是写一段超长 provider prompt，而是减少与模型天性相冲突的通用约束。

### 9. 推荐的优化优先级

如果要按收益排序，推荐顺序如下：

1. 托管类型与锁定字段
2. 推荐参数自动注入
3. 完整 assistant / tool / reasoning replay
4. `reasoning_split` 能力探测与优先启用
5. thinking 降级与状态可解释
6. 上下文窗口与预算策略专项优化
7. prefix cache / prompt cache 利用

这能保证 `br-minimax` 先从“正确接入”进化到“更强表现”，而不是一开始就陷入过早优化。

## Relationship To Official MiniMax Path

`br-minimax` 不应覆盖官方 MiniMax 路线，而应与之并存：

- `minimax`
  用于官方或通用兼容路径，允许高级用户自行调整
- `br-minimax`
  用于当前私有部署，固定网关和参数

这种双轨模式有两个好处：

1. 不破坏已有通用模型体系
2. 不把私有部署特殊性污染为全局 MiniMax 真理

## Risks

1. **只做 UI 锁定，不做主进程门禁**
   用户仍可通过持久化文件或 IPC 绕开限制，最终出现脏配置。
2. **只做接入入口，不做运行时优化**
   用户配置更简单了，但实际回答质量与工具调用稳定性仍然不达预期。
3. **把 `br-minimax` 和 `minimax` 混成同一抽象**
   后续会持续堆积 `if minimax && private` 分支。
4. **默认模型策略不清晰**
   如果 `br-minimax` 既想默认，又允许被普通类型覆盖，必须定义首次初始化和后续用户修改的优先级。
5. **只照抄私有部署样例，不吸收官方最佳实践**
   最终会得到“只能工作在当前网关版本下”的脆弱实现，难以随着 MiniMax 官方能力升级受益。

## Recommended Phase Path

### Phase 1: Managed Type + Default Path

目标：先把产品入口与配置约束做对。

交付包括：

- 新增 `br-minimax` 类型
- 新建受管控 profile 工厂
- 模型详情页进入“只填 API Key”模式
- 首次创建自动设为默认模型
- 主进程增加锁定字段校验
- `br-minimax` 能力默认值接入 102400 context window

### Phase 2: `br-minimax` Runtime Adapter

目标：把私有部署思考模式与工具调用体验做稳。

交付包括：

- `br-minimax` request patch builder
- 推荐参数自动注入
- `enable_thinking` 默认策略
- `reasoning_split` 能力探测与优先启用
- 降级日志与兼容模式状态
- reasoning replay 契约测试
- tool call 历史回放测试

### Phase 3: Managed Diagnostics + UX Polish

目标：让这条私有路径具备可解释性与可运维性。

交付包括：

- 只读能力面板
- 当前模式标签，例如“托管模式 / 兼容模式”
- 当前 thinking 路径标签，例如“reasoning_split / reasoning_content / disabled”
- 更明确的错误文案
- 首次使用引导与空状态优化
- 缓存能力预留与后续提示

## Verification Strategy

1. **产品层**
   验证 `br-minimax` 创建时是否只要求 `apiKey`。
2. **约束层**
   验证被锁定字段无法通过 UI 或 IPC 被任意改写。
3. **运行时层**
   验证默认参数、thinking patch、tool calls 和 reasoning replay 都正确进入主链。
4. **回归层**
   验证原有 `openai`、`minimax`、`custom` 类型不受影响。
5. **能力层**
   验证 `reasoning_split`、`reasoning_content`、非 thinking 三种路径都能正确工作并可解释。

## Decision Summary

最终建议为：

- 新增独立模型类型 `br-minimax`
- 把它定义为“企业私有部署 MiniMax”的受管控接入路径
- 仅允许用户填写 `apiKey`
- 固定网关、模型名、推荐参数与默认 thinking 策略
- 以官方 MiniMax 最佳实践指导私有 OpenAI-compatible 路径优化
- 优先补齐 replay / tool use / thinking 主链，而不是只做表单封装
- 产品层与运行时层分阶段推进
- `br-minimax` 与通用 `minimax` 双轨并存，而不是互相覆盖

# 桌面端上下文压缩机制

> 目标读者：维护 `desktop/src/main/ipc/sessions.ts` agentic 主链、调试上下文截断行为、或排查"对话越聊越笨"问题的工程师。
>
> 本文盘点的是当前实际跑在主链上的代码，不是规划。半成品和未接入的部分会单独标注。

## 速览

- 上下文组装入口：`assembleContext()`（`desktop/src/main/services/context-assembler.ts`）。每一轮 agentic 循环都跑一次。
- 压缩策略：**纯结构化，不调模型**。包括工具输出截断 → Observation Masking → 删除最旧消息三段。
- Token 估算：基于字符数的本地估算，区分 ASCII/CJK，5 种模式，**没有真正的 tokenizer 库**。
- 触发模型："超过预算才压"，不是"接近预算就压"。`compactTriggerTokens` 字段被算出但**当前主链没有消费**。
- 用户警告：累计压缩 ≥2 次、消息总数 ≥100、或单次删除 >60%，向 renderer 推 `context.limit_warning` 事件，提示新建对话。每会话只推一次。
- 没有 LLM-summary 路径，没有持久化的工作/长期记忆接入主链，`MemoryService` 与 `context-checkpoint-service` 当前都是孤岛。

```
┌─────────────────────────── agentic loop（sessions.ts:2941-）───────────────────────────┐
│                                                                                       │
│  resolveModelCapability ─→ buildExecutionPlan ─→ assembleContext ─→ canonical → model │
│                                                       │                               │
│                                                       ↓                               │
│                                            （超过预算才进入压缩）                       │
│                                                       │                               │
│                            ┌──────────────────────────┴────────────────────────────┐  │
│                            │ 阶段 1：工具输出截断（>2000 token）                     │  │
│                            │ 阶段 1.5：Observation Masking（保留近 10 条工具输出）   │  │
│                            │ 阶段 2：删除最旧消息（保留近 12 条）                    │  │
│                            └──────────────────────────┬────────────────────────────┘  │
│                                                       ↓                               │
│                                          shouldSuggestNewChat ─→ ContextLimitWarning  │
│                                                                                       │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

## 1. 触发时机与入口

主入口在 `desktop/src/main/ipc/sessions.ts` 的 agentic 循环：

| 行 | 行为 |
|---|---|
| `2934-2935` | 每次发送消息时初始化 `compactionCount = 0` 和 `suggestNewChatSent = false` |
| `2941` | `while (true)` agentic 循环开始 |
| `2950-2961` | 每轮重新解析能力、执行计划、turn 计划 |
| `2976-2985` | **每轮调用 `assembleContext`**，传入累计压缩次数 |
| `2986-2993` | 若本轮发生压缩，`compactionCount++` 并打日志 |
| `2994-3003` | 若 `shouldSuggestNewChat` 命中，向 renderer 广播 `ContextLimitWarning`（一个会话只发一次） |
| `3004-3039` | 把组装出的 `assembled.messages` 喂给 canonical turn content + provider adapter |

**重要事实：每次调用模型前都跑一次 `assembleContext`**，不是只在临界点触发。这意味着：

1. 估算与组装的开销摊到每轮，不是大额一次性。
2. 一旦某轮触发压缩，被裁剪的上下文是发给本轮模型的视图，但 `session.messages` 本身不会被改写——下一轮还会从原始历史再算一遍，再裁剪一遍。这是为了让回放/导出始终能看到原始消息。
3. `compactionCount` 是进程内计数，**不持久化**。重启 Electron 主进程后归零。

## 2. Token 预算配方

预算计算在 `desktop/src/main/services/token-budget-manager.ts` 的 `buildBudgetSnapshot()`。默认策略来自 `desktop/shared/contracts/model.ts:251` 的 `DEFAULT_CONTEXT_BUDGET_POLICY`：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `outputReserveTokens` | 4096 | 给模型输出留的 token |
| `systemReserveTokens` | 2048 | 系统提示估算开销（最终系统提示会再精确算一遍） |
| `toolReserveTokens` | 4096 | 工具 schema 在 prompt 里的占用 |
| `memoryReserveTokens` | 4096 | 长期/工作记忆预留（即便没启用记忆也扣这一块） |
| `safetyMarginTokens` | 1024 | 安全边距 |
| `compactTriggerRatio` | 0.8 | 历史触发比；**当前未消费**，见第 9 节 |
| `minRecentTurnsToKeep` | 12 | 阶段 2 删消息时强制保底数量 |
| `recentToolOutputTurnsToKeep` | 10 | 阶段 1.5 不会被 mask 的近期工具输出条数 |
| `suggestNewChatAfterCompactions` | 2 | 累计压缩到这次时弹"建议新建对话" |
| `maxSummaryBlocks` | 4 | 规划字段；当前未消费 |
| `enableLongTermMemory` | true | 规划字段；当前未消费 |
| `enableContextCheckpoint` | true | 规划字段；当前未消费 |

总预留默认 = 4096 + 2048 + 4096 + 4096 + 1024 = **15360 tokens**。

### 计算公式

```
effectiveContextWindow = min(contextWindowTokens, maxInputTokens + maxOutputTokens) ?? 32768
effectiveMaxInput      = min(maxInputTokens, contextWindowTokens) ?? effectiveContextWindow
effectiveMaxOutput     = maxOutputTokens ?? 4096
safeInputBudget        = max(0, effectiveMaxInput − 总预留)
compactTriggerTokens   = profile.compactTriggerTokens || floor(safeInputBudget × compactTriggerRatio)
```

举例（32K 上下文窗口，默认策略）：

```
effectiveMaxInput  = 32768
safeInputBudget    = 32768 − 15360 = 17408
compactTriggerTokens = 17408 × 0.8 = 13926   ← 算出来但当前没人用
```

`assembleContext` 实际把 `safeInputBudget − systemTokens` 当 `messageBudget` 传给压缩器，触发条件是 `totalTokens > messageBudget`。所以**实际触发线是 100% 的预算，不是 80%**。

### Profile 级覆盖

`ModelProfile`（`desktop/shared/contracts/model.ts:284`）提供两个覆盖入口：

- `contextWindowOverride`：覆盖发现的 `contextWindowTokens`，由 `model-capability-resolver.ts:65` 拼成 capability override。
- `compactTriggerTokens`：覆盖按比例算的触发线（但同样未被主链消费）。

UI 入口在 `desktop/src/renderer/pages/ModelDetailPage.tsx`，用户在模型详情页可以填写。

### 兜底

- 模型没声明 context window 也没声明 maxInput 时，兜底 `32768`。
- `effectiveMaxOutput` 兜底 `4096`。
- 总预留扣完若 ≤0，`safeInputBudget` 至少为 0（不会负）。

## 3. 压缩四阶段

实现：`desktop/src/main/services/context-compactor.ts:124` `compactMessages()`。

每个阶段都基于增量 token 估算（O(n) 一次预热，每次修改后只更新被改的那条）。

### 阶段 0 — 预热与短路

```ts
tokenCounts = messages.map(estimateMessageTokens)        // O(n) 一次
totalTokens = sum(tokenCounts) + 3                        // +3 conversation overhead
if (totalTokens <= budgetTokens) return 不压缩
```

进入压缩前先做 `sanitizeReplayMessage` 应用 `SessionReplayPolicy`（见第 8 节），按需剥离 `reasoning` 字段。

### 阶段 1 — 工具输出截断

针对 `role === "tool"` 的消息，调用 `sanitizeToolOutput(content, 2000)`：

- 阈值：`2000 tokens × 4 字符/token = 8000 字符`（`desktop/src/main/services/tool-output-sanitizer.ts`）。
- 超过则切到 8000 字符并附 `\n\n[输出已截断] 原始输出过长，仅保留前部分内容。`。
- 截断后立刻重算这条消息的 token 数并增量更新 `totalTokens`。

完成后若已经在预算内，直接返回 `reason: "tool-output-trimmed"`。

注意：阶段 1 的阈值是写死的 `2000`，没有从策略读取。

### 阶段 1.5 — Observation Masking

目的：对历史中的旧工具输出做"语义占位符替换"，保留语义但收回 token。

```ts
recentToolKeep = policy.recentToolOutputTurnsToKeep ?? 10
// 倒序收集所有 role="tool" 的索引
// 跳过最近 recentToolKeep 条，把更早的替换为占位符
```

占位符长这样（`buildToolOutputPlaceholder`）：

```
[工具输出已省略] 工具: fs_read, 原始行数: 142, 摘要: import path from "node:path";...
```

工具名通过遍历前面的 assistant 消息匹配 `tool_call_id` 拿到。摘要取原文前 80 字符（换行替换为空格）。

跳过条件：原文 ≤ 100 字符的工具输出（替换没意义）。

完成后若达标，返回 `reason: "observation-masked"`。

### 阶段 2 — 删除最旧消息

```ts
minKeep = policy.minRecentTurnsToKeep ?? 12
while (removeCount < messages.length − minKeep && totalTokens > budgetTokens) {
  totalTokens -= tokenCounts[removeCount]
  removeCount++
}
messages = messages.slice(removeCount)
```

**保底**：至少留下最近 `minKeep` 条消息，即便仍超预算也不再删。这意味着如果近 12 条本身就撑爆预算（比如 12 条都是巨型工具输出），压缩后仍然超预算——这是已知设计权衡，依赖阶段 1 已经把单条工具输出降到合理大小。

### 返回值

```ts
{
  compacted: ChatMessage[]            // 压缩后的视图，原数组不变
  removedCount: number                // 阶段 2 删了多少条
  maskedToolOutputCount: number       // 阶段 1.5 mask 了多少条
  reason: string | null               // null = 没压；否则给个简短理由
  estimatedTokens: number             // 压缩后估算 token
}
```

`reason` 当多阶段都触发时拼接，例如 `"Observation Masking 8 条工具输出；移除 14 条陈旧消息"`。

## 4. Token 估算策略

实现：`desktop/src/main/services/token-estimator.ts`。

`ModelCapability.tokenCountingMode` 决定走哪种模式（`desktop/shared/contracts/model.ts:157`）：

| 模式 | ASCII | CJK | 备注 |
|---|---|---|---|
| `character-fallback` | 4 字符/token | 1.5 字符/token | 默认兜底 |
| `openai-compatible-estimate` | 4 | 2 | 接近 cl100k_base |
| `anthropic-estimate` | 4 | 1.8 | Anthropic 偏向 |
| `local-heuristic` | 3.5 | 1.4 | 本地模型一般 tokenizer 效率低 |
| `provider-native` | — | — | 降级到 `openai-compatible-estimate` |

每条消息额外 `+4` token overhead（角色标记、格式分隔），整段对话 `+3` token（起止标记）。

CJK 判定覆盖：CJK 统一表意（基本+扩展 A/B）、兼容表意、平假名、片假名、韩文 Hangul。**未覆盖**：emoji、阿拉伯文、印地语等其它非 ASCII。这些会按 ASCII 4 字符/token 处理，估算偏松。

## 5. 系统提示组成

入口：`desktop/src/main/ipc/sessions.ts:1051` `buildSystemPrompt()`。组装顺序：

1. **Identity** — `You are MyClaw, an expert AI assistant ...`
2. **Environment** — 工作目录、平台、日期、git 分支
3. **Session Context**（可选）— 来自 `context-enricher.ts`，见第 6 节
4. **Response Strategy**（仅 `effort != "low"`）— 意图分类引导
5. **Task Planning** — 强制工作流（plan/execute 两阶段）
6. **Tools** — 按分类列工具（Files / Shell&Git / Web&Browser / PPT / Time）
7. **Connected Services (MCP)**（可选）— 企业 MCP 工具
8. **Tool Strategy** — 按 `effort` 分级（low/medium/high）
9. **Skills**（可选）— 可用 skill 列表，强调 skill-first 原则
10. **Guidelines** — 行为约束，按 effort 分级
11. **硅基员工身份**（仅当 `session.siliconPersonId` 非空）— 由 `boundBuildSystemPrompt`（`sessions.ts:2658`）追加在末尾
12. **Personal Prompt**（可选）— 用户个人 profile

`assembleContext` 还接受一个可选的 `workingMemory` 参数，会以 `# Working Memory\n…` 形式追加。**当前 `sessions.ts` 调用时没有传这个字段**，等同于关闭。

### canonical 提示（替代实现）

`desktop/src/main/services/model-runtime/prompt-composer.ts` 的 `composePromptSections()` 提供一份基于 `PromptSection[]` 的结构化提示，支持 vendor 级 overlay（`vendor-policy-registry.ts`）。当前 `sessions.ts:3005` 调用 `buildSessionPromptSections` 把它接到 canonical turn content 上，与第 1-12 项的旧字符串提示**并行存在**。两条路线共存，目前 vendor adapter 拼请求时倾向消费 canonical 版本。

## 6. 上下文增强块（零成本抽取）

`assembleContext` 之外，`sessions.ts` 在每轮都从会话现状挤一份结构化上下文塞进系统提示。所有抽取都不调模型。

### 6.1 Session Context（`context-enricher.ts`）

`extractEnrichedContext(session)` 返回：

| 字段 | 来源 | 上限 |
|---|---|---|
| `recentFiles` | 倒序扫描 assistant 消息的 `tool_calls`，挑 `fs_*` / `git_*` 工具的 `path` 参数 | 8 个 |
| `gitSummary` | 最近一次 `git_status` 的工具结果，提取分支行 + 变更数 | 1 行 |
| `sessionTheme` | 最近 5 条用户消息匹配关键词分类（debugging / building / understanding / refactoring / testing / deploying） | 至多 2 类 |
| `activeTasksSummary` | `session.tasks` 的 in_progress / pending / completed 计数 | 一行 |

`buildEnrichedContextBlock()` 拼成约 200-400 token 的 `# Session Context` 块。无任何字段时返回空字符串。

### 6.2 Work Files（`artifact-context-builder.ts`）

`buildArtifactContextBlock()` 聚合 `ArtifactRegistry` 在 `session` / `workflowRun` / `siliconPerson` 三个 scope 下的 artifact，按 `updatedAt` 降序，取前 8 条，输出每条的 `id / title / kind / lifecycle / status / path / scopes`。

注：本文件含 mojibake（注释为乱码字符），不影响功能。

### 6.3 Meeting Context

`buildMeetingContextBlock()`（在 `sessions.ts` 内）— 当用户在会话里勾选了"对话分析"时附加会议转写稿。文档外，本文不展开。

这三个 block 都通过 `boundBuildSystemPrompt` 闭包参数喂回 `buildSystemPrompt`（`enrichedContextBlock`）和 `buildSessionPromptSections`（`enrichedContextBlock` / `artifactContextBlock` / `meetingContextBlock`）。

## 7. ContextLimitWarning 与 UI

### 7.1 触发条件

`assembleContext` 末尾计算（`context-assembler.ts:154-164`）：

```ts
currentCompactionCount = priorCompactionCount + (本轮是否压缩 ? 1 : 0)
removedRatio          = removedCount / 原始消息数

shouldSuggestNewChat =
     currentCompactionCount >= suggestNewChatAfterCompactions  // 默认 ≥2
  || 原始消息总数 >= 100
  || removedRatio > 0.6
```

`wasCompacted` 的定义是 `removedCount > 0 || maskedToolOutputCount > 0`——也就是说阶段 1.5 单独触发也算。

### 7.2 事件流

`sessions.ts:2994-3003`：

```ts
if (assembled.shouldSuggestNewChat && !suggestNewChatSent) {
  suggestNewChatSent = true
  broadcastToRenderers("session:stream", {
    type: EventType.ContextLimitWarning,    // "context.limit_warning"
    sessionId,
    compactionCount,
    removedCount,
    maskedToolOutputCount,
  })
}
```

`suggestNewChatSent` 是会话级守卫，**一个 send-message 流程内只发一次**。下次用户再发消息会重置。

事件类型定义：`desktop/shared/contracts/events.ts:21`。

### 7.3 渲染端

`desktop/src/renderer/pages/ChatPage.tsx`：

- `:999` — 监听 `context.limit_warning` 事件，匹配当前活跃 session 时 `setShowContextWarning(true)`
- `:1596` — 黄色警告条，文案"当前对话较长，上下文已多次压缩，回答质量可能下降。建议新建对话继续工作。"
- 提供"新建对话"按钮和"忽略"按钮。
- 配色：`rgba(251,191,36,0.08)` 背景 + `rgba(251,191,36,0.25)` 描边。

## 8. SessionReplayPolicy

定义：`desktop/shared/contracts/session-runtime.ts:40`。决定回放历史 assistant 消息时保留多少：

| 策略 | 保留 reasoning | 保留 tool_calls |
|---|---|---|
| `content-only` | 否 | 否（仅 content） |
| `assistant-turn` | 否 | 是 |
| `assistant-turn-with-reasoning`（默认） | 是 | 是 |

压缩器在阶段 0 调用 `sanitizeReplayMessage`，对 assistant 消息按策略剥离 `reasoning` 字段（`context-compactor.ts:59`）。这一步在 token 估算之前发生，所以剥掉 reasoning 后预算自动宽松。

策略来源优先级：`executionPlan.replayPolicy` > 显式 `replayPolicy` 参数 > 默认（保留全部）。`buildExecutionPlan()` 会根据模型能力（如不支持 reasoning 回放）降级。

## 9. 半成品与未接入

以下代码存在但**当前不在主链**，写文档时容易误读为已生效，特别注意：

### 9.1 `compactTriggerTokens` 字段

`buildBudgetSnapshot` 算了 `compactTriggerTokens`（`token-budget-manager.ts:109`），但 `assembleContext` 没传它给 `compactMessages`，`compactMessages` 也只看 `budgetTokens`。也就是说：

- 文档/UI/测试都把它描述为"提前触发线"，实际**当前等同于 0.8 这个比例没有作用**。
- 实际触发线就是 `safeInputBudget - systemTokens` 这个 100% 预算线。

如果要让它真正生效，需要在 `assembleContext` 里把 `messageBudget` 设为 `compactTriggerTokens - systemTokens`（或类似策略），把"接近预算就压"变成真实行为。

### 9.2 `MemoryService` 与记忆生态

文件：`memory-service.ts`、`memory-extractor.ts`、`memory-ranker.ts`、`memory-retriever.ts`。

- 7 种 `MemoryType`：`rolling-summary | working-memory | project-fact | user-preference | tool-discovery | checkpoint | pinned-context`
- 抽取：`extractMemoryCandidates()` 用正则匹配技术栈/偏好，importance 默认 0.6/0.7。
- 排序：`rankMemories()` = 0.4 × 相关性 + 0.3 × 重要性 + 0.2 × 时效性 + 0.1 × pin。时效性指数衰减半衰期 7 天。
- **`MemoryService` 是纯内存容器，没有任何持久化代码。**
- **`sessions.ts` 没有引用 `MemoryService`**，`assembleContext` 的 `workingMemory` 参数也没人传。

整套记忆代码当前是孤岛。如果要接入，最小改动是：在 sessions agentic loop 里维护一个会话级 `MemoryService` 实例，每轮跑 `extractAndStore`，再把 `buildMemoryContext(query)` 的结果塞给 `assembleContext({ workingMemory: ... })`。但持久化、跨会话共享、淘汰策略、与 `recentToolOutputTurnsToKeep` 的语义关系都还要补设计。

### 9.3 `context-checkpoint-service`

`createCheckpoint(session)` 用正则从消息抽取 `goals` / `constraints` / `openItems`，返回 `ContextCheckpoint`。

**没有任何代码调用它。** 看名字像是为"严重压缩前先存一份语义摘要"准备的钩子，但拉链没有接上。

### 9.4 策略字段

`ContextBudgetPolicy` 上的 `maxSummaryBlocks` / `enableLongTermMemory` / `enableContextCheckpoint` 三个字段当前没有消费方。`compactTriggerRatio` 只在 `compactTriggerTokens` 计算里用，而后者也未被消费——闭环都没成。

## 10. 关键观察与限制

1. **没有 LLM-summary 路径**。和 Claude Code 的 `/compact` 不同，本项目压缩纯结构化。优点是延迟稳定、零额外 API 成本；代价是丢失语义整合能力——对 50 轮以上的复杂工程会话，"删最旧消息"是粗暴的。
2. **每轮重组装的是视图，不是会话**。`session.messages` 始终是真值；压缩只影响发给模型的视图。这让回放/导出/调试稳定，但也意味着压缩计数的状态不持久化，主进程重启后丢失。
3. **预留过于保守**。默认 15360 token 预留对小窗口模型（8K / 16K）是灾难——`safeInputBudget` 可能只剩 0~1000 token。需要：
   - 给小窗口模型配置更小的 `memoryReserveTokens` / `toolReserveTokens`；
   - 或在 ModelDetailPage 让用户用 `contextWindowOverride` 把窗口虚高一点（不推荐，会引发上游 4xx）。
4. **`minRecentTurnsToKeep = 12` 的硬保底**。压缩可能在已超预算的前提下返回，model adapter 那边需要兜底处理（截断或报错）。当前实现依赖阶段 1 把单条工具输出降到 8000 字符，假设近 12 条总量可控。
5. **没有自适应**。每次都是相同策略，不根据"上次模型是否报 context_length_exceeded"调整阈值。如果遇到反复触发警告但模型仍报错的情况，目前要手动调 `compactTriggerRatio` / `recentToolOutputTurnsToKeep`。
6. **`tokenCountingMode` 仅影响估算精度，不影响真实计费**。模型计费由 provider 端真 tokenizer 决定，估算偏差只影响"会不会主动压缩"。

## 11. 关键文件索引

| 文件 | 作用 |
|---|---|
| `desktop/src/main/ipc/sessions.ts` | agentic loop，主链入口（`:1051` 系统提示，`:2658` 绑定构造器，`:2941-3039` 主循环） |
| `desktop/src/main/services/context-assembler.ts` | `assembleContext`，组装 system prompt + 压缩后的消息 |
| `desktop/src/main/services/context-compactor.ts` | `compactMessages` 四阶段压缩 |
| `desktop/src/main/services/token-budget-manager.ts` | `buildBudgetSnapshot`，预算计算 |
| `desktop/src/main/services/token-estimator.ts` | 5 种 token 估算模式 |
| `desktop/src/main/services/tool-output-sanitizer.ts` | 单条工具输出截断 |
| `desktop/src/main/services/context-enricher.ts` | 零成本环境上下文抽取（recentFiles / git / theme / tasks） |
| `desktop/src/main/services/artifact-context-builder.ts` | 工作产物上下文聚合 |
| `desktop/src/main/services/context-checkpoint-service.ts` | 语义检查点（**未接入**） |
| `desktop/src/main/services/memory-service.ts` | 内存版记忆容器（**未接入**） |
| `desktop/src/main/services/memory-extractor.ts` | 正则抽取记忆候选项 |
| `desktop/src/main/services/memory-ranker.ts` | 4 因子加权排序 |
| `desktop/src/main/services/memory-retriever.ts` | Top-N 检索 |
| `desktop/src/main/services/model-runtime/prompt-composer.ts` | canonical PromptSection 构造（与旧 buildSystemPrompt 并存） |
| `desktop/shared/contracts/model.ts` | `ContextBudgetPolicy` / `DEFAULT_CONTEXT_BUDGET_POLICY` / `TokenCountingMode` |
| `desktop/shared/contracts/session-runtime.ts` | `SessionReplayPolicy` 等 |
| `desktop/shared/contracts/events.ts` | `ContextLimitWarning` 事件类型 |
| `desktop/src/renderer/pages/ChatPage.tsx` | 警告条 UI（`:999` 监听，`:1596` 渲染） |

## 12. 测试覆盖

`desktop/tests/context-compression-v2.test.ts`（注：文件名带 `v2` 是历史遗留，按实际语义读，不要把它当版本标签理解）：

- **Observation Masking** — 保留近 N 条、跳过短输出（≤100 字符）、占位符内容、预算充足时不触发、masking 足够时不进阶段 2。
- **shouldSuggestNewChat** — `priorCompactionCount` 达阈值、消息总数 ≥100、短会话不触发。
- **maskedToolOutputCount 透传** — `assembleContext` 返回结构正确。

`desktop/tests/phase12-token-budget-manager.test.ts`：

- `compactTriggerTokens` 计算（按比例 + profile 覆盖）。
- 各项预留是否正确扣除。

`desktop/tests/phase9-model-capability-contracts.test.ts`：

- `budgetPolicy` 序列化/反序列化。

未覆盖但建议补的：

- 阶段 1 工具输出截断后 token 实际下降的断言（当前只覆盖 mask 路径）。
- `SessionReplayPolicy` 不同模式下的压缩行为差异。
- 预算降到 ≤0 时的退化行为（`safeInputBudget = 0`）。
- `enrichedContextBlock` / `artifactContextBlock` 注入后的 token 总量回归。

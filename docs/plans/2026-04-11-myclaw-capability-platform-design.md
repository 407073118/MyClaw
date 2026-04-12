# MyClaw Capability Platform Final Design

**Date:** 2026-04-11  
**Scope:** `desktop/` runtime, `cloud/` hub/package distribution, future channel/runtime integrations  
**Status:** Final design baseline

## Executive Summary

`MyClaw` 下一阶段不应该再以“插件系统”作为顶层目标，而应该升级为 `Capability Platform`。

原因很简单：

- `plugin` 只解决“东西怎么装进来”
- `MCP` 只解决“工具怎么接进来”
- `skill` 只解决“模型知道一点方法论”
- `workflow template` 只解决“任务流有模板”
- 真正的用户能力必须同时包含：
  - 可安装分发
  - 可执行 runtime
  - 模型增强绑定
  - 编排与验证
  - 产品级交付面

因此，本设计的最终结论是：

1. 保留并吸收现有 `skills + workflow templates + MCP + cloud hub` 能力。
2. 不再把这些能力继续平铺扩展，而是在其上增加统一的 `Capability Registry` 与 `Model Binding Runtime`。
3. 将平台划分为五层：
   - `Package Layer`
   - `Runtime Layer`
   - `Cognition Layer`
   - `Orchestration Layer`
   - `Product Layer`
4. 插件、内容包、模型增强模块、能力编排不再混为一谈，而是通过统一契约组合成用户可感知的最终能力。

这套架构的目标不是“让 MyClaw 看起来像 OpenClaw / VS Code / Claude / Codex”，而是把它重构为一个可持续增长的平台内核：既能装东西，也能真的放大大模型完成复杂任务的能力上限。

---

## Round 1: 问题重定义

### 1.1 当前问题不是“缺插件”

当前平台已经具备几类重要基础能力：

- 本地 `skills` 扫描与加载
- `workflow-package` 导入
- `employee-package` 导入
- `MCP` server 导入
- `cloud hub` 分发与安装入口
- 本地 runtime、tool executor、session orchestration

所以问题不在于“有没有扩展机制”，而在于以下四件事仍然没有统一：

1. **扩展单元没有统一抽象**
   现在是 `skill`、`workflow-package`、`mcp`、未来的 `ppt pack` 各管一摊。

2. **模型增强没有一等公民地位**
   工具接进来了，但模型什么时候触发、如何规划、如何组合、如何验证，并没有统一运行时。

3. **用户能力没有统一编排**
   现在更像“很多部件”，不是“稳定完成任务的端到端能力”。

4. **内容扩展与代码扩展没有被正确区分**
   主题、版式、prompt、skill、workflow 这类内容，和 channel adapter、runtime service、MCP bridge 这类代码，不应被放进同一个信任模型。

### 1.2 新的设计目标

`MyClaw` 下一阶段应该同时满足五个目标：

1. 允许能力独立更新，不依赖 desktop 主包频繁发版。
2. 允许模型在运行时稳定使用这些能力，而不是只是“看见更多工具”。
3. 允许把原料装配成用户真正可感知的能力，如“资料分析成 PPT”“跨渠道接入企业助手”“代码修复 + 验证 + 汇报”。
4. 允许内容扩展与代码扩展走不同的安全边界。
5. 允许未来演进出私有市场、订阅更新、企业白名单、版本锁定与回滚。

---

## Round 2: 备选架构收敛

### 2.1 方案 A：继续沿着 OpenClaw 方向演进

做法：

- 强化 runtime plugin
- 让 channel/tool/session/target/schema 都由插件参与定义
- 把更多能力挂进统一 gateway/runtime

优点：

- 统一入口强
- 多渠道和消息路由能力成熟
- 对“聊天入口驱动的平台”非常友好

缺点：

- 插件边界过重，容易侵入宿主核心语义
- `message tool / target / session grammar` 等核心抽象被插件接管过多
- 不利于将非聊天能力，如 `PPT / 文档 / 自动化 / 工作台 UI / 垂类能力` 做成清晰平台结构

结论：

- 只适合借鉴部分 runtime 抽象，不适合作为 `MyClaw` 总体蓝本。

### 2.2 方案 B：走 VS Code 式插件宿主

做法：

- 宿主内核稳定
- 插件通过 manifest 贡献能力
- 扩展点、运行隔离、市场分发、企业治理都围绕宿主展开

优点：

- 宿主边界清晰
- 安全治理成熟
- 适合长期平台化

缺点：

- VS Code 的强项是“宿主 + 扩展点”，不是“大模型能力编排”
- 如果只抄宿主层，会得到一个很好的插件平台，但仍然不是一个很强的 AI 能力平台

结论：

- 非常适合作为 `Package Layer + Runtime Layer` 参考，但不够完整。

### 2.3 方案 C：Capability Platform（推荐）

做法：

- 参考 VS Code 做稳定宿主与扩展点
- 参考 Steam Workshop 做内容包分发、订阅、版本兼容
- 参考 Claude/Codex 做 `skills / MCP / hooks / agents` 的 AI 能力装配
- 引入 `Cognition Layer + Orchestration Layer`，把模型增强绑定做成平台一等公民

优点：

- 同时覆盖“装、跑、会用、会组合、会验证”
- 能吸收你当前已有能力，不推翻重来
- 最适合 `MyClaw` 现在的产品形态

结论：

- 最终采用 `Capability Platform` 混合方案。

---

## Round 3: 最终分层架构

### 3.1 总体架构

```text
User Request
  -> Intent & Capability Router
  -> Capability Registry
  -> Context Builder
  -> Planner / Model Routing
  -> Runtime Orchestrator
  -> Tools / MCP / Renderers / Adapters / Services
  -> Critic / Validator / Repair Loop
  -> Product Delivery (Chat / UI / Files / Automations / Channels)
```

### 3.2 五层结构

#### Layer 1: Package Layer

职责：

- 包发现
- 安装 / 卸载
- 启用 / 禁用
- 订阅 / 更新
- 版本锁定
- 兼容性检查
- 权限与信任管理

它只解决一句话：`什么内容能被安装到平台里`。

#### Layer 2: Runtime Layer

职责：

- 执行工具
- 启动外部服务
- 调用 MCP
- 加载 channel adapter
- 调用 renderer / browser / filesystem / code-intel
- 管理 runtime 生命周期与资源隔离

它只解决一句话：`被安装进来的东西如何安全运行`。

#### Layer 3: Cognition Layer

职责：

- capability 触发规则
- prompt / skill / instruction module
- context builder
- tool policy
- planner
- critic
- repair policy
- model routing

它只解决一句话：`模型如何理解、选择并组合这些能力`。

#### Layer 4: Orchestration Layer

职责：

- 将多个 runtime 与 cognition 单元编排成任务链
- 管理状态机、重试、分支、检查点、产物
- 支持自动化、工作流、长任务、多阶段交付

它只解决一句话：`能力如何串成完整流程`。

#### Layer 5: Product Layer

职责：

- Chat UI
- Workflow Studio
- Silicon Person / Employee
- Approval UI
- Package Hub / Marketplace
- 文件导出
- Web Panel / structured UI
- 自动化入口

它只解决一句话：`用户如何使用并感知能力`。

---

## Round 4: 核心抽象与统一契约

### 4.1 Package 不是最终能力，Capability 才是

最终必须区分四种对象：

1. `Package`
   - 安装与分发单元

2. `Contribution`
   - 包贡献的原料，如 skill、workflow、theme、channel adapter、MCP、planner、critic

3. `Capability`
   - 用户可感知的端到端能力，如“生成 PPT”“做深度调研”“修复构建”

4. `Capability Run`
   - 一次能力执行实例，包括状态、上下文、产物、验证结果

### 4.2 包类型与信任等级

推荐不要把包类型设计得太散，而是统一用一个 `package.manifest.json`，再通过 `trustClass` 区分风险等级。

建议的信任等级：

- `declarative`
  - 只包含 themes、layouts、skills、workflow templates、prompt modules、schemas
- `executable`
  - 包含本地进程、MCP server、adapter、hooks、renderer、provider bridge
- `hybrid`
  - 同时有 declarative 和 executable 内容

### 4.3 统一的贡献模型

一个包可以贡献以下内容：

- `skills`
- `workflowTemplates`
- `mcpServers`
- `toolSchemas`
- `toolPolicies`
- `themes`
- `layouts`
- `brandPacks`
- `promptModules`
- `planners`
- `critics`
- `repairPolicies`
- `contextBuilders`
- `modelProviders`
- `channelAdapters`
- `uiPanels`
- `automationTemplates`
- `capabilities`

这样一来，现有的 `skills + workflow templates + MCP` 不需要被推翻，只需要被纳入统一贡献模型。

### 4.4 Capability Manifest

`capability.manifest.json` 是本设计的关键。

它不描述“怎么安装”，而描述“这项能力如何完成任务”。

建议包含：

- `id`
- `displayName`
- `triggers`
- `inputKinds`
- `outputKinds`
- `requiredContributions`
- `preferredContributions`
- `contextBuilder`
- `planner`
- `toolPolicy`
- `modelRouting`
- `critic`
- `repairPolicy`
- `deliveryModes`

示例：

```json
{
  "id": "ppt.deck-generation",
  "displayName": "Deck Generation",
  "triggers": ["ppt", "deck", "演示文稿", "汇报", "slides"],
  "inputKinds": ["files", "urls", "notes", "tabular-data"],
  "outputKinds": ["pptx", "preview", "speaker-notes"],
  "requiredContributions": [
    "runtime.doc-extract",
    "runtime.ppt-render",
    "planner.deck-planner",
    "critic.deck-critic"
  ],
  "preferredContributions": [
    "theme.business",
    "layout.executive-pack",
    "brand.default"
  ],
  "contextBuilder": "deck.context.v1",
  "planner": "deck.planner.v2",
  "toolPolicy": "deck.tools.v1",
  "modelRouting": "deck.route.v1",
  "critic": "deck.critic.v1",
  "repairPolicy": "deck.repair.v1",
  "deliveryModes": ["file", "preview", "chat-summary"]
}
```

### 4.5 与渠道能力统一时的额外抽象

如果未来继续做多渠道接入，建议定义以下统一对象，而不是让每个插件直接改 session 结构：

- `NormalizedInboundEvent`
- `NormalizedActor`
- `NormalizedTarget`
- `NormalizedAttachment`
- `NormalizedConversation`
- `SessionRoute`
- `OutboundAction`

这部分可以吸收 `Satori / Bot Framework` 的做法，但不需要一开始就上线全部渠道。

---

## Round 5: 模型增强绑定与最终能力闭环

### 5.1 为什么“只做插件”没有意义

因为插件只是原料来源，不会自动变成完整能力。

一个真正可用的能力，至少要经过以下链路：

1. 识别用户意图
2. 选择合适 capability
3. 构建上下文
4. 选择模型与推理深度
5. 规划执行步骤
6. 调用工具 / runtime
7. 校验结果
8. 失败时修复
9. 交付给用户

如果缺少其中任一层，用户得到的都只是“部件很多”，而不是“能力很强”。

### 5.2 Model Binding Runtime

建议把模型增强正式抽成 `Model Binding Runtime`。

它负责将 contributions 与 capability 绑定成真正的模型运行时行为。

包含以下模块：

- `Intent Detector`
  - 识别用户要调用哪类能力

- `Capability Router`
  - 在多个能力之间做选择与优先级排序

- `Context Builder`
  - 从文件、会话、网页、知识库、历史任务、UI 状态中拼上下文

- `Planner`
  - 先把目标拆成执行图，而不是让模型直接自由发挥

- `Tool Policy`
  - 决定哪些工具可见、哪些工具先用、哪些工具必须显式确认

- `Model Router`
  - 决定 research / planning / critique / repair 各用哪类模型

- `Critic`
  - 从事实性、结构性、视觉性、规范性等角度验证结果

- `Repair Loop`
  - 根据 critic 结果自动返工，而不是直接把半成品交给用户

### 5.3 最终的能力执行状态机

建议统一状态机：

```text
detected
  -> prepared
  -> planned
  -> executing
  -> validating
  -> repairing
  -> delivered
  -> archived
```

每个 `Capability Run` 都挂上：

- `runId`
- `capabilityId`
- `inputSnapshot`
- `contextSnapshot`
- `selectedContributions`
- `executionPlan`
- `artifacts`
- `validationReports`
- `repairHistory`
- `deliverySummary`

这样后面做自动化、回放、调试、对账、质量分析都会容易很多。

---

## 最终版设计

### 6.1 最终结论

`MyClaw` 应采用如下最终版设计：

#### 一、平台定位

`MyClaw = Capability Platform`

不是：

- 只做插件宿主
- 只做 MCP 容器
- 只做 workflow 平台
- 只做聊天代理

而是一个能把安装单元、执行单元、模型增强单元、编排单元装配成完整能力的平台。

#### 二、平台核心

平台内核至少包含以下注册中心：

- `PackageRegistry`
- `ContributionRegistry`
- `RuntimeRegistry`
- `CapabilityRegistry`
- `ModelBindingRegistry`
- `PolicyRegistry`
- `SessionRegistry`
- `ArtifactRegistry`

#### 三、推荐的包模型

统一包格式：

- `package.manifest.json`
- `capability.manifest.json`（可选，一包可贡献多个 capability）

统一区分：

- `declarative content`
- `executable runtime`
- `capability bindings`

#### 四、产品执行主链

```text
Request
 -> Intent Detection
 -> Capability Resolution
 -> Context Building
 -> Planning
 -> Runtime Execution
 -> Validation / Critique
 -> Repair
 -> Delivery
```

这是平台真正的第一主链，不再是“先有插件再说”。

---

## 能支持哪些扩展

### 7.1 Declarative 扩展

可支持：

- Skills
- Workflow templates
- Prompt packs
- PPT themes
- PPT layouts
- Brand packs
- Review rules
- Vertical playbooks
- Automation templates
- Structured UI specs
- Model routing policies
- Critic / evaluation rules

### 7.2 Executable 扩展

可支持：

- MCP servers
- Channel adapters
- Model provider adapters
- Local service sidecars
- Renderers
- Browsers / crawlers
- Retrieval connectors
- Data extractors
- Specialized tool hosts
- Import / export pipelines

### 7.3 Hybrid 扩展

可支持：

- PPT capability packs
- Deep research packs
- Coding copilot packs
- Enterprise workflow packs
- Domain-specific assistant packs
- Industry solution packs

---

## 能实现哪些能力

### 8.1 通用能力

可实现：

- 深度调研
- 结构化报告生成
- PPT / Deck 生成
- 文档分析与改写
- 自动化任务编排
- 多阶段审批型流程
- 多模型路由与协作
- 会话内持续记忆与状态恢复

### 8.2 编码能力

可实现：

- 代码阅读与解释
- 代码修复
- 构建诊断
- 测试生成
- 代码审查
- 多 agent 协作执行
- 项目级计划生成
- PR / 变更说明生成

### 8.3 工作台能力

可实现：

- Silicon Person / Employee 角色化能力装配
- 团队模板包分发
- 企业内部能力市场
- 组织级白名单与推荐安装
- 工作流模板中心
- 自动化能力订阅与更新

### 8.4 渠道能力

在后续引入 channel kernel 后，可实现：

- 企业 IM 接入
- 多渠道统一收件箱
- 统一消息语义
- 渠道权限与审批策略
- 群聊 / 私聊 / 线程路由
- 统一会话与跨端投递

### 8.5 垂类能力

可实现：

- 销售助理
- 客服助理
- 研究助理
- 报告助理
- PPT 助理
- 代码助理
- 数据分析助理
- 运营自动化助理

---

## 落地路线

### Phase 1: 统一现有扩展入口

目标：

- 不破坏现有 `skills / workflow templates / MCP`
- 增加 `PackageRegistry + ContributionRegistry`

建议动作：

- 把现有 `cloud import` 结果统一映射为 contribution
- 为现有 skill / workflow / mcp 补统一元数据层
- 增加包启用 / 禁用 / 版本信息 / 来源信息

### Phase 2: 引入 Capability Registry

目标：

- 不再直接把 skill 或 MCP 暴露给用户作为最终能力
- 引入 capability resolution

建议动作：

- 定义 `capability.manifest.json`
- 增加 capability trigger、requiredContributions、delivery modes
- 将现有典型场景包装为 capability

### Phase 3: 引入 Model Binding Runtime

目标：

- 让模型真正会使用这些能力

建议动作：

- 上线 `Intent Detector / Capability Router / Context Builder / Planner / Critic / Repair`
- 把 `tool policy` 和 `model routing` 从 prompt 中抽到 runtime

### Phase 4: 推出内容工坊与订阅更新

目标：

- 支持市场、订阅、自动更新、版本锁定、回滚

建议动作：

- 增加 subscribed / pinned / needsUpdate / incompatible 状态
- cloud hub 支持 capability package 与 content pack

### Phase 5: 推出 Runtime Plugins 与 Channel Kernel

目标：

- 支持更重型的 runtime 扩展与多渠道统一语义

建议动作：

- 可执行插件隔离
- channel adapter 统一契约
- 统一 inbound / outbound / target / session 语义

---

## Final Recommendation

最终建议非常明确：

1. **不要再把“插件系统”当成顶层目标。**
2. **先把现有扩展能力统一成 package + contribution。**
3. **尽快引入 capability 与 model binding 两层。**
4. **把“模型会不会用这些能力”变成平台内核的一部分。**
5. **内容扩展与代码扩展走不同信任边界。**
6. **PPT、Research、Coding、Workflow、Channel 都不要直接做成零散功能，而应做成 capability pack。**

如果这套设计落地，`MyClaw` 能从“已有很多部件的桌面产品”，升级为“可以持续长出新能力的平台内核”。

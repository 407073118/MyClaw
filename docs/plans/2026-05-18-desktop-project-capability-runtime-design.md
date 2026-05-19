# Desktop 项目能力本地运行设计方案

## 背景

Cloud 已经支持项目配置，项目里可以引用 Skills、MCP、仓库、API、工作流和硅基员工等能力。Desktop 目前的 Skills 与 MCP 更接近“用户本机全局能力”：用户安装到本地技能目录后，这些能力会进入全局列表，并在会话运行时被模型识别。

项目能力不能简单安装进用户的全局 Skills/MCP 列表。否则用户绑定多个项目后，侧边栏和能力列表会混在一起，用户无法判断某个 Skill 是自己的，还是项目带来的；模型侧也可能误拿不属于当前项目的能力。

本设计把 Cloud 项目配置和 Desktop 本地运行拆开：

- Cloud 是项目推荐配置源，负责项目定义、版本、工件、默认启用状态和审计。
- Desktop SQLite 是本地执行真相源，负责用户绑定项目后的缓存、本地启停、会话绑定和运行快照。
- 每轮模型调用前，Desktop 生成一个冻结的 `CapabilityBundle`，把“当前会话项目能力”和“用户全局能力”合并后交给模型。

## 目标

1. Desktop 侧边栏具备项目概念，用户能看到已绑定项目、当前会话项目、同步状态和项目能力状态。
2. 用户视角上明确区分“我的 Skills/MCP”和“项目能力”，项目能力不污染全局列表。
3. 模型视角上只看到当前会话最终可用能力，即全局启用能力加当前项目本地启用能力。
4. 绑定项目后，项目数据落到本机 SQLite；每轮模型调用不请求 Cloud。
5. 用户可以在本机控制项目 Skills/MCP 的启用、禁用和展示状态，本地禁用永远优先于 Cloud 默认配置。
6. 项目 MCP 安全默认收紧，Cloud 不能直接把任意 stdio command 推到 Desktop 自动执行。
7. 每轮运行记录能力快照，后续可解释“当时模型看到了哪些 Skills/MCP”。

## 非目标

- 不把项目 Skills 安装到用户全局技能目录。
- 不把项目 MCP 直接注册为用户全局 MCP。
- v1 不做跨设备同步本地启停偏好。
- v1 不做员工默认项目继承和复杂团队权限 UI。
- v1 不支持 Cloud 任意下发 stdio MCP 后自动执行。
- v1 不要求每次会话运行前访问 Cloud 做最新配置确认。

## 核心原则

### Cloud 是配置源，不是运行时依赖

Cloud 负责回答“这个项目声明了哪些能力、默认是否启用、对应哪个 release、工件 hash 是什么”。Cloud 不参与每轮模型上下文构建。

Desktop 只在这些时机访问 Cloud：

- 用户首次绑定项目。
- 用户手动同步项目。
- 后台低频同步项目元数据。
- 本地缺少项目能力工件，需要下载或更新。
- 用户主动确认升级项目能力。

### Desktop SQLite 是本地执行真相源

项目绑定完成后，Desktop 将项目元数据、能力引用、本地偏好、工件安装状态和会话绑定关系写入 SQLite。模型运行时只读取 SQLite 和本地工件状态。

Cloud 的 `enabled` 只代表项目默认建议。本机偏好里只要存在 `disabled`，就必须覆盖 Cloud 的启用状态。

### 用户视角分开，模型视角合并

UI 必须让用户看到两套东西：

- 我的 Skills/MCP：用户自己安装或配置的全局能力。
- 项目能力：绑定项目带来的能力，只在绑定该项目的会话中生效。

模型不需要理解这两套来源的 UI 分组。模型只接收当前会话的最终能力集合，并通过工具说明知道每个能力的来源和用途。

### 每轮运行使用冻结能力包

Desktop 在发送消息前生成 `CapabilityBundle`。Prompt composer、tool schema builder 和 tool executor 都读取同一个 bundle，不能在运行中重新读取全局 mutable state。

这样可以避免两个会话并发运行时发生能力串线，例如 A 会话绑定项目甲，B 会话绑定项目乙，工具执行器却拿到了上一轮 `setSkills()` 的技能列表。

## 产品体验

### 侧边栏项目区域

Desktop 侧边栏新增“项目”区域，显示：

- 当前会话绑定的项目名称。
- 已绑定项目列表。
- 项目同步状态：已同步、需要同步、同步失败、离线可用。
- 项目能力摘要：Skills 数量、MCP 数量、本机禁用数量、异常数量。

用户可以从侧边栏执行：

- 绑定 Cloud 项目。
- 切换当前会话项目。
- 打开项目详情。
- 取消当前会话项目绑定。
- 手动同步项目。

### 项目详情页

项目详情页分为三个区域：

1. 项目资料
   - 项目名称、描述、Cloud projectId、绑定账号、最近同步时间、配置版本。
   - 显示离线可用状态和同步失败原因。

2. 云端能力清单
   - 展示 Cloud 声明的 Skills/MCP。
   - 标记 release、版本、默认启用状态、工件状态和安全状态。
   - 这里表达“项目声明了什么”，不等于“模型一定能使用什么”。

3. 本机运行设置
   - 用户本地启用或禁用项目 Skills/MCP。
   - 显示本地 override 来源和生效结果。
   - 对高风险 MCP 显示确认、权限和环境变量状态。

### 聊天页项目上下文

聊天页顶部显示项目 pill：

- 未绑定项目：显示“无项目”。
- 已绑定项目：显示项目名、同步状态、异常数量。
- 点击后打开当前会话的项目能力面板。

聊天页必须提供“最终可用能力”面板，面板按来源分组：

- 项目 Skills
- 我的 Skills
- 项目 MCP
- 全局 MCP

这个面板回答用户最关心的问题：当前这轮模型到底能看到什么。

### Slash 与工具入口

Slash menu 和工具入口按来源分组，不把项目能力塞进全局能力列表：

```text
项目 Skills
  - requirement-split
  - project-review

我的 Skills
  - brainstorming
  - systematic-debugging

项目 MCP
  - jira.search_issue
  - confluence.read_page

全局 MCP
  - filesystem.read_file
```

同名能力必须显示来源，例如“项目：review”和“我的：review”。

## 本地数据模型

v1 建议使用 SQLite 表达本地项目运行状态。Cloud 数据同步到本地后，不直接覆盖用户本地偏好。

### `cloud_projects`

记录本机绑定过的 Cloud 项目。

```text
id
cloud_project_id
tenant_id
account_id
name
description
cloud_version
etag
policy_epoch
synced_at
expires_at
revoked_at
deleted_at
last_sync_status
last_sync_error
created_at
updated_at
```

关键约束：

- `cloud_project_id + tenant_id + account_id` 唯一。
- `revoked_at` 或 `deleted_at` 不为空时，该项目不能再向模型暴露能力。
- `expires_at` 过期后进入 fail closed，除非产品明确允许离线宽限期。

### `project_capability_refs`

记录项目声明的能力引用。

```text
id
local_project_id
source_type              -- skill | mcp
cloud_capability_id
cloud_release_id
alias
display_name
description
default_enabled
manifest_json
artifact_json
artifact_hash
runtime_policy_json
cloud_config_json
sync_status
sync_warning
created_at
updated_at
```

关键约束：

- `local_project_id + source_type + cloud_capability_id` 唯一。
- `cloud_release_id` 必须是 Cloud 已解析出的具体 release，不能在模型运行时再解析 latest。
- `artifact_hash` 是本地安装和执行前校验的依据。

### `project_capability_prefs`

记录用户本机对项目能力的偏好。

```text
id
local_project_id
capability_ref_id
local_state              -- inherit | enabled | disabled | hidden
reason
updated_by
updated_at
```

生效优先级：

```text
disabled > hidden > enabled > inherit
```

当 `local_state = inherit` 时，使用 Cloud 的 `default_enabled`。当 Cloud 后续同步改变默认值时，只能影响 inherit 状态，不能覆盖本地 disabled。

### `capability_installations`

记录项目能力工件在本机的安装状态。

```text
id
source_type              -- project_skill | project_mcp | global_skill | global_mcp
local_project_id
capability_ref_id
install_dir
manifest_hash
artifact_hash
installed_release_id
installed_at
verified_at
install_status           -- missing | installing | ready | failed | revoked
last_error
```

项目 Skill 的 `install_dir` 应位于项目能力缓存目录，不应位于用户全局 skills 目录。

### `session_project_bindings`

记录本机会话与项目的绑定关系。

```text
id
session_id
local_project_id
bound_at
unbound_at
created_at
updated_at
```

v1 使用会话级绑定。一个会话同一时刻最多绑定一个项目。

### `run_capability_snapshots`

记录每轮模型运行的能力快照。

```text
id
run_id
session_id
local_project_id
bundle_hash
bundle_json
created_at
```

`bundle_json` 不保存 secrets，只保存能力身份、来源、版本、工具名、启用状态和摘要。它用于调试和审计，不用于重新执行敏感操作。

## Cloud 运行上下文契约

Cloud 当前项目详情更偏管理视图。Desktop 绑定项目时需要一个更稳定的运行上下文视图，建议新增或稳定化：

```text
GET /api/projects/:id/runtime-context
```

返回结构建议：

```ts
export type ProjectRuntimeContext = {
  project: {
    id: string;
    tenantId: string;
    name: string;
    description?: string;
    version: number;
    etag: string;
    policyEpoch: number;
    expiresAt?: string;
    revokedAt?: string;
    deletedAt?: string;
  };
  skills: ProjectRuntimeSkill[];
  mcps: ProjectRuntimeMcp[];
  warnings: ProjectRuntimeWarning[];
};
```

Skill 引用：

```ts
export type ProjectRuntimeSkill = {
  id: string;
  releaseId: string;
  alias?: string;
  displayName: string;
  description?: string;
  defaultEnabled: boolean;
  manifest: unknown;
  artifact: {
    downloadUrl: string;
    sha256: string;
    size: number;
    signature?: string;
  };
  config?: unknown;
};
```

MCP 引用：

```ts
export type ProjectRuntimeMcp = {
  id: string;
  releaseId: string;
  alias?: string;
  displayName: string;
  description?: string;
  defaultEnabled: boolean;
  transport: "stdio" | "sse" | "streamable-http";
  manifest: unknown;
  artifact?: {
    downloadUrl: string;
    sha256: string;
    size: number;
    signature?: string;
  };
  config?: unknown;
  runtimePolicy: {
    requiresLocalConfirmation: boolean;
    allowAutoExposeToModel: boolean;
    riskLevel: "low" | "medium" | "high";
  };
};
```

Cloud 必须保证：

- 返回的 release 是具体 releaseId，不是 latest。
- 返回 artifact hash 和签名信息。
- 已撤销、已删除、无权限访问的能力不返回为可执行能力。
- Project 与能力引用需要经过账号、租户和权限校验。
- Artifact 下载 token 必须有真实校验、短期有效、绑定账号和 artifact。

## 同步流程

### 首次绑定项目

```text
用户选择 Cloud 项目
  -> Desktop 请求 ProjectRuntimeContext
  -> Desktop 写入 cloud_projects
  -> Desktop 写入 project_capability_refs
  -> Desktop 初始化 project_capability_prefs 为 inherit
  -> Desktop 下载或标记待下载项目 Skill 工件
  -> Desktop 对 MCP 仅登记引用和安全状态
  -> Desktop 绑定当前会话到 local_project_id
```

首次绑定完成后，即使 Cloud 暂时不可用，Desktop 也可以基于本地 SQLite 展示项目和已就绪能力。

### 手动或后台同步

同步使用 `etag` 或版本号判断是否有变化。

```text
Desktop 请求 ProjectRuntimeContext
  -> 若 etag 未变化，只更新 synced_at
  -> 若 etag 变化，更新 project_capability_refs
  -> 保留 project_capability_prefs
  -> 对新增能力设置 inherit
  -> 对删除或撤销能力标记不可用
  -> 对 release 变化的能力标记需要用户确认更新
```

Cloud 不能通过同步覆盖本地 disabled。

### 工件安装和校验

项目 Skill 下载后必须执行：

1. 校验 artifact hash。
2. 校验 manifest hash。
3. 校验目录结构和入口文件。
4. 写入 `capability_installations`。

校验失败时，能力显示为异常，不进入 `CapabilityBundle`。

## CapabilityBundle

每轮模型运行前，Desktop 执行：

```text
bundle = resolveCapabilityBundle(sessionId)
prompt = buildPrompt(bundle)
tools = buildToolSchemas(bundle)
result = executeTool(bundle, toolCall)
saveRunCapabilitySnapshot(bundle)
```

建议结构：

```ts
export type CapabilityBundle = {
  id: string;
  hash: string;
  sessionId: string;
  project?: {
    localProjectId: string;
    cloudProjectId: string;
    name: string;
    version: number;
  };
  skills: RuntimeSkillCapability[];
  mcpTools: RuntimeMcpCapability[];
  functionNameMap: Record<string, RuntimeCapabilityRef>;
  approvalPolicy: RuntimeApprovalPolicy;
  createdAt: string;
};
```

### 合并规则

能力合并顺序：

```text
1. 读取会话绑定项目
2. 读取项目 refs、prefs、installation
3. 过滤 revoked/deleted/expired/missing/failed
4. 计算项目能力 effectiveEnabled
5. 读取用户全局 Skills/MCP
6. 生成稳定工具名
7. 写入 functionNameMap
8. 生成 bundle hash
```

项目能力生效规则：

```text
local disabled -> 不进入模型
local hidden   -> 不进入模型，但 UI 可在项目页显示
local enabled  -> 进入模型，前提是安装和安全校验通过
inherit        -> 使用 Cloud defaultEnabled，仍需安装和安全校验通过
```

全局能力和项目能力可以同时存在。它们不能互相覆盖，必须通过来源和稳定 ID 区分。

### 工具命名

不能依赖 sanitize 后的字符串反推能力身份。必须维护 `functionNameMap`。

示例：

```text
skill_project_crm_requirement_split
skill_global_brainstorming
mcp_project_crm_jira_search_issue
mcp_global_filesystem_read_file
```

当名称冲突时追加短 hash：

```text
skill_project_crm_review_a13f
skill_global_review_92bc
```

`functionNameMap` 示例：

```json
{
  "skill_project_crm_review_a13f": {
    "source": "project",
    "kind": "skill",
    "localProjectId": "p_local_1",
    "capabilityRefId": "ref_1",
    "installDir": "...",
    "releaseId": "skill_release_1"
  }
}
```

Tool executor 执行工具调用时只能通过本轮 bundle 的 `functionNameMap` 查找目标，不能从全局 skill list 反查。

## Skill 运行模型

项目 Skill 应安装在项目能力缓存目录，例如：

```text
{appData}/project-capabilities/{tenantId}/{projectId}/skills/{skillId}/{releaseId}
```

它们不出现在用户全局 skills 目录，也不写入全局 skills state。项目 Skill 的 prompt 内容、manifest、allowed tools 和 view files 只在当前项目会话 bundle 内可见。

项目 Skill 的执行路径必须从 `capability_installations.install_dir` 解析，并在执行前校验：

- install status 是 ready。
- releaseId 与 ref 一致。
- artifact hash 或 manifest hash 未变化。
- 路径位于项目能力缓存根目录内。

## MCP 运行模型

项目 MCP 风险高于项目 Skill，因为 MCP 可能连接外部服务、读取环境变量或启动本地进程。

v1 规则：

- 项目 MCP 默认不自动启用。
- Cloud stdio MCP 只展示，不自动执行。
- SSE 和 streamable HTTP MCP 也需要本地确认后才可暴露给模型。
- MCP secrets 不从 Cloud 直接落本地明文配置。
- 用户确认前，MCP 只能出现在项目详情页的“待配置/待确认”状态。

项目 MCP 进入模型前必须同时满足：

```text
Cloud ref 有效
本地未禁用
runtimePolicy 允许暴露
用户已本地确认
secrets 或环境变量已本地配置
连接状态健康
```

如果任一条件失败，该 MCP 不进入 `CapabilityBundle`。

## 安全边界

### 权限与租户

本地项目记录必须绑定：

- tenantId
- accountId
- cloudProjectId
- policyEpoch
- etag

Desktop 请求 Cloud 项目运行上下文时，Cloud 必须校验当前账号有项目访问权限。Cloud 返回的数据不能跨租户复用。

### 过期、撤销和删除

项目或能力出现以下状态时 fail closed：

- `revoked_at` 不为空。
- `deleted_at` 不为空。
- `expires_at` 已过期且没有离线宽限策略。
- policyEpoch 比本地记录更新，但本地尚未同步。
- artifact hash 校验失败。

Fail closed 的能力不进入模型，不显示在最终可用能力面板，只在项目详情异常区展示原因。

### 本地偏好优先

用户本地禁用是最高优先级。Cloud 同步只能改变项目默认建议和 ref 内容，不能把本地 disabled 改回 enabled。

### 审计与解释

每轮模型运行保存 `run_capability_snapshots`，用于回答：

- 这轮运行绑定了哪个项目。
- 模型看到了哪些 Skills/MCP。
- 每个工具来自全局还是项目。
- 使用的是哪个 release。
- 哪些项目能力因为禁用、未安装、撤销或安全策略没有进入模型。

## 运行时接入点

Desktop 当前发送消息链路中，应在组装 prompt 和 tools 前插入能力解析层。

目标结构：

```text
session:send-message
  -> resolveCapabilityBundle(sessionId)
  -> prompt-composer.build(bundle)
  -> tool-schemas.build(bundle)
  -> model run
  -> builtin-tool-executor.execute(toolCall, bundle)
```

关键要求：

- 不再让 long-lived executor 通过 `setSkills()` 持有会话级能力状态。
- Prompt composer、tool schema builder、tool executor 必须共享同一份 bundle。
- 运行过程中不能重新读取 mutable global skills/mcp state 来决定工具执行目标。
- 运行结束后保存 bundle snapshot。

## 边界场景

### 未绑定项目

模型只看到用户全局启用的 Skills/MCP。UI 显示“无项目”。

### 已绑定项目但离线

如果本地项目未过期且能力工件已就绪，可以继续使用本地缓存。UI 显示“离线可用”。

### 项目同步失败

同步失败不影响已缓存且未过期的能力。UI 显示最后同步失败原因，并允许重试。

### Cloud 删除项目

下一次同步后本地项目标记 `deleted_at`，所有项目能力 fail closed。已有会话保留绑定记录，但模型不再看到项目能力。

### 同名能力

全局 Skill 和项目 Skill 同名时，都可以存在，但工具名、UI 分组和执行路径必须明确区分来源。

### 多会话并发

每个会话每轮运行都有自己的 `CapabilityBundle`。并发运行不能共享 mutable skills list 或 MCP tool list。

## 分阶段实施

### v1

- Desktop 侧边栏增加项目入口和当前会话项目状态。
- 支持绑定 Cloud 项目并写入 SQLite。
- 支持项目 Skill 引用、下载、校验和本地启停。
- 项目 Skill 不进入全局技能目录。
- 聊天运行前生成 `CapabilityBundle`。
- Prompt、tool schema、tool executor 使用 bundle。
- 聊天页展示最终可用能力。
- 项目 MCP 只展示和本地确认，不自动暴露任意 stdio MCP。
- 保存 `run_capability_snapshots`。

### v2

- 员工或团队默认项目绑定。
- 项目 MCP 配置向导和权限模板。
- 项目能力自动升级、回滚和灰度。
- 本地偏好跨设备同步。
- 更完整的 Cloud 项目审计和组织权限。

## 测试计划

### Desktop 单元测试

- `resolveCapabilityBundle` 未绑定项目时只返回全局能力。
- `resolveCapabilityBundle` 已绑定项目时合并全局能力和项目能力。
- 本地 disabled 覆盖 Cloud default enabled。
- Cloud default disabled 在 inherit 状态下不进入模型。
- install status 为 missing、failed、revoked 时不进入模型。
- 同名全局 Skill 和项目 Skill 生成不同工具名。
- functionNameMap 能准确定位项目 Skill 执行路径。

### Desktop 集成测试

- 绑定项目后，项目 Skill 不出现在全局 Skills 列表。
- 聊天页最终可用能力面板按来源分组。
- 两个会话绑定不同项目并发发送消息，工具列表和执行路径不串线。
- 项目同步后新增能力默认 inherit，已有 disabled 不被覆盖。
- 项目撤销后，下一轮模型调用不再暴露项目能力。

### Cloud 契约测试

- `ProjectRuntimeContext` 返回具体 releaseId 和 artifact hash。
- 无权限账号不能读取项目运行上下文。
- 撤销或删除的能力不作为可执行能力返回。
- Artifact 下载 token 短期有效并绑定账号和 artifact。

### 安全测试

- Cloud 下发 stdio MCP 时，Desktop 未确认前不暴露给模型。
- artifact hash 不匹配时能力不可用。
- 本地项目过期或 revoked 时 fail closed。
- bundle snapshot 不包含 secrets。

## 验收标准

1. 用户能在 Desktop 清楚看到当前会话绑定了哪个项目。
2. 项目 Skills/MCP 不污染用户全局 Skills/MCP 列表。
3. 模型每轮只接收当前会话最终可用能力。
4. 本地禁用项目能力后，同步 Cloud 不会重新启用。
5. 项目 MCP 未本地确认前不会暴露给模型。
6. 并发会话不会发生能力串线。
7. 每轮运行可以通过 snapshot 解释当时的能力集合。

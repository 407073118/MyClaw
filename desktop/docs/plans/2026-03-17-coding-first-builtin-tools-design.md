# Coding-First Builtin Tools Design

## 背景

当前项目已经有统一的工具执行入口、审批模型和本地运行时状态存储，但“内置工具”仍然是几段分散的特判逻辑：

- 文件工具只覆盖 `read_file`、`write_file`、`list_files`
- 命令执行仍然是整条 shell 直跑
- MCP、Skill、内置能力没有统一注册表
- 桌面端只有审批配置，没有“内置工具开关”这一层

这会导致几个问题：

- 无法清晰区分“工具存在”“工具是否启用”“工具是否暴露给模型”“工具是否需要审批”
- 无法按分组做默认开关和安全策略
- 无法稳定扩展 `git`、`search`、`apply_patch` 这类 coding-first 工具
- 内置工具和 MCP 工具在 UI 上没有被明确分层

本设计的目标是为 OpenClaw Desktop 补齐一套 `coding-first` 的内置工具平台，并将工具开关状态持久化到本地运行时数据库。

## 设计目标

### 目标

- 提供一套正式的 `builtin tools` 注册表，而不是运行时硬编码分支
- 第一阶段只做 `coding-first` 工具，不引入浏览器自动化
- 工具开关状态保存在本地，应用重启后仍然生效
- 工具的“启用”“暴露给模型”“审批策略”分层管理
- 复用现有 `runtime-state.db`，不额外散落新的配置文件
- 保持现有 MCP、Skill、审批、Session 模型可演进

### 非目标

- 第一阶段不做浏览器控制、桌面自动化、消息发送类工具
- 第一阶段不做远程工具市场
- 第一阶段不做 workspace 级多套工具策略
- 第一阶段不做 provider 自定义脚本工具安装器

## 对外参考

- OpenAI Codex / shell tool 的核心方向是：少量高价值内置工具、强审批、强宿主控制
- OpenClaw 的核心方向是：工具策略是一等能力，支持按组和按范围做 allow/deny

本项目应采用两者结合的方向：

- 借鉴 Codex 的“核心内置工具最先落地”
- 借鉴 OpenClaw 的“工具开关、工具暴露、审批策略分离”

参考资料：

- OpenAI shell tools guide: <https://developers.openai.com/api/docs/guides/tools-shell>
- OpenAI Codex CLI: <https://developers.openai.com/codex/cli>
- OpenClaw tools docs: <https://docs.openclaw.ai/tools>
- OpenClaw repo: <https://github.com/openclaw/openclaw>

关于 `nanobot`：本轮未找到与上面同等级、可直接作为实现基线的官方工具规范，因此不将其作为第一手设计约束。

## 总体方案

运行时将工具分成三类：

- `builtin`
- `mcp`
- `skill`

其中：

- `builtin` 是本产品内置的、由 runtime 直接实现的工具
- `mcp` 是外部协议扩展
- `skill` 是提示与脚本能力，不直接等同于工具注册表

第一阶段只正式建设 `builtin` 平台，并将其接入现有审批和 bootstrap 返回数据。

## 第一阶段工具范围

### P0：首批落地

- `fs.list`
- `fs.read`
- `fs.search`
- `fs.stat`
- `fs.write`
- `fs.apply_patch`
- `exec.command`
- `exec.task`
- `git.status`
- `git.diff`
- `git.show`
- `process.list`

### P1：第二批补齐

- `fs.move`
- `fs.delete`
- `exec.terminal_preset`
- `process.kill`
- `archive.extract`
- `http.fetch`

第一阶段建议默认只对模型暴露 P0。

## 默认开关策略

### 默认启用并暴露给模型

- `fs.list`
- `fs.read`
- `fs.search`
- `fs.stat`
- `git.status`
- `git.diff`
- `git.show`

### 默认启用但执行前需审批

- `fs.write`
- `fs.apply_patch`
- `exec.command`
- `exec.task`

### 默认存在但默认关闭

- `process.list`
- `process.kill`
- `fs.delete`
- `archive.extract`
- `http.fetch`

这样处理的理由是：

- 首批先保证 coding 场景的读、查、diff 能力稳定可用
- 写入和执行属于高风险行为，必须强约束
- 低频或高风险工具默认不暴露，减少模型误调用

## 核心数据模型

建议在 `packages/shared/src/contracts/` 下新增 `builtin-tool.ts`。

### 1. 静态定义：BuiltinToolDefinition

描述工具本身，不包含用户偏好。

建议字段：

- `id`
- `name`
- `description`
- `source: "builtin"`
- `group`
- `risk`
- `inputSchema`
- `outputSchema`
- `requiresAttachedDirectory`
- `enabledByDefault`
- `exposedByDefault`
- `approvalMode`
- `tags`

说明：

- `enabledByDefault` 表示产品默认是否可用
- `exposedByDefault` 表示默认是否暴露给模型
- `approvalMode` 用于表达该工具的默认审批行为，例如 `inherit`、`always`、`never`

### 2. 用户持久化偏好：BuiltinToolPreference

描述用户改动过的开关状态。

建议字段：

- `toolId`
- `enabled`
- `exposedToModel`
- `approvalModeOverride`
- `updatedAt`

只存“覆盖值”，不重复存整份工具定义。

### 3. 运行时解析结果：ResolvedBuiltinTool

运行时真正暴露给模型和 UI 的视图。

建议字段：

- `id`
- `name`
- `description`
- `group`
- `risk`
- `enabled`
- `exposedToModel`
- `requiresAttachedDirectory`
- `effectiveApprovalMode`
- `availability`

其中 `availability` 可取：

- `enabled`
- `disabled-by-user`
- `disabled-by-policy`
- `missing-session-directory`

### 4. 分组枚举：BuiltinToolGroup

第一阶段固定为：

- `fs`
- `exec`
- `git`
- `process`
- `http`

## 本地持久化方案

工具开关状态不新建单独 JSON 文件，直接复用现有 `runtime-state.db`。

### 数据库变更

在 `apps/runtime/src/store/runtime-state-store.ts` 的 schema 初始化中新增一张表：

```sql
CREATE TABLE IF NOT EXISTS builtin_tool_preferences (
  tool_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  exposed_to_model INTEGER NOT NULL,
  approval_mode_override TEXT,
  updated_at TEXT NOT NULL
);
```

### RuntimeState 扩展

当前 `RuntimeState` 结构只保存：

- models
- sessions
- approvals
- approvalRequests

需要新增：

```ts
builtinToolPreferences: BuiltinToolPreference[];
```

### 为什么不单独存文件

- 当前项目已经有成熟的 `runtime-state.db`
- bootstrap 已经从单一状态源读取
- SQLite 更适合后续做工具分组筛选、更新时间排序和迁移
- 避免用户目录下散落多个设置文件

## 配置优先级

内置工具的最终状态按以下顺序解析：

1. 静态默认定义
2. 全局工具偏好覆盖
3. 全局审批策略
4. 当前 session 的上下文约束

举例：

- `fs.read` 默认启用
- 用户手动关闭后，不再暴露给模型，也不能从 UI 主动调用
- 即使用户启用 `fs.write`，若当前 session 没有 attached directory，仍然不可执行
- 即使 `approvals.mode = auto-read-only`，`exec.command` 仍然可通过工具级 override 保持强制审批

## 运行时组件设计

建议新增以下服务：

### 1. BuiltinToolRegistry

职责：

- 注册所有内置工具定义
- 提供 `listDefinitions()`
- 提供 `getDefinition(toolId)`

第一阶段直接用静态数组实现，不做插件系统。

### 2. BuiltinToolPolicyService

职责：

- 合并静态定义、持久化偏好、审批设置、session 上下文
- 输出 `ResolvedBuiltinTool[]`
- 判断某工具是否可以暴露给模型
- 判断某工具是否允许直接执行

### 3. BuiltinToolExecutor

职责：

- 执行 `builtin` 工具
- 将参数转换为底层文件、git、进程操作
- 返回统一的 `ToolExecutionResult`

第一阶段不要把 builtin 继续塞到 MCP 分支里，而应单独分流。

### 4. ToolCatalogService

职责：

- 聚合 `builtin`、`mcp`、`skill` 的 UI 展示数据
- 给桌面端返回“当前可见工具目录”

## 执行链路

目标链路如下：

1. 模型请求调用工具
2. runtime 将调用名解析为 `ToolInvocation`
3. 查找工具定义
4. 结合开关偏好和 session 上下文计算有效状态
5. 走审批策略
6. 执行工具
7. 把结构化结果写回会话和事件流

### 与当前实现的关键差异

当前实现是：

- model tool name
- if/else 映射为 `ExecutionIntent`
- 审批
- 直接执行

改造后应变成：

- model tool name
- registry resolve
- policy resolve
- approval resolve
- executor dispatch

这样后续加工具不会继续膨胀 `tool-executor.ts`。

## 与现有代码的衔接

### 1. 共享契约层

新增：

- `packages/shared/src/contracts/builtin-tool.ts`

更新：

- `packages/shared/src/index.ts`
- `packages/shared/src/contracts/approval.ts`
- `packages/shared/src/contracts/events.ts`

建议新增的审批覆盖类型：

- `inherit`
- `always-ask`
- `allow-read-policy`

### 2. runtime 状态层

更新：

- `apps/runtime/src/store/runtime-state-store.ts`

新增：

- 读写 `builtin_tool_preferences`
- bootstrap 时返回当前 builtin tools 快照

### 3. runtime 服务层

新增：

- `apps/runtime/src/services/builtin-tool-registry.ts`
- `apps/runtime/src/services/builtin-tool-policy.ts`
- `apps/runtime/src/services/builtin-tool-executor.ts`

收敛：

- `apps/runtime/src/services/tool-executor.ts` 变成总调度器

### 4. API 层

更新：

- `apps/runtime/src/routes.ts`
- `apps/runtime/src/server.ts`

## API 设计

### Bootstrap 返回值扩展

`GET /api/bootstrap` 新增：

```ts
tools: {
  builtin: ResolvedBuiltinTool[];
}
```

### 新增接口

#### 1. 获取内置工具目录

`GET /api/tools/builtin`

返回当前解析后的 builtin tools 列表。

#### 2. 更新单个工具开关

`PUT /api/tools/builtin/:toolId`

请求体建议：

```json
{
  "enabled": true,
  "exposedToModel": false,
  "approvalModeOverride": "always-ask"
}
```

#### 3. 批量更新分组开关

`POST /api/tools/builtin/batch`

请求体建议：

```json
{
  "group": "fs",
  "enabled": true,
  "exposedToModel": true
}
```

第一阶段可以先实现单个工具更新；分组批量更新可作为第二步。

## UI 设计

建议新增独立的 `Tools` 视图，而不是把内置工具塞进 `MCP` 页面。

### 页面结构

- 左侧仍为全局导航
- 新增 `Tools`
- 页面默认展示 `Builtin Tools`
- MCP 页面继续只展示外部 MCP servers

### Tools 页内容

每个工具卡片展示：

- 工具名
- 分组
- 风险等级
- 说明
- `启用` 开关
- `暴露给模型` 开关
- 审批模式标签
- 是否需要 attached directory

### 交互规则

- 关闭 `enabled` 时，自动关闭 `exposedToModel`
- 打开 `exposedToModel` 前，必须要求 `enabled = true`
- 对高风险工具在 UI 上给出醒目标识
- 对 `requiresAttachedDirectory = true` 的工具给出说明文案

### Settings 页保留内容

`Settings` 仍保留全局审批策略：

- `prompt`
- `auto-read-only`
- `auto-allow-all`

但不再承担细粒度工具开关管理。

## attached directory 约束

第一阶段的 coding-first 工具中，以下工具必须受 session attached directory 约束：

- `fs.list`
- `fs.read`
- `fs.search`
- `fs.stat`
- `fs.write`
- `fs.apply_patch`
- `fs.move`
- `fs.delete`

`git.*` 和 `exec.*` 建议同样默认只允许在 attached directory 或 workspace root 中执行，不能无边界扩散到任意路径。

建议规则：

- 有 attached directory 时，以其为执行根
- 无 attached directory 时，只允许只读 `workspaceRoot`
- `exec.command` 默认工作目录取 attached directory，否则取 workspaceRoot

## 第一阶段各工具的执行语义

### `fs.list`

- 输入：`path`
- 输出：目录项列表
- 风险：`read`

### `fs.read`

- 输入：`path`
- 输出：文本内容
- 风险：`read`

### `fs.search`

- 输入：`pattern`、`path?`
- 输出：匹配位置列表
- 风险：`read`

### `fs.stat`

- 输入：`path`
- 输出：文件类型、大小、修改时间
- 风险：`read`

### `fs.write`

- 输入：`path`、`content`
- 输出：写入摘要
- 风险：`write`

### `fs.apply_patch`

- 输入：`patch`
- 输出：变更摘要
- 风险：`write`

### `exec.command`

- 输入：`command`
- 输出：stdout、stderr、exitCode
- 风险：`exec`

### `exec.task`

- 输入：`taskId`
- 输出：任务输出
- 风险：`exec`

`exec.task` 与 `exec.command` 的区别是：

- `exec.command` 是自由命令
- `exec.task` 是预设任务，例如 `pnpm --dir apps/runtime test`

这样更适合桌面产品后续做“常用任务”白名单。

### `git.status`

- 输入：空或可选路径
- 输出：工作区状态摘要
- 风险：`read`

### `git.diff`

- 输入：`target?`
- 输出：差异文本
- 风险：`read`

### `git.show`

- 输入：`ref`
- 输出：提交或文件内容
- 风险：`read`

### `process.list`

- 输入：可选过滤条件
- 输出：进程列表
- 风险：`read`

## 审批策略设计

审批仍复用现有 `ApprovalPolicy`，但需要增加“工具级覆盖”的概念。

### 有效审批规则

- `read` 类默认遵循全局 `autoApproveReadOnly`
- `write` 类默认询问
- `exec` 类默认询问
- `git.*` 虽然大多是 `read`，但仍由工具定义决定是否继承只读自动放行
- `fs.apply_patch` 即使看起来像文本操作，本质仍是 `write`

建议工具级覆盖策略：

- `inherit`
- `always-ask`
- `always-allow`

第一阶段不要做过多复杂策略，先把覆盖层建出来即可。

## 模型暴露策略

不是所有启用工具都必须暴露给模型。

需要明确两个维度：

- `enabled`
- `exposedToModel`

含义如下：

- `enabled = false`：运行时不可用，UI 主动调用也不允许
- `enabled = true, exposedToModel = false`：运行时可用，但只允许 UI 或系统内部显式调用
- `enabled = true, exposedToModel = true`：可被模型看到并调用

这是本设计最关键的一点。否则以后会出现“管理员想保留工具但不想让模型自动调用”的场景无法处理。

## 事件模型扩展

建议在现有事件流基础上增加：

- `tool.catalog.updated`
- `tool.preference.updated`

这样桌面端切换开关后，不必完全依赖整包 bootstrap 刷新。

第一阶段如果事件改动过大，也可以先只走 REST 更新和 store 回填。

## 桌面端状态模型

`apps/desktop/src/stores/workspace.ts` 需要新增：

- `builtinTools`

建议类型：

```ts
builtinTools: ResolvedBuiltinTool[];
```

并新增 action：

- `updateBuiltinToolPreference(toolId, patch)`
- `loadBuiltinTools()`

## 实施顺序

### 阶段 1：共享契约与静态注册表

- 新增 builtin tool contracts
- 新增静态 registry
- 先把 P0 工具定义列全

### 阶段 2：持久化与 bootstrap

- 扩展 `runtime-state.db` schema
- 保存和读取 `builtin_tool_preferences`
- bootstrap 返回 builtin tool 快照

### 阶段 3：执行器改造

- 将 builtin 从 MCP 分支中拆出
- 新增 `BuiltinToolExecutor`
- `tool-executor.ts` 改为统一分发

### 阶段 4：桌面端 Tools 页面

- 新增 `ToolsView.vue`
- 增加工具开关和审批说明
- workspace store 对接新接口

### 阶段 5：逐步填充 P0 工具实现

- 先做 `fs.*`
- 再做 `git.*`
- 最后补 `exec.*` 和 `process.list`

## 关键取舍

### 为什么先做 builtin，再谈更多 MCP

因为 coding-first 场景最核心的价值不在“能接很多外部工具”，而在“文件、补丁、git、命令执行是否稳定可控”。这部分如果仍依赖松散的 MCP 映射和 shell 特判，后面产品很难稳。

### 为什么开关状态要进数据库

因为这是一类产品级持久配置，而不是临时会话态。它和模型配置、审批配置一样，都应该进入统一状态源。

### 为什么 `exec.task` 要独立于 `exec.command`

因为后面你几乎一定会需要“受限预设命令”。先拆开，后续做白名单、快捷入口和审批简化都会更顺。

## 后续实现建议

正式实现时，建议先提交三类代码：

1. 共享类型与 runtime 状态迁移
2. builtin registry + bootstrap API
3. Tools 页面和开关持久化

这样可以先把“看得见、存得住”的部分做出来，再逐步补具体工具实现。

## 结论

本项目的内置工具体系应采用：

- `coding-first`
- `builtin / mcp / skill` 三层分离
- `enabled / exposedToModel / approval` 三维分离
- 开关状态进入 `runtime-state.db`
- 首批优先落地 `fs / git / exec`

这套设计既能复用当前项目已有的审批和状态基础，又能为后续继续扩展工具集、策略分层和 UI 管理留出明确演进路径。

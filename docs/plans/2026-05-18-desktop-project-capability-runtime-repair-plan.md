# Desktop Project Capability Runtime Repair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `2026-05-18-desktop-project-capability-runtime-implementation-plan.md` 真正闭环，补齐 Desktop 项目能力运行时的 bundle 命名兼容、项目 MCP 执行、Skill 工件 hash 门禁、bundle 自包含执行、`skill_view` 回归、Renderer 可用性、中文注释和中文日志。

**Architecture:** 项目能力继续以 `CapabilityBundle` 作为每轮会话的运行时边界。项目 MCP v1 可执行，但不写入全局 MCP 注册表，不污染 `mcp-servers.json`；Resolver 负责临时枚举工具并写入 bundle，Session 执行时根据 bundle ref 分流到全局 MCP 或项目 MCP 一次性 runtime。

**Tech Stack:** Desktop Electron main/renderer、TypeScript、Vitest、React Testing Library、Prisma、Cloud NestJS/Repository、现有 `McpClient` / `McpHttpClient`、现有 Project Capability 数据模型和 IPC。

---

## 背景与当前结论

当前实现已经有项目能力页面、类型、同步和部分运行时桥接，但从代码角度还没有完全实现原方案。主要问题不是“没有文件”，而是运行时链路仍有断点：bundle 下全局 MCP 函数名被改写后无法按既有路径调用，项目 MCP 已经可以被确认和暴露但执行时直接抛错，项目 Skill 缺少 sha256 时仍可能安装，bundle 对全局 Skill 还依赖共享 mutable 状态，`skill_view` 在 bundle 分支被提前 return 掉。

默认决策保持不变：项目 MCP v1 要可执行，但只通过每轮 `CapabilityBundle` 临时解析和调用，不进入全局 MCP 配置，不显示在全局 MCP 列表。

## 需要修复的缺口

1. **P1：bundle 下全局 MCP 调用不兼容**
   - `capability-bundle-resolver.ts` 当前会把全局 MCP 工具名 `mcp__server__tool` 清洗成 `mcp_server_tool`。
   - 执行链路仍按 legacy `mcp__server__tool` 解析 server/tool，导致 bundle 模式下函数名和执行器预期不一致。
   - schema 也会丢失，因为 resolver 写入的是裸 schema，而 `tool-schemas.ts` 读取的是 `manifestJson.inputSchema`。

2. **P1：项目 MCP 暴露后不能执行**
   - 项目 MCP 确认后可以进入 bundle/schema。
   - `sessions.ts` 当前遇到 project MCP 仍抛出 “Project MCP execution is not supported yet”。
   - 需要新增临时项目 MCP runtime，不写全局配置。

3. **P1：项目 Skill 工件 hash 门禁不闭环**
   - Cloud runtime-context 可以返回空 sha256 warning。
   - Desktop 安装器只在 hash truthy 时校验，空 hash 会绕过安全门禁。
   - 修复后缺少 sha256 必须 fail closed，并写入 failed installation 状态。

4. **P2：bundle 不是真正自包含**
   - 全局 Skill ref 没有稳定携带 `installDir`。
   - executor 仍依赖 `setSkills(allSkills)` 写入共享 `this.skills`，存在跨会话串用风险。

5. **P2：`skill_view` 回归**
   - `buildToolSchemas` bundle 分支提前 return，跳过 legacy `skill_view` schema 生成。
   - 有 HTML 面板的全局 Skill 在 bundle 模式下不能回到 view 工具。

6. **P2：测试覆盖不足**
   - 现有 session/send 测试只做字符串检查，没有覆盖真实执行行为。
   - 缺少项目 MCP 假 HTTP server 测试、bundle 同名 Skill installDir 隔离测试、`skill_view` 回归测试、空 hash 拒绝安装测试。

7. **P2：Renderer 可用性缺口**
   - Chat slash 项目 Skill 只按 enabled/synced 粗筛，未确认本地安装 ready 和本地文件有效。
   - 项目能力面板 aria 状态不足，键盘 focus 打开/关闭不完整。
   - A2UI 单字段表单被 `fields.length >= 2` 错误隐藏。

8. **P2：中文注释和日志不足**
   - 本次触达的公开构造方法、测试 helper、公开类型需要中文注释。
   - 关键失败路径需要中文日志，包括 bundle 跳过原因、项目 MCP 拒绝/执行、项目 Skill 执行读取、zip-slip 拒绝、Cloud 拉取成功、JSON 解析失败、事务 rollback。

## 实施阶段

### Phase 1：先补失败测试

新增或扩展以下测试，先让关键断点红起来。

1. `desktop/tests/capability-bundle-resolver.test.ts`
   - bundle 下全局 MCP ref 的 `functionName` 保持 `mcp__server__tool`。
   - 全局 MCP ref 写入 `serverId`、`toolName`、`inputSchema`。
   - 全局 Skill ref 写入 `installDir: skill.path`。
   - 两个同名 Skill 指向不同 `installDir` 时，bundle ref 不互相串。

2. `desktop/tests/project-capability-tool-schemas.test.ts`
   - bundle schema、MCP schema、`skill_view` schema 合并生成。
   - MCP schema 保留 tool 参数 schema，不退化为 `{}`。
   - 带 HTML view 的全局 Skill 在 bundle 模式下仍暴露 `skill_view`。

3. `desktop/tests/project-capability-tool-executor.test.ts`
   - Skill 执行优先使用 bundle ref 的 `installDir`。
   - bundle ref 缺少本地目录时 fail closed 并写中文日志。
   - legacy `this.skills` 只作为没有 bundle ref 时的兼容 fallback。

4. `desktop/tests/project-capability-session-send.test.ts`
   - 全局 MCP bundle ref 按 legacy `mcp__server__tool` 走 `activeMcpManager.callTool`。
   - project MCP bundle ref 走 `ProjectMcpRuntimeService.callToolForCapability`。
   - project MCP 未确认、不安全、配置无效时不暴露工具。

5. `desktop/tests/project-mcp-safety.test.ts`
   - 启动假 HTTP MCP server，确认安全后 resolver 能 list tools 并生成 per-tool schema。
   - 调用时按 `serverId/toolName` 执行具体 tool。
   - list/call finally 断开临时 client。

6. `desktop/tests/project-skill-installer.test.ts`
   - `artifact.sha256` 为空必须拒绝安装。
   - 拒绝时写入 failed installation 状态。
   - sha256 不匹配仍保持既有拒绝行为。

7. `desktop/tests/chat-project-capabilities.test.tsx`
   - Chat slash 只展示 `syncStatus === "synced"`、安装 `ready`、本地有效的项目 Skill。
   - 缺少 hash 的项目 Skill 显示不可安装状态。

8. `desktop/tests/chat-page-a11y.test.ts`
   - 项目能力面板按钮包含 `aria-expanded` 和 `aria-controls`。
   - 面板使用 `role="dialog"` 或语义一致的 popover。
   - Enter/Space 可打开，Esc 可关闭，focus 不丢失。

### Phase 2：扩展运行时引用模型

修改 `desktop/src/main/services/capability-bundle-resolver.ts` 及关联类型。

1. 扩展 `RuntimeCapabilityRef`：
   - `serverId?: string`
   - `toolName?: string`
   - `inputSchema?: unknown`
   - `runtimeConfigJson?: unknown`
   - `installDir?: string`

2. 为公开类型补中文注释：
   - 说明 `serverId` 是运行时定位用的 server 标识。
   - 说明 `toolName` 是 MCP 原始 tool 名，不等于对模型暴露的函数名。
   - 说明 `inputSchema` 必须保留 MCP 原始参数 schema。
   - 说明 `runtimeConfigJson` 仅用于本轮项目 MCP 临时连接，不写全局配置。
   - 说明 `installDir` 是 Skill 执行读取目录，用于 bundle 自包含隔离。

3. Resolver 写中文日志：
   - bundle 开始解析、项目码、能力数量。
   - 每个能力被跳过的原因。
   - 项目 MCP 枚举成功/失败。
   - 全局 Skill 缺少 path 或 manifest 时的 fail closed。

### Phase 3：修复 bundle resolver

修改 `desktop/src/main/services/capability-bundle-resolver.ts`。

1. 将 `resolveForSession` 改为 async：
   - 签名改为 `Promise<CapabilityBundle>`。
   - 所有调用点同步改为 `await`。
   - 生成一次 bundle 后在当前 session send 链路内复用同一个对象。

2. 全局 MCP 保持 legacy 函数名兼容：
   - `functionName` 保持 `mcp__${serverName}__${toolName}`。
   - 不再清洗为 `mcp_server_tool`。
   - 写入 `serverId`、`toolName`、`inputSchema`。
   - 保留 `source: "global"`。

3. 全局 Skill ref 写入本地目录：
   - `installDir: skill.path`。
   - `manifestJson` 保留 skill manifest/view 元信息。
   - `functionName` 继续使用现有 Skill 函数命名规则。

4. 项目 MCP 在 resolver 阶段临时 list：
   - 只处理确认且安全通过的项目 MCP。
   - 从 `runtimeConfigJson` 或 `manifestJson.config` 解析 MCP config。
   - 调用新 `ProjectMcpRuntimeService.listToolsForCapability`。
   - 每个 MCP tool 生成一个 bundle ref。
   - `functionName` 使用碰撞安全命名，例如 `mcp_project_${projectCode}_${alias}_${toolName}`。
   - `serverId` 指向项目能力 ref id。
   - `toolName` 保留 MCP 原始 tool 名。
   - `inputSchema` 保留 MCP tool 原始 schema。
   - `runtimeConfigJson` 写入本轮调用需要的配置。

5. 所有失败路径 fail closed：
   - 配置缺失、不安全、JSON 解析失败、list tools 失败都不暴露工具。
   - 写中文 warning 日志，不抛到用户会话主流程。

### Phase 4：新增 ProjectMcpRuntimeService

新建 `desktop/src/main/services/project-mcp-runtime-service.ts`。

1. 服务职责：
   - 只为项目 MCP 做一次性 list/call。
   - 不读取或写入全局 `mcp-servers.json`。
   - 不注册到全局 MCP manager。

2. 配置解析：
   - 优先读取 `ref.runtimeConfigJson`。
   - fallback 到 `ref.manifestJson.config`。
   - 支持 `stdio`：
     - `command: string`
     - `args?: string[]`
     - `cwd?: string`
     - `env?: Record<string, string>`
   - 支持 `http`、`sse`、`streamable-http`：
     - `url: string`
     - `headers?: Record<string, string>`
   - `sse` 和 `streamable-http` v1 统一走现有 `McpHttpClient`。

3. list tools：
   - 创建 `McpClient` 或 `McpHttpClient`。
   - `connect()`。
   - 读取 server tools。
   - 返回 `{ name, description, inputSchema }[]`。
   - `finally` 中断开临时 client。

4. call tool：
   - 按 bundle ref 的 `toolName` 调用具体工具。
   - 参数来自模型调用 arguments。
   - 结果格式对齐现有全局 MCP manager 的文本 flatten 行为。
   - `finally` 中断开临时 client。

5. 中文注释和日志：
   - 构造方法写中文注释。
   - 配置解析失败写中文 warning。
   - 连接、枚举、调用、调用失败、断开均写中文日志。

### Phase 5：修复 tool schema 合并

修改 `desktop/src/main/services/tool-schemas.ts`。

1. 去掉 bundle 分支提前 return。

2. bundle schema 生成逻辑：
   - 先生成 bundle skill invoke schema。
   - 再生成 bundle MCP schema。
   - MCP schema 优先使用 `ref.inputSchema`。
   - 兼容旧数据：fallback 到 `ref.manifestJson.inputSchema`。

3. `skill_view` 回归：
   - bundle 模式下仍继续执行 legacy `skill_view` schema 生成。
   - 对有 HTML panel/view 元信息的全局 Skill 继续暴露 view 工具。
   - 不因为 bundle 存在就跳过 `skill_view`。

4. 中文日志：
   - bundle schema 数量。
   - 跳过无 schema MCP 的原因。
   - `skill_view` 可用/不可用原因。

### Phase 6：修复 sessions 执行分流

修改 `desktop/src/main/ipc/sessions.ts`。

1. `CapabilityBundleResolver.resolveForSession` 调用点全部 `await`。

2. 同一轮 send 复用同一个 bundle：
   - schema 构建使用该 bundle。
   - tool 执行使用该 bundle。
   - 不重复 resolver，避免 project MCP list 多次产生不一致。

3. MCP tool 执行按 bundle ref 分流：
   - `source === "global"`：继续走当前 `activeMcpManager.callTool`，保持 legacy。
   - `source === "project"`：走 `ProjectMcpRuntimeService.callToolForCapability`。
   - 缺少 ref、缺少 `toolName`、配置非法时 fail closed。

4. 中文日志：
   - 收到 bundle MCP 调用。
   - 全局 MCP 兼容调用。
   - 项目 MCP 临时调用。
   - 拒绝项目 MCP 调用原因。

### Phase 7：修复 Skill 执行自包含

修改 `desktop/src/main/services/builtin-tool-executor.ts` 及必要关联代码。

1. `executeSkillInvoke` 优先使用 bundle ref：
   - 如果 bundle ref 是 Skill 且有 `installDir`，从 `installDir/SKILL.md` 读取。
   - 保留现有候选文件 fallback 逻辑。
   - 执行时不依赖共享 `this.skills`。

2. legacy fallback：
   - 只有没有 bundle ref 时才读取 `this.skills`。
   - 保持既有无 bundle 会话兼容。

3. 并发隔离：
   - 同名 Skill 在两个不同 bundle 中使用不同 `installDir`。
   - executor 不缓存按 name 共享的执行目录。

4. 中文日志：
   - 项目/全局 Skill 执行读取路径。
   - 缺少 `installDir`。
   - `SKILL.md` 缺失。
   - 读取成功和失败。

### Phase 8：修复 artifact hash 安全门禁

#### Desktop

修改 `desktop/src/main/services/project-skill-installer.ts`。

1. `parseArtifact` 要求 `artifact.sha256` 非空。
2. 缺少 sha256 抛出明确错误，例如 `project_skill_artifact_hash_required`。
3. 安装流程捕获该错误后写入 failed installation。
4. 不允许空 hash 弱校验。
5. sha256 不匹配保持既有 fail closed。
6. zip-slip 拒绝路径写中文日志。

#### Cloud

修改 Cloud release 存储和 runtime-context 返回链路。

1. Prisma release 表补字段：
   - `artifactSha256 String @default("") @map("artifact_sha256") @db.VarChar(64)`
   - 对 Hub release 和 Skill release 同步处理。

2. Release 创建/导入路径：
   - 从上传 ZIP bytes 计算 sha256。
   - 写入 `artifactSha256`。
   - 导入旧数据时没有 hash 保持空字符串。

3. Runtime-context repository：
   - 返回真实 `sha256`。
   - 没有 `downloadUrl` 或 `sha256` 时返回 warning。
   - Desktop 仍可同步 metadata，但安装必须拒绝。

4. 中文日志：
   - Cloud 拉取 runtime-context 成功。
   - 缺少 sha256 warning。
   - release 写 hash 成功。
   - 事务 rollback。

### Phase 9：修复 Renderer 体验

1. Chat slash 项目 Skill 过滤：
   - 只展示 `syncStatus === "synced"` 的项目 Skill。
   - 只展示安装状态为 `ready` 的项目 Skill。
   - 校验本地安装目录仍有效。
   - 其他状态在项目面板显示，不进入 slash 可调用列表。

2. Projects 页面缺少 hash 状态：
   - 缺少 `artifactHash` 时显示“缺少 hash，无法安装”。
   - 禁用安装按钮。
   - 保留同步 metadata 的能力。

3. 项目能力面板 a11y：
   - 触发按钮补 `aria-expanded`。
   - 触发按钮补 `aria-controls`。
   - 面板补 `role="dialog"` 或改成语义一致的 popover。
   - Enter/Space 打开。
   - Esc 关闭。
   - focus 离开时状态一致。

4. A2UI 单字段表单：
   - `shouldRenderInlineA2UiForm` 允许 `fields.length >= 1`。
   - 只有契约明确要求至少两个字段时才隐藏。
   - 补单字段表单渲染测试。

### Phase 10：中文注释、日志和乱码门禁

1. 对本次触达的构造方法补中文注释：
   - `desktop/src/main/services/capability-bundle-resolver.ts`
   - `desktop/src/main/services/project-capability-database.ts`
   - `desktop/src/main/services/project-capability-service.ts`
   - `desktop/src/main/services/project-runtime-context-client.ts`
   - `desktop/src/main/services/project-skill-installer.ts`
   - 新增 `desktop/src/main/services/project-mcp-runtime-service.ts`

2. 对测试 helper 补中文注释：
   - bundle fixture helper。
   - fake MCP server helper。
   - project skill installer fixture helper。

3. 日志必须覆盖：
   - bundle 跳过原因。
   - 项目 Skill 执行读取路径。
   - 项目 MCP 拒绝/执行。
   - zip-slip 拒绝。
   - Cloud runtime-context 拉取成功。
   - JSON 解析失败。
   - 事务 rollback。
   - ProjectsPage catch 分支。

4. 编码安全：
   - 修改中文文件前先读取目标行确认可读。
   - 只 patch 必要行。
   - 修改后重新读取本次 touched 文件确认中文正常。
   - 本次 touched files 必须乱码检查零命中。

## 文件清单

预计修改：

- `desktop/src/main/services/capability-bundle-resolver.ts`
- `desktop/src/main/services/project-mcp-runtime-service.ts`
- `desktop/src/main/services/tool-schemas.ts`
- `desktop/src/main/ipc/sessions.ts`
- `desktop/src/main/services/builtin-tool-executor.ts`
- `desktop/src/main/services/project-skill-installer.ts`
- `desktop/src/main/services/project-capability-database.ts`
- `desktop/src/main/services/project-capability-service.ts`
- `desktop/src/main/services/project-runtime-context-client.ts`
- `desktop/src/renderer/src/pages/ChatPage.tsx`
- `desktop/src/renderer/src/pages/ProjectsPage.tsx`
- `desktop/src/renderer/src/lib/a2ui.ts`
- `cloud/apps/cloud-api/prisma/schema.prisma`
- `cloud/apps/cloud-api/src/modules/projects/**`
- `cloud/packages/shared/**`

预计新增：

- `desktop/src/main/services/project-mcp-runtime-service.ts`
- `desktop/tests/project-mcp-safety.test.ts`

预计扩展测试：

- `desktop/tests/capability-bundle-resolver.test.ts`
- `desktop/tests/project-capability-tool-schemas.test.ts`
- `desktop/tests/project-capability-tool-executor.test.ts`
- `desktop/tests/project-capability-session-send.test.ts`
- `desktop/tests/project-skill-installer.test.ts`
- `desktop/tests/chat-project-capabilities.test.tsx`
- `desktop/tests/chat-page-a11y.test.ts`
- `cloud/apps/cloud-api/src/modules/projects/tests/projects.controller.test.ts`
- `cloud/apps/cloud-api/src/modules/projects/tests/projects.service.test.ts`
- `cloud/apps/cloud-api/src/modules/projects/tests/prisma-projects.repository.test.ts`
- `cloud/packages/shared/tests/contracts.test.mjs`

## 测试计划

### Desktop targeted

```powershell
pnpm --dir desktop test -- tests/capability-bundle-resolver.test.ts tests/project-capability-tool-schemas.test.ts tests/project-capability-tool-executor.test.ts tests/project-capability-session-send.test.ts tests/project-mcp-safety.test.ts tests/project-skill-installer.test.ts tests/chat-project-capabilities.test.tsx tests/chat-page-a11y.test.ts
```

### Desktop checks

```powershell
pnpm --dir desktop typecheck
pnpm --dir desktop lint
```

### Cloud targeted

```powershell
pnpm --dir cloud test -- apps/cloud-api/src/modules/projects/tests/projects.controller.test.ts apps/cloud-api/src/modules/projects/tests/projects.service.test.ts apps/cloud-api/src/modules/projects/tests/prisma-projects.repository.test.ts packages/shared/tests/contracts.test.mjs
```

### Final gates

```powershell
git diff --check
```

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern desktop cloud docs
```

如果日志文件存在历史乱码或二进制噪声，允许排除日志文件后重跑，但本次 touched files 必须零命中。

## 执行顺序与回滚点

1. 先提交测试红线，不改 runtime。
2. 修 resolver 和 schema，确保全局 MCP 兼容。
3. 接入 `ProjectMcpRuntimeService`，让项目 MCP 可 list/call。
4. 修 Skill bundle 自包含读取。
5. 修 hash 门禁和 Cloud sha256 返回。
6. 修 Renderer 展示、a11y、A2UI。
7. 补中文注释、日志和乱码门禁。
8. 跑 targeted tests。
9. 跑 typecheck/lint。
10. 跑 final gates。

每个阶段都保持可回滚：如果 project MCP runtime 出现不稳定，可先保留 resolver 不暴露 project MCP，并让测试明确标红；不能为了通过测试放开不安全配置或空 hash 安装。

## Assumptions

- 不创建 worktree，不提交，除非后续明确要求。
- 项目 MCP 不进入全局 MCP 配置，不显示在全局 MCP 列表。
- 缺少 sha256 的项目 Skill 视为不可安装，这是安全门禁，不做弱校验兜底。
- Cloud 历史 release 如果没有 hash，迁移后保持可同步但不可安装，等补 hash 后再安装。
- `sse` 和 `streamable-http` 项目 MCP v1 先复用现有 `McpHttpClient` 能力；如后续需要协议级差异，再单独拆分客户端实现。

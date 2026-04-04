# Roadmap: MyClaw Desktop

**Milestone:** v1.0 Core Agentic Loop → **COMPLETED** ✅
**Milestone:** v1.1 Robustness & Polish → **COMPLETED** ✅

## v1.0 Overview (COMPLETED 2026-04-01)

| # | Phase | Goal | Requirements | Status |
|---|-------|------|--------------|--------|
| 1 | SkillTool | 模型可以主动调用已加载技能 | SKILL-01..04 | ✅ Done |
| 2 | MCP Integration | MCP 服务器连接与工具执行 | MCP-01..11 | ✅ Done |
| 3 | Tool Approval | 高风险工具调用前用户审批 | APPR-01..05 | ✅ Done |
| 4 | Chat UI Polish | 工具执行可视化增强 | CHAT-UI-01..05 | ✅ Done |

## v1.1 Overview (COMPLETED 2026-04-01)

| # | Phase | Goal | Requirements | Status |
|---|-------|------|--------------|--------|
| 5 | Parallel Tools & Retry | 只读工具并发 + API 重试 | PARA-01..03, RETRY-01..02 | ✅ Done |
| 6 | Smart Compact & Token UI | 智能压缩 + token 可视化 | COMPACT-01..03, TOKEN-01..03 | ✅ Done |
| 7 | MCP Import & Server UX | 导入第三方 MCP 配置 + 服务器页面增强 | IMPORT-01..03, MCP-UX-01..02 | ✅ Done |
| 8 | Infrastructure | 日志系统 + ErrorBoundary + 测试扩展 | INFRA-01..04 | ✅ Done |

---

## Phase 1: SkillTool

**Goal:** 让模型可以通过 function calling 主动调用已加载的本地技能，技能内容注入上下文，结果反馈给模型。

**Requirements:** SKILL-01, SKILL-02, SKILL-03, SKILL-04

### Implementation Plan

#### 1.1 技能 Schema 动态注册 (SKILL-04)

**涉及文件：**
- `src/main/services/tool-schemas.ts`

**具体改动：**
- `buildToolSchemas()` 函数接受额外参数 `skills: SkillDefinition[]`
- 对每个 `enabled` 的技能生成一个 `skill_invoke__{skillId}` 的 OpenAI function tool
- Schema 的 parameters 包含一个 `input` 字段（string，用户输入/指令）
- Description 取自技能的 `description` 字段

```typescript
// 示例生成的 schema
{
  type: "function",
  function: {
    name: "skill_invoke__git-commit-helper",
    description: "Git 提交助手 — 分析变更并生成规范的 commit message",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "要传递给技能的指令或上下文" }
      },
      required: ["input"]
    }
  }
}
```

#### 1.2 技能内容加载 (SKILL-02)

**涉及文件：**
- `src/main/services/builtin-tool-executor.ts`（或新建 `src/main/services/skill-executor.ts`）

**具体改动：**
- 新增 `executeSkill(skillId: string, input: string, skills: SkillDefinition[])` 函数
- 根据 skillId 找到技能定义
- 读取技能文件内容：
  - JSON manifest: 读取 `path` 指向的文件
  - SKILL.md 目录: 读取 `path/SKILL.md`
- 将技能内容 + 用户 input 组装为 prompt
- 调用 `callModel()` 执行一次独立的模型调用（inline 模式）
- 返回模型的响应作为工具结果

#### 1.3 Agentic Loop 集成 (SKILL-01, SKILL-03)

**涉及文件：**
- `src/main/ipc/sessions.ts`

**具体改动：**
- `buildToolSchemas()` 调用时传入 `ctx.state.skills`
- 在工具执行分发中，识别 `skill_invoke__` 前缀的 function name
- 调用 `executeSkill()` 获取结果
- 结果作为 tool result 消息反馈给模型
- 更新 `buildToolLabel()` 和 `functionNameToToolId()` 处理技能工具

### Success Criteria

1. 用户在 skillsDir 放置一个 SKILL.md 技能后，模型在对话中可以看到并调用该技能
2. 技能的完整内容（SKILL.md 或 JSON entrypoint）被作为 prompt 发送给模型
3. 技能执行结果作为 tool result 返回，模型可以基于结果继续对话
4. 技能工具在 bootstrap 后的工具列表中可见（tool:list-builtin 或独立列表）

---

## Phase 2: MCP Integration

**Goal:** 实现 MCP 客户端，支持 stdio 模式连接 MCP 服务器，发现并执行服务器提供的工具，模型可以在 agentic loop 中使用 MCP 工具。

**Requirements:** MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06, MCP-07, MCP-08, MCP-09, MCP-10, MCP-11

### Implementation Plan

#### 2.1 MCP 协议客户端 (MCP-04, MCP-05, MCP-06)

**涉及文件：**
- `src/main/services/mcp-client.ts` — **新建**

**具体改动：**
- 实现 `McpClient` class
- `connect(command: string, args: string[], env: Record<string, string>)`:
  - 使用 `child_process.spawn` 启动服务器进程
  - 通过 stdin/stdout 进行 JSON-RPC 通信
  - 实现 `initialize` → `initialized` 握手
- `listTools()`: 发送 `tools/list` 请求，返回工具列表
- `callTool(name: string, arguments: Record<string, unknown>)`: 发送 `tools/call`，返回结果
- `disconnect()`: 发送 shutdown 通知，kill 进程
- 消息格式：JSON-RPC 2.0，以 `\n` 分隔的 JSON 行
- 超时处理：每个请求 30s 超时

```typescript
// JSON-RPC 消息格式
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}
```

#### 2.2 MCP 服务器管理器 (MCP-01, MCP-02, MCP-03, MCP-09, MCP-10, MCP-11)

**涉及文件：**
- `src/main/services/mcp-manager.ts` — **新建**

**具体改动：**
- 实现 `McpManager` class
- 维护 `Map<serverId, { config, client, tools, health }>` 内存状态
- `addServer(config)`: 保存配置 → 连接 → 获取工具列表 → 更新状态
- `removeServer(id)`: 断开连接 → 删除配置文件
- `refreshServer(id)`: 断开 → 重连 → 重新获取工具列表
- `listServers()`: 返回所有服务器及其状态
- `getServerTools(id)`: 返回指定服务器的工具列表
- `getAllTools()`: 返回所有服务器的全部工具（合并）
- `callServerTool(serverId, toolName, args)`: 委托给 McpClient.callTool
- 持久化：`mcp-servers.json` 在 myClawDir 下

#### 2.3 IPC Handler 重写 (MCP-01, MCP-09, MCP-10, MCP-11)

**涉及文件：**
- `src/main/ipc/mcp.ts` — 重写所有 handler

**具体改动：**
- `mcp:create-server`: 调用 McpManager.addServer
- `mcp:delete-server`: 调用 McpManager.removeServer
- `mcp:refresh-server`: 调用 McpManager.refreshServer
- `mcp:list-servers`: 调用 McpManager.listServers
- 返回真实的连接状态和工具列表

#### 2.4 MCP 工具纳入 Agentic Loop (MCP-07, MCP-08)

**涉及文件：**
- `src/main/services/tool-schemas.ts`
- `src/main/ipc/sessions.ts`
- `src/main/ipc/tools.ts`

**具体改动：**
- `buildToolSchemas()` 接受额外参数 `mcpTools: McpToolDefinition[]`
- 每个 MCP 工具生成 `mcp__{serverId}__{toolName}` 的 function tool
- 参数 schema 从 MCP `tools/list` 响应中获取（inputSchema 字段）
- agentic loop 中识别 `mcp__` 前缀，调用 McpManager.callServerTool
- `tool:execute-mcp` handler 委托给 McpManager
- `tool:list-mcp` 返回 McpManager.getAllTools 的结果

#### 2.5 RuntimeContext 集成

**涉及文件：**
- `src/main/services/runtime-context.ts`
- `src/main/index.ts`

**具体改动：**
- RuntimeContext 持有 McpManager 实例
- `services.listMcpServers` 改为调用 McpManager.listServers
- `tools.resolveMcpTools` 改为调用 McpManager.getAllTools
- 应用启动时（bootstrap）初始化 McpManager，自动连接已保存的服务器

### Success Criteria

1. 用户在 MCP 页面创建一个 stdio 模式的 MCP 服务器后，服务器进程被启动并显示 "connected"
2. 服务器提供的工具列表在工具页面可见
3. 模型在对话中可以调用 MCP 服务器的工具，结果正确返回
4. 关闭应用后重新打开，MCP 服务器自动重连
5. 删除 MCP 服务器后，进程被终止，配置被删除

---

## Phase 3: Tool Approval

**Goal:** 高风险工具（写文件、执行命令、Git 提交）调用前暂停并等待用户审批，提供 approve/deny 交互。

**Requirements:** APPR-01, APPR-02, APPR-03, APPR-04, APPR-05

### Implementation Plan

#### 3.1 审批拦截逻辑 (APPR-01, APPR-04, APPR-05)

**涉及文件：**
- `src/main/ipc/sessions.ts`

**具体改动：**
- 在 agentic loop 的工具执行阶段，执行前检查工具的 `effectiveApprovalMode`
- 如果是 `always-allow` 或只读工具：直接执行
- 如果是 `always-ask`：
  - 创建 `ApprovalRequest` 对象（包含 toolId、工具名、参数预览、sessionId）
  - 添加到 `ctx.state.approvalRequests`
  - 广播 `approval.requested` 事件到渲染进程
  - **等待** 用户操作（使用 Promise + 事件监听模式）
  - 收到 approve/deny 后继续或跳过
- 审批超时：5 分钟后自动 deny

```typescript
// 等待审批的 Promise 模式
function waitForApproval(approvalId: string, ctx: RuntimeContext): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    const check = () => {
      const request = ctx.state.getApprovalRequests().find(r => r.id === approvalId);
      if (request?.decision) {
        resolve(request.decision);
      } else {
        setTimeout(check, 200);
      }
    };
    check();
    // 5 分钟超时
    setTimeout(() => resolve({ action: "deny", reason: "审批超时" }), 5 * 60 * 1000);
  });
}
```

#### 3.2 审批 UI 组件 (APPR-02, APPR-03)

**涉及文件：**
- `src/renderer/pages/ChatPage.tsx`

**具体改动：**
- 监听 `approval.requested` 事件
- 在消息流中插入审批卡片组件：
  - 显示工具名称（如 "fs_edit"）
  - 显示参数预览（JSON 格式化，可折叠）
  - "通过" 按钮（绿色）和 "拒绝" 按钮（红色）
  - 可选：编辑参数后通过
- 点击按钮调用 `window.myClawAPI.resolveApproval(approvalId, decision)`
- 审批完成后卡片变为已审批状态（显示结果）

#### 3.3 审批结果处理

**涉及文件：**
- `src/main/ipc/approvals.ts`

**具体改动：**
- `approval:resolve` handler 更新请求的 decision 字段
- 广播 `approval:resolved` 事件
- agentic loop 中的 waitForApproval 收到结果后：
  - approve: 执行工具
  - deny: 跳过执行，将 "[用户拒绝了此工具调用]" 作为 tool result 反馈给模型

### Success Criteria

1. 模型调用 fs_write 时，ChatPage 出现审批卡片，显示文件路径和写入内容
2. 用户点击"通过"后工具执行，结果反馈给模型继续对话
3. 用户点击"拒绝"后工具不执行，模型收到拒绝反馈并调整方案
4. fs_read 等只读工具直接执行，不触发审批

---

## Phase 4: Chat UI Polish

**Goal:** 提升工具执行的可视化体验，让用户清晰看到工具调用的过程、参数、结果和耗时。

**Requirements:** CHAT-UI-01, CHAT-UI-02, CHAT-UI-03, CHAT-UI-04, CHAT-UI-05

### Implementation Plan

#### 4.1 工具执行 Spinner (CHAT-UI-01)

**涉及文件：**
- `src/renderer/pages/ChatPage.tsx`

**具体改动：**
- 在收到 `tool.started` 事件时，在工具链区域显示 spinner + 工具名称
- 收到 `tool.completed` 或 `tool.failed` 后替换为结果
- CSS 动画：旋转的圆环 + 脉冲点

#### 4.2 工具参数展开 (CHAT-UI-02)

**涉及文件：**
- `src/renderer/pages/ChatPage.tsx`

**具体改动：**
- 工具链步骤中，assistant 消息的 tool_calls 参数以 JSON 格式化显示
- 默认折叠，点击展开
- JSON 语法着色（简单的 key/value 颜色区分）

#### 4.3 结果语法高亮 (CHAT-UI-03)

**涉及文件：**
- `src/renderer/pages/ChatPage.tsx`
- 可能需要添加轻量语法高亮库（如 `highlight.js` 的子集或手写简单高亮）

**具体改动：**
- 工具结果中的代码块（被 ``` 包裹）使用语法高亮
- 文件内容（fs_read 结果）按文件扩展名选择高亮语言
- 命令输出保持等宽字体

#### 4.4 执行耗时显示 (CHAT-UI-04)

**涉及文件：**
- `src/main/ipc/sessions.ts`
- `src/renderer/pages/ChatPage.tsx`

**具体改动：**
- 在 `tool.started` 事件中记录开始时间
- 在 `tool.completed` / `tool.failed` 事件中计算耗时并包含在 payload 中
- 渲染进程在工具步骤右侧显示耗时（如 "142ms"）

#### 4.5 轮次计数器 (CHAT-UI-05)

**涉及文件：**
- `src/main/ipc/sessions.ts`（已有 round 变量）
- `src/renderer/pages/ChatPage.tsx`

**具体改动：**
- `run.started` 事件中包含当前 `round` 和 `maxRounds`
- 渲染进程在工具链头部显示 "轮次 2/25"
- 超过 5 轮时显示黄色警告色

### Success Criteria

1. 工具执行时有明确的 loading 状态（spinner + 工具名）
2. 用户可以展开查看每个工具调用的完整参数
3. 代码类输出有基本的语法高亮
4. 每个工具调用步骤显示执行耗时

---

---

## Phase 5: Parallel Tools & API Retry

**Goal:** 只读工具并发执行提升速度，API 调用失败自动重试提升稳定性。

**Requirements:** PARA-01~03, RETRY-01~02

### Implementation Plan

#### 5.1 只读工具并发执行 (PARA-01, PARA-02)

**涉及文件：**
- `src/main/ipc/sessions.ts`

**具体改动：**
- 在 agentic loop 的工具执行阶段，将 tool_calls 分为两组：
  - 只读组：`fs.read`, `fs.list`, `fs.search`, `fs.find`, `git.status`, `git.diff`, `git.log`, `task.manage`
  - 写入组：`fs.write`, `fs.edit`, `exec.command`, `git.commit`, `http.fetch`, `web.search`
- 只读组使用 `Promise.all()` 并发执行（并发上限可配置，默认 5）
- 写入组串行执行（保持当前行为）
- 混合调用时：先并发执行只读，再串行执行写入

#### 5.2 并发上限配置 (PARA-03)

**涉及文件：**
- `shared/contracts/approval.ts` 或新建 `shared/contracts/runtime-config.ts`
- `src/main/services/state-persistence.ts`

**具体改动：**
- 运行时配置中添加 `maxParallelTools` 字段（默认 5，范围 1~10）
- 持久化到 `runtime-state.json`

#### 5.3 API 调用重试 (RETRY-01, RETRY-02)

**涉及文件：**
- `src/main/services/model-client.ts`

**具体改动：**
- `callModel()` 失败时自动重试（最多 3 次）
- 指数退避：1s → 2s → 4s
- 可重试的错误类型：网络错误、HTTP 429/500/502/503
- 不可重试：HTTP 400/401/403（配置错误）
- 重试时广播 `retry.started` 事件通知渲染进程

### Success Criteria

1. 模型同时调用 3 个 fs_read 时，并发执行而非串行
2. API 返回 429 时自动重试并最终成功
3. 并发上限可通过设置页面配置

---

## Phase 6: Smart Compact & Token UI

**Goal:** 基于 token 计数的智能对话压缩，模型生成摘要替代简单占位符，token 消耗可视化。

**Requirements:** COMPACT-01~03, TOKEN-01~03

### Implementation Plan

#### 6.1 Token 计数 Compact (COMPACT-01, COMPACT-03)

**涉及文件：**
- `src/main/ipc/sessions.ts` — `autoCompactMessages()` 重写

**具体改动：**
- 用累计的 `totalTokens` 替代消息计数作为 compact 触发条件
- 阈值 = 模型 context window 的 80%（从 ModelProfile 获取）
- 需要在 `ModelProfile` 中添加 `contextWindow` 字段（默认 32768）
- 每条消息记录 token 使用量，累加计算

#### 6.2 模型生成摘要 (COMPACT-02)

**涉及文件：**
- `src/main/ipc/sessions.ts`
- `src/main/services/model-client.ts`

**具体改动：**
- compact 时，将待压缩的消息发送给模型，prompt: "总结以下对话的关键信息..."
- 使用较低 token 预算（max_tokens: 500）
- 将生成的摘要作为 system 消息替代简单占位符
- 如果模型调用失败（网络等），fallback 到当前的消息计数方案

#### 6.3 Token 消耗显示 (TOKEN-01, TOKEN-02, TOKEN-03)

**涉及文件：**
- `shared/contracts/session.ts` — ChatMessage 添加 `usage` 字段
- `src/main/ipc/sessions.ts` — 在消息中记录 usage
- `src/renderer/pages/ChatPage.tsx` — 显示 token 信息

**具体改动：**
- 每条 assistant 消息记录 `{ promptTokens, completionTokens, totalTokens }`
- ChatPage 每条 assistant 消息右下角显示 token 消耗（可折叠）
- 对话底部显示会话级别 token 总计
- 可选：按模型计费估算（需要费率配置）

### Success Criteria

1. 长对话超过 context window 80% 时自动触发摘要压缩
2. 压缩后的摘要保留了对话的关键上下文信息
3. 每条 assistant 消息显示 token 消耗数字

---

## Phase 7: MCP Import & Server UX

**Goal:** 从第三方工具导入 MCP 配置，服务器管理页面体验增强。

**Requirements:** IMPORT-01~03, MCP-UX-01~02

### Implementation Plan

#### 7.1 MCP 配置导入 (IMPORT-01, IMPORT-02, IMPORT-03)

**涉及文件：**
- `src/main/ipc/mcp.ts` — 添加 `mcp:import` handler
- `src/preload/index.ts` — `importMcpServers` 改为真实调用

**具体改动：**
- 读取 `~/.claude/claude_desktop_config.json` (Claude Desktop)
- 读取 `~/.cursor/mcp.json` (Cursor)
- 解析 `mcpServers` 字段，转换为 MyClaw 的 McpServerConfig 格式
- UI 显示发现的服务器列表，用户勾选要导入的
- 导入后自动连接

#### 7.2 服务器管理页面增强 (MCP-UX-01, MCP-UX-02)

**涉及文件：**
- `src/renderer/pages/McpPage.tsx`
- `src/renderer/pages/McpDetailPage.tsx`

**具体改动：**
- 服务器卡片显示实时连接状态图标（绿色圆点 / 红色叉 / 灰色问号）
- 工具列表按分类分组显示
- 一键测试连接按钮
- 服务器日志查看（stderr 输出）

### Success Criteria

1. 用户点击"从 Claude Desktop 导入"后看到已配置的 MCP 服务器列表
2. 导入的服务器自动连接并显示工具
3. 服务器页面实时显示连接状态

---

## Phase 8: Infrastructure

**Goal:** 工程质量提升：结构化日志、错误边界、测试扩展。

**Requirements:** INFRA-01~04

### Implementation Plan

#### 8.1 结构化日志系统 (INFRA-01)

**涉及文件：**
- `src/main/services/logger.ts` — **新建**

**具体改动：**
- `Logger` class with `info/warn/error/debug` methods
- 日志格式：`[timestamp] [level] [module] message {context}`
- 写入文件：`<myClawDir>/logs/myclaw-YYYY-MM-DD.log`
- 日志级别可配置（通过 runtime-state.json）
- 替代全部散落的 `console.log/warn/error`

#### 8.2 渲染进程 ErrorBoundary (INFRA-02)

**涉及文件：**
- `src/renderer/components/ErrorBoundary.tsx` — **新建**
- `src/renderer/App.tsx` — 包裹根组件

**具体改动：**
- React ErrorBoundary 捕获渲染错误
- 显示友好的错误页面（含错误信息 + 重试按钮）
- 上报错误到日志系统

#### 8.3 测试扩展 (INFRA-03, INFRA-04)

**涉及文件：**
- `tests/` — 新增测试文件

**具体改动：**
- `model-client.test.ts` — mock SSE stream 测试
- `mcp-client.test.ts` — mock child_process 测试 JSON-RPC
- `sessions-integration.test.ts` — agentic loop 集成测试
- 测试覆盖率目标：核心服务 > 80%

### Success Criteria

1. 所有 console.log 替换为结构化日志，日志文件可查
2. 渲染进程崩溃时显示友好错误页面而非白屏
3. 测试覆盖率达到 80%+

---

## Dependency Graph

```
v1.0 (COMPLETED)
Phase 1 (SkillTool) ✅
    ↓
Phase 2 (MCP Integration) ✅
    ↓
Phase 3 (Tool Approval) ✅
    ↓
Phase 4 (Chat UI Polish) ✅

v1.1 (PLANNED)
Phase 5 (Parallel Tools & Retry)  ← 独立，无依赖
Phase 6 (Smart Compact & Token)   ← 独立，无依赖
Phase 7 (MCP Import & Server UX)  ← 依赖 Phase 2 的 MCP 基础（已完成）
Phase 8 (Infrastructure)          ← 独立，无依赖

Phase 5/6/7/8 之间无依赖，可完全并行开发。
```

### Phase 9: Chat 推理等级与 Thinking/Effort 适配

**Goal:** 以运行时为核心，在聊天窗口接入单一、可控、可持续打磨的 thinking/effort 模式，而不是先做多档位复杂选择器。
**Requirements**: TBD
**Depends on:** Phase 8
**Plans:** 3 plans (completed)

Plans:
- [x] 09-01 — 基础契约和 reasoning runtime 骨架
- [x] 09-02 — 主进程 reasoning 链路与 request-body patch
- [x] 09-03 — Chat thinking UI 与确认交互

### Phase 10: Provider adapters for MiniMax-first reasoning runtime

**Goal:** 在不破坏现有 MiniMax 调用方式的前提下，把 MiniMax 从 generic-compatible 处理提升为 first-class provider adapter，并为后续 OpenAI / Anthropic 兼容桥接预留稳定扩展点。
**Requirements**: TBD
**Depends on:** Phase 9
**Plans:** 3 plans (completed)

Plans:
- [x] 10-01 — MiniMax adapter contract 与 capability profile
- [x] 10-02 — assistant replay payload 与 tool loop replay
- [x] 10-03 — settings/catalog 对齐与回归矩阵

---
*Roadmap created: 2026-03-31*
*Last updated: 2026-04-04 — Phase 9/10 已完成，通用推理运行时与 MiniMax-first provider adapter 已落地*

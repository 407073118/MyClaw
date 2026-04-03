# Requirements: MyClaw Desktop

**Defined:** 2026-03-31
**Core Value:** 用户可以通过自然语言与 AI 对话，AI 自动调用工具完成复杂的编码和系统管理任务。

## v1 Requirements

Requirements for milestone v1.0: Core Agentic Loop. Each maps to roadmap phases.

### SKILL -- 技能执行

- [x] **SKILL-01**: 模型可以通过 function calling 调用已加载的本地技能（SkillTool） ✅ Phase 1
- [x] **SKILL-02**: 技能的 SKILL.md / JSON manifest 内容作为 prompt 注入到模型上下文 ✅ Phase 1
- [x] **SKILL-03**: 技能执行结果作为 tool result 反馈给模型继续对话 ✅ Phase 1
- [x] **SKILL-04**: tool-schemas.ts 中动态注册已启用技能为 OpenAI function tool ✅ Phase 1

### MCP -- MCP 服务器管理与工具执行

- [x] **MCP-01**: 用户可以通过 UI 创建 MCP 服务器配置（名称、命令、参数、环境变量） ✅ Phase 2
- [x] **MCP-02**: MCP 服务器配置持久化到磁盘（mcp-servers.json） ✅ Phase 2
- [x] **MCP-03**: 应用启动时自动连接已配置的 MCP 服务器（stdio 模式） ✅ Phase 2
- [x] **MCP-04**: MCP 客户端实现 initialize/initialized 握手协议 ✅ Phase 2
- [x] **MCP-05**: MCP 客户端调用 tools/list 获取服务器提供的工具列表 ✅ Phase 2
- [x] **MCP-06**: MCP 客户端调用 tools/call 执行服务器工具并返回结果 ✅ Phase 2
- [x] **MCP-07**: MCP 工具自动注册为 OpenAI function tool（动态加入 tool schemas） ✅ Phase 2
- [x] **MCP-08**: 模型可以在 agentic loop 中调用 MCP 工具 ✅ Phase 2
- [x] **MCP-09**: 用户可以删除 MCP 服务器配置（停止进程 + 删除文件） ✅ Phase 2
- [x] **MCP-10**: 用户可以刷新 MCP 服务器（重连 + 重新获取工具列表） ✅ Phase 2
- [x] **MCP-11**: MCP 服务器列表页显示连接状态（connected / error / unknown） ✅ Phase 2

### APPR -- 工具调用审批

- [x] **APPR-01**: 高风险工具（fs_write, fs_edit, exec_command, git_commit）调用前暂停并请求用户审批 ✅ Phase 3
- [x] **APPR-02**: 审批 UI 在 ChatPage 中展示：工具名称、参数预览、approve / deny 按钮 ✅ Phase 3
- [x] **APPR-03**: 用户 approve 后继续执行工具，deny 后将拒绝信息反馈给模型 ✅ Phase 3
- [x] **APPR-04**: 审批模式可配置：always-ask / always-allow / inherit（全局策略） ✅ Phase 3
- [x] **APPR-05**: 只读工具（fs_read, fs_list, fs_search, fs_find, git_status, git_diff, git_log）默认自动通过 ✅ Phase 3

### CHAT-UI -- ChatPage 工具 UI 增强

- [x] **CHAT-UI-01**: 工具执行中显示 loading spinner 和工具名称 ✅ Phase 4
- [x] **CHAT-UI-02**: 工具参数可展开查看（JSON 格式化显示） ✅ Phase 4
- [x] **CHAT-UI-03**: 工具执行结果支持语法高亮（代码输出） ✅ Phase 4
- [x] **CHAT-UI-04**: 每个工具调用显示执行耗时（毫秒） ✅ Phase 4
- [x] **CHAT-UI-05**: 工具链整体显示当前轮次（"轮次 2/25"） ✅ Phase 4

## v1.1 Requirements (COMPLETED 2026-04-01)

### PARA -- 工具并发执行

- [x] **PARA-01**: 只读工具（fs_read, fs_list, fs_search, fs_find, git_status, git_diff, git_log, task_manage）使用 Promise.all 并发执行 ✅ Phase 5
- [x] **PARA-02**: 写入工具（fs_write, fs_edit, exec_command, git_commit, http_fetch, web_search）串行执行 ✅ Phase 5
- [x] **PARA-03**: 并发上限可配置（默认 5） ✅ Phase 5

### RETRY -- API 调用重试

- [x] **RETRY-01**: API 调用失败自动重试（最多 3 次，指数退避 1s→2s→4s） ✅ Phase 5
- [x] **RETRY-02**: 仅对 429/500/502/503/网络错误重试，400/401/403 不重试 ✅ Phase 5

### COMPACT -- 智能对话压缩

- [x] **COMPACT-01**: 基于 token 累计量（而非消息数量）触发 compact ✅ Phase 6
- [x] **COMPACT-02**: 调用模型生成对话摘要替代简单占位符 ✅ Phase 6
- [x] **COMPACT-03**: 阈值 = 模型 contextWindow 的 80%（ModelProfile 新增 contextWindow 字段） ✅ Phase 6

### TOKEN -- Token 消耗可视化

- [x] **TOKEN-01**: 每条 assistant 消息记录 token 使用量（promptTokens, completionTokens, totalTokens） ✅ Phase 6
- [x] **TOKEN-02**: 会话级别 token 总计 ✅ Phase 6
- [x] **TOKEN-03**: ChatPage 每条 assistant 消息显示 token 消耗 ✅ Phase 6

### IMPORT -- MCP 服务器导入

- [x] **IMPORT-01**: 读取 ~/.claude/claude_desktop_config.json（Claude Desktop 格式） ✅ Phase 7
- [x] **IMPORT-02**: 读取 ~/.cursor/mcp.json（Cursor 格式） ✅ Phase 7
- [x] **IMPORT-03**: 转换为 MyClaw 格式，支持选择性导入 ✅ Phase 7

### MCP-UX -- MCP 服务器管理 UX

- [x] **MCP-UX-01**: 服务器卡片显示实时连接状态图标（绿色/红色/灰色） ✅ Phase 7
- [x] **MCP-UX-02**: 导入面板 UI（发现→勾选→一键导入） ✅ Phase 7

### INFRA -- 基础设施

- [x] **INFRA-01**: 结构化日志系统（createLogger + 日志文件） ✅ Phase 8
- [x] **INFRA-02**: 渲染进程 ErrorBoundary（崩溃友好展示 + 重试） ✅ Phase 8
- [x] **INFRA-03**: 扩展测试覆盖（model-client, mcp-manager, sessions 集成测试） ✅ Phase 8
- [x] **INFRA-04**: 核心模块 console.log 替换为结构化日志 ✅ Phase 8

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### AGENT -- 子代理

- **AGENT-01**: 模型可以 spawn 子代理处理复杂子任务
- **AGENT-02**: 子代理有独立的消息上下文和 token 预算
- **AGENT-03**: 支持前台（等待结果）和后台（异步通知）模式

### COMPACT -- 智能对话压缩

- **COMPACT-01**: 基于 token 计数而非消息数量进行 compact
- **COMPACT-02**: 调用模型生成对话摘要替代简单的占位符
- **COMPACT-03**: 根据模型 context window 大小动态调整阈值

### TOKEN-UI -- Token 消耗可视化

- **TOKEN-UI-01**: 每条消息显示 token 消耗
- **TOKEN-UI-02**: 会话级别 token 总计
- **TOKEN-UI-03**: 按模型计费估算

### CLOUD -- 云端市场

- **CLOUD-01**: 浏览 Hub 项目列表（技能/工作流/员工包/MCP）
- **CLOUD-02**: 查看 Hub 项目详情和版本历史
- **CLOUD-03**: 一键安装 Hub 项目到本地
- **CLOUD-04**: 发布本地项目到 Hub

### WORKFLOW -- 工作流执行

- **WORKFLOW-01**: 启动工作流运行（解析 DAG、拓扑排序执行节点）
- **WORKFLOW-02**: 暂停/恢复/取消运行
- **WORKFLOW-03**: 运行历史持久化
- **WORKFLOW-04**: 运行状态实时推送到渲染进程

### MEMORY -- 持久记忆

- **MEMORY-01**: 跨会话持久记忆存储
- **MEMORY-02**: 自动从对话中提取关键信息保存
- **MEMORY-03**: 新会话自动加载相关记忆作为上下文

### INFRA -- 基础设施

- **INFRA-01**: API 调用失败自动重试（指数退避）
- **INFRA-02**: 结构化日志系统（替代 console.log）
- **INFRA-03**: 渲染进程全局 ErrorBoundary
- **INFRA-04**: 单元测试覆盖（executor, model-client, tool-schemas）

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| LSPTool（Language Server Protocol） | 复杂度极高，需要管理语言服务器进程生命周期，收益有限 |
| NotebookEditTool（Jupyter 编辑） | 使用场景有限，非核心开发者工具 |
| SSE/HTTP 模式 MCP | stdio 模式覆盖大部分场景，远程 MCP 延后 |
| OAuth 登录 MCP 服务器 | 本地 stdio 不需要 OAuth，远程 MCP 时再考虑 |
| 语音输入 | 桌面端优先键盘交互 |
| 移动端适配 | Electron 桌面端，不做移动适配 |
| 多窗口/多实例 | 单窗口单实例足够 |
| 插件系统 | 通过 MCP + Skills 已满足扩展需求 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SKILL-01 | Phase 1 | ✅ Done |
| SKILL-02 | Phase 1 | ✅ Done |
| SKILL-03 | Phase 1 | ✅ Done |
| SKILL-04 | Phase 1 | ✅ Done |
| MCP-01 | Phase 2 | ✅ Done |
| MCP-02 | Phase 2 | ✅ Done |
| MCP-03 | Phase 2 | ✅ Done |
| MCP-04 | Phase 2 | ✅ Done |
| MCP-05 | Phase 2 | ✅ Done |
| MCP-06 | Phase 2 | ✅ Done |
| MCP-07 | Phase 2 | ✅ Done |
| MCP-08 | Phase 2 | ✅ Done |
| MCP-09 | Phase 2 | ✅ Done |
| MCP-10 | Phase 2 | ✅ Done |
| MCP-11 | Phase 2 | ✅ Done |
| APPR-01 | Phase 3 | ✅ Done |
| APPR-02 | Phase 3 | ✅ Done |
| APPR-03 | Phase 3 | ✅ Done |
| APPR-04 | Phase 3 | ✅ Done |
| APPR-05 | Phase 3 | ✅ Done |
| CHAT-UI-01 | Phase 4 | ✅ Done |
| CHAT-UI-02 | Phase 4 | ✅ Done |
| CHAT-UI-03 | Phase 4 | ✅ Done |
| CHAT-UI-04 | Phase 4 | ✅ Done |
| CHAT-UI-05 | Phase 4 | ✅ Done |

| PARA-01 | Phase 5 | ✅ Done |
| PARA-02 | Phase 5 | ✅ Done |
| PARA-03 | Phase 5 | ✅ Done |
| RETRY-01 | Phase 5 | ✅ Done |
| RETRY-02 | Phase 5 | ✅ Done |
| COMPACT-01 | Phase 6 | ✅ Done |
| COMPACT-02 | Phase 6 | ✅ Done |
| COMPACT-03 | Phase 6 | ✅ Done |
| TOKEN-01 | Phase 6 | ✅ Done |
| TOKEN-02 | Phase 6 | ✅ Done |
| TOKEN-03 | Phase 6 | ✅ Done |
| IMPORT-01 | Phase 7 | ✅ Done |
| IMPORT-02 | Phase 7 | ✅ Done |
| IMPORT-03 | Phase 7 | ✅ Done |
| MCP-UX-01 | Phase 7 | ✅ Done |
| MCP-UX-02 | Phase 7 | ✅ Done |
| INFRA-01 | Phase 8 | ✅ Done |
| INFRA-02 | Phase 8 | ✅ Done |
| INFRA-03 | Phase 8 | ✅ Done |
| INFRA-04 | Phase 8 | ✅ Done |

**Coverage:**
- v1.0 requirements: 25 total, 25 completed ✅
- v1.1 requirements: 20 total, 20 completed ✅
- Grand total: 45 requirements, 45 completed ✅
- Unmapped: 0

---
*Requirements defined: 2026-03-31*
*Last updated: 2026-04-01 after v1.1 Phase 5~8 completion*

# MyClaw Desktop

## What This Is

MyClaw Desktop 是一个基于 Electron 的桌面 AI 助手应用，提供聊天、工具调用、技能管理、MCP 服务器集成、工作流编排等功能。面向开发者和技术用户，通过 OpenAI 兼容 API（Qwen/DashScope 为默认后端）驱动，自带完整的 agentic tool loop 实现文件操作、代码搜索、Shell 执行等能力。

## Core Value

用户可以通过自然语言与 AI 对话，AI 自动调用工具（读写文件、执行命令、搜索代码、Git 操作等）完成复杂的编码和系统管理任务。

## Current Milestone: v1.1 Robustness & Polish — COMPLETED ✅

**Goal:** 提升核心功能的健壮性、可观测性和用户体验。

**Completed features (v1.1):**
- 工具并发执行 — 只读工具并行，写入工具串行
- API 调用重试 — 指数退避自动重试（429/5xx）
- 智能 Compact — 基于 token 计数 + 模型摘要
- Token 可视化 — 每条消息 token + 会话总计
- MCP 导入 — 从 Claude Desktop/Cursor 导入配置
- 结构化日志 — createLogger 替代 console.log
- ErrorBoundary — 渲染进程崩溃友好展示

## Requirements

### Validated

<!-- 已实现并确认可用 -->

- [x] Agentic Tool Loop — 模型返回 tool_calls 自动执行并反馈（25 轮上限）
- [x] 13 个内置工具 — fs_read/write/edit/list/search/find, exec_command, git_status/diff/log/commit, http_fetch, web_search, task_manage
- [x] OpenAI Function Calling — 全部工具以 JSON Schema 发送给模型
- [x] 富系统提示词 — 包含环境信息、Git 分支、工具说明、行为准则
- [x] 会话标题自动生成 — 首条消息提取
- [x] Token 使用量追踪 — ModelCallResult 返回 usage
- [x] 对话自动 compact — 超 80 条消息压缩
- [x] 工具偏好持久化 — 保存到 tool-preferences.json
- [x] 状态持久化 — 模型/会话/员工/工作流 JSON 文件
- [x] 用户可配置数据目录 — 首次启动 Setup 向导
- [x] 模型连接测试 — 真实 HTTP 探测
- [x] 模型目录获取 — catalog-by-config 获取可用模型列表
- [x] 云端认证 — login/logout/refresh/introspect 对接 cloud-api
- [x] 技能磁盘加载 — JSON manifest + SKILL.md 两种格式
- [x] SkillTool — 模型可通过 function calling 调用技能 (Phase 1)
- [x] MCP 客户端连接 — stdio 模式 JSON-RPC 2.0 (Phase 2)
- [x] MCP 服务器管理 — 创建/删除/刷新/持久化到 mcp-servers.json (Phase 2)
- [x] MCP 工具执行 — 真实调用 MCP 服务器工具 + 模型可在 agentic loop 中使用 (Phase 2)
- [x] 工具调用前审批 — 高风险工具 approve/deny，只读自动通过 (Phase 3)
- [x] ChatPage 工具 UI — spinner、参数展开、结果高亮、耗时显示、轮次计数 (Phase 4)
- [x] 单元测试覆盖 — 45 个测试覆盖 Phase 1~4 核心逻辑
- [x] 工具并发执行 — 只读工具 Promise.all 并行（上限5），写入工具串行 (Phase 5)
- [x] API 调用重试 — 3次指数退避重试，429/5xx/网络错误 (Phase 5)
- [x] 智能 Compact — 基于 token 累计触发（80% context window），模型生成摘要 (Phase 6)
- [x] Token 消耗可视化 — 每条消息 + 会话总计 (Phase 6)
- [x] MCP 服务器导入 — 从 Claude Desktop/Cursor 导入配置 (Phase 7)
- [x] MCP 服务器 UX — 连接状态指示灯 (Phase 7)
- [x] 结构化日志 — createLogger(module) 替代 console.log (Phase 8)
- [x] ErrorBoundary — 渲染进程崩溃友好展示 + 重试 (Phase 8)
- [x] 单元测试扩展 — 116 个测试覆盖 Phase 1~8 核心逻辑 (Phase 8)

### Active

<!-- v1.0 + v1.1 全部完成，以下为 v2.0 候选 -->

- [ ] AgentTool 子代理 — 模型 spawn 子代理处理复杂子任务
- [ ] Workflow 执行引擎 — DAG 拓扑排序执行 + 暂停/恢复/取消
- [ ] Cloud Hub 浏览/安装 — 浏览、安装、发布 Hub 项目
- [ ] Persistent Memory — 跨会话持久记忆系统

### Out of Scope

<!-- 明确排除，附带理由 -->

- AgentTool（子代理）— 工程量大，依赖进程 fork 和独立 token 预算，P2 优先级
- Workflow 执行引擎 — 需要状态机引擎，CRUD 已完整，运行时延后
- Cloud Hub 浏览/安装 — 依赖 cloud-api 后端接口完善，P2 优先级
- Persistent Memory — 跨会话记忆系统，P3 优先级
- 智能 Compact（模型摘要）— 当前消息计数版够用，P2 优先级
- LSPTool — Language Server Protocol 集成，复杂度高
- NotebookEditTool — Jupyter 编辑，使用场景有限

## Context

- **技术栈**: Electron + React + Zustand + TypeScript
- **模型后端**: Qwen 3.5 Plus via `coding.dashscope.aliyuncs.com`（OpenAI 兼容 API）
- **云端后端**: NestJS cloud-api at `localhost:43210`
- **参考架构**: claude-code（工具体系、技能系统、权限模型已对标）
- **目标平台**: Windows（主要）、macOS（次要）
- **数据存储**: 用户选择的根目录下 `myClaw/` 子目录，JSON 文件持久化

## Constraints

- **自包含**: 不能导入 desktop 包的 runtime，所有功能自己实现
- **OpenAI 兼容**: 工具调用必须用 OpenAI function calling 格式（不是 Anthropic tool_use）
- **Electron 进程隔离**: main ↔ renderer 通过 IPC，preload contextBridge 暴露 API
- **无后端依赖**: 核心功能（聊天、工具）不依赖 cloud-api，离线可用

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 使用 OpenAI function calling 而非 Anthropic tool_use | 模型是 Qwen（OpenAI 兼容），不是 Claude | -- Good |
| fs_edit 使用精确字符串替换 | 对标 claude-code FileEditTool，避免重写整文件 | -- Good |
| 消息计数 compact 而非 token 计数 | 简单可靠，无需 token 估算库 | -- Pending |
| 工具偏好存独立 JSON 而非合并到 runtime-state | 关注点分离，工具配置独立于运行时状态 | -- Pending |
| MCP 优先实现 stdio 模式 | 最常用（本地命令行工具），SSE/HTTP 延后 | -- Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check -- still the right priority?
3. Audit Out of Scope -- reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-31 after milestone v1.0 initialization*

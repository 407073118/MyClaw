# State

## Current Position

Phase: v1.1 Phase 5~8 all completed
Plan: Next milestone planning
Status: v1.0 + v1.1 全部完成，116 个测试通过
Last activity: 2026-04-04 -- 新增 Phase 10，围绕通用推理运行时继续推进 MiniMax-first provider adapter 路线

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-01)

**Core value:** 用户可以通过自然语言与 AI 对话，AI 自动调用工具完成复杂的编码和系统管理任务。
**Current focus:** 下一里程碑定义中，先落 Phase 9 的推理运行时内核，再推进 Phase 10 的 MiniMax-first provider adapter。

## Completed Phases

| Phase | Name | Requirements | Date |
|-------|------|--------------|------|
| 1 | SkillTool | SKILL-01~04 | 2026-04-01 |
| 2 | MCP Integration | MCP-01~11 | 2026-04-01 |
| 3 | Tool Approval | APPR-01~05 | 2026-04-01 |
| 4 | Chat UI Polish | CHAT-UI-01~05 | 2026-04-01 |
| 5 | Parallel Tools & Retry | PARA-01~03, RETRY-01~02 | 2026-04-01 |
| 6 | Smart Compact & Token UI | COMPACT-01~03, TOKEN-01~03 | 2026-04-01 |
| 7 | MCP Import & Server UX | IMPORT-01~03, MCP-UX-01~02 | 2026-04-01 |
| 8 | Infrastructure | INFRA-01~04 | 2026-04-01 |

## Accumulated Context

- 项目基于 claude-code 架构对标，工具体系已基本对齐
- 14 个内置工具全部实现并通过 OpenAI function calling 发送给模型
- Agentic loop 已完成（最多 25 轮自动工具调用）
- 系统提示词已增强（环境信息 + Git 分支 + 工具说明 + 技能列表）
- Token 追踪、自动 compact、工具偏好持久化已完成
- **SkillTool 已实现** — 模型可主动调用已加载技能，SKILL.md 内容注入上下文
- **MCP 客户端已实现** — stdio 模式，JSON-RPC 2.0，initialize 握手，tools/list + tools/call
- **MCP 服务器管理已实现** — CRUD + 持久化 mcp-servers.json + 自动连接 + 工具聚合
- **工具审批已实现** — 高风险工具暂停等待用户 approve/deny，只读工具自动通过
- **Chat UI 增强已实现** — spinner、参数展开、执行耗时、轮次显示、活跃工具高亮
- **工具并发执行** — 只读工具 Promise.all 并发（上限5），写入工具串行
- **API 重试** — 3次重试，指数退避（1s→2s→4s），仅对 429/5xx/网络错误重试
- **智能 Compact** — 基于 token 累计触发（80% context window），模型生成摘要
- **Token 可视化** — 每条 assistant 消息显示 token 消耗，会话级 token 总计
- **MCP 导入** — 从 Claude Desktop / Cursor 导入 MCP 配置
- **MCP UX** — 服务器连接状态指示灯
- **结构化日志** — createLogger(module) → 日志文件 + 控制台
- **ErrorBoundary** — 渲染进程崩溃友好展示 + 重试
- 116 个单元测试全部通过（Phase 1~8 核心逻辑覆盖）
- MCP SSE/HTTP 模式、Cloud Hub、Workflow 运行时仍是 stub

### Roadmap Evolution

- Phase 9 added: Chat 推理等级与 Thinking/Effort 适配
- Phase 10 added: Provider adapters for MiniMax-first reasoning runtime

### Decisions

- Phase 9 先聚焦运行时能力落地，不预设 low / medium / high 等多档位；优先打磨一种稳定、好用的 thinking/effort 模式。
- Phase 10 明确保持现有 MiniMax 调用方式继续可用，在此基础上引入 first-class provider adapter，而不是强制切换到单一路径。

## Key Files Changed (v1.1)

| File | Change |
|------|--------|
| `src/main/ipc/sessions.ts` | Parallel tool execution, smart compact, token recording |
| `src/main/services/model-client.ts` | API retry with exponential backoff |
| `shared/contracts/model.ts` | Added contextWindow field |
| `shared/contracts/session.ts` | Added MessageTokenUsage type and usage field |
| `src/main/services/mcp-server-manager.ts` | MCP import (Claude Desktop / Cursor), structured logging |
| `src/main/ipc/mcp.ts` | mcp:discover-external, mcp:import-servers handlers |
| `src/preload/index.ts` | discoverExternalMcpServers, importMcpServers IPC |
| `src/renderer/pages/McpPage.tsx` | Import panel, status dots |
| `src/renderer/pages/ChatPage.tsx` | Token usage badges, session total |
| `src/main/services/logger.ts` | NEW — structured logger |
| `src/renderer/components/ErrorBoundary.tsx` | NEW — React error boundary |
| `src/renderer/App.tsx` | Wrapped with ErrorBoundary |
| `src/main/index.ts` | Logger init, structured logging |
| `src/main/services/mcp-client.ts` | Structured logging |

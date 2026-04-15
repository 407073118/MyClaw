# MyClaw desktop — 待完成改造清单

> 基于 claude-code 体系全面审计后的改造计划
> 生成日期：2026-03-31

---

## 状态说明

- `[x]` 已完成
- `[ ]` 待完成
- 优先级：P0（阻塞性）> P1（核心功能）> P2（重要增强）> P3（锦上添花）

---

## 一、工具体系 (Tool System)

### 已完成
- [x] Agentic Tool Loop — 模型返回 tool_calls 后自动执行、反馈、循环（最多 25 轮）
- [x] OpenAI Function Calling Schema — 所有工具以 JSON Schema 发送给模型
- [x] SkillTool（技能执行）— 模型可主动调用已加载技能，SKILL.md 内容注入上下文
- [x] fs_read / fs_write / fs_list / fs_search / fs_find — 文件系统工具
- [x] fs_edit — 局部字符串替换（FileEditTool）
- [x] exec_command — Shell 命令执行（含安全阻断）
- [x] git_status / git_diff / git_log / git_commit — Git 工具
- [x] http_fetch / web_search — 网络工具
- [x] task_manage — 任务列表管理
- [x] 工具并发执行 — 只读工具 Promise.all 并发（上限 5），写入工具串行
- [x] 工具偏好持久化 — 保存到 tool-preferences.json

### 待完成

#### P2 — AgentTool（子代理）
- [ ] 模型可以 spawn 子代理处理复杂子任务
- [ ] 子代理有独立的消息上下文和 token 预算
- [ ] 支持前台（等待结果）和后台（异步通知）模式
- **涉及文件**：
  - `src/main/services/tool-schemas.ts` — 添加 agent_spawn schema
  - `src/main/services/agent-executor.ts` — 新建，实现子代理调用 callModel
  - `src/main/ipc/sessions.ts` — 在 agentic loop 中处理 agent 工具

#### P3 — 工具搜索/延迟加载（ToolSearch）
- [ ] 工具数量多时不全部发给模型，而是先发 tool_search 工具
- [ ] 模型通过 tool_search 发现需要的工具，再加载完整 schema
- [ ] 减少 token 消耗
- **涉及文件**：
  - `src/main/services/tool-schemas.ts` — 工具分组和延迟加载逻辑

---

## 二、MCP 服务器管理 (Model Context Protocol)

### 当前状态
MCP 主链已经接通：stdio 连接、CRUD、工具发现与执行、导入流程都已落地；远程 SSE/HTTP 连接仍未完成。

### 待完成

#### P1 — MCP 客户端连接
- [x] 支持 stdio 模式（spawn 子进程通过 stdin/stdout 通信）
- [x] 实现 MCP 协议握手（initialize → initialized）
- [x] 调用 `tools/list` 获取工具列表
- [x] 调用 `tools/call` 执行工具
- [ ] 支持 SSE/HTTP 模式（连接远程 MCP 服务器）
- **涉及文件**：
  - `src/main/services/mcp-client.ts` — MCP 协议客户端

#### P1 — MCP 服务器管理与工具执行
- [x] `mcp:create-server` — 保存配置到磁盘 + 启动服务器进程
- [x] `mcp:update-server` — 合并配置更新 + 重启服务器
- [x] `mcp:delete-server` — 停止进程 + 删除配置文件
- [x] `mcp:refresh-server` — 重连服务器 + 重新探测工具列表
- [x] `tool:execute-mcp` — 真实调用 MCP 服务器执行工具
- [x] `tool:list-mcp` — 返回从 MCP 服务器发现的真实工具列表
- [x] MCP 工具纳入 agentic loop（模型可以调用 MCP 工具）
- **涉及文件**：
  - `src/main/ipc/mcp.ts` — MCP 服务器生命周期 handler
  - `src/main/ipc/tools.ts` — execute-mcp / list-mcp handler
  - `src/main/services/mcp-server-manager.ts` — MCP 客户端管理器
  - `src/main/services/state-persistence.ts` — MCP 服务器持久化
  - `src/main/services/runtime-context.ts` — listMcpServers 真实实现

#### P2 — MCP 服务器导入
- [x] `importMcpServers` — 从 Claude Desktop / Cursor / Codex 导入 MCP 配置
- [x] 读取 `~/.claude/claude_desktop_config.json` 等配置文件
- [x] 解析 mcpServers 配置并导入
- **涉及文件**：
  - `src/preload/index.ts` — importMcpServers 已接通
  - `src/main/ipc/mcp.ts` — mcp:import handler

---

## 三、Cloud Hub（云端市场）

### 当前状态
Hub 浏览、详情、清单、导入链路大多已接通；`publish:create-draft` 仍是 stub，需要继续对接 cloud-api 后端。

### 待完成

#### P2 — Hub 浏览
- [x] `cloud:hub-items` — 调用 cloud-api 获取 Hub 项目列表（技能/工作流/员工包/MCP）
- [x] `cloud:hub-detail` — 获取单个 Hub 项目详情（描述、版本历史、截图等）
- [x] `cloud:hub-manifest` — 获取安装清单（文件列表、入口点、依赖）
- **涉及文件**：
  - `src/main/ipc/cloud.ts` — Hub 浏览 handler

#### P2 — Hub 安装/下载
- [x] `fetchCloudHubDownloadToken` — 获取临时下载 URL
- [x] `importCloudSkill` — 下载技能包 → 解压到 skillsDir → 刷新技能列表
- [x] `importCloudMcp` — 下载 MCP 配置 → 创建服务器 → 启动
- [x] `importSiliconPersonPackage` — 下载员工包 → 创建本地硅基员工记录
- [x] `installWorkflowPackageFromCloud` — 下载工作流包 → 创建本地工作流
- **涉及文件**：
  - `src/preload/index.ts` — Hub 导入 Promise 接口
  - `src/main/ipc/cloud.ts` — 对应 handler

#### P2 — Cloud Skills
- [x] `cloud:skills` — 列出云端技能（按分类/标签/排序）
- [x] `cloud:skill-detail` — 获取技能详情
- **涉及文件**：
  - `src/main/ipc/cloud.ts` — Cloud Skills handler

#### P3 — 发布到 Hub
- [ ] `publish:create-draft` — 创建发布草稿到 cloud-api
- [ ] 打包本地技能/工作流/员工为发布包
- [ ] 上传并提交审核
- **涉及文件**：
  - `src/main/ipc/cloud.ts` — create-draft handler 重写

---

## 四、Workflow 执行引擎

### 当前状态
工作流可以创建、编辑、保存，运行、列表、取消和 `session:stream` 推送也基本已接通；冷恢复仍未完成。

### 待完成

#### P2 — Workflow 运行时
- [x] `workflow:start-run` — 真实启动工作流执行
  - 解析工作流定义（nodes + edges）
  - 按 DAG 拓扑排序执行节点
  - 每个节点可以是：模型调用 / 工具执行 / 条件分支 / 人工审批
  - 记录每个节点的执行状态和输出
- [x] `workflow:resume-run` — 暂停态或已保存状态的恢复执行
- [x] `workflow:list-runs` — 从磁盘加载运行历史
- [x] `workflow:cancel-run` — 取消正在运行的工作流
- [x] 运行状态实时推送到渲染进程（`session:stream`）
- [ ] 冷恢复：进程重启后从 checkpoint 恢复工作流执行
- **涉及文件**：
  - `src/main/ipc/workflows.ts` — workflow 运行时 handler
  - `src/main/services/workflow-engine/` — 工作流执行引擎
  - `src/main/services/state-persistence.ts` — workflow run 持久化

---

## 五、系统提示词与会话管理

### 已完成
- [x] 富系统提示词 — 包含环境信息、Git 分支、工具说明、行为准则
- [x] 会话标题自动生成 — 从首条用户消息提取
- [x] Token 使用量追踪 — ModelCallResult 返回 usage
- [x] 对话自动 compact — 超 80 条消息自动压缩
- [x] 智能 Compact — 基于 token 累计触发，模型生成摘要
- [x] Token 消耗展示 — 每条 assistant 消息显示 token 消耗，会话级 token 总计

### 待完成

#### P3 — Persistent Memory（记忆系统）
- [ ] 跨会话的持久记忆（类似 claude-code 的 memdir/）
- [ ] 自动从对话中提取关键信息保存
- [ ] 新会话自动加载相关记忆作为上下文
- **涉及文件**：
  - `src/main/services/memory-service.ts` — **新建**
  - `src/main/ipc/sessions.ts` — 系统提示词中注入记忆

---

## 六、权限与审批系统

### 已完成
- [x] 高风险工具（fs_write、fs_edit、exec_command、git_commit）调用前请求用户审批
- [x] 审批模式：always-ask / always-allow / inherit（跟随全局策略）
- [x] 审批 UI：渲染进程展示待审批工具调用，用户可以 approve / deny
- [x] 审批结果反馈到 agentic loop，deny 时告知模型被拒绝
- **涉及文件**：
  - `src/main/ipc/sessions.ts` — 工具执行前检查审批策略并暂停会话
  - `src/main/ipc/approvals.ts` — 审批 resolve 后唤醒等待中的工具执行
  - `src/renderer/pages/ChatPage.tsx` — 审批 UI 组件
  - `src/preload/index.ts` — onApprovalResolved 事件监听

---

## 七、渲染进程 (Renderer) 页面完善

### 已完成
- [x] ChatPage 工具调用 UI 增强 — loading spinner、参数展开、执行结果高亮、耗时展示

### 待完成

#### P2 — SettingsPage 工具偏好 UI
- [ ] 工具页面显示每个工具的当前偏好状态
- [ ] 可切换 enabled / exposedToModel / approvalMode
- [ ] 修改后立即持久化（已有后端支持）
- **涉及文件**：
  - `src/renderer/pages/ToolsPage.tsx` — 完善工具偏好编辑 UI

#### P3 — HubPage 安装流程
- [ ] 浏览 Hub 项目列表
- [ ] 查看详情和版本历史
- [ ] 一键安装到本地
- [ ] 安装进度提示
- **涉及文件**：
  - `src/renderer/pages/HubPage.tsx` — 依赖 cloud.ts 的后端实现

#### P3 — WorkflowStudioPage 运行面板
- [ ] 启动工作流运行
- [ ] 实时查看节点执行状态
- [ ] 暂停/恢复/取消运行
- **涉及文件**：
  - `src/renderer/pages/WorkflowStudioPage.tsx` — 依赖 workflow-engine 后端

---

## 八、基础设施与工程质量

### 已完成
- [x] API 调用失败自动重试 — 指数退避
- [x] 网络断开时的优雅降级
- [x] 渲染进程全局错误边界 — React Error Boundary
- [x] 结构化日志 — 替代散落的 console.log/warn/error
- [x] 日志写入文件 — 方便用户报告问题
- [x] 日志级别可配置

### 待完成

#### P3 — 测试覆盖
- [ ] builtin-tool-executor.ts 单元测试
- [ ] model-client.ts 单元测试（mock SSE stream）
- [ ] tool-schemas.ts 单元测试
- [ ] sessions.ts 集成测试（agentic loop）
- **涉及文件**：
  - `src/__tests__/` — 新建测试文件

#### P3 — 热更新 (HMR)
- [ ] 主进程文件变更自动重启 electron（electron-reload 或 nodemon）
- [ ] 当前需要手动 `npm run build:main` 后才能看到变化
- **涉及文件**：
  - `package.json` — 添加 dev script 整合 watch + electron restart

---

## 九、改造优先级路线图

### 已完成
1. SkillTool、MCP stdio / CRUD / 工具执行 / 导入、工具并发执行、智能 Compact、Token 消耗展示
2. Cloud Hub 浏览与导入链路、Workflow 基本运行链路、ChatPage 工具 UI 增强
3. API 重试、结构化日志、ErrorBoundary

### 待开发
1. MCP SSE/HTTP 远程连接
2. AgentTool 子代理
3. ToolSearch / 工具延迟加载
4. Persistent Memory（跨会话记忆）
5. Cloud Hub 发布闭环（`publish:create-draft`、打包、上传审核）
6. Workflow 冷恢复（重启后从 checkpoint 恢复）
7. SettingsPage 工具偏好 UI
8. HubPage 安装流程
9. WorkflowStudioPage 运行面板
10. 测试覆盖
11. 热更新 (HMR)

---

## 文件变更快速参考

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/main/ipc/sessions.ts` | ✅ 已重写 | Agentic loop + 系统提示 + 自动标题 + compact + stream / cancel |
| `src/main/ipc/models.ts` | ✅ 已增强 | catalog-by-config 已添加 |
| `src/main/ipc/tools.ts` | ✅ 已增强 | 工具偏好持久化；MCP 执行 / list 已接通 |
| `src/main/ipc/mcp.ts` | ✅ 已接通 | MCP 服务器生命周期、导入与工具发现已完成；SSE/HTTP 延后 |
| `src/main/ipc/cloud.ts` | ⚠️ 大部分已接通 | Hub 浏览/导入已完成，`publish:create-draft` 仍是 stub |
| `src/main/ipc/workflows.ts` | ⚠️ 基本已接通 | start/list/cancel/stream 已完成，冷恢复未完成 |
| `src/main/services/model-client.ts` | ✅ 已完善 | 含 token usage 追踪与重试逻辑 |
| `src/main/services/builtin-tool-executor.ts` | ✅ 已完善 | 内置工具已实现 |
| `src/main/services/tool-schemas.ts` | ✅ 已完善 | OpenAI function calling schema 已接通 |
| `src/main/services/builtin-tool-stubs.ts` | ✅ 已完善 | 内置工具定义已接通 |
| `src/main/services/mcp-server-manager.ts` | ✅ 已存在 | MCP 服务器管理器，覆盖 CRUD / 导入 / 连接状态 |
| `src/main/services/mcp-client.ts` | ✅ 已存在 | stdio JSON-RPC MCP 客户端 |
| `src/main/services/workflow-engine/` | ✅ 已存在 | Workflow 执行引擎与 checkpointer |
| `src/main/services/memory-service.ts` | ⚠️ 已存在 | 仍待跨会话接入 |
| `src/main/services/logger.ts` | ✅ 已存在 | 结构化日志已接通 |
| `src/preload/index.ts` | ⚠️ 大部分已接通 | Cloud / MCP / Workflow API 透出，`publish:create-draft` 仍保留 stub |
| `shared/contracts/session.ts` | ✅ 已增强 | 含 tool_calls / tool_call_id |

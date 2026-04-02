# MyClaw newApp — 待完成改造清单

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
- [x] fs_read / fs_write / fs_list / fs_search / fs_find — 文件系统工具
- [x] fs_edit — 局部字符串替换（FileEditTool）
- [x] exec_command — Shell 命令执行（含安全阻断）
- [x] git_status / git_diff / git_log / git_commit — Git 工具
- [x] http_fetch / web_search — 网络工具
- [x] task_manage — 任务列表管理
- [x] 工具偏好持久化 — 保存到 tool-preferences.json

### 待完成

#### P1 — SkillTool（技能执行）
- [ ] 模型可以通过 function calling 主动调用已加载的技能
- [ ] 技能的 SKILL.md 内容作为 prompt 注入
- [ ] 支持 inline 模式（共享上下文）和 forked 模式（独立子调用）
- **涉及文件**：
  - `src/main/services/tool-schemas.ts` — 添加 skill_execute 工具 schema
  - `src/main/services/builtin-tool-executor.ts` — 添加技能执行逻辑
  - `src/main/services/builtin-tool-stubs.ts` — 添加技能工具定义
  - `src/main/ipc/sessions.ts` — 在 agentic loop 中处理技能调用

#### P2 — AgentTool（子代理）
- [ ] 模型可以 spawn 子代理处理复杂子任务
- [ ] 子代理有独立的消息上下文和 token 预算
- [ ] 支持前台（等待结果）和后台（异步通知）模式
- **涉及文件**：
  - `src/main/services/tool-schemas.ts` — 添加 agent_spawn schema
  - `src/main/services/agent-executor.ts` — 新建，实现子代理调用 callModel
  - `src/main/ipc/sessions.ts` — 在 agentic loop 中处理 agent 工具

#### P2 — 工具并发执行
- [ ] 只读工具（fs_read、fs_list、fs_search、fs_find、git_status、git_diff、git_log）并行执行
- [ ] 写入/执行类工具串行执行
- [ ] 并发上限可配置（默认 5）
- **涉及文件**：
  - `src/main/ipc/sessions.ts` — agentic loop 中工具执行部分重构

#### P3 — 工具搜索/延迟加载（ToolSearch）
- [ ] 工具数量多时不全部发给模型，而是先发 tool_search 工具
- [ ] 模型通过 tool_search 发现需要的工具，再加载完整 schema
- [ ] 减少 token 消耗
- **涉及文件**：
  - `src/main/services/tool-schemas.ts` — 工具分组和延迟加载逻辑

---

## 二、MCP 服务器管理 (Model Context Protocol)

### 当前状态
所有 MCP 操作都是 stub，返回空数据或假响应。

### 待完成

#### P1 — MCP 服务器生命周期
- [ ] `mcp:create-server` — 保存配置到磁盘 + 启动服务器进程
- [ ] `mcp:update-server` — 合并配置更新 + 重启服务器
- [ ] `mcp:delete-server` — 停止进程 + 删除配置文件
- [ ] `mcp:refresh-server` — 重连服务器 + 重新探测工具列表
- **涉及文件**：
  - `src/main/ipc/mcp.ts` — 所有 4 个 handler 需重写
  - `src/main/services/mcp-manager.ts` — **新建**，MCP 客户端管理器
  - `src/main/services/state-persistence.ts` — 添加 MCP 服务器持久化
  - `src/main/services/runtime-context.ts` — listMcpServers 改为真实实现

#### P1 — MCP 客户端连接
- [ ] 支持 stdio 模式（spawn 子进程通过 stdin/stdout 通信）
- [ ] 支持 SSE/HTTP 模式（连接远程 MCP 服务器）
- [ ] 实现 MCP 协议握手（initialize → initialized）
- [ ] 调用 `tools/list` 获取工具列表
- [ ] 调用 `tools/call` 执行工具
- **涉及文件**：
  - `src/main/services/mcp-client.ts` — **新建**，MCP 协议客户端

#### P1 — MCP 工具执行
- [ ] `tool:execute-mcp` — 真实调用 MCP 服务器执行工具
- [ ] `tool:list-mcp` — 返回从 MCP 服务器发现的真实工具列表
- [ ] MCP 工具纳入 agentic loop（模型可以调用 MCP 工具）
- **涉及文件**：
  - `src/main/ipc/tools.ts` — execute-mcp handler 重写
  - `src/main/services/tool-schemas.ts` — 动态加入 MCP 工具 schema
  - `src/main/ipc/sessions.ts` — agentic loop 中处理 MCP 工具

#### P2 — MCP 服务器导入
- [ ] `importMcpServers` — 从 Claude Desktop / Cursor / Codex 导入 MCP 配置
- [ ] 读取 `~/.claude/claude_desktop_config.json` 等配置文件
- [ ] 解析 mcpServers 配置并导入
- **涉及文件**：
  - `src/preload/index.ts` — importMcpServers 当前返回 Promise.resolve
  - `src/main/ipc/mcp.ts` — 添加 mcp:import handler

---

## 三、Cloud Hub（云端市场）

### 当前状态
所有 Hub 操作都是 stub。需要对接 cloud-api 后端。

### 待完成

#### P2 — Hub 浏览
- [ ] `cloud:hub-items` — 调用 cloud-api 获取 Hub 项目列表（技能/工作流/员工包/MCP）
- [ ] `cloud:hub-detail` — 获取单个 Hub 项目详情（描述、版本历史、截图等）
- [ ] `cloud:hub-manifest` — 获取安装清单（文件列表、入口点、依赖）
- **涉及文件**：
  - `src/main/ipc/cloud.ts` — 3 个 stub handler 重写
  - 需要确认 cloud-api 的 API 路径和响应格式

#### P2 — Hub 安装/下载
- [ ] `fetchCloudHubDownloadToken` — 获取临时下载 URL
- [ ] `importCloudSkill` — 下载技能包 → 解压到 skillsDir → 刷新技能列表
- [ ] `importCloudMcp` — 下载 MCP 配置 → 创建服务器 → 启动
- [ ] `installEmployeePackageFromCloud` — 下载员工包 → 创建本地员工记录
- [ ] `installWorkflowPackageFromCloud` — 下载工作流包 → 创建本地工作流
- **涉及文件**：
  - `src/preload/index.ts` — 5 个 Promise.resolve stub
  - `src/main/ipc/cloud.ts` — 添加对应 handler
  - `src/main/services/cloud-installer.ts` — **新建**，下载和安装逻辑

#### P2 — Cloud Skills
- [ ] `cloud:skills` — 列出云端技能（按分类/标签/排序）
- [ ] `cloud:skill-detail` — 获取技能详情
- **涉及文件**：
  - `src/main/ipc/cloud.ts` — 2 个 stub handler 重写

#### P3 — 发布到 Hub
- [ ] `publish:create-draft` — 创建发布草稿到 cloud-api
- [ ] 打包本地技能/工作流/员工为发布包
- [ ] 上传并提交审核
- **涉及文件**：
  - `src/main/ipc/cloud.ts` — create-draft handler 重写

---

## 四、Workflow 执行引擎

### 当前状态
工作流可以创建、编辑、保存（CRUD 完整），但不能运行。

### 待完成

#### P2 — Workflow 运行时
- [ ] `workflow:start-run` — 真实启动工作流执行
  - 解析工作流定义（nodes + edges）
  - 按 DAG 拓扑排序执行节点
  - 每个节点可以是：模型调用 / 工具执行 / 条件分支 / 人工审批
  - 记录每个节点的执行状态和输出
- [ ] `workflow:resume-run` — 从暂停点恢复执行
- [ ] `workflow:list-runs` — 从磁盘加载运行历史
- [ ] 运行状态实时推送到渲染进程（通过 session:stream 或新 channel）
- **涉及文件**：
  - `src/main/ipc/workflows.ts` — 3 个 stub handler 重写
  - `src/main/services/workflow-engine.ts` — **新建**，工作流执行引擎
  - `src/main/services/state-persistence.ts` — 添加 workflow run 持久化

---

## 五、系统提示词与会话管理

### 已完成
- [x] 富系统提示词 — 包含环境信息、Git 分支、工具说明、行为准则
- [x] 会话标题自动生成 — 从首条用户消息提取
- [x] Token 使用量追踪 — ModelCallResult 返回 usage
- [x] 对话自动 compact — 超 80 条消息自动压缩

### 待完成

#### P2 — 智能 Compact
- [ ] 基于 token 计数而非消息数量进行 compact
- [ ] 调用模型生成对话摘要（而非简单的 "[已压缩]" 占位符）
- [ ] 根据模型的 context window 大小动态调整阈值
- **涉及文件**：
  - `src/main/ipc/sessions.ts` — autoCompactMessages 函数升级

#### P2 — Token 消耗展示
- [ ] 在渲染进程展示每条消息的 token 消耗
- [ ] 会话级别的 token 总计
- [ ] 按模型计费估算（可选）
- **涉及文件**：
  - `shared/contracts/session.ts` — ChatMessage 添加 usage 字段
  - `src/main/ipc/sessions.ts` — 在消息中记录 usage
  - `src/renderer/pages/ChatPage.tsx` — 展示 token 信息

#### P3 — Persistent Memory（记忆系统）
- [ ] 跨会话的持久记忆（类似 claude-code 的 memdir/）
- [ ] 自动从对话中提取关键信息保存
- [ ] 新会话自动加载相关记忆作为上下文
- **涉及文件**：
  - `src/main/services/memory-service.ts` — **新建**
  - `src/main/ipc/sessions.ts` — 系统提示词中注入记忆

---

## 六、权限与审批系统

### 当前状态
审批框架已搭建（ApprovalPolicy、ApprovalRequest），但实际执行流程未接入工具调用。

### 待完成

#### P2 — 工具调用前审批
- [ ] 高风险工具（fs_write、fs_edit、exec_command、git_commit）调用前请求用户审批
- [ ] 审批模式：always-ask / always-allow / inherit（跟随全局策略）
- [ ] 审批 UI：渲染进程展示待审批工具调用，用户可以 approve / deny / edit
- [ ] 审批结果反馈到 agentic loop，deny 时告知模型被拒绝
- **涉及文件**：
  - `src/main/ipc/sessions.ts` — 工具执行前检查审批策略
  - `src/main/ipc/approvals.ts` — 审批 resolve 后唤醒等待中的工具执行
  - `src/renderer/pages/ChatPage.tsx` — 审批 UI 组件
  - `src/preload/index.ts` — onApprovalResolved 事件监听

---

## 七、渲染进程 (Renderer) 页面完善

### 待完成

#### P2 — ChatPage 工具调用 UI 增强
- [ ] 工具执行中显示 loading spinner
- [ ] 工具参数可展开查看（当前只显示工具名）
- [ ] 工具执行结果语法高亮（代码输出）
- [ ] 工具执行耗时显示
- **涉及文件**：
  - `src/renderer/pages/ChatPage.tsx` — 工具链渲染增强

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

### 待完成

#### P2 — 错误边界与重试
- [ ] API 调用失败自动重试（指数退避）
- [ ] 网络断开时的优雅降级
- [ ] 渲染进程全局错误边界（React Error Boundary）
- **涉及文件**：
  - `src/main/services/model-client.ts` — 添加重试逻辑
  - `src/renderer/App.tsx` 或 `src/renderer/router/` — 添加 ErrorBoundary

#### P2 — 日志系统
- [ ] 结构化日志（替代散落的 console.log/warn/error）
- [ ] 日志写入文件（方便用户报告问题）
- [ ] 日志级别可配置
- **涉及文件**：
  - `src/main/services/logger.ts` — **新建**

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

### Phase 1（核心可用）
1. SkillTool — 让模型能调用技能
2. MCP 客户端连接 — stdio 模式（最常用）
3. 工具调用前审批 — 安全保障
4. ChatPage 工具 UI 增强 — 用户体验

### Phase 2（功能补全）
5. MCP 服务器管理 — 创建/删除/刷新
6. Cloud Hub 浏览和安装 — 生态扩展
7. 智能 Compact — 长对话支持
8. Token 消耗展示 — 成本可视

### Phase 3（体验优化）
9. Workflow 执行引擎 — 自动化流程
10. AgentTool 子代理 — 复杂任务分解
11. Persistent Memory — 跨会话记忆
12. 错误重试和日志系统 — 稳定性
13. 测试覆盖 — 质量保障

---

## 文件变更快速参考

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/main/ipc/sessions.ts` | ✅ 已重写 | Agentic loop + 系统提示 + 自动标题 + compact |
| `src/main/ipc/models.ts` | ✅ 已增强 | catalog-by-config 已添加 |
| `src/main/ipc/tools.ts` | ✅ 已增强 | 工具偏好持久化；MCP 执行仍是 stub |
| `src/main/ipc/mcp.ts` | ❌ 全是 stub | 需要 mcp-manager + mcp-client |
| `src/main/ipc/cloud.ts` | ❌ 大部分 stub | 需要对接 cloud-api |
| `src/main/ipc/workflows.ts` | ⚠️ CRUD 完整 | 运行时（start/resume/list-runs）是 stub |
| `src/main/services/model-client.ts` | ✅ 已完善 | 含 token usage 追踪 |
| `src/main/services/builtin-tool-executor.ts` | ✅ 已完善 | 13 个工具全部实现 |
| `src/main/services/tool-schemas.ts` | ✅ 已完善 | 13 个 OpenAI function calling schema |
| `src/main/services/builtin-tool-stubs.ts` | ✅ 已完善 | 13 个工具定义 |
| `src/main/services/mcp-manager.ts` | ❌ 不存在 | 需新建 |
| `src/main/services/mcp-client.ts` | ❌ 不存在 | 需新建 |
| `src/main/services/workflow-engine.ts` | ❌ 不存在 | 需新建 |
| `src/main/services/cloud-installer.ts` | ❌ 不存在 | 需新建 |
| `src/main/services/memory-service.ts` | ❌ 不存在 | 需新建 |
| `src/main/services/logger.ts` | ❌ 不存在 | 需新建 |
| `src/preload/index.ts` | ⚠️ 部分 stub | 5 个 cloud import 返回 Promise.resolve |
| `shared/contracts/session.ts` | ✅ 已增强 | 含 tool_calls / tool_call_id |

<p align="center">
  <img src="desktop/build/icon.png" width="120" alt="MyClaw Logo" />
</p>

<h1 align="center">MyClaw</h1>

<p align="center">
  <strong>开源 AI Agent 平台 -- 可视化工作流引擎 + 桌面 IDE + 云端市场</strong>
</p>

<p align="center">
  <a href="README.md">English</a> &nbsp;|&nbsp;
  <a href="README.zh-CN.md">简体中文</a> &nbsp;|&nbsp;
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> &nbsp;|&nbsp;
  <a href="#核心特性">核心特性</a> &nbsp;|&nbsp;
  <a href="#系统架构">系统架构</a> &nbsp;|&nbsp;
  <a href="#技术栈">技术栈</a> &nbsp;|&nbsp;
  <a href="#参与贡献">参与贡献</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/electron-33-47848f?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-18-61dafb?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/nestjs-11-e0234e?style=flat-square&logo=nestjs" alt="NestJS" />
  <img src="https://img.shields.io/badge/nuxt-4-00dc82?style=flat-square&logo=nuxt.js" alt="Nuxt" />
  <img src="https://img.shields.io/badge/typescript-5.8-3178c6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

---

MyClaw 是一个开源的、本地优先的 AI Agent 平台，将**桌面 IDE**、**云端市场**和**可视化工作流引擎**集成于一体。你可以把它理解为你的个人 AI 操作系统 -- 接入任意大模型、可视化编排复杂工作流、通过 Skill 和 MCP 服务器无限扩展能力。

> **一句话概括**：Cursor/Windsurf 式 AI IDE + n8n/Dify 式可视化工作流 + MCP 生态，三合一。

---

## 为什么选择 MyClaw？

| 痛点 | MyClaw 的解决方案 |
|---|---|
| 被单一 AI 厂商锁定 | **9 种模型接入方式** -- OpenAI、Anthropic、通义千问、Moonshot、Ollama、LM-Studio、OpenRouter 等 |
| 无法控制 AI 在本机的操作 | **细粒度审批网关** -- 读/写/执行三级风险分类，4 种审批模式自由切换 |
| 编排工作流需要写代码 | **可视化 DAG 画布** -- 拖拽、连线、分支、汇聚，零代码 |
| 上下文窗口不够用 | **智能压缩** -- 80% 容量时自动摘要，保留最近 12 轮对话 |
| 工具分散在各处 | **MCP + Skill + 13 个内置工具** -- 统一工具层，一个入口 |

---

## 核心特性

### 桌面应用 (Electron)

**Agentic 对话** -- 多轮流式对话，完整的 Agent 工具循环（模型 -> 工具调用 -> 执行 -> 结果回传 -> 继续推理）。支持最多 200 轮自主执行，可配置审批门控。

**可视化工作流引擎** -- 8 种节点类型（开始、LLM、工具、人工输入、条件分支、子工作流、汇聚、结束），3 种连线类型（普通、并行、条件），基于检查点的执行与暂停恢复。

```
 [开始] --> [LLM: 分析] --> [条件: 通过?]
                                |         |
                              true      false
                                |         |
                          [工具: 部署]  [人工: 审核]
                                |         |
                                +--> [汇聚] --> [结束]
```

**13 个内置工具** -- 文件读写/编辑/搜索、Git 操作、命令执行、HTTP 请求、网页搜索、任务管理。每个工具都有独立的风险分类（读/写/执行）和审批策略。

**MCP 集成** -- 完整支持 [Model Context Protocol](https://modelcontextprotocol.io/)，提供 stdio 和 HTTP/SSE 双传输层。可一键导入 Claude Desktop 和 Cursor 的 MCP 配置，实时健康监测。

**Skill 系统** -- 基于 HTML 的 Skill 视图，支持 iframe postMessage 双向通信。Skill 以函数工具的形式暴露给模型，在内嵌 WebPanel 中渲染交互界面。

**多模型支持** -- 从服务商 API 动态发现可用模型，每个模型可独立配置 8 项上下文预算参数，支持按服务商探测能力（视觉、工具调用、推理）。

**记忆与上下文智能** -- 自动从对话中提取记忆、基于相关性排序和检索、模型生成式摘要压缩上下文、8 项可配置 Token 预算参数。

### 云端平台 (NestJS + Nuxt)

**市场中心** -- 浏览、发布、安装 Skill、工作流、MCP 配置和 Agent 模板，支持版本管理。

**Skill 发布** -- 上传 Skill 包，自动版本控制、分类标签、制品存储。

**MCP 注册中心** -- 集中管理 MCP 服务器目录，健康追踪和工具枚举。

**认证与多租户** -- 基于令牌的认证（access/refresh 双令牌），按用户追踪安装事件和分析。

---

## 系统架构

```
MyClaw/
├── desktop/                  # Electron + React 桌面应用
│   ├── src/main/             #   主进程：IPC 处理器 + 20 个服务
│   ├── src/renderer/         #   React UI：17 个路由，Zustand 状态管理
│   ├── src/preload/          #   Electron 桥接（contextBridge）
│   └── shared/contracts/     #   15 个领域类型文件
│
├── cloud/                    # 云端平台
│   ├── apps/cloud-api/       #   NestJS 后端（7 个模块，Prisma ORM）
│   ├── apps/cloud-web/       #   Nuxt 3 BFF 门户
│   ├── packages/shared/      #   云端领域类型
│   └── infra/                #   Docker Compose（PostgreSQL 16）
│
└── docs/plans/               # 设计文档
```

### 桌面端内部架构

```
┌─────────────────────────────────────────────────┐
│                渲染进程 (React)                   │
│  ┌─────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  对话   │ │  工作流   │ │  Skill / MCP     │  │
│  │  页面   │ │   画布    │ │  管理            │  │
│  └────┬────┘ └────┬─────┘ └────────┬─────────┘  │
│       └───────────┼────────────────┘             │
│                   │ IPC (contextBridge)           │
├───────────────────┼─────────────────────────────┤
│                主进程                             │
│  ┌────────────────┼────────────────────────┐     │
│  │  模型客户端    │  MCP 服务器管理        │     │
│  │  工具执行器    │  记忆服务              │     │
│  │  上下文        │  Token 预算            │     │
│  │  组装器        │  管理器                │     │
│  └────────────────┴────────────────────────┘     │
│       │                    │                     │
│  ┌────┴────┐    ┌─────────┴──────────┐           │
│  │  LLM   │    │  MCP 服务器         │           │
│  │  服务商 │    │  (stdio / HTTP)    │           │
│  └─────────┘    └────────────────────┘           │
└─────────────────────────────────────────────────┘
```

### 审批网关

```
工具调用 ──> 风险评估 ──> 策略检查
                            │
               ┌────────────┼────────────┐
               │            │            │
          [自动放行]    [询问用户]    [始终拦截]
               │            │            │
               └──────> 执行工具 <────────┘
                            │
                       返回结果
```

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 桌面运行时 | Electron 33 |
| 桌面 UI | React 18 + React Router 6 + Zustand 5 |
| 云端后端 | NestJS 11 + Prisma + PostgreSQL 16 |
| 云端前端 | Nuxt 4 (SSR + BFF) |
| 构建工具 | Vite 6 |
| 测试框架 | Vitest 3 |
| 编程语言 | TypeScript 5.8 (strict) |
| 包管理器 | pnpm 9 |
| 桌面打包 | electron-builder |
| 图标库 | Lucide React |

---

## 快速开始

### 前置条件

- **Node.js** >= 18
- **pnpm** >= 9
- **Docker**（云端平台数据库需要）

### 桌面应用

```bash
# 克隆仓库
git clone https://github.com/407073118/MyClaw.git
cd MyClaw/desktop

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建并运行
pnpm build
pnpm start

# 打包为安装程序
pnpm dist
```

### 云端平台

```bash
cd MyClaw/cloud

# 安装依赖
pnpm install

# 启动 PostgreSQL
pnpm dev:db

# 初始化数据库
pnpm setup:api

# 启动 API 服务（端口 43210）
pnpm dev:api

# 启动 Web 门户（端口 43211）
pnpm dev:web
```

---

## 核心概念

### Skill（技能）

Skill 是自包含的扩展包，用于增强 MyClaw 的能力：

```
my-skill/
├── SKILL.md          # 技能描述（注入系统提示词）
├── view.html         # 交互界面（在 WebPanel 中渲染）
├── data/             # 内置数据集
├── scripts/          # 自动化脚本
├── references/       # 参考文档
└── agents/           # 子 Agent 定义
```

### MCP 服务器

MyClaw 原生支持 [Model Context Protocol](https://modelcontextprotocol.io/)：

- **stdio 传输** -- 作为子进程启动本地 MCP 服务器
- **HTTP/SSE 传输** -- 连接远程 MCP 服务器
- **自动导入** -- 一键检测 Claude Desktop 和 Cursor 的配置

### 工作流节点

| 节点 | 用途 |
|---|---|
| **开始** | 工作流入口 |
| **LLM** | 向模型发送提示词并捕获响应 |
| **工具** | 执行已注册的工具（内置、MCP 或 Skill） |
| **人工输入** | 暂停执行，等待用户输入 |
| **条件分支** | 基于状态判断进行分支（等于、不等于、存在） |
| **子工作流** | 调用另一个工作流作为嵌套执行 |
| **汇聚** | 合并并行执行路径（全部/任意模式） |
| **结束** | 终止节点 |

### 审批模式

| 模式 | 行为 |
|---|---|
| `prompt` | 执行写入/删除操作前始终询问 |
| `auto-read-only` | 自动放行只读工具，写入操作需确认 |
| `auto-allow-all` | 自动放行工作区路径内的工具 |
| `unrestricted` | 从不询问（谨慎使用） |

---

## 路线图

- [x] **v1.0** -- 核心 Agent 循环、对话 UI、工具执行、Skill 系统
- [x] **v1.1** -- 工具并发、API 重试、智能压缩、MCP 导入、Token 可视化
- [ ] **v2.0** -- 子 Agent 编排、云端 Hub 浏览与安装
- [ ] **v2.1** -- 工作流执行引擎（运行时）、持久化跨会话记忆
- [ ] **v3.0** -- 多 Agent 协作、企业级功能、插件市场

---

## 参与贡献

欢迎各种形式的贡献！无论是 Bug 报告、功能建议还是 Pull Request。

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'Add amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 发起 Pull Request

---

## 许可证

本项目基于 MIT 许可证开源 -- 详见 [LICENSE](LICENSE) 文件。

---

<p align="center">
  由 MyClaw 团队用心打造<br/>
  <sub>如果这个项目对你有帮助，请给一颗 Star 吧！</sub>
</p>

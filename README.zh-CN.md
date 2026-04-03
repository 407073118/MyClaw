<p align="center">
  <img src="desktop/build/icon.png" width="120" alt="MyClaw Logo" />
</p>

<h1 align="center">MyClaw</h1>

<p align="center">
  <strong>企业级私有部署 AI Agent 平台</strong><br/>
  <sub>几分钟内为你的企业部署专属 Business AI -- 而不是几个月。</sub>
</p>

<p align="center">
  <a href="README.md">English</a> &nbsp;|&nbsp;
  <a href="README.zh-CN.md">简体中文</a> &nbsp;|&nbsp;
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="#企业部署模型">企业部署</a> &nbsp;|&nbsp;
  <a href="#核心特性">核心特性</a> &nbsp;|&nbsp;
  <a href="#系统架构">系统架构</a> &nbsp;|&nbsp;
  <a href="#快速开始">快速开始</a> &nbsp;|&nbsp;
  <a href="#参与贡献">参与贡献</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/部署-私有化-critical?style=flat-square" alt="Self-Hosted" />
  <img src="https://img.shields.io/badge/electron-33-47848f?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-18-61dafb?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/nestjs-11-e0234e?style=flat-square&logo=nestjs" alt="NestJS" />
  <img src="https://img.shields.io/badge/nuxt-4-00dc82?style=flat-square&logo=nuxt.js" alt="Nuxt" />
  <img src="https://img.shields.io/badge/typescript-5.8-3178c6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

---

MyClaw 是一套**企业级、完全私有化部署**的 AI Agent 平台。在公司内网部署 **Cloud** 端，集中管理 Skill、MCP 服务器、工作流模板和模型接入；员工安装 **Desktop** 客户端，即刻获得一个对接企业知识和工具的生产级 AI IDE -- **数据不出内网**。

> **一句话概括**：你公司的私有 Cursor + Dify + MCP Hub，一个下午就能部署完成。

---

## 企业部署模型

这是 MyClaw 与 OpenClaw、Dify、LobeChat 等工具的根本区别 -- **从第一天起就为企业级部署而设计**，而不是事后补丁。

```
┌─────────────────────────────────────────────────────────────┐
│                       企业内网                               │
│                                                             │
│  ┌───────────────────────────────────────┐                  │
│  │        MyClaw Cloud (管理端)           │                  │
│  │  ┌─────────┐ ┌──────┐ ┌───────────┐  │                  │
│  │  │  Skill  │ │ MCP  │ │  工作流   │  │   PostgreSQL     │
│  │  │  中心   │ │ 注册 │ │  模板     │  │◄──── + FastDFS   │
│  │  └────┬────┘ └──┬───┘ └─────┬─────┘  │                  │
│  │       └─────────┼───────────┘         │                  │
│  └─────────────────┼────────────────────┘                  │
│                    │ REST API                                │
│         ┌──────────┼──────────┐                             │
│         │          │          │                              │
│    ┌────┴────┐ ┌───┴────┐ ┌──┴─────┐                       │
│    │Desktop A│ │Desktop B│ │Desktop C│  ... N 名员工        │
│    │(开发)   │ │(产品)   │ │(测试)   │                      │
│    └─────────┘ └────────┘ └─────────┘                       │
│         │          │          │                              │
│    ┌────┴──────────┴──────────┴────┐                        │
│    │    企业 LLM 网关 / API 接入    │  (或公有云服务商)      │
│    └───────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### 运作方式

| 角色 | 组件 | 职责 |
|---|---|---|
| **IT / 管理员** | **Cloud** | 部署在公司服务器。审核并上架 Skill，注册内部 MCP 服务器，发布工作流模板，管理模型接入和 API Key。 |
| **员工** | **Desktop** | 安装 Electron 客户端。即时获取企业审核过的 AI 工具、Skill 和工作流。本地对话、本地执行，审批门控保障安全。 |
| **平台团队** | **两者** | 在 Cloud Hub 中构建定制 Skill 和工作流，一键推送到所有 Desktop。监控使用情况，管控可用模型和工具。 |

### 为什么不直接用 SaaS AI 工具？

| 关注点 | SaaS 工具 | MyClaw（私有部署） |
|---|---|---|
| **数据安全** | 代码/文档上传到第三方服务器 | 一切留在企业内网 |
| **模型选择** | 厂商锁定（单一服务商） | 9 种接入方式，含 Ollama/LM-Studio 私有部署 |
| **自定义工具** | 只能用平台提供的 | MCP + Skill + 内置工具，无限扩展 |
| **流程自动化** | 手动操作或需要额外工具 | 可视化工作流引擎，开箱即用 |
| **成本控制** | 按人头收费的 SaaS | 私有部署 + MIT 协议，仅需 LLM API 费用 |
| **企业管控** | 管理后台是后补的 | Cloud = 从第一天就是企业管控面板 |
| **部署速度** | 数月的采购流程 | `docker compose up` + 分发 Desktop 安装包 |

---

## 核心特性

### Cloud -- 企业管控面板

**Skill 中心** -- 集中管理、版本控制、分发 AI 技能到全组织。管理员审核上架 Skill 包；员工在 Desktop 一键安装。

**MCP 服务器注册** -- 注册企业内部 MCP 服务器（数据库访问、内部 API、监控工具）。注册后自动同步到每一台 Desktop。

**工作流模板** -- 在 Cloud 设计可复用的工作流模板（代码审查、故障响应、员工入职），推送给全体员工。确保 AI 驱动的流程在团队间一致执行。

**模型接入管控** -- 配置可用的 LLM 服务商和 API Key，将员工路由到审核过的模型。支持私有部署（Ollama、LM-Studio、VLM）。

**认证与分析** -- 基于令牌的认证，安装追踪，按用户/按包的使用分析。

### Desktop -- 每位员工的 AI IDE

**Agentic 对话** -- 多轮对话 + 完整 Agent 循环（模型 -> 工具调用 -> 执行 -> 结果回传 -> 继续推理）。支持最多 200 轮自主执行，可配置审批门控。

**可视化工作流引擎** -- 8 种节点（开始、LLM、工具、人工输入、条件分支、子工作流、汇聚、结束），3 种连线（普通、并行、条件），基于检查点的暂停/恢复。

```
 [开始] --> [LLM: 分析] --> [条件: 通过?]
                                |         |
                              true      false
                                |         |
                          [工具: 部署]  [人工: 审核]
                                |         |
                                +--> [汇聚] --> [结束]
```

**13 个内置工具** -- 文件读写/编辑/搜索、Git 操作、命令执行、HTTP 请求、网页搜索、任务管理。每个工具有独立的风险分类（读/写/执行）和审批策略。

**MCP 集成** -- 完整支持 [Model Context Protocol](https://modelcontextprotocol.io/)。stdio + HTTP/SSE 双传输层。一键导入 Claude Desktop 和 Cursor 配置。Cloud 注册的企业 MCP 服务器自动同步可用。

**Skill 系统** -- 基于 HTML 的 Skill 视图，iframe postMessage 双向通信。Cloud Hub 企业 Skill + 个人 Skill 共存。

**多模型支持** -- 9 种服务商接入：OpenAI、Anthropic、通义千问、Moonshot、Ollama、LM-Studio、OpenRouter、VLM、通用 OpenAI 兼容。动态模型发现、逐模型上下文预算、能力探测。

**审批网关** -- 精细控制 AI 在每台机器上的行为：

| 模式 | 行为 |
|---|---|
| `prompt` | 写入/删除操作前始终询问 |
| `auto-read-only` | 只读自动放行，写入需确认 |
| `auto-allow-all` | 工作区范围内自动放行 |
| `unrestricted` | 完全自主（谨慎使用） |

**记忆与上下文智能** -- 自动从对话中提取记忆、基于相关性检索、80% 容量时智能压缩、模型生成式摘要保留最近 12 轮。

---

## 系统架构

```
MyClaw/
├── desktop/                  # Electron + React -- 员工安装
│   ├── src/main/             #   主进程：IPC 处理器 + 20 个服务
│   ├── src/renderer/         #   React UI：17 个路由，Zustand 状态管理
│   ├── src/preload/          #   Electron 桥接（contextBridge）
│   └── shared/contracts/     #   15 个领域类型文件
│
├── cloud/                    # NestJS + Nuxt -- IT/管理员部署
│   ├── apps/cloud-api/       #   NestJS 后端（7 个模块，Prisma ORM）
│   ├── apps/cloud-web/       #   Nuxt 3 BFF 门户（管理控制台）
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
- **Docker**（Cloud 数据库需要）

### 部署 Cloud（管理员）

```bash
git clone https://github.com/407073118/MyClaw.git
cd MyClaw/cloud

pnpm install

# 启动 PostgreSQL
pnpm dev:db

# 初始化数据库（Schema + 种子数据）
pnpm setup:api

# 启动 API 服务（端口 43210）
pnpm dev:api

# 启动 Web 管理门户（端口 43211）
pnpm dev:web
```

> 生产环境：使用 `pnpm build` + PM2 + Nginx 反向代理。

### 安装 Desktop（员工）

```bash
cd MyClaw/desktop

pnpm install

# 开发模式
pnpm dev

# 构建并打包为安装程序（.exe / .dmg / .AppImage）
pnpm dist
```

> 将安装包分发给员工。首次启动时，指向企业 Cloud 服务器地址即可。

---

## 核心概念

### Skill（技能）

自包含的扩展包，增强 AI 能力。企业管理员发布到 Cloud Hub，员工在 Desktop 安装。

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

原生支持 [Model Context Protocol](https://modelcontextprotocol.io/) -- 连接 AI 与外部工具的标准协议：

- **stdio** -- 作为子进程启动本地 MCP 服务器
- **HTTP/SSE** -- 连接远程/企业 MCP 服务器
- **自动导入** -- 一键检测 Claude Desktop 和 Cursor 配置
- **企业注册中心** -- Cloud 管理的 MCP 服务器自动同步到所有 Desktop

### 工作流节点

| 节点 | 用途 |
|---|---|
| **开始** | 工作流入口 |
| **LLM** | 向模型发送提示词 |
| **工具** | 执行内置/MCP/Skill 工具 |
| **人工输入** | 暂停等待人工审核 |
| **条件分支** | 基于状态判断分支 |
| **子工作流** | 嵌套调用其他工作流 |
| **汇聚** | 合并并行路径（全部/任意） |
| **结束** | 终止节点 |

---

## 路线图

- [x] **v1.0** -- 核心 Agent 循环、对话 UI、工具执行、Skill 系统
- [x] **v1.1** -- 工具并发、API 重试、智能压缩、MCP 导入、Token 可视化
- [ ] **v2.0** -- 子 Agent 编排、Cloud Hub 同步、企业 RBAC 权限
- [ ] **v2.1** -- 工作流运行时引擎、持久化跨会话记忆
- [ ] **v3.0** -- 多 Agent 协作、审计日志、SSO/LDAP 集成、插件市场

---

## 参与贡献

欢迎各种形式的贡献！Bug 报告、功能建议、Pull Request，来者不拒。

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'Add amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 发起 Pull Request

## 许可证

MIT 协议 -- 详见 [LICENSE](LICENSE)。

---

<p align="center">
  <strong>别再为你的团队无法定制的 AI 工具按人头付费了。</strong><br/>
  部署 MyClaw，掌控你的 AI 基础设施。<br/><br/>
  <sub>觉得有用就给个 Star 吧！</sub>
</p>

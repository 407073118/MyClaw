# MyClaw

MyClaw 是一个由 `desktop/` 和 `cloud/` 组成的 AI Agent 工作区项目。根仓库主要承担导航、治理和跨工作区约束；真正的运行时代码分别落在桌面端和云端子项目里。

本 README 按当前代码反推整理，优先描述已经存在的模块、命令和边界，不把规划中的能力写成已完成能力。

## 项目组成

| 路径 | 当前职责 | 主要技术 |
| --- | --- | --- |
| `desktop/` | 本地桌面工作区。提供聊天、模型配置、工具执行、MCP、Skills、硅基员工、工作流、会议录音、日程任务、文件与产物预览。 | Electron 33、React 18、Vite 6、TypeScript 5.8、Zustand、SQL.js |
| `cloud/apps/cloud-api/` | 云端 API。提供认证、Hub、Skills、MCP、工件代理、安装留痕等服务。 | NestJS 11、Prisma 6、MySQL |
| `cloud/apps/cloud-web/` | 云端管理台。提供登录、Hub、Skills、MCP 管理和发布页面。 | Nuxt 4、Vue 3 |
| `cloud/packages/shared/` | Cloud API 与 Cloud Web 之间的类型契约。 | TypeScript |
| `docs/` | 架构、流程、产品 backlog 和 Agent 规则文档。 | Markdown |

## Desktop 当前能力

Desktop 是 Electron 应用，不是可独立运行的纯 Web 前端。渲染端通过 preload 暴露的 `window.myClawAPI` 进入主进程，主进程负责本地 runtime、模型调用、工具执行、MCP、工作流、会议、时间调度和持久化。

用户可见能力包括：

- 登录与首次设置：企业账号密码登录、游客登录、本地开发会话、首次模型供应商配置。
- 主聊天：多会话、流式回复、停止生成、推理强度、slash 命令、审批卡片、结构化表单、引用和能力轨迹展示。
- 模型设置：Provider 管理、默认模型、连接测试、路由探测、模型目录、审批策略、ASR 配置、个人提示词、应用更新。
- 工具中心：内置工具、MCP 工具开关、是否暴露给模型、工具执行审批。
- 本地 Skills 与 MCP：技能列表、技能文件预览、MCP server 新建/编辑/导入/连接。
- Cloud Hub 导入：从云端浏览并导入 MCP、Skills、员工包、工作流包。
- 硅基员工：员工创建、Studio 管理、独立会话、未读/审批/运行状态、绑定工作流运行。
- 工作流：本地工作流库、图形化 Studio、变量与状态 schema、运行面板、checkpoint、interrupt resume。
- 会议与日程：会议录音、转写、摘要、后续事项生成；日历事件、提醒、任务承诺、定时任务。
- 文件与产物：工作文件、产物预览、WebPanel、打开文件、Reveal 文件、发布草稿。

Desktop 主导航包括 `Chat`、`Hub`、`Tools`、`MCP`、`Skills`、`硅基员工`、`Workflows`、`会议录音`、`日程规划`、`Files`。设置、模型详情、个人提示词和发布草稿是独立路由或设置入口。

## Desktop Runtime

主进程的能力边界集中在 `desktop/src/main`、`desktop/src/preload` 和 `desktop/src/renderer/types/electron.d.ts`。

主要 IPC/API 分组：

- app/window/update：窗口控制、启动 bootstrap、更新检查、下载和安装。
- session/runtime：会话创建、发送消息、取消运行、后台任务、执行意图、审批、计划确认和流事件。
- model：模型配置的增删改查、默认模型、连接测试、路由探测、模型目录。
- tools/MCP：内置工具、MCP 工具、工具开关、MCP server 管理、外部 MCP 配置发现和导入。
- workflow：工作流定义、运行、取消、恢复、运行详情和流事件。
- artifacts/files：产物列表、标记最终版本、打开、Reveal、文件预览。
- cloud imports：Cloud Hub、Skills、MCP、员工包、工作流包的拉取与导入。
- silicon person：硅基员工、员工会话、消息、工作流启动和员工专属路径。
- meeting/time：会议录音、转写、后续事项；日程事件、提醒、任务承诺、调度任务和今日摘要。

内置工具覆盖文件读写与搜索、文档读取、命令执行、Git、HTTP、Web search、浏览器自动化、PPT 生成、任务与时间管理。`document.read` 支持 `xlsx/xls/xlsm/docx/pdf/pptx/md/txt/csv` 等格式。

模型适配器覆盖 OpenAI-compatible、OpenAI native、Anthropic、Qwen、Kimi/Moonshot、DeepSeek、Volcengine Ark、MiniMax、BR MiniMax 等路径，并按供应商能力选择 OpenAI Responses、Anthropic Messages 或 OpenAI Chat Compatible 协议。

## Cloud 当前能力

Cloud 是一个独立工作区，当前目标集中在认证、Hub、Skills/MCP 管理、工件元数据/下载代理和安装留痕。

`cloud-api` 模块：

- `auth`：登录、刷新、当前用户、token introspect、登出。当前实现使用 opaque token 和 SHA-256 hash 持久化，不是 JWT。
- `hub`：Hub 条目列表、详情、按类型和关键字过滤。Hub 类型为 `mcp`、`employee-package`、`workflow-package`。
- `skills`：独立 Skills 市场能力，支持列表、详情、创建、更新和 ZIP release 发布。
- `mcp`：独立 MCP 管理能力，支持创建、列表、详情和配置版本发布。
- `artifact`：FastDFS 风格的上传、下载流代理和下载 descriptor。
- `install`：安装日志写入和基础查询服务。

`cloud-web` 是 Nuxt 管理台，页面包括登录、Hub、Skills 列表/详情/发布、MCP 列表/发布。`server/api/*` 作为 BFF 转发到 `cloud-api`，Web 不直接访问数据库或 FastDFS。

`cloud/packages/shared` 只保存契约类型，导出 `auth`、`employee-package`、`hub`、`install`、`mcp`、`skills` 等模块。

## 重要边界

- 根仓库不是单一应用入口；开发时请进入 `desktop/` 或 `cloud/`。
- Desktop 和 Cloud 是平级工作区，通过 API、包格式、共享契约和文档约束连接，不应直接互相读取内部实现。
- Hub 不包含 `skill` 类型；Skills 是 Cloud 中的独立模块。
- MCP release 当前发布的是连接配置，不是 ZIP 工件。
- Cloud API 当前使用 MySQL；不要按 PostgreSQL 配置。
- `cloud/infra/docker-compose.yml` 目前是注释状态的 MySQL 模板，`pnpm dev:db` 不等同于开箱启动数据库。
- 企业登录、Cloud Hub、导入、应用更新、Web search、部分模型和 ASR 能力依赖网络或外部服务。
- 游客登录只表示 Desktop 本地会话，不等同于 Cloud 认证。
- 工具执行、文件访问和 MCP 调用受审批策略影响；自动允许或 unrestricted 策略会扩大本机操作风险。

## 环境要求

建议使用：

- Node.js 20 或更高版本。Desktop 发布流程使用 Node 22。
- pnpm 9.x。
- Windows、macOS 或 Linux 桌面环境用于 Electron。
- MySQL 数据库用于 Cloud API。
- FastDFS 兼容服务用于 Cloud 工件上传和下载代理。

## Desktop 开发

```powershell
cd F:\MyClaw\desktop
pnpm install
pnpm dev
```

常用命令：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm run dist:prod -- --publish never
```

Desktop 数据根目录解析顺序：

1. `MYCLAW_DATA_ROOT`
2. portable 模式下的 `data`
3. 安装器配置文件 `myclaw-data-root.txt`
4. 开发态 `.userdata`
5. Electron `userData`

派生目录包括 `myClaw/skills`、`workspace`、`artifacts`、`cache`、`sessions.db`、`time.db`、`models`、`settings.json`、`logs` 和会议文件目录。

## Cloud 开发

```powershell
cd F:\MyClaw\cloud
pnpm install
Copy-Item apps/cloud-api/.env.example apps/cloud-api/.env
pnpm setup:api
pnpm dev:api
pnpm dev:web
```

常用命令：

```powershell
pnpm test
pnpm build
pnpm --dir packages/shared test
pnpm --dir packages/shared build
pnpm --dir apps/cloud-api test
pnpm --dir apps/cloud-api build
pnpm --dir apps/cloud-api bundle
pnpm --dir apps/cloud-web test
pnpm --dir apps/cloud-web build
```

Cloud API 默认监听 `43210`。Cloud Web 默认连接 `http://127.0.0.1:43210`。

常见环境变量：

```dotenv
DATABASE_URL="mysql://user:password@host:3306/myclaw_cloud"
PORT=43210

INTERNAL_AUTH_MODE=mock
INTERNAL_AUTH_VALIDATE_URL=
CAS_VALIDATE_USER_URL=

FASTDFS_BASE_URL=
FASTDFS_PROJECT_CODE=
FASTDFS_TOKEN=
FASTDFS_UPLOAD_PATH=
FASTDFS_DOWNLOAD_PATH=
```

如需打部署包，先生成 API bundle 和 Web `.output`，再在 `cloud/` 下执行：

```bash
bash scripts/pack-deploy.sh
```

该脚本负责复制已有产物并打包，不负责从零构建产物。

## 测试与验证

Desktop：

```powershell
pnpm --dir desktop typecheck
pnpm --dir desktop test
```

Cloud：

```powershell
pnpm --dir cloud test
pnpm --dir cloud build
pnpm --dir cloud/apps/cloud-api test
pnpm --dir cloud/apps/cloud-web test
pnpm --dir cloud/packages/shared test
```

中文文档和代码改动后，需要按仓库规则做乱码检查。可在根目录执行：

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern README.md docs desktop cloud
```

## 文档入口

- [AGENTS.md](AGENTS.md)：全仓库 Agent 硬规则、阅读顺序、编码要求。
- [docs/agents/context-engineering.md](docs/agents/context-engineering.md)：上下文收集和阅读纪律。
- [docs/agents/harness-rules.md](docs/agents/harness-rules.md)：命令、编辑和验证规则。
- [docs/architecture/overview.md](docs/architecture/overview.md)：仓库级架构概览。
- [docs/architecture/domain-boundaries.md](docs/architecture/domain-boundaries.md)：Desktop、Cloud 和共享契约边界。
- [docs/architecture/layering-constraints.md](docs/architecture/layering-constraints.md)：分层与依赖限制。
- [docs/processes/code-review-checklist.md](docs/processes/code-review-checklist.md)：代码评审检查项。
- [docs/processes/release-process.md](docs/processes/release-process.md)：发布流程。
- [desktop/docs/releases/public-release-runbook.md](desktop/docs/releases/public-release-runbook.md)：Desktop 公开发布流程。

## 当前文档缺口

- `desktop/` 目前没有独立 `README.md` 或 `AGENTS.md`，根层 README 只能作为临时导航入口。
- `README.zh-CN.md` 和 `README.ja.md` 尚未按当前代码同步重写。
- Cloud 部署文档需要进一步收敛环境变量命名、构建顺序和部署包脚本边界。

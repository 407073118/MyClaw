<p align="center">
  <img src="desktop/build/icon.png" width="120" alt="MyClaw Logo" />
</p>

<h1 align="center">MyClaw</h1>

<p align="center">
  <strong>Enterprise-Ready, Self-Hosted AI Agent Platform</strong><br/>
  <sub>Deploy your own Business AI in minutes -- not months.</sub>
</p>

<p align="center">
  <a href="README.md">English</a> &nbsp;|&nbsp;
  <a href="README.zh-CN.md">简体中文</a> &nbsp;|&nbsp;
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="#enterprise-deployment">Enterprise Deploy</a> &nbsp;|&nbsp;
  <a href="#features">Features</a> &nbsp;|&nbsp;
  <a href="#architecture">Architecture</a> &nbsp;|&nbsp;
  <a href="#quick-start">Quick Start</a> &nbsp;|&nbsp;
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/deploy-self--hosted-critical?style=flat-square" alt="Self-Hosted" />
  <img src="https://img.shields.io/badge/electron-33-47848f?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-18-61dafb?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/nestjs-11-e0234e?style=flat-square&logo=nestjs" alt="NestJS" />
  <img src="https://img.shields.io/badge/nuxt-4-00dc82?style=flat-square&logo=nuxt.js" alt="Nuxt" />
  <img src="https://img.shields.io/badge/typescript-5.8-3178c6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

---

MyClaw is an **enterprise-grade, fully self-hosted** AI agent platform. Deploy the **Cloud** on your company's infrastructure to centrally manage skills, MCP servers, workflows, and model access. Employees install the **Desktop** app and instantly get a production-ready AI IDE connected to your enterprise knowledge and tools -- no data leaves your network.

> **Think**: Your company's private Cursor + Dify + MCP Hub, deployed in one afternoon.

---

## Enterprise Deployment

This is what sets MyClaw apart from tools like OpenClaw, Dify, or LobeChat -- **it's built for enterprise from day one**, not bolted on as an afterthought.

```
┌─────────────────────────────────────────────────────────────┐
│                    YOUR COMPANY NETWORK                      │
│                                                             │
│  ┌───────────────────────────────────────┐                  │
│  │         MyClaw Cloud (Admin)          │                  │
│  │  ┌─────────┐ ┌──────┐ ┌───────────┐  │                  │
│  │  │  Skill  │ │ MCP  │ │ Workflow  │  │   PostgreSQL     │
│  │  │  Hub    │ │ Reg. │ │ Templates │  │◄──── + FastDFS   │
│  │  └────┬────┘ └──┬───┘ └─────┬─────┘  │                  │
│  │       └─────────┼───────────┘         │                  │
│  └─────────────────┼────────────────────┘                  │
│                    │ REST API                                │
│         ┌──────────┼──────────┐                             │
│         │          │          │                              │
│    ┌────┴────┐ ┌───┴────┐ ┌──┴─────┐                       │
│    │Desktop A│ │Desktop B│ │Desktop C│  ... N employees     │
│    │(Dev)    │ │(PM)     │ │(QA)     │                      │
│    └─────────┘ └────────┘ └─────────┘                       │
│         │          │          │                              │
│    ┌────┴──────────┴──────────┴────┐                        │
│    │   Company LLM Gateway / API   │  (or public providers) │
│    └───────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### How It Works

| Role | Component | What They Do |
|---|---|---|
| **IT / Admin** | **Cloud** | Deploy on company servers. Curate approved skills, register internal MCP servers, publish workflow templates, manage model access and API keys. |
| **Employees** | **Desktop** | Install the Electron app. Get instant access to enterprise-approved AI tools, skills, and workflows. Chat with any LLM, execute tools locally with approval gates. |
| **Platform Team** | **Both** | Build custom skills and workflows in the Cloud Hub, push to all desktops. Monitor usage, control which models and tools are available. |

### Why Not Just Use SaaS AI Tools?

| Concern | SaaS Tools | MyClaw (Self-Hosted) |
|---|---|---|
| **Data Privacy** | Your code/docs go to third-party servers | Everything stays in your network |
| **Model Choice** | Vendor lock-in (one provider) | 9 providers, including private Ollama/LM-Studio |
| **Custom Tools** | Limited to what they offer | Unlimited via MCP + Skills + Built-in tools |
| **Workflow Automation** | Manual or requires separate tools | Visual workflow engine, built-in |
| **Cost Control** | Per-seat SaaS pricing | Self-hosted, MIT license, pay only for LLM API |
| **Enterprise Control** | Admin panels as afterthought | Cloud = enterprise control plane from day one |
| **Deployment Speed** | Months of procurement | `docker compose up` + distribute Desktop installer |

---

## Features

### Cloud -- Enterprise Control Plane

**Skill Hub** -- Centrally manage, version, and distribute AI skills across the organization. Admins curate approved skill packages; employees install with one click from the Desktop app.

**MCP Server Registry** -- Register your company's internal MCP servers (database access, internal APIs, monitoring tools). All registered servers are instantly available to every Desktop user.

**Workflow Templates** -- Design reusable workflow templates (code review, incident response, onboarding) in the Cloud, push to all employees. Ensure consistent AI-powered processes across teams.

**Model Access Control** -- Configure which LLM providers and API keys are available. Route employees to approved models only. Support for private deployments (Ollama, LM-Studio, VLM).

**Auth & Analytics** -- Token-based authentication, install tracking, usage analytics per user and per package.

### Desktop -- AI IDE for Every Employee

**Agentic Chat** -- Multi-turn conversations with a full agent loop (model -> tool calls -> execution -> result -> continue). Up to 200 autonomous rounds with configurable approval gates.

**Visual Workflow Engine** -- 8 node types (Start, LLM, Tool, HumanInput, Condition, Subgraph, Join, End), 3 edge types (Normal, Parallel, Conditional), checkpoint-based pause/resume.

```
 [Start] --> [LLM: Analyze] --> [Condition: Pass?]
                                    |         |
                                  true      false
                                    |         |
                              [Tool: Deploy] [HumanInput: Review]
                                    |         |
                                    +--> [Join] --> [End]
```

**13 Built-in Tools** -- File read/write/edit/search, Git operations, command execution, HTTP fetch, web search, task management. Each with risk categories (read/write/execute) and independent approval policies.

**MCP Integration** -- Full [Model Context Protocol](https://modelcontextprotocol.io/) support. stdio + HTTP/SSE transports. Auto-import from Claude Desktop and Cursor. All enterprise MCP servers from Cloud Registry automatically available.

**Skill System** -- HTML-based skill views with iframe postMessage bidirectional communication. Enterprise skills from Cloud Hub + personal skills coexist.

**Multi-Model Support** -- 9 provider flavors: OpenAI, Anthropic, QWen, Moonshot, Ollama, LM-Studio, OpenRouter, VLM, and generic OpenAI-compatible. Dynamic model discovery, per-model context budgets, capability probing.

**Approval Gateway** -- Fine-grained control over what AI can do on each machine:

| Mode | Behavior |
|---|---|
| `prompt` | Always ask before write/delete operations |
| `auto-read-only` | Auto-approve reads, prompt for writes |
| `auto-allow-all` | Auto-approve within workspace scope |
| `unrestricted` | Full autonomy (use with caution) |

**Memory & Context Intelligence** -- Auto-extract memory from conversations, relevance-based retrieval, smart compaction at 80% context window capacity, model-generated summaries preserving recent 12 turns.

---

## Architecture

```
MyClaw/
├── desktop/                  # Electron + React -- installed by employees
│   ├── src/main/             #   Main process: IPC handlers + 20 services
│   ├── src/renderer/         #   React UI: 17 routes, Zustand stores
│   ├── src/preload/          #   Electron bridge (contextBridge)
│   └── shared/contracts/     #   15 domain type files
│
├── cloud/                    # NestJS + Nuxt -- deployed by IT/admin
│   ├── apps/cloud-api/       #   NestJS backend (7 modules, Prisma ORM)
│   ├── apps/cloud-web/       #   Nuxt 3 BFF portal (admin console)
│   ├── packages/shared/      #   Cloud domain types
│   └── infra/                #   Docker Compose (PostgreSQL 16)
│
└── docs/plans/               # Design documents
```

### Desktop Internal Architecture

```
┌─────────────────────────────────────────────────┐
│                  Renderer (React)                │
│  ┌─────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  Chat   │ │ Workflow  │ │  Skills / MCP    │  │
│  │  Page   │ │  Canvas   │ │  Management      │  │
│  └────┬────┘ └────┬─────┘ └────────┬─────────┘  │
│       └───────────┼────────────────┘             │
│                   │ IPC (contextBridge)           │
├───────────────────┼─────────────────────────────┤
│              Main Process                        │
│  ┌────────────────┼────────────────────────┐     │
│  │  Model Client  │  MCP Server Manager    │     │
│  │  Tool Executor │  Memory Service        │     │
│  │  Context       │  Token Budget          │     │
│  │  Assembler     │  Manager               │     │
│  └────────────────┴────────────────────────┘     │
│       │                    │                     │
│  ┌────┴────┐    ┌─────────┴──────────┐           │
│  │  LLM    │    │  MCP Servers       │           │
│  │ Provider│    │  (stdio / HTTP)    │           │
│  └─────────┘    └────────────────────┘           │
└─────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Runtime | Electron 33 |
| Desktop UI | React 18 + React Router 6 + Zustand 5 |
| Cloud Backend | NestJS 11 + Prisma + PostgreSQL 16 |
| Cloud Frontend | Nuxt 4 (SSR + BFF) |
| Build Tool | Vite 6 |
| Testing | Vitest 3 |
| Language | TypeScript 5.8 (strict) |
| Package Manager | pnpm 9 |
| Desktop Packaging | electron-builder |
| Icons | Lucide React |

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **pnpm** >= 9
- **Docker** (for Cloud database)

### Deploy Cloud (Admin)

```bash
git clone https://github.com/407073118/MyClaw.git
cd MyClaw/cloud

pnpm install

# Start PostgreSQL
pnpm dev:db

# Initialize database (schema + seed data)
pnpm setup:api

# Start API server (port 43210)
pnpm dev:api

# Start Web admin portal (port 43211)
pnpm dev:web
```

> For production: use `pnpm build` + PM2 + Nginx reverse proxy. See [Cloud Deploy Guide](docs/plans/).

### Install Desktop (Employee)

```bash
cd MyClaw/desktop

pnpm install

# Development mode
pnpm dev

# Build & package as installer (.exe / .dmg / .AppImage)
pnpm dist
```

> Distribute the installer to employees. On first launch, point to your Cloud server URL.

---

## Key Concepts

### Skills

Self-contained packages that extend AI capabilities. Enterprise admins publish to the Cloud Hub; employees install on their Desktop.

```
my-skill/
├── SKILL.md          # Description (injected into system prompt)
├── view.html         # Interactive UI (rendered in WebPanel)
├── data/             # Bundled datasets
├── scripts/          # Automation scripts
├── references/       # Reference documentation
└── agents/           # Sub-agent definitions
```

### MCP Servers

Native [Model Context Protocol](https://modelcontextprotocol.io/) support -- the standard for connecting AI to external tools:

- **stdio** -- Launch local MCP servers as child processes
- **HTTP/SSE** -- Connect to remote / enterprise MCP servers
- **Auto-import** -- Detect configs from Claude Desktop and Cursor
- **Enterprise Registry** -- Cloud-managed MCP servers auto-sync to all Desktops

### Workflow Nodes

| Node | Purpose |
|---|---|
| **Start** | Entry point |
| **LLM** | Model inference with prompt |
| **Tool** | Execute builtin / MCP / skill tool |
| **HumanInput** | Pause for human review |
| **Condition** | Branch on state (equals, not-equals, exists) |
| **Subgraph** | Nested workflow execution |
| **Join** | Merge parallel paths (all/any) |
| **End** | Terminal node |

---

## Roadmap

- [x] **v1.0** -- Core agent loop, chat UI, tool execution, skill system
- [x] **v1.1** -- Tool concurrency, API retry, smart compaction, MCP import, token visualization
- [ ] **v2.0** -- Sub-agent orchestration, cloud hub sync, enterprise RBAC
- [ ] **v2.1** -- Workflow runtime engine, persistent cross-session memory
- [ ] **v3.0** -- Multi-agent collaboration, audit logging, SSO/LDAP, plugin marketplace

---

## Contributing

Contributions are welcome! Bug reports, feature requests, and pull requests all appreciated.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License -- see [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>Stop paying per-seat for AI tools your team can't customize.</strong><br/>
  Deploy MyClaw. Own your AI stack.<br/><br/>
  <sub>If this project helps you, give it a star!</sub>
</p>

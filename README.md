<p align="center">
  <img src="desktop/build/icon.png" width="120" alt="MyClaw Logo" />
</p>

<h1 align="center">MyClaw</h1>

<p align="center">
  <strong>Open-source AI Agent Platform with Visual Workflow Engine</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &nbsp;|&nbsp;
  <a href="#features">Features</a> &nbsp;|&nbsp;
  <a href="#architecture">Architecture</a> &nbsp;|&nbsp;
  <a href="#tech-stack">Tech Stack</a> &nbsp;|&nbsp;
  <a href="#contributing">Contributing</a>
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

MyClaw is an open-source, local-first AI agent platform that combines a **desktop IDE**, a **cloud marketplace**, and a **visual workflow engine** into one integrated system. Think of it as your personal AI operating system -- connect any LLM, orchestrate complex workflows visually, and extend everything through skills and MCP servers.

> **TL;DR**: Cursor/Windsurf-like AI IDE + n8n/Dify-like visual workflow builder + MCP ecosystem, all in one.

---

## Why MyClaw?

| Pain Point | MyClaw's Answer |
|---|---|
| Locked into one AI provider | **9 provider flavors** -- OpenAI, Anthropic, QWen, Moonshot, Ollama, LM-Studio, OpenRouter, and more |
| Can't control what AI does on your machine | **Fine-grained approval gateway** -- read/write/execute risk tiers with 4 approval modes |
| Workflows require coding | **Visual DAG canvas** -- drag, connect, branch, join -- zero code |
| Context window limits | **Smart compaction** -- auto-summarizes at 80% capacity, preserves recent 12 turns |
| Tools scattered across apps | **MCP + Skills + 13 builtins** -- unified tool layer, one interface |

---

## Features

### Desktop App (Electron)

**Agentic Chat** -- Multi-turn conversations with streaming responses and an agentic tool loop (model -> tool calls -> execution -> result -> continue). Supports up to 200 autonomous rounds with configurable approval gates.

**Visual Workflow Engine** -- 8 node types (Start, LLM, Tool, HumanInput, Condition, Subgraph, Join, End), 3 edge types (Normal, Parallel, Conditional), checkpoint-based execution with pause/resume.

```
 [Start] --> [LLM: Analyze] --> [Condition: Pass?]
                                    |         |
                                  true      false
                                    |         |
                              [Tool: Deploy] [HumanInput: Review]
                                    |         |
                                    +--> [Join] --> [End]
```

**13 Built-in Tools** -- File read/write/edit/search, Git operations, command execution, HTTP fetch, web search, and task management. Each tool has a risk category (read/write/execute) with independent approval policies.

**MCP Integration** -- Full [Model Context Protocol](https://modelcontextprotocol.io/) support with stdio and HTTP/SSE transports. Auto-import configs from Claude Desktop and Cursor. Real-time health monitoring.

**Skill System** -- HTML-based skill views with bidirectional postMessage communication. Skills are exposed as function tools to the model and rendered in an embedded WebPanel.

**Multi-Model Support** -- Dynamic model discovery from provider APIs. Per-model context budget policies with 8 configurable parameters. Provider-specific capability probing (vision, tools, reasoning).

**Memory & Context Intelligence** -- Auto-extract memory from conversations, relevance-based ranking and retrieval, smart context compaction with model-generated summaries, 8 configurable token budget parameters.

### Cloud Platform (NestJS + Nuxt)

**Marketplace Hub** -- Browse, publish, and install skills, workflows, MCP configs, and agent templates with version management.

**Skill Publishing** -- Upload skill packages with automatic versioning, category tagging, and artifact storage.

**MCP Registry** -- Centralized MCP server catalog with health tracking and tool enumeration.

**Auth & Multi-tenancy** -- Token-based authentication with access/refresh flows, per-user install tracking and analytics.

---

## Architecture

```
MyClaw/
├── desktop/                  # Electron + React desktop app
│   ├── src/main/             #   Main process: IPC handlers + 20 services
│   ├── src/renderer/         #   React UI: 17 routes, Zustand stores
│   ├── src/preload/          #   Electron bridge (contextBridge)
│   └── shared/contracts/     #   15 domain type files
│
├── cloud/                    # Cloud platform
│   ├── apps/cloud-api/       #   NestJS backend (7 modules, Prisma ORM)
│   ├── apps/cloud-web/       #   Nuxt 3 BFF portal
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

### Approval Gateway

```
Tool Call ──> Risk Assessment ──> Policy Check
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                 │
              [auto-approve]   [prompt user]    [always block]
                    │                │                 │
                    └────────> Execute Tool <──────────┘
                                     │
                               Return Result
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
- **Docker** (for cloud platform database)

### Desktop App

```bash
# Clone the repository
git clone https://github.com/407073118/MyClaw.git
cd MyClaw/desktop

# Install dependencies
pnpm install

# Development mode
pnpm dev

# Build & run
pnpm build
pnpm start

# Package as installer
pnpm dist
```

### Cloud Platform

```bash
cd MyClaw/cloud

# Install dependencies
pnpm install

# Start PostgreSQL
pnpm dev:db

# Initialize database
pnpm setup:api

# Start API server (port 43210)
pnpm dev:api

# Start Web portal (port 43211)
pnpm dev:web
```

---

## Key Concepts

### Skills

Skills are self-contained packages that extend MyClaw's capabilities:

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

MyClaw supports the [Model Context Protocol](https://modelcontextprotocol.io/) natively:

- **stdio** transport -- Launch local MCP servers as child processes
- **HTTP/SSE** transport -- Connect to remote MCP servers
- **Auto-import** -- Detect configs from Claude Desktop and Cursor

### Workflow Nodes

| Node | Purpose |
|---|---|
| **Start** | Entry point of the workflow |
| **LLM** | Send a prompt to the model and capture the response |
| **Tool** | Execute a registered tool (builtin, MCP, or skill) |
| **HumanInput** | Pause execution and wait for user input |
| **Condition** | Branch based on state evaluation (equals, not-equals, exists) |
| **Subgraph** | Invoke another workflow as a nested execution |
| **Join** | Merge parallel execution paths (all/any mode) |
| **End** | Terminal node |

### Approval Modes

| Mode | Behavior |
|---|---|
| `prompt` | Always ask before executing write/delete operations |
| `auto-read-only` | Auto-approve read-only tools, prompt for writes |
| `auto-allow-all` | Auto-approve tools scoped to workspace paths |
| `unrestricted` | Never prompt (use with caution) |

---

## Roadmap

- [x] **v1.0** -- Core agentic loop, chat UI, tool execution, skill system
- [x] **v1.1** -- Tool concurrency, API retry, smart compaction, MCP import, token visualization
- [ ] **v2.0** -- Sub-agent orchestration, cloud hub browsing/installation
- [ ] **v2.1** -- Workflow execution engine (runtime), persistent cross-session memory
- [ ] **v3.0** -- Multi-agent collaboration, enterprise features, plugin marketplace

---

## Contributing

Contributions are welcome! Whether it's bug reports, feature requests, or pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License -- see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with passion by the MyClaw team<br/>
  <sub>If this project helps you, consider giving it a star!</sub>
</p>

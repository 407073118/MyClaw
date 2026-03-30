# OpenClaw-Style Desktop V1 Design

## Overview

This document defines the first version of a desktop AI workbench inspired by Claude Desktop, Codex, Cowork/OpenWork, and OpenClaw. The product goal is not a generic chatbot and not a full IDE. V1 is a desktop AI workspace with:

- chat as the primary interaction model
- global MCP server management
- manually imported Skills based on `skill folder + SKILL.md`
- approval-driven execution for risky actions
- optional local directory attachment per chat session

The first version is intentionally constrained. It prioritizes a usable desktop product over maximal flexibility. It should feel like a simplified OpenClaw desktop app running fully on the local machine.

## Product Goals

### Primary goals

- Deliver a native desktop AI client with a polished multi-panel workbench UI.
- Support configurable model providers with user-supplied `baseURL`, `apiKey/token`, and `model`.
- Support global MCP server import and usage, including reuse of user-managed Claude/Codex/Cursor MCP configurations through explicit import.
- Support manually imported Skills that the system can automatically select when relevant.
- Support local directory read/write workflows after the user explicitly attaches a directory to the current session.
- Make tool execution legible and controllable through approval UX.

### Non-goals for V1

- workspace-scoped MCP or Skills
- automatic discovery of external Skills directories
- remote gateway or remote node architecture
- online Skill marketplace
- visual workflow canvas
- subagents
- cloud sync
- project-wide IDE replacement

## Reference Products And What To Borrow

### OpenClaw

Borrow:

- multi-panel agent workspace
- tool execution approvals
- `Allow once` and persistent allow flows
- Skills format and automatic eligibility-based discovery
- installable Skills with controlled installers

Do not borrow for V1:

- remote gateway deployment model
- node network
- remote host management
- online ecosystem surface area

### OpenWork / Cowork-style apps

Borrow:

- desktop-shell plus local runtime split
- host-local execution model
- workbench framing instead of pure chat app framing

### Claude Code / Claude Skills

Borrow:

- `SKILL.md`-based package format
- model-invoked Skill discovery
- progressive disclosure approach: metadata first, full Skill only when relevant

## Chosen Technical Direction

### Stack

- Desktop shell: `Tauri 2`
- Desktop-native layer: `Rust`
- Frontend UI: `Vue 3 + TypeScript + Vite`
- State management: `Pinia`
- Routing: `Vue Router`
- AI runtime/orchestrator: `Node.js + TypeScript sidecar`
- Local persistence: `SQLite` or `libSQL`-compatible local file database
- MCP client integration: official TypeScript MCP SDK

### Why this stack

This is still a Rust desktop app. Rust remains responsible for the Tauri shell, packaging, permissions, and native boundaries. TypeScript is used where iteration speed and ecosystem strength matter most: model adapters, MCP client code, Skill indexing, approval event streaming, and chat orchestration.

This split matches the actual needs of the product:

- the UI is a complex web-style workbench
- the runtime needs strong TypeScript ecosystem support
- the desktop shell needs native packaging and tight permission boundaries

## High-Level Architecture

The app is split into four layers.

### 1. UI layer

The Vue app renders:

- chat timeline
- session list
- right-side execution and approvals panel
- model settings
- MCP settings
- Skill manager
- attached-directory indicators
- notifications and status banners

The UI does not talk directly to MCP servers or run arbitrary commands. It consumes structured events from the local runtime.

### 2. App runtime layer

The Node sidecar acts as the local AI orchestrator. It owns:

- provider clients
- conversation state for active sessions
- Skill indexing and selection context
- MCP client lifecycle
- approval requests and execution queues
- directory-scoped file operations
- streaming events to the UI

This layer is the product core.

### 3. Desktop/native layer

The Rust/Tauri layer owns:

- window lifecycle
- tray
- notifications
- secure storage bridges if needed
- application data paths
- filesystem/shell capability boundary
- packaging
- optional process supervision for the Node sidecar

### 4. External integration layer

This includes:

- configured model providers
- imported MCP servers
- imported local Skills
- local attached directories

## UI And Information Architecture

V1 should use a single-window workbench.

### Main regions

- Left sidebar:
  - session list
  - navigation to Chat, MCP, Skills, Models, Settings
- Center pane:
  - chat timeline
  - composer
  - inline approval cards
  - streaming assistant output
- Right pane:
  - current run status
  - tool call history
  - pending approvals
  - MCP server status
  - current attached directory

### Core screens

- Chat workspace
- MCP manager
- Skill manager
- Model/provider settings
- App/security settings

V1 should not introduce separate windows unless there is a clear OS-driven need later.

## Session Model

### Session scope

V1 sessions are global by default. A session is not automatically tied to a project folder. The user may optionally attach a local directory to a session. Only after attachment may file tools operate on that directory.

### Why this scope

This keeps startup and configuration simple while still supporting local file workflows. It avoids the complexity of full workspace management in V1 but preserves a migration path toward workspace-scoped sessions later.

### Session state

Each session stores:

- title
- message history
- selected model profile
- attached directory path, if any
- active run state
- session snapshot of eligible Skills
- session-level approval decisions for `allow this run`

## Model Provider Configuration

### V1 behavior

Users configure one or more provider profiles in Settings. A profile contains:

- profile name
- provider kind
- `baseURL`
- `apiKey` or token
- model id
- optional custom headers
- optional timeout and retry policy

V1 should allow multiple stored profiles, but the session should use one selected profile. The chat UI does not need arbitrary hot-swapping per turn. Selection may happen when creating a session or from a session settings drawer.

### Provider abstraction

Support at least:

- OpenAI-compatible chat API
- Anthropic-style provider adapter
- local gateway endpoints that look OpenAI-compatible

The abstraction must normalize:

- streaming text deltas
- tool call requests
- tool results
- system prompt assembly
- error types

## MCP Design

### Scope

V1 MCP is global. There is one global managed MCP pool for the application.

### Import model

The app does not automatically ingest third-party configurations. Users explicitly choose to import external MCP definitions from Claude, Codex, Cursor, or a file path. Imported entries are normalized into the app's own schema.

### Internal MCP server entity

Each managed MCP server stores:

- stable id
- display name
- source kind
- source path, if imported
- transport type: `stdio` or `http`
- command or URL
- args
- environment variables
- working directory policy
- auth metadata state
- enabled flag
- health status
- discovered tools cache
- risk classification tags

### Runtime behavior

On import or update, the runtime:

1. parses the source config
2. normalizes it into the internal schema
3. validates required fields
4. runs connectivity or launch checks
5. performs `list_tools`
6. stores tool metadata and server health

### Tool usage

MCP tools are surfaced to the model as tool definitions only when:

- the server is enabled
- connectivity succeeded
- auth is valid or not required
- the current policy allows exposure

## Skill Design

### Skill format

V1 supports manually imported local Skill folders using the Claude/OpenClaw-style convention:

- one directory per Skill
- required `SKILL.md`
- optional `scripts/`
- optional references/templates/assets

### Import policy

The app does not auto-scan `~/.claude/skills`, project `.claude/skills`, or any OpenClaw directory. All Skills must be manually imported through the UI.

### Managed Skill entity

Each imported Skill stores:

- stable id
- display name
- source path
- imported copy path or managed storage path
- parsed metadata from `SKILL.md`
- enabled flag
- eligibility status
- install status
- dependency status
- script manifest
- risk markers
- last validation time

### Skill discovery behavior

The system indexes imported Skills and builds a compact discovery list from their metadata. The model does not scan the filesystem itself. Instead:

1. the runtime selects eligible enabled Skills
2. it sends only compact Skill summaries into the model context
3. the model chooses whether to invoke a Skill
4. if chosen, the runtime loads the full Skill instructions and any needed references

This preserves context efficiency and gives predictable control over which Skills exist.

### Skill installation and execution

V1 allows installable and executable Skills, but only through controlled execution paths.

Allowed installer families:

- `npm`
- `pnpm`
- `yarn`
- `bun`
- `pip`
- `uv`
- `go install`

The runtime must parse installer requests into a structured form rather than execute arbitrary installer shell strings.

Skill execution scripts may run only through the same approval system used by all other risky tools.

## Unified Tool Runtime

V1 should unify all executable abilities under one internal abstraction:

- MCP tool calls
- built-in file tools
- built-in shell or command tools
- Skill install actions
- Skill execution scripts

This avoids fragmented approval logic.

### Internal action categories

- `read`
- `write`
- `exec`
- `network`
- `install`

Each category can carry risk tags and default policy behavior.

## Approval And Safety Model

### UX goals

Approvals must be understandable in-context and configurable globally.

### Approval surfaces

V1 should provide three surfaces backed by one policy engine:

- inline approval cards in the chat timeline
- a right-panel approval queue and run log
- settings-level persistent defaults

### Decision types

- `Allow once`
- `Allow this run`
- `Always allow this tool`
- `Deny`

### Default policy

- read-only tools may be auto-allowed
- write, exec, install, and browser-control style tools require approval by default
- users may loosen policy in settings

### Why this model

This copies the interaction pattern users already recognize from products like OpenClaw while preserving a stronger local-safety posture for V1.

## Local Directory Attachment

### V1 behavior

The user can attach one local directory to the current session. The directory becomes the root scope for file tools in that session.

### Allowed operations

V1 should support:

- list files
- search files
- read file contents
- create files
- edit files
- rename files

Optional for later in V1 if time permits:

- delete files
- run commands inside the attached directory

### Guardrails

- no file operations outside the attached directory root
- path normalization and traversal defense required
- writes should surface a clear preview or summary in approval cards

## Event Model

The runtime should stream structured events to the UI instead of shipping raw logs.

### Example event types

- `session.updated`
- `message.delta`
- `message.completed`
- `run.started`
- `run.step.updated`
- `approval.requested`
- `approval.resolved`
- `tool.started`
- `tool.completed`
- `tool.failed`
- `mcp.server.updated`
- `skill.updated`

This event model is critical. It keeps the UI reactive without coupling it tightly to implementation details.

## Persistence Model

V1 needs local persistence for:

- sessions and messages
- model profiles
- MCP server definitions
- imported Skill metadata
- approval policies
- attached directory history
- tool call audit trail

Suggested storage split:

- SQLite for structured entities
- managed app-data directories for imported Skill folders and runtime artifacts
- secure storage for sensitive tokens if Tauri plugins or OS keychain integration is introduced later

## Packaging And Distribution

V1 is a desktop app distributed through Tauri packaging. The Node sidecar should be bundled with the app and supervised locally. The product must function without any cloud control plane.

The runtime should start on app launch or lazily on first session open. The UI should clearly show runtime unavailable states.

## Migration Path For V2

The V1 design intentionally leaves room for:

- workspace-scoped sessions
- workspace-scoped MCP pools
- agent-scoped tool subsets
- subagents
- visual workflow canvas
- browser automation
- richer installer ecosystems
- secure secret storage improvements

To support that path, V1 data models must already include optional scope fields even if only `global` is active now.

## Final V1 Scope Summary

V1 includes:

- Tauri desktop shell
- Vue workbench UI
- Node sidecar runtime
- chat-first interaction model
- configurable model profiles
- global managed MCP pool with manual imports
- manually imported Skills using `SKILL.md`
- automatic Skill discovery by the runtime
- installable and executable Skills through controlled execution
- approval-driven risky actions
- optional per-session attached directory for local file operations

V1 excludes:

- automatic external Skill discovery
- remote gateway architecture
- marketplace-style Skill distribution
- workspace/project scoping
- subagents
- node graph editor

## References

- Tauri 2 docs: project creation, frontend integration, Node sidecar, filesystem/shell/capabilities
- MCP docs: SDK support and transport guidance
- OpenClaw docs: Skills, install actions, exec approvals
- Claude docs: Agent Skills and `SKILL.md` structure
- OpenWork repo: local desktop shell plus local runtime architecture
- MCPorter repo: MCP config import and TypeScript runtime inspiration

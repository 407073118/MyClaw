# External Integrations

**Analysis Date:** 2026-03-31

## AI / LLM Provider APIs

The runtime service (`desktop/apps/runtime/src/services/model-provider/`) implements a multi-provider LLM client that communicates with AI model APIs. No vendor SDK is used; all calls use raw `fetch()`.

**OpenAI-Compatible Providers:**
- Implementation: `desktop/apps/runtime/src/services/model-provider/openai-compatible/client.ts`
- Endpoints: `/chat/completions` (inference), `/models` (catalog)
- Auth: Bearer token via `ModelProfile.apiKey`
- Flavor detection: `desktop/apps/runtime/src/services/model-provider/openai-compatible/flavor.ts`
- Supported flavors:
  - `generic` - Standard OpenAI-compatible (OpenAI, local LLMs, etc.)
  - `qwen` - Alibaba Qwen via `dashscope.aliyuncs.com` (requires `/compatible-mode/v1` prefix; stream+tools disabled)
  - `qwen-coding` - Alibaba Qwen Coding via `coding.dashscope.aliyuncs.com` (standard OpenAI path)
  - `minimax` - MiniMax provider (detected by URL pattern)

**Anthropic (Claude):**
- Implementation: `desktop/apps/runtime/src/services/model-provider/anthropic/client.ts`
- Endpoint: `/v1/messages`
- Auth: `x-api-key` header via `ModelProfile.apiKey`
- API version header: `anthropic-version` (constant `ANTHROPIC_API_VERSION`)
- Also has flavor detection for MiniMax Anthropic proxy: `desktop/apps/runtime/src/services/model-provider/anthropic/flavor.ts`

**Streaming Support:**
- SSE parsing for both OpenAI and Anthropic protocols
- OpenAI SSE: `desktop/apps/runtime/src/services/model-provider/openai-compatible/sse.ts`
- Anthropic SSE: `desktop/apps/runtime/src/services/model-provider/anthropic/sse.ts`

**URL Resolution:**
- Smart base URL resolution with user-error correction (strips accidentally appended endpoint paths)
- Implementation: `desktop/apps/runtime/src/services/model-provider/shared/endpoint.ts`
- Supports `provider-root` mode (auto-append `/v1`) and manual mode (use as-is)

**Configuration:**
- Model profiles are user-configured at runtime (no hardcoded API keys)
- Each profile specifies: `provider`, `baseUrl`, `baseUrlMode`, `model`, `apiKey`, custom `headers`
- Type definition: `@myclaw-desktop/shared` -> `desktop/packages/shared/src/contracts/model.ts`

## MCP (Model Context Protocol) Servers

The runtime connects to external MCP servers for tool discovery and invocation.

**Implementation:** `desktop/apps/runtime/src/services/live-mcporter-adapter.ts`

**Transport Protocols:**
- **stdio** - Spawns child process, communicates via JSON-RPC 2.0 over stdin/stdout
- **HTTP** - POST JSON-RPC 2.0 requests to server endpoint

**MCP Protocol Version:** `2024-11-05`

**Operations:**
- `initialize` - Handshake with server
- `notifications/initialized` - Post-init notification
- `tools/list` - Discover available tools from server
- `tools/call` - Invoke a specific tool with arguments

**Configuration:**
- `McpServerConfig` type from `@myclaw-desktop/shared` -> `desktop/packages/shared/src/contracts/mcp.ts`
- Supports: `id`, `transport` ("stdio"|"http"), `command`, `args`, `cwd`, `env`, `url`, `headers`

**MCP Service Layer:** `desktop/apps/runtime/src/services/mcp-service.ts`
**MCP Manager:** `desktop/apps/runtime/src/services/mcp-manager.ts`

## Data Storage

**PostgreSQL (Cloud):**
- Provider: PostgreSQL 16 via Docker (`cloud/infra/docker-compose.yml`)
- Connection: `DATABASE_URL` env var
- ORM: Prisma 6.5.x (`cloud/apps/cloud-api/prisma/schema.prisma`)
- Models: `LoginSession`, `HubItem`, `HubRelease`, `Skill`, `SkillRelease`, `InstallLog`
- Database module: `cloud/apps/cloud-api/src/modules/database/database.module.ts`

**SQLite (Desktop - Local):**
- Library: sql.js (SQLite compiled to WASM)
- Used in: `desktop/apps/runtime/` and `newApp/`
- Purpose: Local desktop data persistence

**File-based Persistence (Desktop):**
- Session data: JSON files per session (`desktop/apps/runtime/src/services/session-persistence.ts`)
- Runtime state: `~/.myclaw/runtime-state.json` (newApp default path)
- Skills: Local filesystem skill definitions with SKILL.md frontmatter (`desktop/apps/runtime/src/services/skill-manager.ts`)

**File Storage (Cloud):**
- FastDFS integration for artifact (skill package) storage
- Implementation: `cloud/apps/cloud-api/src/modules/artifact/fastdfs-artifact-storage.ts`
- Port interface: `cloud/apps/cloud-api/src/modules/artifact/artifact-storage.port.ts`
- Env vars: `FASTDFS_BASE_URL`, `FASTDFS_PROJECT_CODE`, `FASTDFS_TOKEN`
- Operations: upload skill zip, generate download descriptors, stream downloads

## Authentication & Identity

**Cloud Auth (Custom Token-Based):**
- Implementation: `cloud/apps/cloud-api/src/modules/auth/auth.service.ts`
- Pattern: Opaque access + refresh tokens, SHA-256 hashed in database
- Access token TTL: 7200 seconds (2 hours)
- Refresh token TTL: 180 days
- Token format: `access-<base64url>` / `refresh-<base64url>` (using `node:crypto`)
- Session storage: `LoginSession` Prisma model
- Auth validation: delegated to `InternalAuthProvider` interface (`cloud/apps/cloud-api/src/modules/auth/internal-auth-provider.ts`)
- Endpoints: login, refresh, logout, me, introspect

**Desktop -> Cloud Auth:**
- Desktop frontend stores access token and passes it via `Authorization: Bearer` header
- Runtime proxy forwards auth headers to cloud API: `desktop/apps/desktop/src/services/cloud-hub-client.ts`

**Cloud Web Auth:**
- Session cookie: `myclaw-cloud-session` (contains JSON with `accessToken`)
- Server-side proxy extracts token from cookie: `cloud/apps/cloud-web/server/utils/cloud-api.ts`

## Internal Service Communication

**Desktop Architecture (Tauri):**
- Vue frontend <-> Tauri Rust shell (IPC via `@tauri-apps/api`)
- Tauri shell <-> Runtime sidecar (bundled Node.js binary, HTTP on port 43110)
- Runtime exposes HTTP API for frontend to consume

**Desktop Architecture (newApp / Electron):**
- React renderer <-> Electron main process (IPC via `contextBridge`/`ipcRenderer`)
- Preload script: `newApp/src/preload/`
- IPC handlers: `newApp/src/main/ipc/`
- Runtime context: `newApp/src/main/services/runtime-context.ts`

**Cloud Architecture:**
- Nuxt web (SSR server) -> Cloud API (NestJS) via `$fetch` with `proxyCloudApi()` utility
- Desktop runtime -> Cloud API via `CloudHubProxy` class
- Base URL: configurable, defaults to `http://127.0.0.1:43210`

**Cloud Hub Proxy (Desktop Runtime):**
- Purpose: Avoids CORS by routing desktop frontend requests through the local runtime process
- Implementation: `desktop/apps/runtime/src/services/cloud-hub-proxy.ts`
- Exposed at: `/api/cloud-hub/*` routes on the runtime HTTP server
- Client: `desktop/apps/desktop/src/services/cloud-hub-client.ts`
- Operations: list hub items, fetch details, fetch manifests, get download tokens, list/detail skills

## Cloud API Modules

| Module | Path | Purpose |
|--------|------|---------|
| auth | `cloud/apps/cloud-api/src/modules/auth/` | Login, token refresh, session management |
| hub | `cloud/apps/cloud-api/src/modules/hub/` | Hub item catalog (MCP, employees, workflows) |
| skills | `cloud/apps/cloud-api/src/modules/skills/` | Skill CRUD, publishing, versioning |
| artifact | `cloud/apps/cloud-api/src/modules/artifact/` | File storage (FastDFS), download streaming |
| install | `cloud/apps/cloud-api/src/modules/install/` | Installation logging |
| mcp | `cloud/apps/cloud-api/src/modules/mcp/` | MCP server registry |
| database | `cloud/apps/cloud-api/src/modules/database/` | Prisma client provider |

## Monitoring & Observability

**Error Tracking:** None detected (no Sentry, DataDog, etc.)

**Logging:**
- NestJS `Logger` class used in cloud API (e.g., `FastdfsArtifactStorage`)
- `console.log`/`console.warn`/`console.error`/`console.info` used throughout runtime services
- No structured logging framework

## CI/CD & Deployment

**Hosting:** Not detected from codebase (no Dockerfile for app, no deployment configs)

**CI Pipeline:** Not detected (no `.github/workflows/`, no `.gitlab-ci.yml`, etc.)

**Local Dev Infrastructure:**
- Docker Compose for PostgreSQL: `cloud/infra/docker-compose.yml`
- Dev commands: `pnpm dev:db` (start), `pnpm dev:db:down` (stop)

## Environment Configuration

**Required env vars (Cloud API):**
- `DATABASE_URL` - PostgreSQL connection string
- FastDFS vars for artifact storage (if using file uploads)
- Internal auth provider configuration (implementation-dependent)

**Required env vars (Cloud Web):**
- `CLOUD_API_BASE` - Backend API URL (default: `http://127.0.0.1:43210`)

**Required env vars (Desktop Runtime):**
- `RUNTIME_PORT` - HTTP server port (default: 43110)
- `RUNTIME_STATE_FILE_PATH` - State persistence file path
- `MYCLAW_CLOUD_HUB_BASE_URL` - Cloud hub URL (default: `http://127.0.0.1:43210`)

**Secrets location:**
- Environment variables (no `.env` files detected in repo)
- Model API keys stored in user-configured `ModelProfile` objects at runtime

## Webhooks & Callbacks

**Incoming:** None detected

**Outgoing:** None detected

## Built-in Tools (Desktop Runtime)

The runtime exposes built-in tools to the AI model for agentic coding workflows.

**Implementation:** `desktop/apps/runtime/src/services/builtin-tool-registry.ts`
**Executor:** `desktop/apps/runtime/src/services/builtin-tool-executor.ts`

| Tool ID | Group | Risk | Purpose |
|---------|-------|------|---------|
| `fs.list` | fs | Read | List files in workspace |
| `fs.read` | fs | Read | Read text files |
| `fs.search` | fs | Read | Search text content |
| `fs.stat` | fs | Read | File metadata |
| `fs.find` | fs | Read | Glob-based file finding |
| `fs.write` | fs | Write | Write text files |
| `fs.apply_patch` | fs | Write | Apply structured patches |
| `fs.move` | fs | Write | Move/rename files |
| `fs.delete` | fs | Write | Delete files/dirs |
| `exec.command` | exec | Exec | Run shell commands |
| `exec.task` | exec | Exec | Run predefined tasks |
| `git.status` | git | Read | Git status |
| `git.diff` | git | Read | Git diff |
| `git.show` | git | Read | Git show |
| `process.list` | process | Read | List OS processes |
| `process.kill` | process | Exec | Kill OS processes |
| `http.fetch` | http | Network | HTTP GET requests |
| `archive.extract` | archive | Write | Extract archives |
| `web.search` | web | Network | Web search |
| `task.manage` | task | Read | Task list management |

---

*Integration audit: 2026-03-31*

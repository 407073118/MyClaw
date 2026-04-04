# External Integrations

**Analysis Date:** 2026-04-04

## APIs & External Services

**Desktop to Cloud Platform:**
- MyClaw Cloud API - desktop auth, hub browsing, skill import, MCP import, and artifact download requests from `desktop/src/main/ipc/cloud.ts`
  - SDK/Client: native `fetch` helper in `desktop/src/main/ipc/cloud.ts`
  - Auth: bearer access tokens returned by `/auth/login` and refreshed via `/auth/refresh`; base URL comes from `MYCLAW_CLOUD_API_URL` or `desktop/config/env.*.ts`
- MyClaw Cloud API via Nuxt BFF - cloud web proxies every browser request through `cloud/apps/cloud-web/server/lib/cloud-api.ts`
  - SDK/Client: Nuxt `$fetch` plus `proxyCloudApi()` in `cloud/apps/cloud-web/server/lib/cloud-api.ts`
  - Auth: `myclaw-cloud-session` cookie handled in `cloud/apps/cloud-web/composables/useCloudSession.ts` and forwarded as `Authorization` by `cloud/apps/cloud-web/server/lib/cloud-api.ts`

**AI Model Providers:**
- OpenAI-compatible and Anthropic-style providers - desktop model testing and inference use the custom HTTP client in `desktop/src/main/services/model-client.ts`
  - SDK/Client: native `fetch` in `desktop/src/main/services/model-client.ts` and `desktop/src/main/ipc/models.ts`
  - Auth: per-profile `apiKey`, optional headers, and base URL stored in model profile JSON written by `desktop/src/main/services/state-persistence.ts`
- Supported provider flavors - normalization and probing code currently supports OpenAI, OpenRouter, Vercel AI Gateway, Qwen/DashScope, Moonshot, Ollama, Anthropic, MiniMax, and generic local gateways in `desktop/src/main/ipc/models.ts`, `desktop/src/main/services/model-capability-registry.ts`, and `desktop/src/main/services/provider-capability-probers/*.ts`
  - SDK/Client: provider-specific catalog normalizers in `desktop/src/main/services/provider-capability-probers/*.ts`
  - Auth: bearer tokens for OpenAI-compatible APIs and `x-api-key` for Anthropic in `desktop/src/main/services/model-client.ts`

**MCP Ecosystem:**
- Local stdio MCP servers - desktop launches and manages external MCP processes from `desktop/src/main/services/mcp-server-manager.ts`
  - SDK/Client: `McpClient` referenced by `desktop/src/main/services/mcp-server-manager.ts`
  - Auth: optional per-server process env and command args stored in `desktop/shared/contracts/mcp.ts`
- Remote MCP HTTP/SSE servers - desktop connects to networked MCP endpoints from `desktop/src/main/services/mcp-http-client.ts`
  - SDK/Client: `McpHttpClient` in `desktop/src/main/services/mcp-http-client.ts`
  - Auth: optional request headers stored per server in `desktop/shared/contracts/mcp.ts`
- External MCP config import - desktop discovers user-owned MCP definitions from local tool configs in `desktop/src/main/services/mcp-server-manager.ts`
  - SDK/Client: JSON config readers for `~/.claude/claude_desktop_config.json` and `~/.cursor/mcp.json`
  - Auth: inherited from imported server env/header definitions

**Enterprise Identity and Artifact Services:**
- Internal CAS or internal auth HTTP endpoint - cloud login delegates credential validation from `cloud/apps/cloud-api/src/modules/auth/providers/cas-internal-auth.provider.ts`
  - SDK/Client: native `fetch`
  - Auth: `CAS_VALIDATE_USER_URL`, `INTERNAL_AUTH_BASE_URL`, `INTERNAL_AUTH_VALIDATE_URL`, `INTERNAL_AUTH_VALIDATE_PATH`, `INTERNAL_AUTH_TIMEOUT_MS`, and `INTERNAL_AUTH_REQUIRED_ROLES`
- FastDFS artifact service - cloud package uploads and downloads run through `cloud/apps/cloud-api/src/modules/artifact/providers/fastdfs-artifact-storage.ts`
  - SDK/Client: native `fetch` plus `FormData`
  - Auth: `FASTDFS_BASE_URL`, `FASTDFS_PROJECT_CODE`, `FASTDFS_TOKEN`, `FASTDFS_UPLOAD_PATH`, `FASTDFS_DOWNLOAD_PATH`, and `FASTDFS_TIMEOUT_MS`

**General Web Access:**
- Arbitrary HTTP endpoints - desktop built-in `http.fetch` tool can request any URL via `desktop/src/main/services/builtin-tool-executor.ts`
  - SDK/Client: native `fetch`
  - Auth: caller-supplied URL only; no fixed env contract
- DuckDuckGo HTML search - desktop built-in `web.search` tool queries `https://html.duckduckgo.com/html/` from `desktop/src/main/services/builtin-tool-executor.ts`
  - SDK/Client: native `fetch`
  - Auth: none
- Browser automation targets - desktop Playwright tools open arbitrary web pages from `desktop/src/main/services/browser-service.ts`
  - SDK/Client: `playwright-core`
  - Auth: page-specific user/browser state only

## Data Storage

**Databases:**
- MySQL 8.0 - primary cloud relational store defined in `cloud/apps/cloud-api/prisma/schema.prisma`
  - Connection: `DATABASE_URL`
  - Client: Prisma via `cloud/apps/cloud-api/src/modules/database/services/database.service.ts`
- Local MySQL container scaffold - optional development database in `cloud/infra/docker-compose.yml`
  - Connection: the compose file stands up MySQL for local use; app code still reads `DATABASE_URL`
  - Client: Prisma via `cloud/apps/cloud-api/package.json`

**File Storage:**
- FastDFS - published skill and hub package artifacts are stored remotely through `cloud/apps/cloud-api/src/modules/artifact/providers/fastdfs-artifact-storage.ts`
- Local filesystem only - desktop persistent data, skills, sessions, and model profiles are stored under the derived data root from `desktop/src/main/services/directory-service.ts` and written by `desktop/src/main/services/state-persistence.ts`

**Caching:**
- None detected

## Authentication & Identity

**Auth Provider:**
- Custom session service backed by Prisma, with upstream enterprise validation or mock login in `cloud/apps/cloud-api/src/modules/auth/services/auth.service.ts` and `cloud/apps/cloud-api/src/modules/auth/auth.module.ts`
  - Implementation: cloud API issues opaque access and refresh tokens, stores only token hashes in MySQL, and chooses between `CasInternalAuthProvider` and `MockInternalAuthProvider`
- Desktop auth state - local session persistence in `desktop/src/renderer/stores/auth.ts`
  - Implementation: access and refresh tokens are stored in browser `localStorage` under `myclaw-desktop-auth-session`
- Cloud web auth state - browser/session cookie persistence in `cloud/apps/cloud-web/composables/useCloudSession.ts`
  - Implementation: access and refresh tokens are stored in the `myclaw-cloud-session` cookie and mirrored to `localStorage`

## Monitoring & Observability

**Error Tracking:**
- None detected

**Logs:**
- Desktop uses `console` and custom logger helpers in `desktop/src/main/services/logger.ts`
- Cloud API uses Nest `Logger` and `console` in files such as `cloud/apps/cloud-api/src/modules/artifact/providers/fastdfs-artifact-storage.ts`, `cloud/apps/cloud-api/src/modules/auth/providers/cas-internal-auth.provider.ts`, and `cloud/apps/cloud-api/src/main.ts`
- Cloud deployment expects PM2 process logs through `cloud/scripts/pack-deploy.sh`

## CI/CD & Deployment

**Hosting:**
- Desktop is packaged locally into native Electron installers by `electron-builder` in `desktop/package.json`
- Cloud services are self-hosted Node processes managed by PM2 through `cloud/scripts/pack-deploy.sh`

**CI Pipeline:**
- None detected

## Environment Configuration

**Required env vars:**
- Desktop runtime config: `APP_ENV`, `MYCLAW_CLOUD_API_URL`, `MYCLAW_DATA_ROOT`, `MYCLAW_RENDERER_DEV_URL`
- Cloud API runtime config: `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- Cloud API enterprise auth config: `CAS_VALIDATE_USER_URL`, `INTERNAL_AUTH_BASE_URL`, `INTERNAL_AUTH_VALIDATE_URL`, `INTERNAL_AUTH_VALIDATE_PATH`, `INTERNAL_AUTH_TIMEOUT_MS`, `INTERNAL_AUTH_MODE`, `INTERNAL_AUTH_REQUIRED_ROLES`
- Cloud API artifact config: `FASTDFS_BASE_URL`, `FASTDFS_PROJECT_CODE`, `FASTDFS_TOKEN`, `FASTDFS_UPLOAD_PATH`, `FASTDFS_DOWNLOAD_PATH`, `FASTDFS_TIMEOUT_MS`
- Cloud web runtime config surface: `CLOUD_API_BASE` in `cloud/apps/cloud-web/nuxt.config.ts`; deployment scripts also emit `NUXT_CLOUD_API_BASE`, plus `PORT` and `HOST`, in `cloud/scripts/pack-deploy.sh`

**Secrets location:**
- Cloud runtime secrets live in `cloud/apps/cloud-api/.env`; the app loads them through `cloud/apps/cloud-api/src/runtime/load-runtime-env.ts`
- Cloud deployment packaging writes runtime `.env` files into staged artifacts in `cloud/scripts/pack-deploy.sh`
- Desktop provider secrets are persisted locally inside model profile JSON files under the `modelsDir` path defined by `desktop/src/main/services/directory-service.ts` and written by `desktop/src/main/services/state-persistence.ts`

## Webhooks & Callbacks

**Incoming:**
- None detected; the cloud API exposes standard HTTP endpoints in `cloud/apps/cloud-api/src/modules/auth/controllers/auth.controller.ts`, `cloud/apps/cloud-api/src/modules/skills/controllers/skills.controller.ts`, `cloud/apps/cloud-api/src/modules/mcp/controllers/mcp.controller.ts`, `cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts`, `cloud/apps/cloud-api/src/modules/artifact/controllers/artifact.controller.ts`, and `cloud/apps/cloud-api/src/modules/install/controllers/install.controller.ts`

**Outgoing:**
- CAS/internal auth validation requests from `cloud/apps/cloud-api/src/modules/auth/providers/cas-internal-auth.provider.ts`
- FastDFS upload and download requests from `cloud/apps/cloud-api/src/modules/artifact/providers/fastdfs-artifact-storage.ts`
- Nuxt BFF proxy requests from `cloud/apps/cloud-web/server/lib/cloud-api.ts`
- Desktop Cloud API requests from `desktop/src/main/ipc/cloud.ts`
- Desktop model provider requests from `desktop/src/main/services/model-client.ts` and `desktop/src/main/ipc/models.ts`
- Remote MCP HTTP/SSE requests from `desktop/src/main/services/mcp-http-client.ts`
- Desktop generic web requests and DuckDuckGo search from `desktop/src/main/services/builtin-tool-executor.ts`

---

*Integration audit: 2026-04-04*

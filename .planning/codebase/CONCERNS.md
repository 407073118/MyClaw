# Codebase Concerns

**Analysis Date:** 2026-03-31

## Tech Debt

**Dual Desktop Implementations (Critical):**
- Issue: Two complete desktop apps exist side-by-side: `desktop/` (Tauri + Vue 3 + Pinia) and `desktop/` (Electron + React + Zustand). The original has ~49K lines of source across runtime and desktop apps with full functionality. The new one has ~16K lines but most IPC handlers are stubs returning empty arrays or throwing "not found" errors.
- Files: `desktop/` (entire directory), `desktop/` (entire directory)
- Impact: Maintaining two desktop apps doubles development effort. The shared contracts are duplicated: `desktop/packages/shared/src/contracts/` (1189 lines, includes tests) vs `desktop/shared/contracts/` (681 lines, no tests). Any contract change must be made in both places or they will drift. The desktop contracts are already missing test files that exist in the desktop shared package.
- Fix approach: Complete the desktop migration, then archive/remove `desktop/`. Until then, freeze the desktop shared contracts and treat `desktop/shared/contracts/` as the canonical copy for new work. Document which IPC handlers still need real implementations.

**desktop IPC Handlers Are Stubs:**
- Issue: Almost every IPC handler in the desktop main process is a stub. Sessions return synthetic "[stub]" messages, tools log to console and return fake results, MCP server CRUD does not persist, cloud hub endpoints return empty arrays.
- Files: `desktop/src/main/ipc/sessions.ts` (lines 86-116 - hardcoded stub reply), `desktop/src/main/ipc/tools.ts` (lines 37-43, 56-60), `desktop/src/main/ipc/mcp.ts` (lines 26-43, 55-61, 72-74, 85-88), `desktop/src/main/ipc/cloud.ts` (lines 62-91 - all return empty/throw)
- Impact: The desktop is not functional beyond UI scaffolding. Users cannot chat, execute tools, manage MCP servers, or interact with the cloud hub. The in-memory state in `desktop/src/main/index.ts` (lines 76-112) has no persistence -- all data is lost on restart.
- Fix approach: Port the runtime services from `desktop/apps/runtime/src/services/` into the desktop main process or connect desktop to the existing runtime server. Priority order: (1) model provider + chat, (2) state persistence via sql.js, (3) builtin tool execution, (4) MCP server management, (5) cloud hub integration.

**Deprecated `pkg` Dependency:**
- Issue: The desktop runtime uses `pkg` v5.8.1 for building the sidecar binary. `pkg` has been deprecated by Vercel in favor of Node.js SEA (Single Executable Applications) since Node 20.
- Files: `desktop/apps/runtime/package.json` (line 22), build script at line 11 (`build:sidecar:win`)
- Impact: `pkg` targets Node 18 (`--targets node18-win-x64`) which is approaching end-of-life. Future Node.js updates will not be supported. The binary packaging approach may break with newer native modules.
- Fix approach: Migrate to Node.js SEA or use `@vercel/ncc` + a custom entry point. The desktop (Electron) bundles Node.js natively, making `pkg` unnecessary for the new architecture.

**`nothing/` Directory:**
- Issue: An empty directory `nothing/` exists in the repository root with no apparent purpose.
- Files: `nothing/`
- Impact: Confusing to developers; accumulates accidental files.
- Fix approach: Remove the directory or add a README explaining its purpose.

## Known Bugs

**desktop Cloud IPC Uses Wrong Logout Parameter:**
- Symptoms: The preload API sends `accessToken` to logout (`cloud:auth-logout`), but the IPC handler in `desktop/src/main/ipc/cloud.ts` (line 112) receives it as `accessToken` and sends it as a Bearer header. However, the cloud API's `AuthService.logout()` at `cloud/apps/cloud-api/src/modules/auth/auth.service.ts` (line 111) expects a `refreshToken`, not an access token.
- Files: `desktop/src/preload/index.ts` (line 131), `desktop/src/main/ipc/cloud.ts` (lines 110-123)
- Trigger: User clicks logout in the desktop -- the server-side session will NOT be revoked because the wrong token type is sent.
- Workaround: The desktop (Tauri) version in `desktop/src/renderer/stores/auth.ts` line 294 correctly sends `session.refreshToken` to the logout call, but the preload bridge signature is incorrect.

## Security Considerations

**Auth Tokens Stored in localStorage (Renderer Process):**
- Risk: Both desktop implementations store auth sessions (including access and refresh tokens) in `localStorage`. In an Electron app with `sandbox: false` (as set in `desktop/src/main/index.ts` line 38), this means any XSS vulnerability in the renderer could exfiltrate auth tokens. The refresh token has a 180-day lifetime (`cloud/apps/cloud-api/src/modules/auth/auth.service.ts` line 22).
- Files: `desktop/src/renderer/stores/auth.ts` (lines 130, 143, 187), `desktop/src/main/index.ts` (line 38)
- Current mitigation: `contextIsolation: true` and `nodeIntegration: false` are set correctly. External links open in system browser.
- Recommendations: Store tokens in the main process using Electron's `safeStorage` API or the OS keychain. Keep `sandbox: false` only if strictly necessary. Consider encrypting persisted tokens at rest.

**Cloud API Has No Auth Guards on Endpoints:**
- Risk: The cloud API controllers (`SkillsController`, hub controllers) have no `@UseGuards()` decorators. Any client can create, update, or publish skills without authentication. The `POST /api/skills` and `POST /api/skills/:id/releases` endpoints accept file uploads with no authentication check.
- Files: `cloud/apps/cloud-api/src/modules/skills/skills.controller.ts` (entire file -- no auth decorators), `cloud/apps/cloud-api/src/main.ts` (no global guards configured)
- Current mitigation: None detected. No `@UseGuards`, no global middleware, no helmet, no CORS configuration, no rate limiting, no CSRF protection.
- Recommendations: Add a global auth guard that validates Bearer tokens via `AuthService.introspect()`. Add rate limiting to login and file upload endpoints. Enable CORS with an explicit allowlist. Add helmet for HTTP security headers. Validate file upload size limits.

**No File Upload Size Limits:**
- Risk: The skill release publish endpoint (`POST /api/skills/:id/releases`) accepts ZIP file uploads via `FileInterceptor("file")` with no size limit configured. An attacker could upload arbitrarily large files to exhaust disk/memory.
- Files: `cloud/apps/cloud-api/src/modules/skills/skills.controller.ts` (lines 84-85)
- Current mitigation: The `.zip` extension is validated, but no size check exists.
- Recommendations: Add `@UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_SIZE } }))` with a reasonable limit (e.g., 50MB).

**`allowOutOfWorkspace` Bypasses Path Sandboxing:**
- Risk: The runtime's `DirectoryService` enforces workspace-root confinement for file operations. However, when a path traversal error occurs, the system automatically creates an approval request with `allowOutOfWorkspace: true` in the arguments. Once approved, the tool re-executes with `unrestricted=true`, which completely bypasses all path checks via `resolveUnrestricted()`.
- Files: `desktop/apps/runtime/src/server/create-runtime-app.ts` (line 1946), `desktop/apps/runtime/src/services/directory-service.ts` (lines 29-44), `desktop/apps/runtime/src/services/builtin-tool-executor.ts` (line 140)
- Current mitigation: Requires explicit user approval before unrestricted access. The approval system categorizes this as `ToolRiskCategory.Exec`.
- Recommendations: Even with approval, restrict unrestricted access to read-only operations. Write/delete operations outside the workspace should require a separate, higher-level confirmation.

**API Key Passed in Request Bodies:**
- Risk: Model API keys are stored in `ModelProfile.apiKey` and sent to external LLM providers. The key is transmitted as a Bearer token in request headers, which is standard. However, the workspace store exposes `apiKey` fields to the renderer process through IPC, and the "test model" flow sends the full profile (including API key) to the runtime server via HTTP.
- Files: `desktop/apps/desktop/src/stores/workspace.ts` (line 524), `desktop/apps/runtime/src/services/model-provider/openai-compatible/client.ts` (line 24), `desktop/apps/desktop/src/services/runtime-client.ts` (line 744)
- Current mitigation: The runtime server is local (localhost). API keys are stored in the sql.js database on disk.
- Recommendations: Ensure the local runtime HTTP server only binds to `127.0.0.1`. Consider encrypting API keys at rest in the sqlite database.

## Performance Bottlenecks

**3,472-line `create-runtime-app.ts` God Function:**
- Problem: The entire runtime HTTP server, all route handlers, state management, session logic, tool execution orchestration, workflow execution, and cloud proxy are defined in a single 3,472-line file.
- Files: `desktop/apps/runtime/src/server/create-runtime-app.ts`
- Cause: All mutable state (sessions, models, approvals, workflows) is captured as closures within a single function scope, making extraction difficult.
- Improvement path: Extract route handlers into separate modules. Pass shared state through a context object (similar to how `desktop/src/main/services/runtime-context.ts` already does it). This is partially what the desktop migration accomplishes by splitting into `desktop/src/main/ipc/*.ts` files.

**Custom Glob Implementation in DirectoryService:**
- Problem: `DirectoryService.findFiles()` implements a custom recursive directory walker with manual glob matching (180+ lines). It walks the entire directory tree for every search.
- Files: `desktop/apps/runtime/src/services/directory-service.ts` (lines 132-197)
- Cause: Avoids external dependency for glob matching in the bundled sidecar.
- Improvement path: Use a lightweight glob library like `picomatch` for pattern matching. Consider caching directory listings for repeated searches within the same session.

**In-Memory State in desktop Has No Persistence:**
- Problem: The desktop stores all runtime state (sessions, models, approval requests, workflows) in plain JavaScript arrays in the main process. Everything is lost on app restart.
- Files: `desktop/src/main/index.ts` (lines 76-79)
- Cause: Stub implementation -- persistence was deferred.
- Improvement path: Port the sql.js-based `RuntimeStateStore` from `desktop/apps/runtime/src/store/runtime-state-store.ts` into the desktop main process. The dependency `sql.js` is already declared in `desktop/package.json`.

## Fragile Areas

**Shared Contract Duplication:**
- Files: `desktop/packages/shared/src/contracts/*.ts`, `desktop/shared/contracts/*.ts`
- Why fragile: The two contract sets are copies of each other but not linked. Changes to types in one location (e.g., adding a field to `ChatSession`) will cause type mismatches if the other copy is not updated. The cloud shared package at `cloud/packages/shared/src/contracts/` is a third independent copy for cloud-specific types.
- Safe modification: When changing contracts, update ALL copies: desktop shared, desktop shared, and (if applicable) cloud shared. Run `pnpm test` in both `desktop/` and `desktop/` workspaces.
- Test coverage: Desktop contracts have 427-line test file + 92-line MCP usage test. NewApp contracts have zero tests.

**desktop Preload API Surface:**
- Files: `desktop/src/preload/index.ts`
- Why fragile: The preload bridge exposes 30+ IPC methods to the renderer. The `MyClawAPI` type is derived from the `myClawAPI` constant using `typeof`, which means any rename or signature change in the preload breaks the renderer silently at runtime (TypeScript only catches issues if imports are correctly wired).
- Safe modification: Always verify the renderer TypeScript compiles after preload changes. The `window.myClawAPI` declaration at `desktop/src/renderer/types/electron.d.ts` must match.
- Test coverage: No tests exist for IPC handler registration or preload API coverage.

## Scaling Limits

**Cloud API Single-Instance Design:**
- Current capacity: Single NestJS process on port 43210 with no clustering.
- Limit: The API stores no horizontal scaling primitives. Session tokens are stored in PostgreSQL which scales, but artifact storage goes through a single FastDFS upload path.
- Scaling path: Add a load balancer. Session management already uses database-backed token hashing, so multiple API instances can share sessions. Artifact uploads may need a queue or direct-to-storage upload (presigned URLs).

## Dependencies at Risk

**`pkg` (v5.8.1):**
- Risk: Deprecated by Vercel. No longer maintained. Targets Node 18 which is nearing EOL.
- Impact: Cannot upgrade Node.js runtime for the desktop sidecar binary.
- Migration plan: Switch to Node.js Single Executable Applications (SEA) or eliminate the sidecar entirely (the desktop/Electron migration embeds Node.js).

**`@types/marked` (v6.0.0):**
- Risk: Since `marked` v5+, types are bundled with the package. The separate `@types/marked` package is outdated and may conflict.
- Impact: Type conflicts or incorrect type definitions for the markdown renderer.
- Migration plan: Remove `@types/marked` from `desktop/apps/desktop/package.json` (line 17) and rely on built-in types from `marked` v17.

## Missing Critical Features

**desktop Has No Model Provider Integration:**
- Problem: The desktop cannot send messages to any LLM. The session handler returns a hardcoded stub string `"[stub] 模型服务尚未连接。"` for every message.
- Files: `desktop/src/main/ipc/sessions.ts` (line 89)
- Blocks: All AI-powered features -- chat, tool execution, workflow runs, employee execution.

**desktop Has No State Persistence:**
- Problem: No data survives an app restart. Models, sessions, MCP configs, and workflows are all lost.
- Files: `desktop/src/main/index.ts` (lines 76-79 -- plain arrays)
- Blocks: Production use of the desktop.

**Cloud API Has No Authorization Layer:**
- Problem: No endpoint requires authentication. Anyone with network access can create skills, upload artifacts, and manage hub items.
- Files: `cloud/apps/cloud-api/src/main.ts`, all controller files under `cloud/apps/cloud-api/src/modules/`
- Blocks: Safe deployment to any network accessible by untrusted clients.

## Test Coverage Gaps

**desktop Has Zero Tests:**
- What's not tested: The entire desktop codebase -- 48 source files across main process, preload, renderer pages, components, stores, and hooks.
- Files: `desktop/src/` (all files)
- Risk: Any refactoring or feature addition could introduce regressions undetected. The IPC handler stubs cannot be verified against the real runtime behavior.
- Priority: High -- at minimum, test the auth store (`desktop/src/renderer/stores/auth.ts`) and workspace store, as these manage critical application state.

**Cloud API Controller Input Validation Not Fully Tested:**
- What's not tested: The `SkillsController` has manual validation (`assertCreateSkillBody`, `assertReleaseBody`) but no integration tests that verify HTTP-level request/response behavior with invalid inputs.
- Files: `cloud/apps/cloud-api/src/modules/skills/skills.controller.ts` (lines 104-150)
- Risk: Malformed requests could bypass validation or return unexpected error formats.
- Priority: Medium

**desktop Shared Contracts Have No Tests:**
- What's not tested: Type contracts, factory functions, and default value creators in `desktop/shared/contracts/`.
- Files: `desktop/shared/contracts/*.ts` (all 13 files)
- Risk: Type drift from the desktop contracts goes unnoticed. The desktop version has `contracts.test.ts` (427 lines) and `mcp-contracts-usage.test.ts` (92 lines) that catch structural issues.
- Priority: Medium -- copy and adapt the test files from `desktop/packages/shared/src/contracts/`.

---

*Concerns audit: 2026-03-31*

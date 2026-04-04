# Codebase Concerns

**Analysis Date:** 2026-04-04

## Tech Debt

**Desktop runtime surfaces unfinished workflow and publish flows as if they are complete:**
- Issue: `workflow:list-runs`, `workflow:start-run`, `workflow:resume-run`, and `publish:create-draft` are exposed through Electron IPC and renderer pages, but the main-process handlers are still stub implementations.
- Files: `desktop/src/main/ipc/workflows.ts`, `desktop/src/main/ipc/cloud.ts`, `desktop/src/preload/index.ts`, `desktop/src/renderer/components/workflow/WorkflowRunPanel.tsx`, `desktop/src/renderer/pages/PublishDraftPage.tsx`
- Impact: Users can trigger UI paths that never execute real runtime work, never persist run history, and can return placeholder payloads that drift from renderer expectations.
- Fix approach: Replace stubs with persisted runtime-backed implementations, or hide/disable these UI paths until the backend contract is real.

**Desktop state and page logic are concentrated in very large files:**
- Issue: Several renderer and main-process files exceed 800 to 1300 lines and combine transport, state, validation, and UI rendering in one module.
- Files: `desktop/src/renderer/pages/ChatPage.tsx`, `desktop/src/renderer/pages/McpDetailPage.tsx`, `desktop/src/renderer/pages/WorkflowStudioPage.tsx`, `desktop/src/renderer/components/workflow/WorkflowCanvas.tsx`, `desktop/src/renderer/stores/workspace.ts`, `desktop/src/main/ipc/sessions.ts`, `desktop/src/main/services/builtin-tool-executor.ts`, `desktop/src/main/services/browser-service.ts`
- Impact: Small edits have high regression risk, targeted testing is difficult, and ownership boundaries are unclear.
- Fix approach: Split by responsibility first: extract transport adapters, derived selectors, and leaf UI components before changing behavior.

**Cloud build and release paths diverge from source truth:**
- Issue: normal workspace `build` only type-checks the API, while deploy packaging depends on a separate bundling script and a committed generated bundle.
- Files: `cloud/package.json`, `cloud/apps/cloud-api/package.json`, `cloud/apps/cloud-api/scripts/bundle.mjs`, `cloud/apps/cloud-api/bundle/main.js`
- Impact: CI can pass while the shipped artifact is stale or missing modules, and source/build drift becomes hard to detect in review.
- Fix approach: Make release artifacts reproducible from source in CI, stop committing generated bundle output, and verify the packaged runtime instead of only `tsc --noEmit`.

**Dependency management is inconsistent in `desktop/`:**
- Issue: the workspace is driven by pnpm, but `desktop/package-lock.json` is also committed.
- Files: `desktop/package.json`, `desktop/pnpm-workspace.yaml`, `desktop/package-lock.json`
- Impact: lock drift can produce non-reproducible installs and ambiguous dependency updates.
- Fix approach: keep a single package manager lock source and remove the unused lockfile from the workflow.

## Known Bugs

**Hub API is implemented but not mounted in the running cloud app:**
- Symptoms: `/api/hub/*` endpoints are documented and consumed by both desktop and web, but the Nest app does not import the Hub module.
- Files: `cloud/apps/cloud-api/src/app.module.ts`, `cloud/apps/cloud-api/src/modules/hub/hub.module.ts`, `cloud/apps/cloud-web/pages/hub.vue`, `desktop/src/main/ipc/cloud.ts`
- Trigger: any request to hub list/detail/manifest/download-token on a running API instance.
- Workaround: none in source; the fix is to import `HubModule` into `AppModule`.

**Hub code is also excluded from the deployable API bundle:**
- Symptoms: even after source-level fixes, the production bundle path still omits the hub module from compilation.
- Files: `cloud/apps/cloud-api/tsconfig.build.json`, `cloud/apps/cloud-api/src/modules/hub/**`, `cloud/apps/cloud-api/scripts/bundle.mjs`
- Trigger: `node scripts/bundle.mjs` followed by deployment packaging.
- Workaround: remove the hub exclusion and rebuild the bundle before packaging.

**Desktop cloud skill import uses the wrong download route:**
- Symptoms: skill import downloads from `${CLOUD_API_BASE}/artifacts/download/:releaseId`, while the server route is `/api/artifacts/download/:releaseId`.
- Files: `desktop/src/main/ipc/cloud.ts`, `cloud/apps/cloud-api/src/modules/artifact/controllers/artifact.controller.ts`
- Trigger: installing a cloud skill from desktop Hub.
- Workaround: use the download token endpoint or prepend `/api` in the desktop download URL.

**Hub manifest endpoint returns the wrong contract for employee/workflow packages:**
- Symptoms: `HubController.manifest()` delegates to `ArtifactService.getManifest()`, but that service only queries `mcpServerRelease` and otherwise returns a fallback MCP manifest.
- Files: `cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts`, `cloud/apps/cloud-api/src/modules/artifact/services/artifact.service.ts`, `desktop/src/renderer/stores/workspace.ts`, `desktop/src/renderer/pages/HubPage.tsx`
- Trigger: opening/importing an employee package or workflow package via Hub manifest flow.
- Workaround: none in source; manifest resolution needs package-type-specific lookup instead of the MCP fallback.

**Publish draft UI expects fields the IPC stub never returns:**
- Symptoms: the renderer reads `draft.filePath` and `draft.manifest.version`, but the stub payload only returns `id`, `status`, timestamps, and echoed input.
- Files: `desktop/src/main/ipc/cloud.ts`, `desktop/src/preload/index.ts`, `desktop/src/renderer/pages/PublishDraftPage.tsx`
- Trigger: creating a publish draft from the desktop page.
- Workaround: none in source; either return the real draft shape or gate the page behind feature completion.

## Security Considerations

**Cloud artifact storage has hardcoded credential fallbacks and deployment-time default secrets:**
- Risk: if operators forget to override env vars, the API can run with built-in FastDFS credentials and generated deployment secrets.
- Files: `cloud/apps/cloud-api/src/modules/artifact/providers/fastdfs-artifact-storage.ts`, `cloud/scripts/pack-deploy.sh`
- Current mitigation: `FASTDFS_BASE_URL` is required before runtime access starts.
- Recommendations: remove credential fallbacks from source, generate templates without live-looking defaults, and fail closed on missing secrets.

**Cloud session tokens are kept in browser-readable cookie and localStorage state:**
- Risk: both access token and refresh token are serialized into a client-readable cookie and mirrored into `localStorage`, increasing XSS blast radius.
- Files: `cloud/apps/cloud-web/composables/useCloudSession.ts`, `cloud/apps/cloud-web/server/lib/cloud-api.ts`
- Current mitigation: `sameSite: "lax"` on the cookie.
- Recommendations: move tokens to `httpOnly` server-managed session storage and keep only non-sensitive session metadata in client state.

## Performance Bottlenecks

**Workflow editor updates operate on large in-memory objects and broad store writes:**
- Problem: workflow edits clone and rewrite whole definitions and update a wide global Zustand store, while the editor/view stack is split across several 800+ line components.
- Files: `desktop/src/renderer/pages/WorkflowStudioPage.tsx`, `desktop/src/renderer/components/workflow/WorkflowCanvas.tsx`, `desktop/src/renderer/components/workflow/WorkflowNodeEditor.tsx`, `desktop/src/renderer/stores/workspace.ts`
- Cause: graph editing, selection state, inspector state, and persistence all live close to one another with coarse-grained state updates.
- Improvement path: isolate editor-local state from workspace-global state, normalize graph data, and move persistence into narrower actions.

**Session orchestration centralizes too much work in the Electron main process:**
- Problem: the chat/session loop, tool orchestration, approval handling, and renderer broadcasting all run inside a single large main-process module.
- Files: `desktop/src/main/ipc/sessions.ts`, `desktop/src/main/index.ts`
- Cause: one module constructs prompts, executes tools, tracks loops, and pushes events to every renderer.
- Improvement path: split prompt assembly, execution scheduling, and event broadcasting into separate services and add per-session instrumentation.

## Fragile Areas

**Preload swallows IPC failures into null or empty objects that the renderer then trusts:**
- Files: `desktop/src/preload/index.ts`, `desktop/src/renderer/stores/workspace.ts`, `desktop/src/renderer/components/workflow/WorkflowRunPanel.tsx`, `desktop/src/renderer/pages/PublishDraftPage.tsx`
- Why fragile: a transport failure can silently become `{ run: null }`, `{ items: [] }`, or `null`, after which renderer code dereferences assumed fields or reports misleading empty-state UX instead of a real error.
- Safe modification: remove blanket `.catch(() => ...)` fallbacks on contract-bearing methods and let the store surface explicit failures.
- Test coverage: `desktop/tests/workflow-ipc.test.ts` only covers normalization, not end-to-end failure propagation.

**Browser automation relies on host-installed browsers and broad catch-and-continue behavior:**
- Files: `desktop/src/main/services/browser-service.ts`, `desktop/tests/browser-service.test.ts`
- Why fragile: startup depends on Chrome/Edge/Chromium being present on the host, while many branches recover by continuing after failures; the existing test file does not exercise `BrowserService` behavior.
- Safe modification: add behavior tests around launch/channel detection/recovery before changing startup or selector logic.
- Test coverage: missing for real browser-service lifecycle paths.

**Cloud deploy output can drift from reviewed source:**
- Files: `cloud/apps/cloud-api/bundle/main.js`, `cloud/apps/cloud-api/scripts/bundle.mjs`, `cloud/scripts/pack-deploy.sh`
- Why fragile: generated runtime output is committed and packaged separately from normal workspace build, so reviewers can approve source while deployment still uses stale compiled code.
- Safe modification: treat bundle output as generated-only, rebuild it in CI, and verify the packaged artifact before release.
- Test coverage: `cloud/tests/cloud-api-runtime-format.test.mjs` validates module format only, not runtime route availability in the packaged app.

## Scaling Limits

**Desktop agent execution is effectively single-runtime and single-browser per app instance:**
- Current capacity: one shared `BuiltinToolExecutor`, one shared browser lifecycle, and one Electron main process coordinating all sessions.
- Limit: concurrent long-running sessions or multiple browser-heavy tasks contend for the same main-process resources and a single browser instance.
- Scaling path: move execution scheduling into isolated workers/processes and scope browser instances per task or per session.
- Files: `desktop/src/main/ipc/sessions.ts`, `desktop/src/main/services/browser-service.ts`

## Dependencies at Risk

**`playwright-core` depends on externally installed browsers rather than managed runtime binaries:**
- Risk: feature success depends on host machine browser installation and channel naming, which varies across Windows/macOS/Linux.
- Impact: browser tools can fail on fresh machines even when dependencies install correctly.
- Migration plan: either provision browser binaries explicitly in setup or add a first-run dependency check with guided remediation.
- Files: `desktop/package.json`, `desktop/src/main/services/browser-service.ts`

## Missing Critical Features

**Workflow execution is missing behind a visible desktop debugger UI:**
- Problem: users can open run history and start/resume actions, but there is no real runtime-backed workflow execution path in the current desktop code.
- Blocks: reliable debugging, persisted run history, and any confidence that workflow authoring corresponds to executable behavior.
- Files: `desktop/src/main/ipc/workflows.ts`, `desktop/src/renderer/components/workflow/WorkflowRunPanel.tsx`

**Cloud publish-draft flow is only a placeholder:**
- Problem: the desktop publish draft flow returns fake local data instead of a durable artifact or cloud-backed draft contract.
- Blocks: real review/upload workflow for employee or workflow packages.
- Files: `desktop/src/main/ipc/cloud.ts`, `desktop/src/renderer/pages/PublishDraftPage.tsx`

## Test Coverage Gaps

**Cloud web tests are mostly static existence/string assertions:**
- What's not tested: route handlers under `cloud/apps/cloud-web/server/api/**`, auth forwarding behavior, manifest/download flows, and page interaction logic.
- Files: `cloud/apps/cloud-web/tests/pages.test.mjs`, `cloud/tests/workspace.test.mjs`, `cloud/apps/cloud-web/server/api/**`
- Risk: broken proxies, wrong routes, and auth regressions can ship while tests still pass.
- Priority: High

**Cloud API lacks application-assembly and packaged-runtime tests:**
- What's not tested: Nest boot with real module imports, Hub route registration, and behavior of the bundled runtime artifact.
- Files: `cloud/apps/cloud-api/src/app.module.ts`, `cloud/apps/cloud-api/tsconfig.build.json`, `cloud/apps/cloud-api/scripts/bundle.mjs`
- Risk: missing modules and bundle exclusions are not caught before release.
- Priority: High

**Desktop workflow and publish flows lack behavioral tests for the user-visible failure paths:**
- What's not tested: stubbed workflow run IPC, publish draft renderer contract, preload fallback behavior, and end-to-end cloud import paths.
- Files: `desktop/tests/workflow-ipc.test.ts`, `desktop/src/preload/index.ts`, `desktop/src/main/ipc/workflows.ts`, `desktop/src/main/ipc/cloud.ts`, `desktop/src/renderer/pages/PublishDraftPage.tsx`
- Risk: broken or placeholder flows remain user-visible without automated detection.
- Priority: High

**Desktop browser-service test name does not match actual coverage:**
- What's not tested: channel detection, browser launch, idle shutdown, disconnect recovery, and selector resolution inside `BrowserService`.
- Files: `desktop/tests/browser-service.test.ts`, `desktop/src/main/services/browser-service.ts`
- Risk: cross-platform browser regressions can slip through while a misleadingly named test suite still passes.
- Priority: Medium

---

*Concerns audit: 2026-04-04*

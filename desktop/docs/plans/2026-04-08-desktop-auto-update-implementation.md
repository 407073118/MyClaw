# Desktop Auto Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a safe desktop update flow that lets MyClaw check for new releases from a public GitHub release repository, download the installer, and let users restart to install without overwriting their existing data directory.

**Architecture:** Keep source code in the private main repository, but treat a separate public GitHub release repository as the updater feed. Add a main-process updater service that wraps `electron-updater`, expose it through IPC/preload/bootstrap, and render a dedicated update section in Settings with a manual download fallback.

**Tech Stack:** Electron 33, React 18, Zustand, Vitest, electron-builder NSIS, electron-updater

---

### Task 1: Document the release-repo contract

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/scripts/set-env.js`
- Create: `desktop/src/main/services/update-config.ts`
- Test: `desktop/tests/platform-config.test.ts`

**Step 1: Write the failing test**

Add a test that loads the updater config helper and asserts it accepts:
- `MYCLAW_UPDATE_PROVIDER=github`
- `MYCLAW_UPDATE_OWNER`
- `MYCLAW_UPDATE_REPO`
- optional `MYCLAW_UPDATE_CHANNEL`
- optional `MYCLAW_UPDATE_RELEASE_NOTES_URL`

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/platform-config.test.ts`
Expected: FAIL because `update-config.ts` and the new config reader do not exist yet.

**Step 3: Write minimal implementation**

Create `src/main/services/update-config.ts` that:
- parses updater env vars
- returns `{ enabled, provider, owner, repo, channel, releaseNotesUrl }`
- disables auto update cleanly when required values are missing

Update `scripts/set-env.js` only if build-time resolved env output is needed by renderer-facing copy.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/platform-config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add desktop/package.json desktop/scripts/set-env.js desktop/src/main/services/update-config.ts desktop/tests/platform-config.test.ts
git commit -m "feat: add desktop updater feed configuration"
```

### Task 2: Add a main-process updater service

**Files:**
- Create: `desktop/src/main/services/app-updater.ts`
- Modify: `desktop/src/main/services/runtime-context.ts`
- Modify: `desktop/src/main/index.ts`
- Test: `desktop/tests/app-updater-service.test.ts`

**Step 1: Write the failing test**

Add service tests that cover:
- disabled mode when updater config is incomplete
- initial idle state when config is valid
- `checkForUpdates` transitions to checking
- download progress snapshots are published
- `quitAndInstall` is blocked until update is downloaded

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/app-updater-service.test.ts`
Expected: FAIL because `app-updater.ts` does not exist.

**Step 3: Write minimal implementation**

Create `app-updater.ts` with:
- a small state machine
- injected adapter around `electron-updater`
- state snapshot getter
- `checkForUpdates()`
- `quitAndInstall()`
- safe fallback logging in Chinese

Wire the service into `index.ts` and store it on `RuntimeContext.services`.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/app-updater-service.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/services/app-updater.ts desktop/src/main/services/runtime-context.ts desktop/src/main/index.ts desktop/tests/app-updater-service.test.ts
git commit -m "feat: add desktop updater service"
```

### Task 3: Expose updater state through IPC, preload, and bootstrap

**Files:**
- Create: `desktop/src/main/ipc/update.ts`
- Modify: `desktop/src/main/ipc/index.ts`
- Modify: `desktop/src/main/ipc/bootstrap.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Test: `desktop/tests/update-ipc.test.ts`

**Step 1: Write the failing test**

Add IPC tests that verify:
- bootstrap returns the initial updater snapshot
- `update:check` calls the updater service
- `update:quit-and-install` forwards only when ready
- renderer event subscribers receive pushed updater snapshots

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/update-ipc.test.ts`
Expected: FAIL because update IPC handlers do not exist.

**Step 3: Write minimal implementation**

Expose:
- `app:bootstrap` -> `updates`
- `update:get-state`
- `update:check`
- `update:quit-and-install`
- `update:open-download-page`
- `update:state-changed` event stream

Mirror the same surface in preload and `window.myClawAPI`.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/update-ipc.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/ipc/update.ts desktop/src/main/ipc/index.ts desktop/src/main/ipc/bootstrap.ts desktop/src/preload/index.ts desktop/src/renderer/types/electron.d.ts desktop/tests/update-ipc.test.ts
git commit -m "feat: expose desktop updater IPC"
```

### Task 4: Show updater state in the Settings page

**Files:**
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Modify: `desktop/src/renderer/pages/SettingsPage.tsx`
- Test: `desktop/tests/settings-page-update.test.tsx`

**Step 1: Write the failing test**

Add a jsdom test that verifies:
- Settings renders an update card with current version
- clicking `检查更新` calls the store action
- downloading state shows percentage
- downloaded state shows `重启并安装`
- fallback button opens the download page action

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/settings-page-update.test.tsx`
Expected: FAIL because update state/actions are not in the store or page yet.

**Step 3: Write minimal implementation**

Extend the workspace store with:
- `appUpdate`
- `loadBootstrap()` hydration
- `checkForAppUpdates()`
- `quitAndInstallAppUpdate()`
- `openAppUpdateDownloadPage()`
- event subscription hookup

Render a dedicated update section in `SettingsPage.tsx` with:
- current app version
- release repo target summary
- status copy
- primary action button
- manual download fallback

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/settings-page-update.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/renderer/stores/workspace.ts desktop/src/renderer/pages/SettingsPage.tsx desktop/tests/settings-page-update.test.tsx
git commit -m "feat: add settings-based desktop updates"
```

### Task 5: Verify packaging and regression safety

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/tests/platform-config.test.ts`
- Test: `desktop/tests/workflow-ipc.test.ts`
- Test: `desktop/tests/settings-page-update.test.tsx`

**Step 1: Write the failing test**

Add or extend packaging tests to assert:
- `electron-updater` is present in dependencies
- NSIS target remains enabled
- installer data-directory behavior remains untouched

**Step 2: Run tests to verify they fail if assumptions are wrong**

Run: `pnpm vitest run tests/platform-config.test.ts tests/workflow-ipc.test.ts tests/settings-page-update.test.tsx`
Expected: Any missing config or bootstrap regressions fail.

**Step 3: Write minimal implementation**

Install `electron-updater` and keep existing NSIS installer/data-dir behavior unchanged.

**Step 4: Run targeted verification**

Run: `pnpm vitest run tests/app-updater-service.test.ts tests/update-ipc.test.ts tests/settings-page-update.test.tsx tests/platform-config.test.ts tests/workflow-ipc.test.ts`
Expected: PASS

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm test`
Expected: PASS or report exact unrelated failures.

Run garble gate:

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern desktop/src desktop/tests desktop/docs *.md
```

Expected: No new garble introduced in edited files.

**Step 5: Commit**

```bash
git add desktop/package.json desktop/pnpm-lock.yaml desktop/tests/platform-config.test.ts
git commit -m "chore: verify desktop updater packaging"
```

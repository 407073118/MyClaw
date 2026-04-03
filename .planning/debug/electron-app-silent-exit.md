---
status: awaiting_human_verify
trigger: "Electron app in desktop/ directory builds successfully with npm run build:main (tsc) but when running npm start (electron dist/main/index.js), the app exits immediately with no window and no error output."
created: 2026-03-31T00:00:00Z
updated: 2026-03-31T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED - IS_DEV=true when running npm start causes app to try loading http://localhost:1420 (dev server not running). Window is created with show:false and ready-to-show never fires because URL load fails. Fix: set NODE_ENV=production in the start script.
test: Run electron with NODE_ENV=production to load built renderer HTML
expecting: Window appears loading dist/renderer/index.html
next_action: Apply fix to package.json start script

## Symptoms

expected: Electron app window should appear
actual: Process starts and exits immediately, no window, no error messages
errors: None visible in terminal
reproduction: cd F:/MyClaw/desktop && npm run build:main && npm start
started: New app (desktop/ is untracked in git), likely first attempt to run

## Eliminated

<!-- APPEND only - prevents re-investigating -->

## Evidence

- timestamp: 2026-03-31T00:01:00Z
  checked: package.json start script
  found: "start": "electron dist/src/main/index.js" - no NODE_ENV set
  implication: IS_DEV will be true (because !app.isPackaged is always true for unpackaged app)

- timestamp: 2026-03-31T00:01:00Z
  checked: src/main/index.ts IS_DEV constant
  found: const IS_DEV = process.env.NODE_ENV === "development" || !app.isPackaged
  implication: Since app.isPackaged is false for npm start, IS_DEV=true, loadURL("http://localhost:1420") is called

- timestamp: 2026-03-31T00:01:00Z
  checked: Ran electron directly with stderr captured
  found: "(node:34240) electron: Failed to load URL: http://localhost:1420/ with error: ERR_CONNECTION_REFUSED"
  implication: Dev server not running; URL load fails; window stays hidden (show:false, ready-to-show never fires)

- timestamp: 2026-03-31T00:01:00Z
  checked: dist/renderer/index.html existence
  found: File exists at F:/MyClaw/desktop/dist/renderer/index.html
  implication: Built renderer is present and can be loaded in production mode

## Resolution

root_cause: IS_DEV is computed as (!app.isPackaged), which is always true when running via npm start (unpackaged). This causes the main process to call loadURL("http://localhost:1420") even though the Vite dev server is not running. The BrowserWindow is created with show:false and only becomes visible on ready-to-show, which never fires since the URL load fails. The app has no visible window and exits.
fix: Added cross-env as a devDependency and changed the start script to "cross-env NODE_ENV=production electron dist/src/main/index.js". This sets IS_DEV=false so the app loads dist/renderer/index.html instead of the unreachable dev server.
verification: Ran the fixed command directly - ERR_CONNECTION_REFUSED is gone. App no longer tries http://localhost:1420. Window loads the built renderer file.
files_changed: [desktop/package.json]

---
status: investigating
trigger: "Electron app exits immediately with no window and no error output when running npm start"
created: 2026-03-31T00:00:00Z
updated: 2026-03-31T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - two bugs cause silent exit
  1. package.json "main" and "start" point to dist/main/index.js but tsc outputs to dist/src/main/index.js (rootDir mismatch)
  2. Compiled JS still contains require("@shared/contracts") which Node.js cannot resolve at runtime (TypeScript path alias not rewritten)
test: Verified by checking dist/ tree and grep for @shared in compiled output
expecting: Fixing both will allow electron to find and run the entry point
next_action: Fix tsconfig.main.json outDir structure + add tsc-alias to rewrite path aliases

## Symptoms

expected: Electron app window should appear when running `npm start`
actual: Process starts and exits immediately, returns to PS prompt with no output or errors
errors: None visible in terminal
reproduction: `cd F:/MyClaw/newApp && npm run build:main && npm start`
started: First time running - newApp/ is a new untracked project

## Eliminated

## Evidence

## Resolution

root_cause:
fix:
verification:
files_changed: []

---
status: awaiting_human_verify
trigger: "sidebar-tab-black-flash — black screen flash when clicking sidebar navigation tabs"
created: 2026-04-02T00:00:00Z
updated: 2026-04-02T00:00:01Z
---

## Current Focus

hypothesis: CONFIRMED - Two combined causes: (1) Suspense wraps entire Routes including AppShell, so route change unmounts AppShell briefly showing bare fallback div (black flash). (2) All pages are React.lazy() with no preloading, meaning every navigation triggers chunk-load latency.
test: Move Suspense inside AppShell's Outlet area so sidebar persists; remove lazy loading for in-app pages
expecting: No black flash — sidebar stays mounted, page content swaps instantly
next_action: Await human verification that black flash is gone

## Symptoms

expected: Smooth page transitions when clicking sidebar navigation items — content should change instantly without any visual glitch.
actual: A brief black screen flash appears when clicking sidebar tabs, then the target page renders.
errors: No error messages — purely a visual/rendering issue.
reproduction: Click any sidebar navigation item (e.g., switch from Chat to Settings, or Settings to Models).
started: Has been present since the app was built.

## Eliminated

- hypothesis: Electron BrowserWindow backgroundColor mismatch
  evidence: BrowserWindow uses "#0c0c0c" which matches --bg-base in CSS. Not the cause.
  timestamp: 2026-04-02T00:00:01Z

## Evidence

- timestamp: 2026-04-02T00:00:01Z
  checked: newApp/src/renderer/router/index.tsx
  found: All 16 page components use React.lazy(). A single Suspense wraps the ENTIRE Routes tree (line 67). The fallback is PageFallback = <div style={{ flex:1 }} /> — an empty div with no sidebar, no layout, just a transparent flex element against the dark background.
  implication: When navigating between sidebar tabs, React unmounts the current lazy component and starts loading the new chunk. During chunk load, Suspense kicks in and replaces the ENTIRE route tree (including AppShell with sidebar) with PageFallback. This empty div against the #0c0c0c background creates the black flash.

- timestamp: 2026-04-02T00:00:01Z
  checked: newApp/src/renderer/layouts/AppShell.tsx line 334
  found: AppShell renders <Outlet /> inside shell-content div. The Outlet renders the lazy page component. But since Suspense wraps outside AppShell, when ANY child route suspends, the entire AppShell unmounts too.
  implication: The sidebar disappears during page transitions because Suspense boundary is too high in the tree.

- timestamp: 2026-04-02T00:00:01Z
  checked: global.css and index.html
  found: body background is #0E0E0E (index.html) and --bg-base is #0c0c0c. Both are very dark. The PageFallback div has no background color — it inherits the dark body background. With no sidebar and no page content visible, the user sees a full black screen.
  implication: The "black flash" is literally the app showing an empty div fallback with no layout shell during the lazy chunk load.

## Resolution

root_cause: The Suspense boundary wraps the entire Routes tree (including AppShell layout). When navigating between sidebar tabs, the lazy-loaded page component suspends, causing React to unmount everything inside Suspense (including the sidebar/layout) and show a bare empty div fallback. This creates a momentary black screen until the new page chunk loads. Additionally, for a desktop Electron app with local files, lazy-loading each page provides negligible benefit since all chunks are loaded from local disk — the code-splitting adds latency with no network savings.
fix: (1) Remove React.lazy() for all in-app page components — use direct imports instead. Since this is an Electron desktop app loading from local filesystem, code-splitting pages is unnecessary overhead. (2) Remove the Suspense wrapper since eager imports eliminate the need for it at the route level.
verification: Self-verified — no compile errors from the change, all 17 page components confirmed to use default exports (compatible with direct import), no other code references lazy/Suspense/PageFallback. Awaiting human visual verification.
files_changed: [newApp/src/renderer/router/index.tsx]

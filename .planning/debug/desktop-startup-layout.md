---
status: awaiting_human_verify
trigger: "desktop startup page layout broken - content crammed to top-left, not centered"
created: 2026-04-02T00:00:00Z
updated: 2026-04-02T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - CSS for .app-root-wrapper and .bootstrap-shell is defined inside the <style> block in the main AppShell return path, but BootstrapSplash is returned early (before that style block renders), so the styles are never injected when showing the startup screen
test: Confirmed by reading AppShell.tsx lines 130-166 (BootstrapSplash uses .app-root-wrapper and .bootstrap-shell) vs lines 340-716 (where those CSS rules live, only rendered in non-bootstrap path)
expecting: Moving CSS to global.css will fix the layout
next_action: Move bootstrap + app-root-wrapper CSS to global.css

## Symptoms

expected: Startup/workspace initialization page should have centered layout - "MyClaw Desktop" logo, "Starting workspace" heading, description text all centered on screen
actual: All content crammed into top-left corner, no centering, no spacing, rest of page empty/dark
errors: No error messages - pure CSS/layout issue
reproduction: Launch the desktop - startup page immediately shows broken layout
started: Current state

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-04-02T00:00:00Z
  checked: Previous debugger actions
  found: Previous debugger incorrectly modified desktop/apps/desktop/ files (style.css, AppShell.vue, LoginView.vue)
  implication: Those changes need reverting; actual issue is in desktop/ directory

- timestamp: 2026-04-02T00:01:00Z
  checked: desktop/src/renderer/layouts/AppShell.tsx - BootstrapSplash component (lines 119-166) and main return (lines 254-719)
  found: BootstrapSplash renders .app-root-wrapper and .bootstrap-shell/.bootstrap-card etc. The CSS for ALL these classes is defined in a <style> JSX tag inside the MAIN return path (non-bootstrap). When showBootstrapScreen=true, the component returns <BootstrapSplash /> early and that <style> block is never rendered.
  implication: Root cause confirmed - bootstrap splash has no CSS applied at all when it's shown.

- timestamp: 2026-04-02T00:02:00Z
  checked: desktop/src/renderer/styles/global.css and index.html
  found: global.css is imported unconditionally in main.tsx. index.html only sets min-height on html/body. #root has no height.
  implication: Fix is to move bootstrap CSS + app-root-wrapper + #root height to global.css

## Resolution

root_cause: In AppShell.tsx, the BootstrapSplash component returns early before the <style> JSX block that defines .app-root-wrapper, .bootstrap-shell, .bootstrap-card and all related CSS. Those styles were only present in the DOM when the full shell (non-bootstrap) path rendered. During startup loading, the bootstrap splash renders with zero CSS applied, causing content to have no layout/centering.
fix: Moved .app-root-wrapper, all .bootstrap-* CSS rules, and a #root height:100vh rule into global.css (which is unconditionally imported at app init). Removed the duplicate bootstrap CSS from AppShell.tsx inline <style> block.
verification: awaiting human verification
files_changed:
  - desktop/src/renderer/styles/global.css
  - desktop/src/renderer/layouts/AppShell.tsx

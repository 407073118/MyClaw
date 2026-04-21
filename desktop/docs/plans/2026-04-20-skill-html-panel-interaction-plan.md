# Skill HTML Panel Interaction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the skills list expose only `查看详情`, then let the skill detail page control HTML page selection and `WebPanel` opening/switching/closing.

**Architecture:** Keep `WebPanel` as the renderer-side preview surface, but move the interaction source of truth into `SkillDetailPage`. The detail page owns selected-file state, explicitly opens the panel for the first HTML file, auto-switches while the panel is already open, auto-closes on non-HTML selection, and remembers manual close to suppress re-open until the user clicks again.

**Tech Stack:** React, Zustand workspace store, Electron preload IPC, Vitest, Testing Library

---

### Task 1: Detail-page behavior tests

**Files:**
- Modify: `desktop/tests/skill-pages-a11y.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- list page no longer renders a `预览` button
- detail page selects `view.html`, shows `在面板中打开`, and opens `WebPanel` only on explicit click
- with panel open, selecting another HTML file auto-switches the panel
- selecting a non-HTML file auto-closes the panel
- after a manual close, selecting another HTML file does not auto-open

**Step 2: Run test to verify it fails**

Run: `npm test -- skill-pages-a11y.test.ts`
Expected: FAIL because current UI still has list preview and detail page has no HTML-driven panel state.

**Step 3: Commit**

Do not commit yet. Continue after implementation is green.

### Task 2: Remove list-level preview entry

**Files:**
- Modify: `desktop/src/renderer/pages/SkillsPage.tsx`

**Step 1: Write minimal implementation**

- Remove `openWebPanel` and `webPanelResolveView` usage from the list page flow
- Delete the card-level `预览` button
- Update list copy so it only talks about viewing details

**Step 2: Run targeted test**

Run: `npm test -- skill-pages-a11y.test.ts`
Expected: still FAIL, but the list-preview assertion is now fixed and remaining failures point to detail-page behavior.

### Task 3: Add detail-page HTML selection state machine

**Files:**
- Modify: `desktop/src/renderer/pages/SkillDetailPage.tsx`

**Step 1: Write minimal implementation**

- Read `openWebPanel`, `closeWebPanel`, and `webPanel` from workspace store
- Track whether the current panel session was manually closed from this page
- Detect whether `selectedPath` is an `.html` file
- For HTML files:
  - do not inline preview in the detail page
  - show a state card with an `在面板中打开` button
  - if panel is already open and the user selects another HTML file, auto-switch the panel target
- For non-HTML files:
  - close the panel automatically
- After manual close:
  - keep panel closed until the user explicitly clicks `在面板中打开`

**Step 2: Run targeted test**

Run: `npm test -- skill-pages-a11y.test.ts`
Expected: PASS for the new detail-page interaction tests.

### Task 4: Add safe page resolution helper for detail page

**Files:**
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/main/ipc/web-panel.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`

**Step 1: Write failing test if needed**

If current tests cannot cover IPC shape safely, add a minimal unit/integration assertion in `desktop/tests/skill-pages-a11y.test.ts` or a dedicated IPC test.

**Step 2: Write minimal implementation**

- Replace the fixed `resolve-view` behavior with a resolver that accepts `skillId + relativePath`
- Validate that the requested file exists under the skill root and is an HTML file declared by the skill
- Keep `view.html` compatibility only as ordinary file selection, not as a special default

**Step 3: Run targeted tests**

Run: `npm test -- skill-pages-a11y.test.ts`
Expected: PASS with the new resolver path.

### Task 5: Final verification

**Files:**
- Verify: `desktop/src/renderer/pages/SkillsPage.tsx`
- Verify: `desktop/src/renderer/pages/SkillDetailPage.tsx`
- Verify: `desktop/src/main/ipc/web-panel.ts`
- Verify: `desktop/src/preload/index.ts`
- Verify: `desktop/src/renderer/types/electron.d.ts`
- Verify: `desktop/tests/skill-pages-a11y.test.ts`

**Step 1: Run focused tests**

Run: `npm test -- skill-pages-a11y.test.ts`
Expected: PASS

**Step 2: Run broader renderer confidence checks**

Run: `npm test -- skill-preview-utils.test.ts`
Expected: PASS

**Step 3: Run workspace encoding check on modified files**

Run: `rg -n "�|锟|Ã|Ð" desktop/src/renderer/pages/SkillsPage.tsx desktop/src/renderer/pages/SkillDetailPage.tsx desktop/src/main/ipc/web-panel.ts desktop/src/preload/index.ts desktop/src/renderer/types/electron.d.ts desktop/tests/skill-pages-a11y.test.ts`
Expected: no matches


# Cloud Web Portal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild `cloud-web` into an integrated cloud portal with a strong landing page, an enterprise capability hub, and a clear admin entry.

**Architecture:** Keep the current Nuxt 3 app lightweight, but introduce a real application shell, shared visual system, and page-level information architecture. The public-facing portal and hub share one layout, while the admin entry is separated as its own route so the frontstage and backstage roles stay clear.

**Tech Stack:** Nuxt 3, Vue 3, TypeScript, plain CSS

---

### Task 1: Lock the new page contract with tests

**Files:**
- Modify: `cloud/apps/cloud-web/tests/pages.test.mjs`

**Step 1: Write the failing test**

Add assertions for:
- the new `/console` admin entry route
- a shared layout file
- a global stylesheet
- landing page copy that positions the product as a cloud portal
- hub page sections for official capabilities, skills, and MCP

**Step 2: Run test to verify it fails**

Run: `pnpm --dir cloud/apps/cloud-web test`
Expected: FAIL because the new files and markers do not exist yet.

**Step 3: Write minimal implementation**

Create the missing layout and stylesheet, then update the page files so the required markers exist.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir cloud/apps/cloud-web test`
Expected: PASS.

### Task 2: Build the shared application shell

**Files:**
- Modify: `cloud/apps/cloud-web/app.vue`
- Create: `cloud/apps/cloud-web/layouts/default.vue`
- Create: `cloud/apps/cloud-web/assets/css/main.css`
- Modify: `cloud/apps/cloud-web/nuxt.config.ts`

**Step 1: Write the failing test**

Covered by Task 1.

**Step 2: Run test to verify it fails**

Covered by Task 1.

**Step 3: Write minimal implementation**

Add:
- a top navigation with `Hub`, `登录`, and `进入后台`
- a branded shell that works for desktop and mobile
- global theme tokens, spacing, card styles, and responsive rules

**Step 4: Run test to verify it passes**

Run: `pnpm --dir cloud/apps/cloud-web test`
Expected: PASS.

### Task 3: Rebuild the landing page and enterprise hub

**Files:**
- Modify: `cloud/apps/cloud-web/pages/index.vue`
- Modify: `cloud/apps/cloud-web/pages/hub.vue`
- Modify: `cloud/apps/cloud-web/pages/login.vue`
- Create: `cloud/apps/cloud-web/pages/console.vue`

**Step 1: Write the failing test**

Covered by Task 1.

**Step 2: Run test to verify it fails**

Covered by Task 1.

**Step 3: Write minimal implementation**

Rework:
- `/` into a cloud portal with hero, capability map, rollout flow, and admin entry
- `/hub` into an enterprise capability portal with recommended capabilities and category sections
- `/login` into a stable identity bridge page for desktop and cloud sessions
- `/console` into a backstage overview page placeholder for later admin functions

**Step 4: Run test to verify it passes**

Run: `pnpm --dir cloud/apps/cloud-web test`
Expected: PASS.

### Task 4: Verify build output and text safety

**Files:**
- Verify: `cloud/apps/cloud-web/**/*`

**Step 1: Run targeted verification**

Run:
- `pnpm --dir cloud/apps/cloud-web test`
- `pnpm --dir cloud/apps/cloud-web build`

Expected: PASS.

**Step 2: Run garble scan**

Run the garble scan command recommended by the repository `AGENTS.md`, but scope the check to the files modified for this task.
Expected: no matches in modified files.

---
phase: quick-260506-mq5
plan: 01
subsystem: desktop-renderer
tags: [silicon-rail, chat-page, workspace-store, ui]
requires: []
provides:
  - silicon-rail-attention-cue
  - workspace-applySessionUpdate-patches-silicon-summary
affects:
  - desktop/src/renderer/pages/ChatPage.tsx
  - desktop/src/renderer/stores/workspace.ts
  - desktop/src/renderer/components/SiliconRail.tsx
key-files:
  modified:
    - desktop/src/renderer/pages/ChatPage.tsx
    - desktop/src/renderer/stores/workspace.ts
    - desktop/src/renderer/components/SiliconRail.tsx
decisions:
  - 主聊天 @-mention 流不再 gating loadSiliconPersonById：只要 updatedSession.siliconPersonId 存在就刷新，避免 rail 徽章永远拿不到摘要更新。
  - applySessionUpdate 只在 store 内同步 patch SiliconPersonSessionSummary.needsApproval（由 chatRunState.phase === "approval" 推导），unreadCount/hasUnread/status 不动，由 loadSiliconPersonById 兜底。
  - SiliconRail 用 status-dot 上的 pulse + glow ring 替换数字 badge，attentionVariant 单变量驱动黄/绿优先级（needsApproval > done+hasUnread > running）。
metrics:
  completed: 2026-05-06
  tasks: 3
  files: 3
  duration_minutes: ~12
---

# Quick Task 260506-mq5: SiliconRail 徽章不更新 + 数字 badge 改单点视觉 Summary

修复硅基员工 SiliconRail 在 @-mention 派发场景下徽章不刷新的 bug，并将数字未读 badge 替换为 status-dot 上的 pulse + glow-ring 单点视觉提示。

## Tasks & Commits

| # | Task | File | Commit |
|---|------|------|--------|
| 1 | 移除 ChatPage 在 `session.updated` 分支对 `activeViewSiliconPersonIdRef.current` 的等值 gating | desktop/src/renderer/pages/ChatPage.tsx | 7c0bd13 |
| 2 | applySessionUpdate 同步 patch siliconPersons[].sessions[].needsApproval 与员工级聚合 | desktop/src/renderer/stores/workspace.ts | 26a5a14 |
| 3 | 删除 rail-badge / approval-badge / unread-badge，改 status-dot pulse + glow-ring（黄/绿变体） | desktop/src/renderer/components/SiliconRail.tsx | 92492dc |

## What Changed

### Task 1 — ChatPage.tsx

`onSessionStream` 的 `session.updated` 分支原本只在 `updatedSession.siliconPersonId === activeViewSiliconPersonIdRef.current` 时才调用 `loadSiliconPersonById`。这意味着用户站在主聊天 session（`activeViewSiliconPersonIdRef.current` 为 null）@-mention 一个硅基员工派发任务后，rail 徽章永远拿不到摘要刷新。

修复：删除等值判断，仅保留 `updatedSession.siliconPersonId` 存在性检查。`console.error` 路径与字段保持原样，下方 `isActiveViewSession(updatedSession.id)` / `setCurrentRound(0)` / `setActiveTools(new Map())` 全部不动。

### Task 2 — workspace.ts applySessionUpdate

在原 `sessions[]` 更新逻辑之后，新增 siliconPersons[] 的 inline patch：
- 仅在 `updatedSession.siliconPersonId` 存在 + 找到对应员工 + 找到对应 session summary 时才 patch；任一条件不满足直接 `return { sessions }` 早返回。
- 仅 patch `SiliconPersonSessionSummary.needsApproval`（由 `chatRunState.phase === "approval"` 推导）。`unreadCount` / `hasUnread` / `status` / `title` / `updatedAt` 全部保留原值——`ChatSession` 不携带未读信号，由 `loadSiliconPersonById` round-trip 兜底。
- 员工级 `needsApproval` 用 `nextSummaries.some(it => it.needsApproval)` 重算；`hasUnread` / `unreadCount` / `status` 因 per-session 字段没动，不重算。
- 全程不可变更新：`siliconPersons.map(...)` 替换员工对象、employee 内 `sessions` 也用 `map(...)` 生成新引用，其他员工对象保持引用稳定。
- 全包在同一个 `set((s) => { ... })` 里。
- 没有引入新 helper，没有复用 `mergeSiliconPersonSessionPayload`（那是合并整包 SiliconPerson payload 的，本场景只有 ChatSession）。

### Task 3 — SiliconRail.tsx

JSX：
- 删除整段 `.rail-badge.approval-badge` / `.rail-badge.unread-badge` 渲染。
- 在 `SiliconRailAvatar` 内新增 `attentionVariant`（"yellow" | "green" | null）单变量，按 `needsApproval > done + hasUnread > running > 静态` 优先级解析。
- `status-dot` className 由 `["status-dot", is-running?, status-dot--attention status-dot--attention-${variant}?]` 组合得出。`is-running` 与 attention 互斥（attentionVariant 非空时不再加 `is-running`）。
- 按钮 `title` 切换：待审批 → "{name} — 待审批"；done+hasUnread → "{name} — 已完成，待查看（N 条更新）"；其余维持 `{name} — {statusLabel}`。

CSS：
- 删除 `.rail-badge` / `.approval-badge` / `.unread-badge` 三条规则。
- 新增 `.status-dot--attention` 基础规则 + 黄/绿变体类（用 CSS 变量 `--rail-attention-color` 解耦颜色，单一 keyframes）+ `silicon-rail-attention` keyframes（`scale 1 → 1.08`，`box-shadow 0 0 0 0 → 0 0 0 6px` 形成 ring pulse，用 `color-mix(in srgb, ..., transparent)`）。
- `.status-dot.is-running` 与 `silicon-rail-pulse` 关键帧未触碰——running 状态视觉保持原样。

## Verification

- `pnpm --dir desktop tsc --noEmit -p tsconfig.renderer.json`：通过（no output / no errors）。
- `git grep "rail-badge\|approval-badge\|unread-badge" -- desktop/src/renderer/components/SiliconRail.tsx`：0 命中。
- `git grep "activeViewSiliconPersonIdRef" desktop/src/renderer/pages/ChatPage.tsx`：`session.updated` 分支内已 0 命中（其他分支如 `runtime.status` / `context.limit_warning` 等保留的引用未动）。

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- desktop/src/renderer/pages/ChatPage.tsx: FOUND, gating 已删除
- desktop/src/renderer/stores/workspace.ts: FOUND, applySessionUpdate inline patch 已添加
- desktop/src/renderer/components/SiliconRail.tsx: FOUND, rail-badge 已删除, attention 规则已添加
- Commit 7c0bd13: FOUND
- Commit 26a5a14: FOUND
- Commit 92492dc: FOUND
- Renderer typecheck: PASSED

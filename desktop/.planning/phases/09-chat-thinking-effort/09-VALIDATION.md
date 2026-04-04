---
phase: 09
slug: chat-thinking-effort
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-04
---

# Phase 09 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 |
| **Config file** | `desktop/vitest.config.ts` |
| **Quick run command** | `pnpm --dir desktop exec vitest run tests/phase9-thinking-mode.test.ts tests/phase9-provider-reasoning-mapper.test.ts` |
| **Full suite command** | `pnpm --dir desktop exec vitest run tests/phase9-thinking-mode.test.ts tests/phase9-provider-reasoning-mapper.test.ts tests/phase9-thinking-ui.test.ts` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --dir desktop exec vitest run tests/phase9-thinking-mode.test.ts tests/phase9-provider-reasoning-mapper.test.ts`
- **After every plan wave:** Run `pnpm --dir desktop exec vitest run tests/phase9-thinking-mode.test.ts tests/phase9-provider-reasoning-mapper.test.ts tests/phase9-thinking-ui.test.ts`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | P9-01 | unit | `pnpm --dir desktop exec vitest run tests/phase9-thinking-mode.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | P9-01 | unit | `pnpm --dir desktop exec vitest run tests/phase9-thinking-mode.test.ts` | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 2 | P9-02 | unit | `pnpm --dir desktop exec vitest run tests/phase9-provider-reasoning-mapper.test.ts` | ❌ W0 | ⬜ pending |
| 09-02-02 | 02 | 2 | P9-03 | unit | `pnpm --dir desktop exec vitest run tests/phase9-provider-reasoning-mapper.test.ts` | ❌ W0 | ⬜ pending |
| 09-03-01 | 03 | 3 | P9-04 | component | `pnpm --dir desktop exec vitest run tests/phase9-thinking-ui.test.ts` | ❌ W0 | ⬜ pending |
| 09-03-02 | 03 | 3 | P9-04 | component | `pnpm --dir desktop exec vitest run tests/phase9-thinking-ui.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `desktop/tests/phase9-thinking-mode.test.ts` — 覆盖 session 契约、create/load 持久化、send-message request body 透传
- [ ] `desktop/tests/phase9-provider-reasoning-mapper.test.ts` — 覆盖 OpenAI-style reasoning patch 与 unsupported provider 空 patch
- [ ] `desktop/tests/phase9-thinking-ui.test.ts` — 覆盖 ChatPage 开关、确认交互、状态 badge

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Thinking 开关在真实聊天会话中的可理解性 | P9-04 | 需要检查 UI 文案和交互节奏是否自然 | 打开 ChatPage，创建会话，切换 thinking，确认 badge、确认弹窗与正文布局不产生明显干扰 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

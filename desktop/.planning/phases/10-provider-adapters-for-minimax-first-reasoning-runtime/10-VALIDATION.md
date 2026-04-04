---
phase: 10
slug: provider-adapters-for-minimax-first-reasoning-runtime
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-04
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for MiniMax-first adapter execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 |
| **Config file** | `desktop/vitest.config.ts` |
| **Quick run command** | `pnpm --dir desktop exec vitest run tests/phase10-model-capability-resolver.test.ts tests/phase10-minimax-adapter.test.ts tests/phase10-message-replay.test.ts` |
| **Full suite command** | `pnpm --dir desktop exec vitest run tests/phase9-provider-reasoning-mapper.test.ts tests/phase10-model-capability-resolver.test.ts tests/phase10-minimax-adapter.test.ts tests/phase10-message-replay.test.ts tests/phase10-model-settings.test.ts` |
| **Estimated runtime** | ~25 seconds |

---

## Sampling Rate

- **After every task commit:** Run the smallest test command covering the changed task
- **After every plan wave:** Run the quick run command for the phase
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 25 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | P10-01 | unit | `pnpm --dir desktop exec vitest run tests/phase10-model-capability-resolver.test.ts tests/phase10-minimax-adapter.test.ts` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | P10-02 | unit | `pnpm --dir desktop exec vitest run tests/phase10-minimax-adapter.test.ts` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 2 | P10-03 | unit | `pnpm --dir desktop exec vitest run tests/phase10-message-replay.test.ts` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 2 | P10-04 | integration | `pnpm --dir desktop exec vitest run tests/phase10-message-replay.test.ts tests/phase10-minimax-adapter.test.ts` | ❌ W0 | ⬜ pending |
| 10-03-01 | 03 | 3 | P10-05 | unit | `pnpm --dir desktop exec vitest run tests/phase10-model-settings.test.ts tests/phase10-model-capability-resolver.test.ts` | ❌ W0 | ⬜ pending |
| 10-03-02 | 03 | 3 | P10-06 | regression | `pnpm --dir desktop exec vitest run tests/phase9-provider-reasoning-mapper.test.ts tests/phase10-model-capability-resolver.test.ts tests/phase10-minimax-adapter.test.ts tests/phase10-message-replay.test.ts tests/phase10-model-settings.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `desktop/tests/phase10-minimax-adapter.test.ts` — 覆盖 adapter 选择、兼容模式、增强模式、请求 patch 和降级原因
- [ ] `desktop/tests/phase10-message-replay.test.ts` — 覆盖完整 assistant turn 规范化与 tool/reasoning replay
- [ ] `desktop/tests/phase10-model-settings.test.ts` — 覆盖 MiniMax preset、provider flavor、catalog normalization、旧 baseUrl/root 兼容
- [ ] `desktop/tests/phase10-model-capability-resolver.test.ts` — 扩展为覆盖 MiniMax capability profile

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 现有 MiniMax 配置仍可连通 | P10-02 | 需要真实服务或近似配置验证旧调用路径 | 在设置页加载已有 MiniMax profile，使用当前 `baseUrl` / `requestBody` 测试连接，确认不会因 adapter 引入新字段而报错 |
| 增强模式的可解释性 | P10-04 | 需要观察 UI/日志文案是否足够清楚 | 打开 chat，用启用 thinking 的 MiniMax 会话触发一次 tool loop，确认日志或 UI 能区分正常增强与自动降级 |
| MiniMax preset 与模型目录体验 | P10-05 | 需要检查设置页输入提示和 catalog 行为 | 新建 MiniMax profile，检查 preset、baseUrl 提示、model catalog 拉取与保存后的 provider flavor 是否一致 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 25s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

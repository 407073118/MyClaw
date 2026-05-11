---
phase: 260421-lhw-fix-deepseek-adapter-incorrectly-sending
plan: 01
subsystem: desktop/provider-adapters
tags: [deepseek, provider-adapter, replay, reasoning, bugfix]
dependency-graph:
  requires:
    - "desktop/src/main/services/provider-adapters/base.ts (frozen at bf4d82a — cloneReplayMessages, mapAssistantReasoningToReplayField)"
  provides:
    - "Per-model replay branching for DeepSeek family (reasoner vs chat/v3.2)"
  affects:
    - "Chat with deepseek-reasoner now succeeds (no longer 400 from /v1/chat/completions)"
    - "Chat with deepseek-chat / deepseek-v3.2* still replays reasoning_content for thinking + tool_calls multi-turn"
tech-stack:
  added: []
  patterns:
    - "Lowercase + startsWith model-family detection (mirrors qwen.ts isQwenThinking pattern)"
key-files:
  created:
    - "desktop/tests/deepseek-adapter.test.ts"
  modified:
    - "desktop/src/main/services/provider-adapters/deepseek.ts"
decisions:
  - "isDeepSeekReasonerModel uses lowercase exact match plus startsWith(\"deepseek-reasoner-\") to tolerate dated variants"
  - "Reasoner branch strips assistant.reasoning by destructuring; non-reasoner branch delegates to base helper for empty-omit consistency"
  - "Bracketed Chinese log [deepseek-adapter] surfaces the branching decision in main-process logs (per CLAUDE.md logging convention)"
metrics:
  duration_seconds: 1027
  completed: "2026-04-21"
requirements:
  - DEEPSEEK-FIX-01
---

# Phase 260421-lhw Plan 01: Fix DeepSeek Adapter Incorrectly Sending reasoning_content to deepseek-reasoner — Summary

DeepSeek adapter's `materializeReplayMessages` now branches on `context.profile.model`: deepseek-reasoner family strips assistant `reasoning` (no `reasoning_content` in input messages), while deepseek-chat / deepseek-v3.2 keep mapping `reasoning -> reasoning_content` via the shared base helper.

## What Changed

### Branching Condition

A new private helper in `desktop/src/main/services/provider-adapters/deepseek.ts`:

```typescript
function isDeepSeekReasonerModel(model: string): boolean {
  const lower = (model ?? "").toLowerCase();
  return lower === "deepseek-reasoner" || lower.startsWith("deepseek-reasoner-");
}
```

Behavior matrix:

| Model id (case-insensitive)           | Branch        | reasoning_content in replay? |
| ------------------------------------- | ------------- | ---------------------------- |
| `deepseek-reasoner`                   | reasoner      | NO (stripped)                |
| `deepseek-reasoner-2026-xx-xx`        | reasoner      | NO (stripped)                |
| `deepseek-chat`                       | non-reasoner  | YES (mapped from reasoning, omitted when empty) |
| `deepseek-v3.2-thinking`              | non-reasoner  | YES (mapped from reasoning, omitted when empty) |
| `DeepSeek-V3.2` (mixed case)          | non-reasoner  | YES (mapped from reasoning, omitted when empty) |

The reasoner branch builds replay messages via `cloneReplayMessages(input.messages)`, then destructures `reasoning` out of every assistant message so the field is structurally absent (no `reasoning`, no `reasoning_content`).

The non-reasoner branch delegates to `mapAssistantReasoningToReplayField(input.messages, "reasoning_content")` — the same helper Qwen / Kimi / volcengine-ark use, which now (post-bf4d82a) omits the field when reasoning is empty rather than writing an empty string placeholder.

### Logging

Added a Chinese subsystem-prefixed log in the reasoner branch (per CLAUDE.md `[subsystem]` convention):

```
[deepseek-adapter] 检测到 deepseek-reasoner 模型，已剥离历史 assistant.reasoning，避免输入 reasoning_content 触发 400: <model-id>
```

`prepareRequest` log untouched.

## Test Coverage

New file: `desktop/tests/deepseek-adapter.test.ts` (5 cases):

1. **deepseek-reasoner with non-empty reasoning** — assistant message has neither `reasoning` nor `reasoning_content` after replay.
2. **deepseek-reasoner with empty reasoning** — same, no field appears.
3. **deepseek-chat with non-empty reasoning** — `reasoning_content` equals original reasoning, no `reasoning` field.
4. **deepseek-v3.2 family** — both lowercase (`deepseek-v3.2-thinking`) and mixed case (`DeepSeek-V3.2`) keep `reasoning_content` mapping; mixed case confirms case-insensitive check does NOT misclassify them as reasoner.
5. **Non-reasoner with empty reasoning** — `reasoning_content` is omitted (regression guard for the bf4d82a base-helper fix).

Style mirrors `desktop/tests/phase1-openai-compatible-adapter.test.ts`: double quotes, 2-space indent, semicolons, vitest, local `makeDeepSeekProfile` factory, single `describe` block.

## Frozen Files Confirmation

`git diff --stat HEAD~2..HEAD` shows only two files in the plan's commits:

```
desktop/src/main/services/provider-adapters/deepseek.ts | 29 +++++++++++++++++++--
desktop/tests/deepseek-adapter.test.ts                  | 132 ++++++++++++++++
```

`desktop/src/main/services/provider-adapters/base.ts` and `desktop/src/main/services/model-client.ts` were NOT modified by this plan. `base.ts` remains at the bf4d82a fix; `model-client.ts` was not touched. (Pre-existing dirty working-tree edits to other files were left as-is and not staged into either commit.)

No other adapter file (qwen, kimi, minimax, br-minimax, volcengine-ark, openai-native, openai-compatible, anthropic-native) was modified.

## Verification

```
cd desktop && npx vitest run tests/deepseek-adapter.test.ts
  -> Test Files  1 passed (1)
  -> Tests       5 passed (5)

cd desktop && npx tsc --noEmit -p tsconfig.main.json
  -> exit 0, no output
```

## Commits

- `fd12042` — test(desktop): add failing test for deepseek per-model replay branching (RED)
- `29220e5` — fix(desktop): branch deepseek replay messages by model id (GREEN)

## Deviations from Plan

The plan predicted that Tests 1, 3, 4 (and the case-insensitive subcase) would all fail in the RED phase. In practice, only Test 1 failed — Tests 3, 4, 5 passed against the original adapter because the original code unconditionally mapped `reasoning -> reasoning_content`, which incidentally satisfies the non-reasoner expectations for those cases. Test 2 also passed in RED for the same reason (the base helper already omits empty reasoning). This is a documentation-only mismatch; the critical regression test (Test 1) failed as expected, locking in the bug, and all 5 tests now pass after the fix. No code or test adjustments were needed.

No auto-fix deviations (Rules 1-3) triggered. No architectural decisions (Rule 4) needed.

## Self-Check: PASSED

- FOUND: desktop/tests/deepseek-adapter.test.ts
- FOUND: desktop/src/main/services/provider-adapters/deepseek.ts (modified with isDeepSeekReasonerModel + branching)
- FOUND commit: fd12042
- FOUND commit: 29220e5
- VERIFIED: base.ts unchanged from bf4d82a (no diff in commits fd12042 / 29220e5)
- VERIFIED: model-client.ts unchanged in this plan
- VERIFIED: 5/5 tests passing, tsc clean

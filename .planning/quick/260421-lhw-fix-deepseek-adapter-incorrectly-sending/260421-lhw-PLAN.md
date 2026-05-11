---
phase: 260421-lhw-fix-deepseek-adapter-incorrectly-sending
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - desktop/src/main/services/provider-adapters/deepseek.ts
  - desktop/tests/deepseek-adapter.test.ts
autonomous: true
requirements:
  - DEEPSEEK-FIX-01
must_haves:
  truths:
    - "DeepSeek adapter does NOT attach reasoning_content to assistant replay messages when target model is deepseek-reasoner"
    - "DeepSeek adapter still maps assistant.reasoning -> reasoning_content for non-reasoner models (deepseek-chat, deepseek-v3.2*) so thinking-mode tool-call replay keeps working"
    - "When the assistant message has no reasoning, the field is omitted (delegated to the freshly fixed base.ts helper)"
    - "Unit test exercises both branches and fails before the deepseek.ts change"
  artifacts:
    - path: "desktop/src/main/services/provider-adapters/deepseek.ts"
      provides: "Per-model branching: reasoner -> strip reasoning; others -> map to reasoning_content"
      contains: "deepseek-reasoner"
    - path: "desktop/tests/deepseek-adapter.test.ts"
      provides: "Vitest coverage for deepseek per-model replay branching"
      contains: "describe(\"deepseek adapter"
  key_links:
    - from: "desktop/src/main/services/provider-adapters/deepseek.ts:materializeReplayMessages"
      to: "context.profile.model"
      via: "lowercase startsWith check on model id"
      pattern: "deepseek-reasoner"
    - from: "desktop/src/main/services/provider-adapters/deepseek.ts (non-reasoner branch)"
      to: "base.ts:mapAssistantReasoningToReplayField"
      via: "delegates with field name reasoning_content"
      pattern: "mapAssistantReasoningToReplayField.*reasoning_content"
---

<objective>
Fix DeepSeek adapter so that `materializeReplayMessages` no longer indiscriminately attaches `reasoning_content` for every DeepSeek model. The current behavior breaks `deepseek-reasoner` requests with HTTP 400 because, per DeepSeek官方文档, including `reasoning_content` in input messages to deepseek-reasoner is explicitly rejected. At the same time, deepseek-chat / deepseek-v3.2 thinking + tool_calls path requires the historical `reasoning_content` to be replayed, so behavior must branch by model id.

Purpose: Restore working chat with `deepseek-reasoner` in desktop while preserving the recently-fixed thinking-mode replay contract for the rest of the DeepSeek family. This is the second of two paired fixes; the first (Qwen / shared base helper) was committed at `bf4d82a` on main and MUST NOT be touched.

Output:
- Modified `desktop/src/main/services/provider-adapters/deepseek.ts` with model-aware branching in `materializeReplayMessages`.
- New `desktop/tests/deepseek-adapter.test.ts` covering both branches.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@F:/MyClaw/CLAUDE.md
@F:/MyClaw/desktop/src/main/services/provider-adapters/deepseek.ts
@F:/MyClaw/desktop/src/main/services/provider-adapters/base.ts
@F:/MyClaw/desktop/src/main/services/provider-adapters/qwen.ts
@F:/MyClaw/desktop/tests/phase1-openai-compatible-adapter.test.ts
@F:/MyClaw/desktop/tests/phase1-minimax-adapter.test.ts

<interfaces>
<!-- Contracts the executor needs. Extracted from the codebase. Do NOT explore further. -->

From desktop/src/main/services/provider-adapters/base.ts:
```typescript
export type ProviderAdapterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  reasoning?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type ProviderAdapterContext = {
  profile: ModelProfile;          // profile.model is the raw model id, e.g. "deepseek-reasoner"
  reasoningEnabled?: boolean;
  reasoningEffort?: SessionReasoningEffort;
};

export type ProviderAdapterRequestInput = {
  messages: ProviderAdapterMessage[];
  tools?: ProviderAdapterTool[];
};

// Already fixed at bf4d82a — when reasoning is empty/missing, the field is OMITTED.
// Do NOT modify. The deepseek non-reasoner branch will keep delegating to it.
export function mapAssistantReasoningToReplayField(
  messages: ProviderAdapterMessage[],
  fieldName: string,
): ProviderAdapterMessage[];

// Use this for the deepseek-reasoner branch — it strips `reasoning` without re-emitting it.
export function cloneReplayMessages(messages: ProviderAdapterMessage[]): ProviderAdapterMessage[];
```

From desktop/src/main/services/provider-adapters/index.ts:
```typescript
export function getProviderAdapter(id: ProviderAdapterId): ProviderAdapter;
// Test will call: getProviderAdapter("deepseek")
```

From desktop/tests/phase1-openai-compatible-adapter.test.ts (profile factory pattern to copy):
```typescript
import type { ModelProfile } from "@shared/contracts";
function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-openai",
    name: "OpenAI Compatible",
    provider: "openai-compatible",
    providerFlavor: "generic-openai-compatible",
    baseUrl: "https://example.com/v1",
    apiKey: "test-key",
    model: "gpt-test",
    headers: {},
    requestBody: { temperature: 0.3, max_tokens: 1024 },
    ...overrides,
  };
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add per-model replay branching in deepseek adapter + unit tests</name>
  <files>
    desktop/src/main/services/provider-adapters/deepseek.ts,
    desktop/tests/deepseek-adapter.test.ts
  </files>
  <behavior>
    Tests in desktop/tests/deepseek-adapter.test.ts (new file, vitest, mirroring the style of phase1-openai-compatible-adapter.test.ts and phase1-minimax-adapter.test.ts):

    Test 1 — "deepseek-reasoner: strips reasoning from assistant replay messages and does NOT attach reasoning_content":
      - Build a ModelProfile with `provider: "deepseek"`, `providerFlavor: "deepseek"` (or matching flavor used by other deepseek tests; keep it generic — provider id alone is enough), `model: "deepseek-reasoner"`.
      - Call `getProviderAdapter("deepseek").materializeReplayMessages({ profile }, { messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "answer", reasoning: "internal chain of thought" },
        ] })`.
      - Expect the returned assistant message to:
        - Have `role === "assistant"` and `content === "answer"`.
        - NOT have a `reasoning` property.
        - NOT have a `reasoning_content` property.

    Test 2 — "deepseek-reasoner with empty reasoning: still no reasoning_content":
      - Same setup, but assistant message has `reasoning: ""`.
      - Expect no `reasoning` and no `reasoning_content` on the resulting message.

    Test 3 — "deepseek-chat (non-reasoner): maps reasoning -> reasoning_content for thinking-mode tool-call replay":
      - Profile with `model: "deepseek-chat"`.
      - Same input messages as Test 1.
      - Expect the assistant message to have `reasoning_content === "internal chain of thought"` and NO `reasoning` field.

    Test 4 — "deepseek-v3.2 family: also keeps reasoning_content mapping":
      - Profile with `model: "deepseek-v3.2-thinking"` (and a second case with `"DeepSeek-V3.2"` to confirm case-insensitive match for the reasoner check — should NOT be treated as reasoner).
      - Expect `reasoning_content` to be present, equal to original reasoning.

    Test 5 — "non-reasoner with empty reasoning: omits reasoning_content (delegated to base helper, regression guard for bf4d82a)":
      - Profile with `model: "deepseek-chat"`, assistant message has `reasoning: ""`.
      - Expect no `reasoning_content` (the base helper now omits empty values).
  </behavior>
  <action>
    Step 1 — Write the failing tests first (RED):
      - Create `desktop/tests/deepseek-adapter.test.ts`.
      - Use double quotes, 2-space indent, semicolons (matches `desktop/src/**` style per CLAUDE.md).
      - Imports:
          import { describe, expect, it } from "vitest";
          import type { ModelProfile } from "@shared/contracts";
          import { getProviderAdapter } from "../src/main/services/provider-adapters";
      - Local `makeDeepSeekProfile(overrides: Partial<ModelProfile> = {}): ModelProfile` factory based on the openai-compatible-adapter test pattern but with `provider: "deepseek"` and a default `model: "deepseek-chat"`. Keep `providerFlavor`, `baseUrl`, `apiKey`, `headers`, `requestBody` set to plausible defaults (e.g. providerFlavor: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiKey: "test-key", headers: {}, requestBody: {}).
      - Implement Tests 1-5 from the <behavior> block above. Run `cd desktop && npx vitest run tests/deepseek-adapter.test.ts` and confirm Test 1, 3, 4 (and the 4-case-insensitive subcase) FAIL on current `deepseek.ts` (because today's adapter unconditionally adds reasoning_content for `deepseek-reasoner`).

    Step 2 — Implement the fix (GREEN) in `desktop/src/main/services/provider-adapters/deepseek.ts`:
      - Add a private helper `function isDeepSeekReasonerModel(model: string): boolean`:
          const lower = (model ?? "").toLowerCase();
          return lower === "deepseek-reasoner" || lower.startsWith("deepseek-reasoner-");
        (Use startsWith to tolerate dated/variant suffixes the same way qwen.ts does.)
      - Update `materializeReplayMessages(context, input)`:
          if (isDeepSeekReasonerModel(context.profile.model)) {
            // deepseek-reasoner 不接受输入消息中的 reasoning_content（官方文档明确返回 400），
            // 也不支持 function calling，因此直接剥离 assistant.reasoning，避免历史推理被回传。
            return cloneReplayMessages(input.messages).map((message) => {
              if (message.role !== "assistant" || !("reasoning" in message)) {
                return message;
              }
              const { reasoning: _omitted, ...rest } = message;
              void _omitted;
              return rest as ProviderAdapterMessage;
            });
          }
          // 其他 DeepSeek 模型（deepseek-chat / deepseek-v3.2*）在 thinking + tool_calls 多轮中
          // 仍要求历史 assistant 携带 reasoning_content；当本地无内容时由 base helper 自行省略。
          return mapAssistantReasoningToReplayField(input.messages, "reasoning_content");
      - Update the imports at the top to add `cloneReplayMessages` and the type `ProviderAdapterMessage` from "./base".
      - Update the file-level JSDoc block to mention the per-model branching:
          "DeepSeek-Reasoner 不允许在输入消息中携带 reasoning_content（官方文档），且不支持 function calling，所以重放阶段需剥离 reasoning；DeepSeek-Chat / DeepSeek-V3.2 thinking + tool_calls 仍需要回传 reasoning_content，沿用 base helper。"
      - Add a `console.info("[deepseek-adapter] ...")` log inside the reasoner branch describing that reasoning was stripped (subsystem prefix per CLAUDE.md logging conventions, Chinese business message). Keep the existing `prepareRequest` log untouched.
      - Do NOT change `prepareRequest`, `normalizeResponse`, or any other adapter file.
      - Do NOT modify `base.ts` or `model-client.ts` — they are already fixed at bf4d82a.

    Step 3 — Re-run tests (GREEN). All 5 tests must pass.

    Step 4 — Type-check the main process bundle.

    Style requirements (per CLAUDE.md):
      - Double quotes, 2-space indent, semicolons (matches surrounding `desktop/src/main/services/provider-adapters/*.ts`).
      - `camelCase` for the new helper, `PascalCase` for any types.
      - Bracketed Chinese log prefix `[deepseek-adapter]`.
  </action>
  <verify>
    <automated>cd desktop && npx vitest run tests/deepseek-adapter.test.ts && npx tsc --noEmit -p tsconfig.main.json</automated>
  </verify>
  <done>
    - `desktop/tests/deepseek-adapter.test.ts` exists, contains 5 test cases as described, and all pass.
    - `desktop/src/main/services/provider-adapters/deepseek.ts` branches on `context.profile.model`: reasoner-family models receive replay messages with `reasoning` stripped and NO `reasoning_content`; all other DeepSeek models still get `reasoning -> reasoning_content` via the shared base helper.
    - `npx tsc --noEmit -p tsconfig.main.json` passes with no new errors.
    - `desktop/src/main/services/provider-adapters/base.ts` and `desktop/src/main/services/model-client.ts` are unchanged (verify with `git diff --stat HEAD`).
    - No other adapter file (qwen, kimi, minimax, br-minimax, volcengine-ark, openai-native, openai-compatible, anthropic-native) is modified.
  </done>
</task>

</tasks>

<verification>
1. Run `cd desktop && npx vitest run tests/deepseek-adapter.test.ts` — all 5 tests pass.
2. Run `cd desktop && npx tsc --noEmit -p tsconfig.main.json` — no errors.
3. `git diff --stat HEAD` shows ONLY two files touched: `desktop/src/main/services/provider-adapters/deepseek.ts` and `desktop/tests/deepseek-adapter.test.ts`.
4. Manually inspect the diff to confirm `base.ts` and `model-client.ts` are untouched.
</verification>

<success_criteria>
- DeepSeek adapter `materializeReplayMessages` correctly branches on model id.
- For `deepseek-reasoner`: assistant replay messages contain neither `reasoning` nor `reasoning_content`. (Eliminates the 400 from `https://api.deepseek.com/v1/chat/completions`.)
- For `deepseek-chat`, `deepseek-v3.2*`, and any other non-reasoner DeepSeek model: assistant replay messages still receive `reasoning_content` mapped from `reasoning` (preserving thinking-mode tool-call replay contract). Empty/missing reasoning correctly omits the field via the already-fixed base helper.
- New unit test file under `desktop/tests/` matches existing vitest patterns and locks in both branches.
- TypeScript build succeeds.
- No regression to other adapters or to the recently-committed bf4d82a fix.
</success_criteria>

<output>
After completion, create `.planning/quick/260421-lhw-fix-deepseek-adapter-incorrectly-sending/260421-lhw-01-SUMMARY.md` summarizing:
- The exact branching condition added (`isDeepSeekReasonerModel`).
- Which DeepSeek models now strip vs preserve reasoning on replay.
- Test file path and the 5 cases covered.
- Confirmation that `base.ts` and `model-client.ts` were not modified.
</output>

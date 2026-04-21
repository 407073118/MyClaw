# MiniMax Responses Planning Controller Implementation Plan

> **For Codex:** 按 TDD 顺序实现，只影响 `br-minimax + openai-responses + 深度思考` 路线，不改变其他模型与协议的默认行为。

**Goal:** 让 `br-minimax` 走 `OpenAI Responses` 且开启高强度推理时，复杂研究/分析类请求在首轮稳定停留于规划阶段，优先创建完整任务集，而不是只创建 1 个 `task_create` 就滑入执行。

**Architecture:** 在现有 task 工具不变的前提下，增加一层 route-scoped planning controller，由三个定向注入点组成：`prompt-composer` 的深度规划覆盖层、`openai-responses-driver` 的 MiniMax request patch、`sessions` 的规划完整性 gate 与自动续规划提示。

**Tech Stack:** TypeScript, Vitest, existing session orchestration loop, OpenAI Responses protocol driver

---

### Task 1: 补齐 route-scoped prompt 测试

**Files:**
- Modify: `tests/model-runtime/unit/prompt-composer.test.ts`

**Step 1: 写失败测试**

新增断言，验证当输入满足以下条件时：
- `providerFamily = "br-minimax"`
- `protocolTarget = "openai-responses"`
- `deploymentProfile = "br-private"`
- `reasoningEffort = "high"`

生成的 prompt 需要额外包含：
- 第一轮仅允许规划
- 复杂研究/分析/报告请求必须一次性创建完整任务集
- 不允许“先写多步自然语言、只建一个 task”
- 规划未覆盖信息收集 / 核心分析 / 输出整理时必须继续规划

同时保留一个对照断言，验证非该 route 不会出现这些定向文案。

**Step 2: 运行测试确认失败**

Run: `pnpm test tests/model-runtime/unit/prompt-composer.test.ts`

Expected: FAIL，因为当前 prompt 只有通用 task 规则，没有 route-specific planning overlay。

---

### Task 2: 补齐 MiniMax Responses request patch 测试

**Files:**
- Modify: `tests/model-runtime/unit/openai-responses-request-body.test.ts`

**Step 1: 写失败测试**

新增断言，验证当 `buildOpenAiResponsesRequestBody()` 满足以下条件时：
- `providerFamily = "br-minimax"`
- `reasoningEffort = "high"` 或 `"xhigh"`
- 存在 tools

请求体会显式打开更积极的 tool calling 形态：
- `parallel_tool_calls: true`

同时补一个对照断言：
- `reasoningEffort = "medium"` 或 provider family 非 `br-minimax` 时，不应因为本次改动被强行注入该字段。

**Step 2: 运行测试确认失败**

Run: `pnpm test tests/model-runtime/unit/openai-responses-request-body.test.ts`

Expected: FAIL，因为当前只有 `qwen-native` 路线会显式注入 `parallel_tool_calls: true`。

---

### Task 3: 补齐 sessions 规划完整性 gate 测试

**Files:**
- Modify: `tests/phase3-session-planning-orchestration.test.ts`

**Step 1: 写失败测试**

新增一个回归测试，构造如下场景：
- 路线为 `br-minimax + openai-responses + br-private`
- `reasoningEffort = "high"`
- 用户请求为复杂研究/分析类任务，例如分析年报
- 第一轮模型只返回一个 `task_create`
- 第二轮模型收到系统续规划提示后，再补充更多 `task_create`
- 第三轮才输出最终文本结果

需要断言：
- 第一轮后不会直接结束执行
- 会向会话注入“规划未完成，继续创建剩余任务”的提示
- `callModel` 至少被调用两次以上
- session 最终任务数大于 1，且包含后续补建的任务

**Step 2: 运行测试确认失败**

Run: `pnpm test tests/phase3-session-planning-orchestration.test.ts`

Expected: FAIL，因为当前 sessions 只阻止“规划与执行混用”，不会阻止“只建一个 task 就继续往下走”。

---

### Task 4: 实现 route-scoped planning controller

**Files:**
- Modify: `src/main/services/model-runtime/prompt-composer.ts`
- Modify: `src/main/services/model-runtime/protocols/openai-responses-driver.ts`
- Modify: `src/main/ipc/sessions.ts`
- Modify: `src/main/ipc/workflows.ts` if prompt composer signature changes

**Step 1: prompt 定向覆盖**

- 为 `ComposePromptInput` 增加 `protocolTarget`、`deploymentProfile`
- 仅在 `br-minimax + openai-responses + br-private + high/xhigh` 时追加深度规划覆盖层
- 文案保持短而硬，避免重复铺陈

**Step 2: Responses request patch**

- 在 `buildOpenAiResponsesRequestBody()` 中增加 route 判断
- 仅在目标 route 且存在 tools 时显式设置 `parallel_tool_calls: true`

**Step 3: sessions 规划完整性 gate**

- 在现有 phase gate 旁边增加 route-scoped completeness gate
- 仅在首轮、无历史 task、复杂研究/分析类请求、且本轮 task_create 数量明显不足时触发
- 允许本轮 `task_create` 正常执行写入任务
- 随后注入一条系统续规划提示，要求继续创建剩余任务，禁止进入执行

**Step 4: 自动续规划**

- gate 触发后不要报错中断
- 让主循环自然进入下一轮
- 通过注入的系统提示把模型留在 planning loop 内，直到补足任务

---

### Task 5: 验证、类型检查、乱码门禁

**Files:**
- Verify: `src/main/services/model-runtime/prompt-composer.ts`
- Verify: `src/main/services/model-runtime/protocols/openai-responses-driver.ts`
- Verify: `src/main/ipc/sessions.ts`
- Verify: `src/main/ipc/workflows.ts`
- Verify: `tests/model-runtime/unit/prompt-composer.test.ts`
- Verify: `tests/model-runtime/unit/openai-responses-request-body.test.ts`
- Verify: `tests/phase3-session-planning-orchestration.test.ts`

**Step 1: 跑定向测试**

Run:
- `pnpm test tests/model-runtime/unit/prompt-composer.test.ts`
- `pnpm test tests/model-runtime/unit/openai-responses-request-body.test.ts`
- `pnpm test tests/phase3-session-planning-orchestration.test.ts`

Expected: PASS

**Step 2: 跑类型检查**

Run: `pnpm typecheck`

Expected: PASS

**Step 3: 跑乱码检查**

Run:
`$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"; rg -n $pattern src/main/services/model-runtime/prompt-composer.ts src/main/services/model-runtime/protocols/openai-responses-driver.ts src/main/ipc/sessions.ts src/main/ipc/workflows.ts tests/model-runtime/unit/prompt-composer.test.ts tests/model-runtime/unit/openai-responses-request-body.test.ts tests/phase3-session-planning-orchestration.test.ts docs/plans/2026-04-21-minimax-responses-planning-controller-plan.md`

Expected: no matches introduced by this change set

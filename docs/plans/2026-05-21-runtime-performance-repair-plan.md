# Runtime Performance Repair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 MyClaw desktop runtime 在提问、流式输出、approval/tool 弹窗、workflow 执行过程中的明显卡顿。

**Architecture:** 先建立端到端性能观测，再按主线程同步 IO、IPC 全量广播、renderer 全量重渲染、workflow 高频 checkpoint 四条链路逐段削峰。短期保持 sql.js 和现有会话协议兼容，通过增量保存、payload 瘦身、patch stream、renderer 选择性订阅和 workflow 降频获得主要收益；native SQLite 迁移仅作为后续评估，不放入本轮修复主线。

**Tech Stack:** TypeScript、Electron main/preload/renderer、React、Zustand、Vitest、React Testing Library、sql.js、现有 model-runtime、workflow pregel runner、desktop IPC contracts。

---

## 全局约束

- 执行前先确认工作树已有修改，禁止回滚用户现有改动。
- 所有新增/修改文本必须使用 UTF-8，编辑中文文件后必须复读目标行确认可读。
- 所有新增或触达的方法必须写中文注释；关键路径必须写中文日志，日志需要覆盖成功、跳过、降级、失败原因。
- 小步 TDD：每个任务先写失败测试，再实现，再跑目标测试。
- 改动契约时必须同步更新 shared contracts、main、preload、renderer store、测试。
- 先不要引入 native SQLite，不要大规模重写 UI，不要修改无关页面样式。
- 每个任务完成后单独提交，提交前执行本任务目标测试和乱码门禁。

## 性能验收目标

- 长会话输入框打字：P95 <= 50ms。
- approval/tool 弹窗打开：P95 <= 120ms。
- 本地 mock 首 token：P95 <= 250ms。
- stream delta 到 renderer store flush：P95 <= 34ms。
- 小 workflow checkpoint：P95 <= 50ms。
- 大 workflow checkpoint：P95 <= 250ms。
- session 追加消息保存不再全量删除并重插所有消息。
- 大 tool input 和 approval arguments 不再默认通过 realtime IPC 全量广播。

## Feature Flags 与回滚开关

- `MYCLAW_PERF_OBSERVABILITY=0|1`
- `MYCLAW_SESSION_INCREMENTAL_SAVE=0|1`
- `MYCLAW_SESSION_DEBOUNCED_FLUSH=0|1`
- `MYCLAW_SESSION_PATCH_STREAM=0|1`
- `MYCLAW_SLIM_TOOL_EVENTS=0|1`
- `MYCLAW_WORKFLOW_CHECKPOINT_POLICY=on-interrupt|every-step|none`
- `MYCLAW_WORKFLOW_DEBUG_EVENT_LIMIT=0|300`

默认开启 P0 修复；任一 flag 设为旧行为时必须能回退。

## Task 1: 建立性能观测与预算测试

**Files:**

- Modify: `desktop/shared/contracts/session-runtime.ts`
- Modify: `desktop/src/main/services/model-runtime/execution-gateway.ts`
- Modify: `desktop/src/main/ipc/sessions.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Modify: `desktop/src/renderer/pages/ChatPage.tsx`
- Create: `desktop/src/main/services/performance/performance-metrics.ts`
- Create: `desktop/src/renderer/utils/performance-marks.ts`
- Create: `desktop/tests/model-runtime/observability/performance-telemetry.test.ts`
- Create: `desktop/tests/performance-budget-regression.test.ts`

**Step 1: 写失败测试**

新增 `desktop/tests/model-runtime/observability/performance-telemetry.test.ts`：

```ts
import { createPerformanceSpan, summarizePerformanceSpans } from "../../../src/main/services/performance/performance-metrics";

describe("performance telemetry", () => {
  it("records named spans with duration and Chinese-readable labels", () => {
    const span = createPerformanceSpan("session.save", "会话保存");
    span.end({ sessionId: "s1" });

    const summary = summarizePerformanceSpans([span.toJSON()]);

    expect(summary.totalMs).toBeGreaterThanOrEqual(0);
    expect(summary.spans[0]?.name).toBe("session.save");
    expect(summary.spans[0]?.label).toBe("会话保存");
    expect(summary.spans[0]?.attributes.sessionId).toBe("s1");
  });
});
```

新增 `desktop/tests/performance-budget-regression.test.ts`，先用 mock 数据断言预算判断函数存在：

```ts
import { assertPerformanceBudget } from "../src/main/services/performance/performance-metrics";

describe("performance budget regression", () => {
  it("fails when approval open latency exceeds budget", () => {
    expect(() => assertPerformanceBudget("approval.open", 121, { p95BudgetMs: 120 })).toThrow(/approval.open/);
  });
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/observability/performance-telemetry.test.ts desktop/tests/performance-budget-regression.test.ts
```

Expected: FAIL，模块或导出不存在。

**Step 3: 实现观测工具**

在 `desktop/src/main/services/performance/performance-metrics.ts` 中实现：

```ts
export type PerformanceSpanName =
  | "context.assembly"
  | "gateway.latency"
  | "turn.first_delta"
  | "session.save"
  | "session.flush"
  | "stream.patch_flush"
  | "approval.open"
  | "input.keystroke_commit"
  | "workflow.checkpoint_save"
  | "workflow.checkpoint_flush"
  | "workflow.checkpoint_restore";

export interface PerformanceSpanRecord {
  name: PerformanceSpanName | string;
  label: string;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  attributes: Record<string, unknown>;
}

export function createPerformanceSpan(name: PerformanceSpanName | string, label: string): {
  end(attributes?: Record<string, unknown>): void;
  toJSON(): PerformanceSpanRecord;
};

export function summarizePerformanceSpans(spans: PerformanceSpanRecord[]): {
  totalMs: number;
  spans: PerformanceSpanRecord[];
};

export function assertPerformanceBudget(name: string, actualMs: number, budget: { p95BudgetMs: number }): void;
```

实现要求：

- main process 使用 `node:perf_hooks` 的 `performance.now()`。
- renderer 使用 `globalThis.performance.now()`。
- 所有公共方法写中文注释。
- 异常时只写中文 warning，不影响主流程。

**Step 4: 接入关键链路**

- `execution-gateway.ts` 记录 gateway、protocol、first delta。
- `sessions.ts` 记录 sendMessage、context assembly、approval broadcast、tool event、session save。
- `workspace.ts` 记录 stream buffer flush 和 patch apply。
- `ChatPage.tsx` 记录 input commit 和 approval DOM open。
- `session-runtime.ts` 为 `TurnOutcome` 增加可选 `performance?: { spans?: PerformanceSpanRecord[] }`。

**Step 5: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/observability/performance-telemetry.test.ts desktop/tests/performance-budget-regression.test.ts
pnpm --dir desktop typecheck
```

Expected: PASS。

**Step 6: 提交**

```powershell
git add desktop/shared/contracts/session-runtime.ts desktop/src/main/services/performance/performance-metrics.ts desktop/src/main/services/model-runtime/execution-gateway.ts desktop/src/main/ipc/sessions.ts desktop/src/renderer/stores/workspace.ts desktop/src/renderer/pages/ChatPage.tsx desktop/src/renderer/utils/performance-marks.ts desktop/tests/model-runtime/observability/performance-telemetry.test.ts desktop/tests/performance-budget-regression.test.ts
git commit -m "perf(desktop): 增加运行时性能观测"
```

## Task 2: 修复 SessionDatabase 全量消息重写和同步 flush

**Files:**

- Modify: `desktop/src/main/services/session-database.ts`
- Modify: `desktop/src/main/services/state-persistence.ts`
- Test: `desktop/tests/session-database-incremental-save.test.ts`
- Test: `desktop/tests/session-performance.test.ts`

**Step 1: 写失败测试**

新增 `desktop/tests/session-database-incremental-save.test.ts`：

```ts
describe("SessionDatabase incremental message save", () => {
  it("appends one new message without deleting existing message rows", () => {
    const database = createInstrumentedSessionDatabase();
    database.saveSession(buildSessionWithMessages(["m1", "m2"]));
    database.resetSqlCounters();

    database.saveSession(buildSessionWithMessages(["m1", "m2", "m3"]));

    expect(database.sqlCounters.deleteMessages).toBe(0);
    expect(database.sqlCounters.insertMessages).toBe(1);
  });

  it("rewrites only the changed suffix when a middle message changes", () => {
    const database = createInstrumentedSessionDatabase();
    database.saveSession(buildSessionWithMessages(["m1", "m2", "m3"]));
    database.resetSqlCounters();

    database.saveSession(buildSessionWithMessages(["m1", "m2-changed", "m3"]));

    expect(database.sqlCounters.deleteMessagesFromSeq).toBe(1);
    expect(database.sqlCounters.insertMessages).toBe(2);
  });
});
```

新增 `desktop/tests/session-performance.test.ts`：

```ts
describe("session save performance", () => {
  it("coalesces repeated flush requests", async () => {
    const database = createInstrumentedSessionDatabase({ debouncedFlushMs: 50 });

    database.saveSession(buildLargeSession(500));
    database.saveSession(buildLargeSession(501));
    database.saveSession(buildLargeSession(502));

    await database.waitForPendingFlushForTest();

    expect(database.flushCount).toBe(1);
  });
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/session-database-incremental-save.test.ts desktop/tests/session-performance.test.ts
```

Expected: FAIL，当前实现会删除并重插全部消息，flush 次数过多。

**Step 3: 实现增量保存**

在 `session-database.ts` 中：

- 保留 session metadata UPSERT。
- 将 message 序列化逻辑抽成内部方法，例如 `serializeMessageRowForSave`。
- 新增内部方法 `loadExistingMessageRows(sessionId)`。
- 比较 existing rows 与 desired rows。
- 如果只追加，直接 insert suffix。
- 如果中间不同，删除 `seq >= firstChangedSeq` 后重插 suffix。
- 如果消息数量变少，删除多余 suffix。
- 任何异常写中文 warning，并 fallback 到旧全量重写路径。
- `MYCLAW_SESSION_INCREMENTAL_SAVE=0` 时强制旧路径。

**Step 4: 实现 debounce flush**

在 `session-database.ts` 中：

- 新增 `markDirty()`、`scheduleFlush()`、`flushNow(reason)`。
- 普通 `saveSession()` 只 schedule flush。
- app close、terminal state、critical approval 使用 `flushNow()`。
- `MYCLAW_SESSION_DEBOUNCED_FLUSH=0` 时保持旧同步 flush。
- 增加中文日志：计划 flush、合并 flush、立即 flush、flush 失败。

在 `state-persistence.ts` 中：

- 对 terminal save 或 shutdown 路径调用 `flushNow("应用退出或会话终态保存")`。
- 保持现有 public API 兼容。

**Step 5: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/session-database-incremental-save.test.ts desktop/tests/session-performance.test.ts
pnpm --dir desktop test desktop/tests/model-runtime/integration/sessions-execution-gateway.test.ts
pnpm --dir desktop typecheck
```

Expected: PASS。

**Step 6: 提交**

```powershell
git add desktop/src/main/services/session-database.ts desktop/src/main/services/state-persistence.ts desktop/tests/session-database-incremental-save.test.ts desktop/tests/session-performance.test.ts
git commit -m "perf(desktop): 增量保存会话消息"
```

## Task 3: 瘦身 tool 与 approval IPC payload

**Files:**

- Modify: `desktop/shared/contracts/events.ts`
- Modify: `desktop/shared/contracts/approval.ts`
- Modify: `desktop/src/main/ipc/sessions.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/session-stream-budget.test.ts`
- Test: `desktop/tests/workspace-approval-store.test.ts`
- Test: `desktop/tests/phase3-approval.test.ts`

**Step 1: 写失败测试**

新增 `desktop/tests/session-stream-budget.test.ts`：

```ts
describe("session stream payload budget", () => {
  it("omits large tool input from realtime tool started events", () => {
    const event = buildToolStartedEvent({
      input: { content: "x".repeat(100_000) },
    });

    expect(JSON.stringify(event).length).toBeLessThan(16_384);
    expect(event.payload.inputPreview).toContain("x");
    expect(event.payload.inputBytes).toBeGreaterThan(100_000);
    expect(event.payload.omittedKeys).toContain("input");
  });

  it("keeps full approval arguments behind detail loading", () => {
    const event = buildApprovalRequestedEvent({
      argumentsJson: { content: "x".repeat(100_000) },
    });

    expect(event.payload.argumentsJson).toBeUndefined();
    expect(event.payload.inputHash).toMatch(/^[a-f0-9]+$/);
    expect(event.payload.inputPreview.length).toBeLessThanOrEqual(2048);
  });
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/session-stream-budget.test.ts desktop/tests/workspace-approval-store.test.ts desktop/tests/phase3-approval.test.ts
```

Expected: FAIL，当前 payload 仍包含完整 input 或 arguments。

**Step 3: 扩展契约**

在 shared contracts 中新增：

```ts
export interface PayloadPreview {
  inputPreview: string;
  inputBytes: number;
  inputHash: string;
  omittedKeys: string[];
}

export interface ApprovalDetailRequest {
  approvalId: string;
}

export interface ApprovalDetailResponse {
  approvalId: string;
  argumentsJson: unknown;
}
```

实现要求：

- 所有新增类型写中文注释。
- preview 上限默认 2048 字符。
- budget soft limit 16KB，hard limit 64KB。

**Step 4: 修改 main IPC**

在 `sessions.ts` 中：

- `tool.started` 改为发送 `PayloadPreview`。
- `approval.requested` 改为只发送 UI 卡片字段和 preview。
- main process 保存 full arguments 到 approval registry。
- 新增 `approval:get-detail` handler，按 `approvalId` 返回完整 arguments。
- 查不到 detail 时写中文 warning 并返回结构化错误。

**Step 5: 修改 preload 与 renderer store**

- `preload/index.ts` 暴露 `approval.getDetail(approvalId)`。
- `electron.d.ts` 同步类型。
- `workspace.ts` 存储 preview，只有用户展开详情或执行需要时拉 full detail。

**Step 6: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/session-stream-budget.test.ts desktop/tests/workspace-approval-store.test.ts desktop/tests/phase3-approval.test.ts
pnpm --dir desktop typecheck
```

Expected: PASS。

**Step 7: 提交**

```powershell
git add desktop/shared/contracts/events.ts desktop/shared/contracts/approval.ts desktop/src/main/ipc/sessions.ts desktop/src/preload/index.ts desktop/src/renderer/types/electron.d.ts desktop/src/renderer/stores/workspace.ts desktop/tests/session-stream-budget.test.ts desktop/tests/workspace-approval-store.test.ts desktop/tests/phase3-approval.test.ts
git commit -m "perf(desktop): 瘦身工具和审批事件载荷"
```

## Task 4: 新增 session patch stream 与 renderer patch apply

**Files:**

- Modify: `desktop/shared/contracts/events.ts`
- Create: `desktop/shared/contracts/session-stream.ts`
- Modify: `desktop/src/main/ipc/sessions.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/session-stream-contracts.test.ts`
- Test: `desktop/tests/session-stream-subscription.test.ts`
- Test: `desktop/tests/workspace-session-patch-store.test.ts`

**Step 1: 写失败测试**

新增 `desktop/tests/session-stream-contracts.test.ts`：

```ts
import type { SessionPatchPayload, SessionStreamEnvelopeV2 } from "../shared/contracts/session-stream";

describe("session stream contracts", () => {
  it("represents message append as a small patch", () => {
    const envelope: SessionStreamEnvelopeV2<SessionPatchPayload> = {
      version: 2,
      id: "evt-1",
      seq: 1,
      createdAt: "2026-05-21T00:00:00.000Z",
      type: "session.patched",
      scope: { kind: "session", id: "s1" },
      payload: {
        sessionId: "s1",
        revision: 2,
        kind: "messages.append",
        messages: [],
      },
    };

    expect(envelope.payload.kind).toBe("messages.append");
  });
});
```

新增 `desktop/tests/workspace-session-patch-store.test.ts`：

```ts
describe("workspace session patch store", () => {
  it("appends messages without replacing unrelated session fields", () => {
    const store = createWorkspaceStoreForTest();
    store.setSession(buildSession({ id: "s1", title: "旧标题", messages: [message("m1")] }));

    store.applySessionPatch({
      sessionId: "s1",
      revision: 2,
      kind: "messages.append",
      messages: [message("m2")],
    });

    expect(store.getState().sessions["s1"]?.title).toBe("旧标题");
    expect(store.getState().sessions["s1"]?.messages).toHaveLength(2);
  });
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/session-stream-contracts.test.ts desktop/tests/session-stream-subscription.test.ts desktop/tests/workspace-session-patch-store.test.ts
```

Expected: FAIL，契约和 store 方法不存在。

**Step 3: 新增契约**

在 `desktop/shared/contracts/session-stream.ts` 中新增：

```ts
export type SessionPatchPayload =
  | { sessionId: string; revision: number; kind: "session.fields"; fields: Partial<ChatSession> }
  | { sessionId: string; revision: number; kind: "messages.append"; messages: ChatMessage[] }
  | { sessionId: string; revision: number; kind: "messages.update"; messageId: string; fields: Partial<ChatMessage> }
  | { sessionId: string; revision: number; kind: "tasks.replace"; tasks: Task[] }
  | { sessionId: string; revision: number; kind: "runState.set"; chatRunState: ChatSession["chatRunState"] };

export interface SessionStreamEnvelopeV2<TPayload> {
  version: 2;
  id: string;
  seq: number;
  createdAt: string;
  type: string;
  scope?: { kind: "session" | "artifact" | "workflow" | "global"; id?: string };
  payload: TPayload;
  budget?: { bytes: number; truncated?: boolean; omittedKeys?: string[] };
}
```

**Step 4: 修改 main broadcast**

在 `sessions.ts` 中：

- 新增 per-session revision。
- 对消息追加、消息更新、任务替换、runState 变更发 `session.patched`。
- 保留 legacy `session.updated`，但仅在 flag 关闭或兼容订阅需要时发送。
- patch 超出 hard limit 时发 `session.snapshot.available`。
- 写中文日志说明 patch 类型、revision、payload bytes。

**Step 5: 新增订阅过滤**

- main process 维护 `webContents.id -> SessionStreamSubscription`。
- preload 暴露 `sessionStream.subscribe(options)`。
- renderer 页面 mount 时只订阅当前 session。
- WorkFilesPanel 后续只订阅 artifact scope。

**Step 6: 修改 renderer store**

在 `workspace.ts` 中新增：

- `applySessionPatch(patch: SessionPatchPayload): void`
- revision 旧包丢弃。
- revision gap 触发 snapshot reload。
- `messages.append` 只追加，不全量替换 session。
- `messages.update` 只更新目标 message。
- 任何无法应用的 patch 写中文 warning，并请求 snapshot。

**Step 7: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/session-stream-contracts.test.ts desktop/tests/session-stream-subscription.test.ts desktop/tests/workspace-session-patch-store.test.ts
pnpm --dir desktop test desktop/tests/model-runtime/integration/sessions-execution-gateway.test.ts
pnpm --dir desktop typecheck
```

Expected: PASS。

**Step 8: 提交**

```powershell
git add desktop/shared/contracts/events.ts desktop/shared/contracts/session-stream.ts desktop/src/main/ipc/sessions.ts desktop/src/preload/index.ts desktop/src/renderer/types/electron.d.ts desktop/src/renderer/stores/workspace.ts desktop/tests/session-stream-contracts.test.ts desktop/tests/session-stream-subscription.test.ts desktop/tests/workspace-session-patch-store.test.ts
git commit -m "perf(desktop): 增加会话增量事件流"
```

## Task 5: 拆分 ChatPage 渲染热点

**Files:**

- Modify: `desktop/src/renderer/pages/ChatPage.tsx`
- Create: `desktop/src/renderer/components/chat/ChatTimeline.tsx`
- Create: `desktop/src/renderer/components/chat/VirtualMessageList.tsx`
- Create: `desktop/src/renderer/components/chat/MessageRow.tsx`
- Create: `desktop/src/renderer/components/chat/MessageContent.tsx`
- Create: `desktop/src/renderer/components/chat/ChatComposer.tsx`
- Create: `desktop/src/renderer/components/chat/ApprovalQueue.tsx`
- Create: `desktop/src/renderer/components/chat/ConfirmDialogHost.tsx`
- Create: `desktop/src/renderer/utils/message-render-cache.ts`
- Test: `desktop/tests/chat-page-performance.test.tsx`
- Test: `desktop/tests/message-render-cache.test.ts`
- Modify: `desktop/tests/chat-page-cache-usage.test.tsx`
- Modify: `desktop/tests/inline-file-references.test.tsx`

**Step 1: 写失败测试**

新增 `desktop/tests/chat-page-performance.test.tsx`：

```tsx
describe("ChatPage render performance", () => {
  it("does not rerender visible message rows when typing in the composer", async () => {
    const renderCounter = createRenderCounter("MessageRow");
    render(<ChatPageWithSession messageCount={500} renderCounter={renderCounter} />);

    renderCounter.reset();
    await userEvent.type(screen.getByRole("textbox"), "hello world");

    expect(renderCounter.count("MessageRow")).toBe(0);
  });

  it("opens approval dialog without reparsing all markdown messages", async () => {
    const markdownSpy = vi.spyOn(markdownRenderer, "renderMarkdown");
    render(<ChatPageWithSession messageCount={500} approvalCount={1} />);

    markdownSpy.mockClear();
    await userEvent.click(screen.getByRole("button", { name: /审批|approval/i }));

    expect(markdownSpy).not.toHaveBeenCalled();
  });
});
```

新增 `desktop/tests/message-render-cache.test.ts`：

```ts
import { createMessageRenderCache } from "../src/renderer/utils/message-render-cache";

describe("message render cache", () => {
  it("returns cached markdown html for unchanged message content", () => {
    const cache = createMessageRenderCache({ maxEntries: 2 });
    const first = cache.getOrRenderMarkdown({ messageId: "m1", content: "hello" }, () => "<p>hello</p>");
    const second = cache.getOrRenderMarkdown({ messageId: "m1", content: "hello" }, () => "<p>changed</p>");

    expect(first.html).toBe("<p>hello</p>");
    expect(second.html).toBe("<p>hello</p>");
  });
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/chat-page-performance.test.tsx desktop/tests/message-render-cache.test.ts
```

Expected: FAIL，组件或缓存不存在。

**Step 3: 实现 message render cache**

在 `message-render-cache.ts` 中：

- 缓存 key：`messageId + contentHash + renderMode`。
- 支持 markdown html、A2UI parse result、inline file refs metadata。
- LRU 默认 500。
- 公共方法写中文注释。
- cache miss/hit 可在 debug flag 下写中文日志。

**Step 4: 拆分 ChatPage**

- `ChatPage.tsx` 保留 routing、session id、IPC side effects。
- `ChatComposer` 内部维护 draft，提交时回调给父层。
- `ApprovalQueue` 使用窄 selector 读取 approval state。
- `ConfirmDialogHost` portal 化，避免重渲染 timeline。
- `ChatTimeline` 只接收 message ids 和必要 session 状态。
- `MessageRow` 使用 `React.memo`。
- `MessageContent` 负责选择 markdown/A2UI/html 渲染路径。

**Step 5: 修复重复 markdown parse**

- 如果 message 已有可信/sanitized html，不再传给 MarkdownView 二次 parse。
- inline file refs 只对可见 message 执行。
- `InlineFileReferenceContent` 的 DOM 遍历结果进入 cache。

**Step 6: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/chat-page-performance.test.tsx desktop/tests/message-render-cache.test.ts desktop/tests/chat-page-cache-usage.test.tsx desktop/tests/inline-file-references.test.tsx
pnpm --dir desktop typecheck
```

Expected: PASS。

**Step 7: 提交**

```powershell
git add desktop/src/renderer/pages/ChatPage.tsx desktop/src/renderer/components/chat desktop/src/renderer/utils/message-render-cache.ts desktop/tests/chat-page-performance.test.tsx desktop/tests/message-render-cache.test.ts desktop/tests/chat-page-cache-usage.test.tsx desktop/tests/inline-file-references.test.tsx
git commit -m "perf(desktop): 拆分聊天页渲染热点"
```

## Task 6: 修复 SiliconPersonWorkspacePage 全 store 订阅与消息全量渲染

**Files:**

- Modify: `desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx`
- Create: `desktop/src/renderer/components/silicon/SiliconWorkspaceShell.tsx`
- Create: `desktop/src/renderer/components/silicon/SiliconChatTab.tsx`
- Create: `desktop/src/renderer/components/silicon/SiliconComposer.tsx`
- Create: `desktop/src/renderer/components/silicon/SiliconApprovalQueue.tsx`
- Create: `desktop/src/renderer/components/silicon/SiliconTasksTab.tsx`
- Test: `desktop/tests/silicon-person-workspace-performance.test.tsx`
- Modify: `desktop/tests/silicon-person-studio-page.test.ts`

**Step 1: 写失败测试**

新增 `desktop/tests/silicon-person-workspace-performance.test.tsx`：

```tsx
describe("SiliconPersonWorkspacePage performance", () => {
  it("does not rerender chat tab for unrelated workspace store updates", () => {
    const counter = createRenderCounter("SiliconChatTab");
    render(<SiliconPersonWorkspacePageWithSession renderCounter={counter} />);

    counter.reset();
    act(() => updateUnrelatedWorkspaceField());

    expect(counter.count("SiliconChatTab")).toBe(0);
  });

  it("virtualizes long silicon chat history", () => {
    render(<SiliconPersonWorkspacePageWithSession messageCount={1000} />);

    expect(screen.getAllByTestId("silicon-message-row").length).toBeLessThan(80);
  });
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/silicon-person-workspace-performance.test.tsx desktop/tests/silicon-person-studio-page.test.ts
```

Expected: FAIL，当前页面裸订阅 store 且消息未虚拟化。

**Step 3: 拆分 Silicon 页面**

- `SiliconPersonWorkspacePage.tsx` 只保留路由和布局壳。
- `SiliconWorkspaceShell` 接收人物 id、当前 tab。
- `SiliconChatTab` 使用 message ids 和虚拟列表。
- `SiliconComposer` 独立 draft state。
- `SiliconApprovalQueue` 窄订阅当前 session approval。
- `SiliconTasksTab` 只订阅 task slice。

**Step 4: 收窄 Zustand selector**

- 禁止 `useWorkspaceStore()` 无 selector。
- 每个子组件只选择所需字段。
- selector 返回对象时使用 shallow compare。
- 对计算派生数据使用 memoized selector 或组件内 `useMemo`。

**Step 5: 接入虚拟化和渲染缓存**

- Silicon chat 复用 `VirtualMessageList` 或同等结构。
- 复用 `MessageContent` 和 `message-render-cache`。
- 避免把已渲染 HTML 传入 MarkdownView。

**Step 6: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/silicon-person-workspace-performance.test.tsx desktop/tests/silicon-person-studio-page.test.ts
pnpm --dir desktop typecheck
```

Expected: PASS。

**Step 7: 提交**

```powershell
git add desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx desktop/src/renderer/components/silicon desktop/tests/silicon-person-workspace-performance.test.tsx desktop/tests/silicon-person-studio-page.test.ts
git commit -m "perf(desktop): 优化硅基人工作区渲染"
```

## Task 7: 降低 workflow checkpoint 和 flush 频率

**Files:**

- Modify: `desktop/src/main/ipc/workflows.ts`
- Modify: `desktop/src/main/services/workflow/pregel-runner.ts`
- Modify: `desktop/src/main/services/workflow/sqlite-checkpointer.ts`
- Test: `desktop/tests/workflow-engine-checkpoint.test.ts`
- Test: `desktop/tests/workflow-checkpoint-performance.test.ts`

**Step 1: 写失败测试**

新增 `desktop/tests/workflow-engine-checkpoint.test.ts`：

```ts
describe("workflow checkpoint policy", () => {
  it("saves checkpoints only on interrupt by default", async () => {
    const runner = createPregelRunnerForTest({ checkpointPolicy: "on-interrupt" });

    await runner.runUntilComplete(simpleThreeStepWorkflow());

    expect(runner.checkpointer.saveCount).toBe(1);
    expect(runner.checkpointer.lastSaveReason).toBe("run-complete");
  });

  it("keeps every-step policy for debug rollback", async () => {
    const runner = createPregelRunnerForTest({ checkpointPolicy: "every-step" });

    await runner.runUntilComplete(simpleThreeStepWorkflow());

    expect(runner.checkpointer.saveCount).toBeGreaterThanOrEqual(3);
  });
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/workflow-engine-checkpoint.test.ts desktop/tests/workflow-checkpoint-performance.test.ts
```

Expected: FAIL，当前默认 every-step。

**Step 3: 实现 checkpoint policy**

在 `pregel-runner.ts` 中：

- 新增 `shouldSaveCheckpoint(reason)`。
- 支持 `none`、`on-interrupt`、`every-step`。
- 默认 `on-interrupt`。
- `run-complete`、`interrupt`、`before-quit` 强制保存。
- 每次跳过 checkpoint 写中文 debug 日志，说明策略和原因。

在 `workflows.ts` 中：

- 默认 policy 从 `every-step` 改为 env 或 `on-interrupt`。
- debug/dev 显式传入 `every-step`。

**Step 4: 实现 checkpointer debounce flush**

在 `sqlite-checkpointer.ts` 中：

- `saveCheckpoint()` 只标记 dirty。
- 普通 flush debounce 500-1000ms。
- interrupt、run-complete、before-quit 调 `flushNow()`。
- flush 异常写中文 warning 并保留旧 fallback。

**Step 5: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/workflow-engine-checkpoint.test.ts desktop/tests/workflow-checkpoint-performance.test.ts
pnpm --dir desktop typecheck
```

Expected: PASS。

**Step 6: 提交**

```powershell
git add desktop/src/main/ipc/workflows.ts desktop/src/main/services/workflow/pregel-runner.ts desktop/src/main/services/workflow/sqlite-checkpointer.ts desktop/tests/workflow-engine-checkpoint.test.ts desktop/tests/workflow-checkpoint-performance.test.ts
git commit -m "perf(desktop): 降低工作流检查点频率"
```

## Task 8: 收敛 workflow 事件、artifact 刷新和 task projection

**Files:**

- Modify: `desktop/src/renderer/stores/workflow-runs.ts`
- Modify: `desktop/src/renderer/components/workflow/WorkflowDebugPanel.tsx`
- Modify: `desktop/src/renderer/components/workfiles/WorkFilesPanel.tsx`
- Modify: `desktop/src/main/ipc/workflows.ts`
- Modify: `desktop/src/main/services/agent-tasks.ts`
- Test: `desktop/tests/workflow-debug-panel.test.tsx`
- Test: `desktop/tests/work-files-panel-stream-filter.test.ts`
- Test: `desktop/tests/silicon-person-workflow-run.test.ts`

**Step 1: 写失败测试**

新增 `desktop/tests/work-files-panel-stream-filter.test.ts`：

```ts
describe("WorkFilesPanel workflow stream filter", () => {
  it("does not reload artifacts for checkpoint or state update events", () => {
    const panel = renderWorkFilesPanelForTest();

    panel.emitWorkflowEvent({ type: "checkpoint-saved" });
    panel.emitWorkflowEvent({ type: "state-updated" });

    expect(panel.artifactReloadCount).toBe(0);
  });

  it("reloads artifacts for artifact changed events", () => {
    const panel = renderWorkFilesPanelForTest();

    panel.emitWorkflowEvent({ type: "artifact.changed", artifactId: "a1" });

    expect(panel.artifactReloadCount).toBe(1);
  });
});
```

新增 `desktop/tests/workflow-debug-panel.test.tsx`：

```tsx
describe("WorkflowDebugPanel performance", () => {
  it("renders a bounded event window", () => {
    render(<WorkflowDebugPanelWithEvents count={1000} />);

    expect(screen.getAllByTestId("workflow-debug-event").length).toBeLessThanOrEqual(300);
  });
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/workflow-debug-panel.test.tsx desktop/tests/work-files-panel-stream-filter.test.ts desktop/tests/silicon-person-workflow-run.test.ts
```

Expected: FAIL，当前事件无界且 artifact reload 过宽。

**Step 3: renderer workflow event ring buffer**

在 `workflow-runs.ts` 中：

- 默认最多保留 300 条事件。
- `MYCLAW_WORKFLOW_DEBUG_EVENT_LIMIT=0` 可禁用 cap。
- `node-streaming` 合并或采样。
- 大 `state-updated.value` 存 summary，不存完整对象。
- 写中文日志说明事件被压缩或丢弃。

**Step 4: DebugPanel 窗口化渲染**

- 只渲染最近 N 条。
- 大对象默认折叠，不在 render 中全量 `JSON.stringify`。
- 提供显式“加载完整日志”的入口，后续再接 main-side pagination。

**Step 5: WorkFilesPanel 只响应 artifact 事件**

- 忽略 checkpoint、state update、node streaming。
- 只对 `artifact.changed`、`artifact.created`、`artifact.deleted` reload。
- reload 做 debounce。

**Step 6: task projection 降频**

在 `workflows.ts` 和 `agent-tasks.ts` 中：

- 只让 `node-start`、`node-complete`、`node-error`、`run-complete` 进入 task projection。
- 跳过 `checkpoint-saved`、`state-updated`、`node-streaming`。
- task save 和 broadcast debounce 100-300ms。
- 保留 terminal flush。

**Step 7: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/workflow-debug-panel.test.tsx desktop/tests/work-files-panel-stream-filter.test.ts desktop/tests/silicon-person-workflow-run.test.ts
pnpm --dir desktop typecheck
```

Expected: PASS。

**Step 8: 提交**

```powershell
git add desktop/src/renderer/stores/workflow-runs.ts desktop/src/renderer/components/workflow/WorkflowDebugPanel.tsx desktop/src/renderer/components/workfiles/WorkFilesPanel.tsx desktop/src/main/ipc/workflows.ts desktop/src/main/services/agent-tasks.ts desktop/tests/workflow-debug-panel.test.tsx desktop/tests/work-files-panel-stream-filter.test.ts desktop/tests/silicon-person-workflow-run.test.ts
git commit -m "perf(desktop): 收敛工作流事件处理"
```

## Task 9: 集成验证、乱码门禁和回滚演练

**Files:**

- Modify: `docs/plans/2026-05-21-runtime-performance-repair-plan.md` only if execution notes need updates.
- No production code changes unless previous tasks expose missing integration wiring.

**Step 1: 运行核心测试**

Run:

```powershell
pnpm --dir desktop test desktop/tests/session-database-incremental-save.test.ts desktop/tests/session-performance.test.ts
pnpm --dir desktop test desktop/tests/session-stream-budget.test.ts desktop/tests/workspace-session-patch-store.test.ts
pnpm --dir desktop test desktop/tests/chat-page-performance.test.tsx desktop/tests/silicon-person-workspace-performance.test.tsx
pnpm --dir desktop test desktop/tests/workflow-engine-checkpoint.test.ts desktop/tests/workflow-debug-panel.test.tsx
pnpm --dir desktop typecheck
```

Expected: PASS。

**Step 2: 运行现有相关回归**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/integration/sessions-execution-gateway.test.ts
pnpm --dir desktop test desktop/tests/phase3-approval.test.ts desktop/tests/workspace-approval-store.test.ts
pnpm --dir desktop test desktop/tests/silicon-person-studio-page.test.ts
```

Expected: PASS。

**Step 3: 执行乱码门禁**

Run from repo root:

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern desktop docs
```

Expected: 本次修改文件无命中。若历史文件命中，记录为既有问题，不和本次提交混在一起修。

**Step 4: 回滚开关演练**

Run:

```powershell
$env:MYCLAW_SESSION_INCREMENTAL_SAVE="0"
$env:MYCLAW_SESSION_DEBOUNCED_FLUSH="0"
$env:MYCLAW_SESSION_PATCH_STREAM="0"
$env:MYCLAW_SLIM_TOOL_EVENTS="0"
$env:MYCLAW_WORKFLOW_CHECKPOINT_POLICY="every-step"
pnpm --dir desktop test desktop/tests/model-runtime/integration/sessions-execution-gateway.test.ts desktop/tests/phase3-approval.test.ts
```

Expected: PASS，旧行为兼容路径可用。

**Step 5: 手动冒烟**

Run:

```powershell
pnpm --dir desktop dev
```

Manual checks:

- 打开已有长会话，连续输入 30 个字符，输入框无明显卡顿。
- 发送一条普通问题，首 token 和流式输出无明显冻结。
- 触发 tool call，tool started 事件不携带完整大 input。
- 触发 approval，弹窗打开顺滑，点击查看详情时才拉完整参数。
- 打开 Silicon workspace 长消息会话，滚动不卡顿。
- 运行 workflow，checkpoint 不再每步 flush，debug panel 不渲染无限事件。

**Step 6: 最终提交**

```powershell
git status --short
git commit -m "perf(desktop): 修复运行时卡顿链路"
```

如果前面每个任务已单独提交，则此步骤只用于补充遗漏文档或最终整合。

## 非本轮范围

- native SQLite / WAL 迁移。
- 全量重写 ChatPage 视觉样式。
- 大规模替换 Zustand 或 React state 管理。
- workflow debug 日志持久化分页的完整产品化。
- provider cache、模型协议策略、云端能力同步等与 runtime 卡顿无直接关系的优化。

## 执行优先级

1. Task 1：先有观测，不再盲修。
2. Task 2：先砍主线程同步 IO 和全量消息重写。
3. Task 3：先让大 payload 不再默认广播。
4. Task 4：用 patch stream 减少 full session update。
5. Task 5-6：拆 renderer 热点，解决输入和弹窗牵动全页面。
6. Task 7-8：workflow 降频，解决执行过程越跑越卡。
7. Task 9：集成验证、乱码门禁、回滚演练。

这份计划的修复重心是把“每个小动作都触发全量工作”的路径改成“只处理变化本身”。实现时不要跳过测试和 feature flag，否则性能修复一旦出问题会很难定位。

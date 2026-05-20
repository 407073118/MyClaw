# Workflow Visible Output Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让工作流可以把节点产物明确配置为最终输出，并在硅基员工对话中把工作流结果作为 assistant 消息展示出来。

**Architecture:** 第一版不新增独立节点类型，先补齐已有 `end.outputSources` 的编辑能力，并在 workflow run 完成后把 `finalState.outputs` 转成对话消息。这样复用现有 runtime、`outputs` channel、`session.updated` 事件和 ChatPage 渲染链路，避免同时改协议、画布和模型工具调用。

**Tech Stack:** Electron main IPC, React + Testing Library, Vitest, TypeScript, existing workflow Pregel runner, shared contracts in `shared/contracts`.

---

## 背景与边界

当前事实：

- `WorkflowNodeKind.End` 已存在，契约在 `shared/contracts/workflow.ts`。
- `EndNodeExecutor` 已支持 `outputSources`，会写入 `outputs` channel 和 `__done__`。
- Studio 目前只能配置 `start/end` 的标签和阶段说明，不能配置 `end.outputSources`。
- workflow run 完成后会把 `finalState.outputs` 写入 `WorkflowRunSummary.outputs`，但不会把结果追加到 `ChatSession.messages`。
- ChatPage 已订阅 `session:stream` 的 `session.updated` 事件，拿到完整 session 后会调用 `workspace.applySessionUpdate()`。

第一版明确不做：

- 不新增 `answer` / `reply` / `output` 节点类型。
- 不改 LLM 节点的 tool calling，天气类能力短期通过 Tool / HTTP 节点完成。
- 不改 workflow stream 事件契约，先从 `result.finalState.outputs` 取最终输出。

执行前请先确认工作区：

```powershell
cd F:\MyClaw\desktop
git status --short
```

如果当前工作区已有用户改动，只读取相关文件并避免无关回滚。中文文件修改前后都要重新打开目标行确认可读。

---

### Task 1: 为工作流最终输出选择规则添加纯函数

**Files:**

- Create: `src/main/services/workflow-output-message.ts`
- Create: `tests/workflow-output-message.test.ts`

**Step 1: Write the failing test**

Create `tests/workflow-output-message.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildWorkflowOutputMessageContent,
  resolveWorkflowOutputText,
} from "../src/main/services/workflow-output-message";

describe("workflow output message", () => {
  it("优先使用 answer 字段作为对话输出", () => {
    expect(resolveWorkflowOutputText({ output: "备用", answer: "今天北京晴，21℃。" })).toBe("今天北京晴，21℃。");
  });

  it("在没有 answer 时按常见输出字段回退", () => {
    expect(resolveWorkflowOutputText({ result: "模型总结" })).toBe("模型总结");
    expect(resolveWorkflowOutputText({ output: "最终输出" })).toBe("最终输出");
    expect(resolveWorkflowOutputText({ message: "发给用户" })).toBe("发给用户");
  });

  it("对象输出会格式化为可读 JSON", () => {
    const text = resolveWorkflowOutputText({ answer: { city: "北京", weather: "晴" } });
    expect(text).toContain('"city": "北京"');
    expect(text).toContain('"weather": "晴"');
  });

  it("空输出不会生成消息内容", () => {
    expect(resolveWorkflowOutputText({ answer: "   " })).toBeNull();
    expect(resolveWorkflowOutputText({})).toBeNull();
    expect(resolveWorkflowOutputText(null)).toBeNull();
  });

  it("生成带工作流上下文的最终对话文案", () => {
    expect(buildWorkflowOutputMessageContent({
      workflowName: "天气查询",
      outputs: { answer: "今天上海小雨。" },
    })).toBe("今天上海小雨。");
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
pnpm vitest run tests/workflow-output-message.test.ts
```

Expected: FAIL because `src/main/services/workflow-output-message.ts` does not exist.

**Step 3: Write minimal implementation**

Create `src/main/services/workflow-output-message.ts`:

```ts
const PREFERRED_OUTPUT_KEYS = ["answer", "output", "result", "message", "content", "summary"] as const;

/** 将单个 workflow 输出值转成可展示文本，保证对话消息不会出现 [object Object]。 */
function stringifyWorkflowOutputValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.warn("[workflow:output] 最终输出 JSON 序列化失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** 从 workflow outputs 中选择最适合回到对话的文本。 */
export function resolveWorkflowOutputText(outputs: unknown): string | null {
  if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) return null;
  const record = outputs as Record<string, unknown>;

  for (const key of PREFERRED_OUTPUT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const text = stringifyWorkflowOutputValue(record[key]);
      if (text) return text;
    }
  }

  for (const value of Object.values(record)) {
    const text = stringifyWorkflowOutputValue(value);
    if (text) return text;
  }
  return null;
}

/** 生成 workflow 完成后追加到对话里的 assistant 文案。 */
export function buildWorkflowOutputMessageContent(input: {
  workflowName: string;
  outputs: unknown;
}): string | null {
  const text = resolveWorkflowOutputText(input.outputs);
  if (!text) {
    console.info("[workflow:output] 工作流没有可回流到对话的最终输出", {
      workflowName: input.workflowName,
    });
    return null;
  }
  console.info("[workflow:output] 已解析工作流最终对话输出", {
    workflowName: input.workflowName,
    outputLength: text.length,
  });
  return text;
}
```

**Step 4: Run test to verify it passes**

Run:

```powershell
pnpm vitest run tests/workflow-output-message.test.ts
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/main/services/workflow-output-message.ts tests/workflow-output-message.test.ts
git commit -m "feat: resolve workflow outputs for chat"
```

---

### Task 2: 给 End 节点增加最终输出配置 UI

**Files:**

- Create: `tests/workflow-end-output-node-editor.test.tsx`
- Modify: `src/renderer/components/workflow/WorkflowNodeEditor.tsx`

**Step 1: Write the failing test**

Create `tests/workflow-end-output-node-editor.test.tsx`:

```tsx
/** @vitest-environment jsdom */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowEndNode } from "@shared/contracts";
import WorkflowNodeEditor from "../src/renderer/components/workflow/WorkflowNodeEditor";

describe("WorkflowNodeEditor end outputs", () => {
  it("允许为结束节点绑定最终输出字段", () => {
    const onUpdateNode = vi.fn();
    const node: WorkflowEndNode = {
      id: "node-end",
      kind: "end",
      label: "结束",
    };

    render(
      <WorkflowNodeEditor
        node={node}
        variableSourceOptions={[
          {
            id: "nodes.node-llm.content",
            group: "节点输出",
            label: "天气总结.content",
            ref: { scope: "node", nodeId: "node-llm", path: "content", valueType: "string" },
          },
        ]}
        onUpdateNode={onUpdateNode}
      />,
    );

    fireEvent.click(screen.getByTestId("workflow-node-editor-end-add-output-source"));

    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({
      outputSources: {
        answer: {
          mode: "variable",
          ref: { scope: "node", nodeId: "node-llm", path: "content", valueType: "string" },
        },
      },
    }));
  });

  it("允许编辑已有结束输出字段名称", () => {
    const onUpdateNode = vi.fn();
    const node: WorkflowEndNode = {
      id: "node-end",
      kind: "end",
      label: "结束",
      outputSources: {
        answer: { mode: "static", value: "天气结果" },
      },
    };

    render(<WorkflowNodeEditor node={node} onUpdateNode={onUpdateNode} />);

    fireEvent.change(screen.getByTestId("workflow-node-editor-end-output-key-0"), {
      target: { value: "summary" },
    });

    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({
      outputSources: {
        summary: { mode: "static", value: "天气结果" },
      },
    }));
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
pnpm vitest run tests/workflow-end-output-node-editor.test.tsx
```

Expected: FAIL because the End editor has no `workflow-node-editor-end-add-output-source` control.

**Step 3: Implement the End output editor**

In `src/renderer/components/workflow/WorkflowNodeEditor.tsx`:

1. Add local helpers near existing input/output binding helpers:

```ts
/** 新增结束节点输出映射，默认把第一个可见变量绑定到 answer 字段。 */
function buildDefaultEndOutputSource(variableSourceOptions: WorkflowVariableSourceOption[]) {
  const firstVariable = variableSourceOptions[0];
  return firstVariable
    ? { mode: "variable" as const, ref: firstVariable.ref }
    : { mode: "static" as const, value: "" };
}
```

2. Add handlers inside the component:

```ts
/** 为结束节点追加一个最终输出字段，供 workflow run 完成后回流到 outputs channel。 */
function handleAddEndOutputSource() {
  if (node.kind !== "end") return;
  const current = node.outputSources ?? {};
  const key = current.answer ? `output_${Object.keys(current).length + 1}` : "answer";
  console.info("[workflow] 新增结束节点最终输出字段", { nodeId: node.id, key });
  onUpdateNode({
    ...node,
    outputSources: {
      ...current,
      [key]: buildDefaultEndOutputSource(variableSourceOptions),
    },
  });
}

/** 更新结束节点最终输出字段名称或来源。 */
function updateEndOutputSource(index: number, nextKey: string, nextSource: WorkflowNodeInputSource) {
  if (node.kind !== "end") return;
  const entries = Object.entries(node.outputSources ?? {});
  const previous = entries[index];
  if (!previous) return;
  const normalizedKey = nextKey.trim() || previous[0];
  const nextEntries = entries.map(([key, source], currentIndex) =>
    currentIndex === index ? [normalizedKey, nextSource] : [key, source],
  );
  console.info("[workflow] 更新结束节点最终输出字段", {
    nodeId: node.id,
    key: normalizedKey,
  });
  onUpdateNode({ ...node, outputSources: Object.fromEntries(nextEntries) });
}
```

3. Render an End-specific subsection after the existing `start/end` stage hint:

```tsx
{node.kind === "end" && (
  <section className="subsection">
    <div className="section-row">
      <div>
        <h5>最终输出</h5>
        <p>把上游节点结果映射成工作流完成后的 outputs。优先使用 answer 字段回到对话。</p>
      </div>
      <button
        type="button"
        className="secondary"
        data-testid="workflow-node-editor-end-add-output-source"
        onClick={handleAddEndOutputSource}
      >
        新增输出
      </button>
    </div>
    {Object.entries(node.outputSources ?? {}).map(([key, source], index) => (
      <div key={`${key}-${index}`} className="binding-row">
        <input
          data-testid={`workflow-node-editor-end-output-key-${index}`}
          value={key}
          onChange={(event) => updateEndOutputSource(index, event.target.value, source)}
        />
        <select
          data-testid={`workflow-node-editor-end-output-source-${index}`}
          value={source.mode === "variable" ? formatVariableRefForSelect(source.ref) : "__static__"}
          onChange={(event) => {
            const matched = variableSourceOptions.find((option) => formatVariableRefForSelect(option.ref) === event.target.value);
            updateEndOutputSource(index, key, matched
              ? { mode: "variable", ref: matched.ref }
              : { mode: "static", value: source.mode === "static" ? source.value : "" });
          }}
        >
          <option value="__static__">静态文本</option>
          {variableSourceOptions.map((option) => (
            <option key={option.id} value={formatVariableRefForSelect(option.ref)}>
              {option.group} / {option.label}
            </option>
          ))}
        </select>
      </div>
    ))}
  </section>
)}
```

If the existing file uses different helper names for variable select formatting, reuse the local names instead of inventing another representation. Keep styles aligned with the existing `.binding-row` and `.subsection` CSS.

**Step 4: Run test to verify it passes**

Run:

```powershell
pnpm vitest run tests/workflow-end-output-node-editor.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/renderer/components/workflow/WorkflowNodeEditor.tsx tests/workflow-end-output-node-editor.test.tsx
git commit -m "feat: configure workflow end outputs"
```

---

### Task 3: 验证 End outputSources 到 run outputs 的 runtime 链路

**Files:**

- Create: `tests/workflow-end-output-runtime.test.ts`
- Modify only if needed: `src/main/services/workflow-engine/executors/end.ts`

**Step 1: Write the test**

Create `tests/workflow-end-output-runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { WorkflowEndNode } from "@shared/contracts";
import { EndNodeExecutor } from "../src/main/services/workflow-engine/executors/end";
import { WorkflowEventEmitter } from "../src/main/services/workflow-engine/event-emitter";

describe("EndNodeExecutor outputSources", () => {
  it("把配置的 outputSources 写入 outputs channel", async () => {
    const executor = new EndNodeExecutor();
    const node: WorkflowEndNode = {
      id: "node-end",
      kind: "end",
      label: "结束",
      outputSources: {
        answer: {
          mode: "variable",
          ref: { scope: "node", nodeId: "node-llm", path: "content", valueType: "string" },
        },
      },
    };

    const result = await executor.execute({
      node,
      state: new Map([
        ["nodes", { "node-llm": { content: "今天杭州多云。" } }],
      ]),
      resolvedInputs: {},
      config: {
        recursionLimit: 10,
        workingDirectory: "F:/MyClaw",
        modelProfileId: "profile-1",
        checkpointPolicy: "none",
      },
      emitter: new WorkflowEventEmitter(),
      signal: new AbortController().signal,
      runId: "run-1",
    });

    expect(result.outputs).toEqual({ answer: "今天杭州多云。" });
    expect(result.writes).toEqual(expect.arrayContaining([
      { channelName: "outputs", value: { answer: "今天杭州多云。" } },
      { channelName: "__done__", value: true },
    ]));
  });
});
```

**Step 2: Run test**

Run:

```powershell
pnpm vitest run tests/workflow-end-output-runtime.test.ts
```

Expected: PASS if current runtime already supports this. If it fails, fix only `src/main/services/workflow-engine/executors/end.ts` or the variable resolver path handling that the failure identifies.

**Step 3: Commit**

```powershell
git add tests/workflow-end-output-runtime.test.ts src/main/services/workflow-engine/executors/end.ts
git commit -m "test: cover workflow end output mapping"
```

If no runtime file changed:

```powershell
git add tests/workflow-end-output-runtime.test.ts
git commit -m "test: cover workflow end output mapping"
```

---

### Task 4: 将硅基员工 workflow 完成输出追加到对话消息

**Files:**

- Create: `tests/workflow-chat-output-bridge.test.ts`
- Modify: `src/main/ipc/workflows.ts`
- Modify: `src/main/services/workflow-output-message.ts`

**Step 1: Write the failing test**

Create `tests/workflow-chat-output-bridge.test.ts` by following the mock style of `tests/silicon-person-workflow-run.test.ts`, but keep the fixture smaller and UTF-8 readable.

The core assertion should be:

```ts
it("工作流成功完成后把最终 answer 追加成硅基员工对话消息", async () => {
  const { registerWorkflowHandlers } = await import("../src/main/ipc/workflows");
  const ctx = buildContextWithOneSiliconPersonWorkflow();

  registerWorkflowHandlers(ctx);
  const startRunHandler = ipcHandleRegistry.get("workflow:start-run");
  expect(startRunHandler).toBeTypeOf("function");

  void startRunHandler?.({}, {
    workflowId: "workflow-1",
    initialState: {
      siliconPersonId: "sp-1",
      sessionId: "session-1",
    },
  });

  lastRunner?.finish({
    status: "succeeded",
    totalSteps: 4,
    durationMs: 30,
    finalState: {
      outputs: {
        answer: "今天上海小雨，建议带伞。",
      },
    },
  });

  await vi.waitFor(() => {
    expect(ctx.state.sessions[0]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        content: "今天上海小雨，建议带伞。",
      }),
    ]));
  });

  expect(saveSessionMock).toHaveBeenCalledWith(
    ctx.runtime.paths,
    expect.objectContaining({
      id: "session-1",
      messages: expect.arrayContaining([
        expect.objectContaining({ content: "今天上海小雨，建议带伞。" }),
      ]),
    }),
  );
});
```

Also add a negative case:

```ts
it("没有绑定 session 的普通 workflow run 不会写入对话消息", async () => {
  // Start without siliconPersonId/sessionId.
  // Finish with outputs.answer.
  // Assert all ctx.state.sessions messages stay unchanged.
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
pnpm vitest run tests/workflow-chat-output-bridge.test.ts
```

Expected: FAIL because completion currently updates `workflowRuns` only and does not append `ChatSession.messages`.

**Step 3: Implement the bridge**

In `src/main/ipc/workflows.ts`:

1. Import `EventType` and output helper:

```ts
import { EventType } from "@shared/contracts";
import { buildWorkflowOutputMessageContent } from "../services/workflow-output-message";
```

2. Add a helper near the existing workflow/session helpers:

```ts
/** 将绑定到硅基员工会话的 workflow 最终输出追加为 assistant 消息。 */
function appendWorkflowOutputToSiliconPersonSession(input: {
  ctx: RuntimeContext;
  session: ChatSession | null;
  workflow: WorkflowDefinition;
  runId: string;
  outputs: unknown;
}): void {
  const { ctx, session, workflow, runId, outputs } = input;
  if (!session) return;
  const content = buildWorkflowOutputMessageContent({
    workflowName: workflow.name,
    outputs,
  });
  if (!content) return;

  const message = {
    id: randomUUID(),
    role: "assistant" as const,
    content,
    createdAt: new Date().toISOString(),
  };
  session.messages = [...session.messages, message];

  console.info("[workflow:output] 工作流输出已追加到硅基员工对话", {
    workflowId: workflow.id,
    workflowName: workflow.name,
    runId,
    sessionId: session.id,
    messageId: message.id,
    outputLength: content.length,
  });

  trackSave(saveSession(ctx.runtime.paths, session).catch((err) => {
    console.error("[workflow:output] 保存工作流对话输出失败", {
      workflowId: workflow.id,
      runId,
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }));

  broadcastToRenderers("session:stream", {
    type: EventType.SessionUpdated,
    session,
  });
}
```

3. In the `runner.run(...).then((result) => { ... })` success path, after `completedRun` is upserted and before or after task settlement, call:

```ts
appendWorkflowOutputToSiliconPersonSession({
  ctx,
  session: siliconPersonSession,
  workflow: definition,
  runId,
  outputs: completedRun.outputs,
});
```

Use the exact local variable names from the file. If the definition variable is named differently in the handler, use that existing name. Do not append messages for failed, canceled, or waiting-input results.

**Step 4: Run focused test**

Run:

```powershell
pnpm vitest run tests/workflow-chat-output-bridge.test.ts
```

Expected: PASS.

**Step 5: Run existing workflow IPC regression**

Run:

```powershell
pnpm vitest run tests/silicon-person-workflow-run.test.ts tests/silicon-person-ipc.test.ts
```

Expected: PASS. If existing tests contain mojibake, do not rewrite them broadly; patch only failing assertions if the new message changes expected arrays.

**Step 6: Commit**

```powershell
git add src/main/ipc/workflows.ts src/main/services/workflow-output-message.ts tests/workflow-chat-output-bridge.test.ts
git commit -m "feat: return workflow outputs to chat"
```

---

### Task 5: Renderer smoke coverage for session.updated workflow messages

**Files:**

- Create: `tests/workflow-chat-output-renderer.test.tsx`
- Modify only if needed: `src/renderer/pages/ChatPage.tsx` or `src/renderer/pages/SiliconPersonWorkspacePage.tsx`

**Step 1: Write the test**

Create `tests/workflow-chat-output-renderer.test.tsx` as a small store-level or page-level regression. Prefer store-level if ChatPage setup becomes too heavy.

Minimal store-level version:

```ts
import { describe, expect, it } from "vitest";
import type { ChatSession } from "@shared/contracts";
import { useWorkspaceStore } from "../src/renderer/stores/workspace";

describe("workflow chat output renderer state", () => {
  it("session.updated with workflow assistant message becomes visible in workspace state", () => {
    const session: ChatSession = {
      id: "session-1",
      title: "天气查询",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      siliconPersonId: "sp-1",
      createdAt: "2026-05-19T00:00:00.000Z",
      messages: [{
        id: "message-1",
        role: "assistant",
        content: "今天上海小雨，建议带伞。",
        createdAt: "2026-05-19T00:01:00.000Z",
      }],
    };

    useWorkspaceStore.getState().applySessionUpdate(session);

    expect(useWorkspaceStore.getState().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "session-1",
        messages: expect.arrayContaining([
          expect.objectContaining({ content: "今天上海小雨，建议带伞。" }),
        ]),
      }),
    ]));
  });
});
```

If `applySessionUpdate` requires bootstrap state, initialize store state the same way existing workspace store tests do.

**Step 2: Run test**

Run:

```powershell
pnpm vitest run tests/workflow-chat-output-renderer.test.tsx
```

Expected: PASS if existing `applySessionUpdate` already handles full session replacement. If it fails, patch only the store merge logic.

**Step 3: Commit**

```powershell
git add tests/workflow-chat-output-renderer.test.tsx src/renderer/stores/workspace.ts src/renderer/pages/ChatPage.tsx src/renderer/pages/SiliconPersonWorkspacePage.tsx
git commit -m "test: show workflow outputs from session updates"
```

If only the test file changed:

```powershell
git add tests/workflow-chat-output-renderer.test.tsx
git commit -m "test: show workflow outputs from session updates"
```

---

### Task 6: Add a workflow example for weather-style output

**Files:**

- Modify: whichever seed/example workflow file currently creates personal workflow definitions, if one exists.
- If no seed file exists, modify docs only: `docs/plans/2026-05-19-workflow-visible-output-implementation-plan.md` or create `docs/design/workflow-visible-output.md`.

**Step 1: Search for workflow seed/examples**

Run:

```powershell
rg -n "workflowDefinitions|createWorkflow|WorkflowDefinition|end-1|http-request" src tests docs
```

Expected: identify whether there is an existing workflow template location. Do not invent a new seed system if none exists.

**Step 2: Add the smallest example**

If there is an existing template location, add a minimal example equivalent to:

```ts
{
  id: "example-weather-answer",
  name: "天气查询并回复",
  entryNodeId: "start",
  nodes: [
    { id: "start", kind: "start", label: "开始" },
    {
      id: "fetch-weather",
      kind: "http-request",
      label: "查询天气",
      httpRequest: {
        method: "GET",
        url: "https://api.example.com/weather?city={{ city }}",
        outputKey: "weatherRaw",
      },
    },
    {
      id: "summarize",
      kind: "llm",
      label: "整理回复",
      llm: {
        prompt: "请把天气数据整理成一句给用户的中文回复：{{ weatherRaw }}",
        outputKey: "weatherAnswer",
      },
    },
    {
      id: "end",
      kind: "end",
      label: "回复用户",
      outputSources: {
        answer: {
          mode: "variable",
          ref: { scope: "node", nodeId: "summarize", path: "content", valueType: "string" },
        },
      },
    },
  ],
  edges: [
    { id: "e1", fromNodeId: "start", toNodeId: "fetch-weather", kind: "normal" },
    { id: "e2", fromNodeId: "fetch-weather", toNodeId: "summarize", kind: "normal" },
    { id: "e3", fromNodeId: "summarize", toNodeId: "end", kind: "normal" },
  ],
}
```

If no seed system exists, write this as documentation only and skip runtime changes.

**Step 3: Run relevant test**

If seed code changed:

```powershell
pnpm vitest run tests/workflow-package-installer.test.ts tests/workflow-ipc.test.ts
```

If docs only changed:

```powershell
pnpm vitest run tests/workflow-output-message.test.ts tests/workflow-end-output-runtime.test.ts
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add <changed-files>
git commit -m "docs: document workflow visible output example"
```

---

### Task 7: Full verification and encoding gate

**Files:**

- No planned source edits unless verification exposes a bug.

**Step 1: Run focused workflow suite**

Run:

```powershell
pnpm vitest run tests/workflow-output-message.test.ts tests/workflow-end-output-node-editor.test.tsx tests/workflow-end-output-runtime.test.ts tests/workflow-chat-output-bridge.test.ts tests/workflow-chat-output-renderer.test.tsx
```

Expected: PASS.

**Step 2: Run existing workflow regressions**

Run:

```powershell
pnpm vitest run tests/workflow-engine-integration.test.ts tests/workflow-engine-executors.test.ts tests/workflow-run-panel.test.ts tests/workflow-studio-page.test.ts tests/silicon-person-workflow-run.test.ts
```

Expected: PASS. If failures are unrelated pre-existing mojibake/text assertions, document them instead of rewriting broad files.

**Step 3: Run typecheck**

Run:

```powershell
pnpm typecheck
```

Expected: PASS.

**Step 4: Run乱码门禁**

Run:

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern src shared tests docs *.md
```

Expected: no matches in files modified by this implementation. If existing unrelated files match, do not silently fix them; record the pre-existing paths and ensure new/modified files are clean.

**Step 5: Final commit**

If verification required small fixes:

```powershell
git add <fixed-files>
git commit -m "fix: stabilize workflow visible output"
```

---

## Acceptance Criteria

- Studio End 节点可以配置至少一个最终输出字段。
- 默认新增字段名为 `answer`，并优先绑定第一个可见变量来源。
- `EndNodeExecutor` 可以把 `outputSources.answer` 写入 `finalState.outputs.answer`。
- 硅基员工触发的 workflow 成功完成后，`outputs.answer` 会追加为该员工当前 session 的 assistant 消息。
- 普通 workflow run 或没有绑定 session 的 run 不会误写任何对话。
- 空 outputs、空字符串 outputs、失败 run、取消 run 都不会产生空白 assistant 消息。
- ChatPage / SiliconPersonWorkspacePage 能通过现有 `session.updated` 事件看到新消息。
- 新增/修改方法有中文注释，新增日志为中文且包含 workflowId/runId/sessionId 等定位字段。
- Focused Vitest、workflow regression、`pnpm typecheck` 和乱码门禁通过，或明确记录只存在于未修改文件的既有乱码。

---

## Later Phase: Answer 节点与带工具 LLM 节点

第一版完成后，再评估是否新增两类能力：

- `answer` 节点：用于 Chatflow 场景中途多次发消息，不负责结束工作流。
- Tool-enabled LLM 节点：允许 LLM 节点声明可用工具 specs，让“模型节点自己查天气”成为真实 tool calling，而不是只能通过显式 Tool / HTTP 节点。

新增节点时必须同步改：

- `shared/contracts/workflow.ts`
- `src/main/services/workflow-engine/executors/*`
- `src/main/ipc/workflows.ts` executor registry
- `src/renderer/components/workflow/workflow-node-factory.ts`
- `src/renderer/components/workflow/WorkflowCanvas.tsx`
- `src/renderer/components/workflow/WorkflowNodeEditor.tsx`
- `src/renderer/components/workflow/WorkflowGraphInspector.tsx`
- focused Vitest and renderer tests

---

## Design References

- LangGraph: `START` / `END` define graph boundary, node outputs flow through shared state.
- Dify: Workflow uses Output node, Chatflow uses Answer node; this supports separating final data output from conversational replies.
- n8n: Nodes expose execution outputs clearly and keep node-level output inspection separate from workflow-level result.

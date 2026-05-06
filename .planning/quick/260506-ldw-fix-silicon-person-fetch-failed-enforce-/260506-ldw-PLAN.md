---
quick_id: 260506-ldw
type: execute
wave: 1
depends_on: []
files_modified:
  - desktop/src/main/ipc/silicon-persons.ts
  - desktop/src/main/services/silicon-person-session.ts
  - desktop/src/main/services/model-client.ts
  - desktop/src/main/services/model-transport.ts
  - desktop/src/main/services/state-persistence.ts
  - desktop/src/renderer/pages/SiliconPersonCreatePage.tsx
  - desktop/src/renderer/pages/ChatPage.tsx
autonomous: true
requirements:
  - QUICK-260506-LDW
must_haves:
  truths:
    - "新建硅基员工时若未选择有效模型，create handler 拒绝并返回中文错误，磁盘上不会留下空 modelProfileId 的 person.json"
    - "更新硅基员工的 modelProfileId 时，若传入值不在已配置模型列表中，update handler 拒绝并保留原状态"
    - "buildSiliconPersonSession 在所有回退后仍无可用 modelProfileId 时，抛出明确中文错误，不再让空字符串穿透到 ChatSession.modelProfileId"
    - "callModel 在进入 fetch 前会校验 profile.baseUrl 非空，否则抛出含 profile.id 的领域错误，不再被 native fetch 折叠成 'fetch failed'"
    - "model-transport 重试结束抛出的错误，message 中保留底层原因（如 ENOTFOUND/ECONNREFUSED/URL invalid），并将原 cause 透传到 Error.cause"
    - "loadPersistedState 启动时会自动用 modelBindingSnapshot 给历史 modelProfileId 缺失的硅基员工补齐字段并落盘"
    - "SiliconPersonCreatePage 的提交按钮在未选择模型时禁用并提示『请选择模型』"
    - "ChatPage 在 isSiliconPersonView=true 时不再展示 effort selector 残留 reasoningEffort，且当前员工无可用模型时禁用输入框并显示『该员工未配置模型』"
  artifacts:
    - path: "desktop/src/main/ipc/silicon-persons.ts"
      provides: "create/update 入口校验 + create handler 写入 modelProfileId 字段"
    - path: "desktop/src/main/services/silicon-person-session.ts"
      provides: "buildSiliconPersonSession 在最终回退后仍空时抛错"
    - path: "desktop/src/main/services/model-client.ts"
      provides: "callModel 入口对 profile.baseUrl/apiKey 的契约断言"
    - path: "desktop/src/main/services/model-transport.ts"
      provides: "Error.cause 透传 + 错误 message 包含底层 SystemError code"
    - path: "desktop/src/main/services/state-persistence.ts"
      provides: "loadPersistedState 中的 SiliconPerson modelProfileId 回填逻辑"
    - path: "desktop/src/renderer/pages/SiliconPersonCreatePage.tsx"
      provides: "强制模型选择 UI"
    - path: "desktop/src/renderer/pages/ChatPage.tsx"
      provides: "硅基员工视图下的 effort 残留清理 + 缺模型禁用输入"
  key_links:
    - from: "silicon-persons.ts create handler"
      to: "SiliconPerson.modelProfileId 字段 (literal at line ~169-188)"
      via: "validatedId 直接赋值，而非仅传给 buildModelBindingSnapshot"
      pattern: "modelProfileId: validatedId"
    - from: "buildSiliconPersonSession"
      to: "ChatSession.modelProfileId"
      via: "throw 而非空字符串穿透"
      pattern: "throw new Error.*未配置可用模型"
    - from: "callModel 入口"
      to: "executeRequestVariants"
      via: "在 fetch 之前完成 profile.baseUrl 非空断言"
      pattern: "profile.baseUrl.*trim"
    - from: "executeRequestVariants catch 块"
      to: "上层 lastError"
      via: "formatCause(err.cause) 拼接到 message，并 new Error(msg, { cause })"
      pattern: "cause:.*formatCause"
---

<objective>
修复硅基员工聊天发送消息时报 `[模型调用失败] fetch failed` 的问题，端到端建立 modelProfileId 契约。

Purpose: 当前 6 层中没有任何一层兜住"硅基员工无有效 modelProfileId"这个失败状态——create 时不写字段、session 构建时允许空值穿透、模型客户端不校验 baseUrl、transport 层把底层 cause 丢掉、磁盘历史数据无法自愈、UI 不阻拦。结果就是一次 fetch 用空 URL 发出，native fetch 抛出 TypeError 被折叠成"fetch failed"，用户看不到任何可定位的信息。

Output: 7 个文件的针对性修改，构成一条"创建-持久化-加载-会话构建-模型调用-传输错误透传-UI 守卫"的完整契约链，加上一次性的 typecheck + 既有 silicon-person 测试集回归。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@desktop/src/main/ipc/silicon-persons.ts
@desktop/src/main/services/silicon-person-session.ts
@desktop/src/main/services/model-client.ts
@desktop/src/main/services/model-transport.ts
@desktop/src/main/services/state-persistence.ts
@desktop/src/renderer/pages/SiliconPersonCreatePage.tsx
@desktop/src/renderer/pages/ChatPage.tsx
@desktop/shared/contracts/silicon-person.ts

<interfaces>
<!-- 关键契约：执行者无需自行 grep，下面是已确认的现状 -->

From desktop/shared/contracts/silicon-person.ts:
```typescript
export type SiliconPerson = {
  id: string;
  // ...
  modelProfileId?: string;       // 注意是 optional，本次修复后写盘的新员工必须为非空 string
  modelBindingSnapshot?: {
    modelProfileId: string;
    modelName: string;
    frozenAt: string;
  } | null;
  // ...
};
```

From desktop/src/main/services/runtime-context.ts (已知现状):
```typescript
ctx.state.models: ModelProfile[]
ctx.state.siliconPersons: SiliconPerson[]
ctx.state.getDefaultModelProfileId(): string | null
```

From desktop/src/main/services/state-persistence.ts:
```typescript
export async function saveSiliconPerson(paths: MyClawPaths, person: SiliconPerson): Promise<void>
// 已存在，写入 <myClawDir>/silicon-persons/<id>/person.json
```

From desktop/src/main/services/model-transport.ts (现状):
```typescript
async function createHttpError(response: Response): Promise<Error>  // 现状：仅 message，无 cause
// catch 块（lines 200-215）：lastError = err instanceof Error ? err : new Error(String(err))
// 这里 err.cause 被丢弃 —— Node fetch 的 TypeError("fetch failed") 真实原因都在 cause 里
```

From desktop/src/renderer/pages/ChatPage.tsx 上下文:
- isSiliconPersonView 已存在，作用范围内可用
- updateDisplayedSessionRuntimeIntent({ reasoningEffort: ... }) 是已存在的 hook，可传 undefined 清空
- session、submitMessage、composer-input(textarea) 已在 line 2040-2107
- 现有 disabled 条件：`!composerDraft.trim() || !session`
</interfaces>

<style_notes>
- silicon-persons.ts / silicon-person-session.ts / model-client.ts / model-transport.ts / state-persistence.ts: 双引号 + 分号 + 2 空格缩进
- 所有新增日志使用 `[silicon-person:create]` `[silicon-person-session]` `[model-client]` `[model-transport]` `[state-persistence:backfill]` 这种带方括号的中文 prefix（与现有 console.info/warn/error 风格一致）
- Error 抛出文案：中文为主，必要时附 modelProfileId / siliconPersonId 等定位字段（例如：`硅基员工 sp-xxx 未配置可用模型，请先在员工设置中选择模型`）
- React TSX：双引号 + 分号 + 2 空格缩进；样式继续用 `<style>{...}</style>` 内联块，匹配 SiliconPersonCreatePage 现有风格
</style_notes>
</context>

<tasks>

<task type="auto">
  <name>Task 1: silicon-persons.ts —— create/update 入口强制校验 modelProfileId 并写入字段</name>
  <files>desktop/src/main/ipc/silicon-persons.ts</files>
  <action>
两处改动，共一个文件：

(A) create handler（lines 162-214）：
1. 在 line 168 (`const now = ...`) 之前插入 modelProfileId 校验块：
   ```ts
   const rawModelProfileId = (input.modelProfileId as string | undefined)?.trim();
   if (!rawModelProfileId) {
     throw new Error("硅基员工创建失败：必须指定有效的模型 (modelProfileId)");
   }
   if (!ctx.state.models.find((m) => m.id === rawModelProfileId)) {
     throw new Error(`硅基员工创建失败：modelProfileId=${rawModelProfileId} 不在已配置模型列表中`);
   }
   ```
2. 在 SiliconPerson 字面量（lines 169-188）里，于 `modelBindingSnapshot:` 上方新增一行：
   ```ts
   modelProfileId: rawModelProfileId,
   ```
   并把 `buildModelBindingSnapshot(ctx, input.modelProfileId as string | undefined)` 改成 `buildModelBindingSnapshot(ctx, rawModelProfileId)`，避免再做一次 `as string` 转换。

(B) update handler（lines 216-255）：
1. 在 `const current = ctx.state.siliconPersons[index]!;` 之后、`const siliconPerson: SiliconPerson = ...` 之前，插入：
   ```ts
   if (Object.prototype.hasOwnProperty.call(input, "modelProfileId")) {
     const incoming = (input.modelProfileId as string | undefined)?.trim();
     if (!incoming) {
       throw new Error("硅基员工更新失败：modelProfileId 不能为空");
     }
     if (!ctx.state.models.find((m) => m.id === incoming)) {
       throw new Error(`硅基员工更新失败：modelProfileId=${incoming} 不在已配置模型列表中`);
     }
     // 写回 trim 后的值
     (input as { modelProfileId?: string }).modelProfileId = incoming;
   }
   ```
   说明：`hasOwnProperty` 写法保留了"未传 modelProfileId 字段就不动"的语义，不会把已有非空值意外重置。

校验失败抛 Error 时不要做 console.error（IPC 层的 catch 已经有日志）；但成功路径下，create 时新增一行 console.info：
```ts
console.info("[silicon-person:create] modelProfileId 已锁定", { siliconPersonId: siliconPerson.id, modelProfileId: rawModelProfileId });
```

不要触碰 buildModelBindingSnapshot 函数本身（保持 modelProfileId 可选签名以便未来其他调用）。不要修改 list/get/delete/create-session/switch-session/mark-session-read/send-message/start-workflow-run/get-paths/list-skills/refresh-skills/list-mcp-servers handler。
  </action>
  <verify>
人工 grep 确认以下成立（不跑 tsc）：
- `grep -n "rawModelProfileId" desktop/src/main/ipc/silicon-persons.ts` 在 create 块和 SiliconPerson 字面量里都能命中
- `grep -n "modelProfileId 不在已配置模型列表中" desktop/src/main/ipc/silicon-persons.ts` 命中两次（create + update）
- create handler 的 SiliconPerson 字面量里有显式 `modelProfileId: rawModelProfileId,` 这一行
  </verify>
  <done>
- create handler：input.modelProfileId 缺失或不在 ctx.state.models 时抛中文 Error，不会进入 saveSiliconPerson
- create handler：成功路径下，新建的 SiliconPerson 落盘的 person.json 中 modelProfileId 字段为非空 string，与 modelBindingSnapshot.modelProfileId 一致
- update handler：当传入 input.modelProfileId 字段（包括传入空字符串）时，缺失或非法都抛中文 Error；未传该字段时 update 行为不变
  </done>
</task>

<task type="auto">
  <name>Task 2: silicon-person-session.ts —— buildSiliconPersonSession 终态校验，禁止空 modelProfileId 穿透</name>
  <files>desktop/src/main/services/silicon-person-session.ts</files>
  <action>
修改 `buildSiliconPersonSession`（lines 59-102）：

在现有回退链 `if (!modelProfileId) { modelProfileId = ctx.state.getDefaultModelProfileId() || ""; }` （line 82-84）**之后**、`const session: ChatSession = {` （line 85）**之前**，插入终态守卫：

```ts
if (!modelProfileId || !ctx.state.models.find((m) => m.id === modelProfileId)) {
  console.error("[silicon-person-session] 无可用 modelProfileId，拒绝构建会话", {
    siliconPersonId: input.siliconPerson.id,
    ownField: input.siliconPerson.modelProfileId ?? null,
    snapshotField: input.siliconPerson.modelBindingSnapshot?.modelProfileId ?? null,
    globalDefault: ctx.state.getDefaultModelProfileId() ?? null,
  });
  throw new Error(`硅基员工 ${input.siliconPerson.id} 未配置可用模型，请先在员工设置中选择模型`);
}
```

不要修改原有的回退链（own field → snapshot → globalDefault 顺序保留）。不要触碰 buildSiliconPersonSessionSummary、requireSiliconPerson、assertSiliconPersonSessionOwner、syncSiliconPersonExecutionResult 等其他函数。
  </action>
  <verify>
- `grep -n "拒绝构建会话" desktop/src/main/services/silicon-person-session.ts` 命中 1 次
- `grep -n "未配置可用模型" desktop/src/main/services/silicon-person-session.ts` 命中 1 次
- 守卫位于回退链尾部、ChatSession 字面量构造之前
  </verify>
  <done>
- 当员工 own modelProfileId 为空、snapshot 里也没有可命中模型、且 ctx.state.getDefaultModelProfileId() 也返回 null 时，buildSiliconPersonSession 抛出含 siliconPersonId 的中文 Error
- 不再有任何路径让 ChatSession.modelProfileId === "" 落入 ctx.state.sessions
  </done>
</task>

<task type="auto">
  <name>Task 3: model-client.ts —— callModel 入口契约断言，杜绝空 baseUrl 进 fetch</name>
  <files>desktop/src/main/services/model-client.ts</files>
  <action>
修改 `callModel`（lines 462-591）：

在解构 options（line 463-472）之后、`const url = resolveModelEndpointUrl(profile);` （line 474）**之前**，插入契约断言：

```ts
if (!profile) {
  throw new Error("模型配置不完整：profile 为 null/undefined");
}
if (typeof profile.baseUrl !== "string" || profile.baseUrl.trim() === "") {
  throw new Error(`模型配置不完整：profile=${profile.id ?? "(missing)"} baseUrl 为空`);
}
if (typeof profile.apiKey !== "string" || profile.apiKey.trim() === "") {
  // 当前代码库所有 ModelProfile 都需要 apiKey（buildRequestHeaders 不区分提供商都会写 Authorization 或 x-api-key）；
  // 若未来有 provider schema 显式标记 apiKey 可选，再在此处放行；目前保持严格。
  throw new Error(`模型配置不完整：profile=${profile.id ?? "(missing)"} apiKey 为空`);
}
```

不要触碰 resolveModelEndpointUrl、buildRequestHeaders、resolveProtocolEndpointUrl、buildRequestBodyVariants 等其他函数。
  </action>
  <verify>
- `grep -n "模型配置不完整" desktop/src/main/services/model-client.ts` 命中 3 次（profile、baseUrl、apiKey）
- 断言位于 callModel 函数体最前段，且早于 `resolveModelEndpointUrl` 调用
  </verify>
  <done>
- 任何调用方传入 baseUrl 为空字符串或 undefined 的 profile 时，callModel 在进入 fetch 前抛带 profile.id 的中文 Error
- 真正的 fetch 调用路径只对结构合法的 profile 生效，"fetch failed" 不再覆盖配置缺失场景
  </done>
</task>

<task type="auto">
  <name>Task 4: model-transport.ts —— 透传 Error.cause，让底层 SystemError code 浮到用户层</name>
  <files>desktop/src/main/services/model-transport.ts</files>
  <action>
两处改动，共一个文件：

(A) 在 `createHttpError` （lines 117-120）下方新增一个工具函数：
```ts
/** 把 fetch/SystemError cause 渲染成可读字符串，保留 code 优先于 message。 */
function formatCause(cause: unknown): string {
  if (cause == null) return "(no cause)";
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    const codeStr = typeof code === "string" || typeof code === "number" ? String(code) : "";
    return codeStr ? `${codeStr}: ${cause.message || cause.name}` : (cause.message || cause.name);
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}
```

(B) 修改 catch 块（lines 200-215）—— 把
```ts
if (isRetryableError(err) && attempt < maxRetries) {
  lastError = err instanceof Error ? err : new Error(String(err));
  await sleep(resolveRetryDelay(retryDelaysMs, attempt));
  continue;
}

throw err;
```

改为：
```ts
if (isRetryableError(err) && attempt < maxRetries) {
  const baseErr = err instanceof Error ? err : new Error(String(err));
  const causeText = formatCause((err as { cause?: unknown })?.cause);
  // 使用 ES2022 Error cause 选项，并把 cause 摘要拼到 message，方便日志和 toast 同时看到
  lastError = new Error(`${baseErr.message} (cause: ${causeText})`, { cause: (err as { cause?: unknown })?.cause });
  console.warn("[model-transport] fetch 失败，准备重试", {
    variantId: variant.id,
    attempt,
    cause: causeText,
  });
  await sleep(resolveRetryDelay(retryDelaysMs, attempt));
  continue;
}

// 不可重试或重试耗尽：同样保留 cause
if (err instanceof Error) {
  const causeText = formatCause((err as { cause?: unknown }).cause);
  if (causeText !== "(no cause)") {
    throw new Error(`${err.message} (cause: ${causeText})`, { cause: (err as { cause?: unknown }).cause });
  }
}
throw err;
```

不要修改 `if (err instanceof Error && err.name === "AbortError") { ... }` 那段超时分支（行为保持原状）。
不要触碰 createAbortContext、isRetryableTransportError、resolveRetryDelay 等。
不要把现有 `throw lastError ?? new Error("Model request failed after retries")` 改掉——lastError 已经是带 cause 的新 Error，足够。
  </action>
  <verify>
- `grep -n "formatCause" desktop/src/main/services/model-transport.ts` 命中至少 3 次（定义 + 重试分支 + 终止分支）
- `grep -n "(cause:" desktop/src/main/services/model-transport.ts` 命中至少 2 次
- 新 Error 通过 `{ cause }` 选项透传原始 cause，未被字符串化丢弃
  </verify>
  <done>
- 当 native fetch 抛 `TypeError("fetch failed")` 且 cause 是 Node SystemError（含 code: ENOTFOUND/ECONNREFUSED 等）时，最终冒泡到 model-client / IPC 的 Error message 必然包含 `(cause: <code>: <message>)`
- 调用方 catch 到的 Error 上 `.cause` 为原始对象，便于结构化日志后续抽取 code
- 不影响 AbortError / timeout 路径的现有语义
  </done>
</task>

<task type="auto">
  <name>Task 5: state-persistence.ts —— loadPersistedState 启动期回填历史 SiliconPerson.modelProfileId</name>
  <files>desktop/src/main/services/state-persistence.ts</files>
  <action>
修改 `loadPersistedState` 中的 silicon persons 加载块（lines 237-263）。

在 `// ---- silicon persons ----` 块完成后（即 line 263 之后、`// ---- sessions (SQLite) ----` 之前），插入 modelProfileId 回填逻辑：

```ts
// ---- silicon persons modelProfileId 回填 -----------------------------
// 历史数据（创建时 create handler 还没强制写 modelProfileId）的 person.json
// 可能 modelProfileId 缺失/为空，但 modelBindingSnapshot 里有有效 id。
// 启动期一次性补齐，避免后续 buildSiliconPersonSession 抛错或走默认模型。
{
  const backfilled: string[] = [];
  for (const person of siliconPersons) {
    const own = (person.modelProfileId ?? "").trim();
    if (own) continue;
    const snapshotId = person.modelBindingSnapshot?.modelProfileId;
    if (!snapshotId) continue;
    if (!models.find((m) => m.id === snapshotId)) continue;
    person.modelProfileId = snapshotId;
    backfilled.push(person.id);
  }
  if (backfilled.length > 0) {
    console.info("[state-persistence:backfill] 已为历史硅基员工补齐 modelProfileId", {
      count: backfilled.length,
      ids: backfilled,
    });
    // 顺序写盘，避免并发写同一目录的 .tmp 文件
    for (const id of backfilled) {
      const target = siliconPersons.find((p) => p.id === id);
      if (!target) continue;
      try {
        await saveSiliconPerson(paths, target);
      } catch (err) {
        console.warn("[state-persistence:backfill] 回填写盘失败（内存仍已修正）", {
          siliconPersonId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
```

注意：
- 直接复用上方已加载的 `models` 数组（line 219），保证只补齐能命中已有 ModelProfile.id 的 snapshot
- 复用文件内已有的 `saveSiliconPerson`（line 455），不要在此处自己实现写盘
- 写盘失败只 warn 不 throw —— 内存里已经修好，下次启动还会再尝试
- 不要碰 sessions / models / workflows / settings 加载块
  </action>
  <verify>
- `grep -n "[state-persistence:backfill]" desktop/src/main/services/state-persistence.ts` 命中 2 次（info + warn）
- 回填逻辑位于 silicon persons 加载之后、sessions 加载之前
- 引用了文件内已有的 `saveSiliconPerson`，未引入新 import
  </verify>
  <done>
- 启动时若发现 modelProfileId 缺失但 snapshot 命中的硅基员工，自动写入 modelProfileId 字段并落盘
- 启动日志中可定位修正了哪些 person id
- 写盘失败不阻塞启动；下次启动会重试
  </done>
</task>

<task type="auto">
  <name>Task 6: SiliconPersonCreatePage.tsx —— 强制选择模型，未选不能提交</name>
  <files>desktop/src/renderer/pages/SiliconPersonCreatePage.tsx</files>
  <action>
两处改动，共一个文件：

(A) 修改 `canCreate` （line 62）：
```ts
const canCreate = Boolean(name.trim() && soul.trim() && selectedModelId);
```
说明：之前的 canCreate 不要求 selectedModelId，导致用户可以在"跟随全局默认"留空状态下提交，再交给后端拒。改成强制必选。

(B) 修改 `handleCreate`（lines 85-129）：
1. 在 `if (!name.trim() || !soul.trim()) { ... }` 之后、`setCreateError("");` 之前，新增：
   ```ts
   if (!selectedModelId) {
     setCreateError("请选择硅基员工使用的模型，再继续创建。");
     return;
   }
   ```
2. 把 `await workspace.createSiliconPerson({ ... })` 调用里增加 `modelProfileId: selectedModelId` 字段（紧跟在 `soul: trimmedSoul,` 后面）：
   ```ts
   const created = await workspace.createSiliconPerson({
     name: trimmedName,
     title: trimmedName,
     description: deriveDescriptionFromSoul(trimmedSoul, trimmedName),
     soul: trimmedSoul,
     modelProfileId: selectedModelId,
   });
   ```
   说明：当前代码把 modelProfileId 留到创建之后再用 update 写入（lines 105-121），这条链路在我们已经把 create handler 改成强制要求 modelProfileId 之后会失败。把模型直接放到 create 入参里即可。
3. update 块（lines 105-121）保留，但把判断条件中的 `Boolean(selectedModelId)` 那一项移除（已经在 create 阶段写入），以免冗余 update：
   ```ts
   if (
     created?.id &&
     (
       approvalMode !== "inherit" ||
       reasoningEnabled !== true ||
       reasoningEffort !== "medium"
     )
   ) {
     await workspace.updateSiliconPerson(created.id, {
       approvalMode,
       reasoningEnabled,
       reasoningEffort,
     });
   }
   ```

(C) 在"使用模型"字段（lines 228-252）下方，已有 model-status pill 之后，再追加一个空选时的红字提示（与现有 .spc-error 风格一致，但只在用户尝试提交后显示也可以；这里简单点，按"未选 → 显示提示"）：
```tsx
{!selectedModelId && (
  <span className="spc-field-hint spc-field-hint--required" data-testid="silicon-person-create-model-required">
    请选择模型
  </span>
)}
```

并在底部 `<style>{...}</style>` 块里 `.spc-error` 规则旁追加：
```css
.spc-field-hint--required {
  color: var(--status-red);
  font-size: 12px;
  margin-top: 2px;
}
```

不要修改 templateSourceId / handleTemplateChange 等无关分支。从已有员工复制时如果源员工有 modelProfileId（line 79 已经做了），新页面会自动带上，无需改。
  </action>
  <verify>
- `grep -n "请选择硅基员工使用的模型" desktop/src/renderer/pages/SiliconPersonCreatePage.tsx` 命中 1 次
- `grep -n "modelProfileId: selectedModelId" desktop/src/renderer/pages/SiliconPersonCreatePage.tsx` 命中 1 次
- `grep -n "selectedModelId &&" desktop/src/renderer/pages/SiliconPersonCreatePage.tsx` 在 canCreate 中能看到
- data-testid="silicon-person-create-model-required" 存在
  </verify>
  <done>
- 未选模型时：提交按钮 disabled，"请选择模型"红字提示可见
- 选了模型时：modelProfileId 直接通过 createSiliconPerson 入参传给 IPC，不再走"先 create 再 update"的两步链
- 创建后跳转 /employees 行为不变
  </done>
</task>

<task type="auto">
  <name>Task 7: ChatPage.tsx —— 硅基员工视图清理 effort 残留 + 缺模型时禁用输入</name>
  <files>desktop/src/renderer/pages/ChatPage.tsx</files>
  <action>
两处改动，共一个文件：

(A) 在 effort selector 渲染块（lines 2070-2085）的 `!isSiliconPersonView &&` 守卫**之外**（即对硅基员工视图也生效），新增一个一次性副作用：当切换到硅基员工视图且当前显示 session 的 runtimeIntent.reasoningEffort 仍存在残留时，清空它。

实现：在文件中已有的 useEffect 注册区（找到所有依赖 `[isSiliconPersonView, session?.id]` 风格的 effect 区段，或紧跟在与 isSiliconPersonView 相关的现有 effect 旁），追加：

```tsx
useEffect(() => {
  if (!isSiliconPersonView) return;
  if (!session) return;
  const intent = session.runtimeIntent as Record<string, unknown> | undefined;
  if (!intent || intent.reasoningEffort === undefined) return;
  // 切换到硅基员工视图后，effort selector 不再显示，清掉残留以免发送时仍把上次的 effort 带进 runtimeIntent
  void updateDisplayedSessionRuntimeIntent({ reasoningEffort: undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isSiliconPersonView, session?.id]);
```

如果当前文件已有大型 useEffect 集中区，请把这段就近放到 isSiliconPersonView 相关的那一段附近；如果不便定位，直接放到组件内 useEffect 注册的末尾即可。注意保留 `// eslint-disable-next-line react-hooks/exhaustive-deps`，与 CLAUDE.md "preserve existing dependency-suppression intent" 要求一致。

(B) 在 textarea + submit 按钮区域（lines 2040-2107），引入"当前硅基员工无可用模型时禁用输入"的能力。

1. 在文件靠前位置（与其他 useMemo 同区，搜索 `siliconPersons` 等已有引用确定位置）新增：
```tsx
const siliconPersonModelMissing = useMemo(() => {
  if (!isSiliconPersonView) return false;
  // 当前显示的硅基员工。用现有 session.siliconPersonId 反查，或复用已有 selector。
  const sid = (session as { siliconPersonId?: string | null } | null)?.siliconPersonId ?? null;
  if (!sid) return false;
  const person = siliconPersons.find((p) => p.id === sid);
  if (!person) return false;
  const profileId = person.modelProfileId?.trim();
  if (!profileId) return true;
  return !models.find((m) => m.id === profileId);
}, [isSiliconPersonView, session, siliconPersons, models]);
```
说明：如果 ChatPage 没有 `models` 这个 selector，参考已有 `useWorkspaceStore((s) => s.models)` 模式新增一行；如果已经有，复用即可。

2. 修改 textarea（line 2040-2062）的 `disabled` 属性 —— textarea 当前没有 disabled，加一个：
```tsx
disabled={siliconPersonModelMissing}
placeholder={siliconPersonModelMissing ? "该员工未配置模型，请先在员工设置中选择模型" : (isRunBusy ? "正在响应..." : "输入消息 (Enter 发送, Shift+Enter 换行)，或输入 / 获取快捷命令")}
```

3. 修改 submit 按钮（line 2089-2097）的 disabled：
```tsx
disabled={!composerDraft.trim() || !session || siliconPersonModelMissing}
```

4. 在 textarea 上方或同区，追加一个轻量提示（仅在 siliconPersonModelMissing 为 true 时渲染），位置建议放在 `.composer-toolbar` 之外、textarea 同级容器里：
```tsx
{siliconPersonModelMissing && (
  <div className="composer-warn" data-testid="silicon-person-model-missing-banner">
    该员工未配置模型
  </div>
)}
```
对应在文件末尾已有的 `<style>` 区追加：
```css
.composer-warn {
  margin: 0 0 6px;
  padding: 6px 10px;
  border-radius: var(--radius-md, 7px);
  background: rgba(255, 90, 90, 0.08);
  border: 1px solid rgba(255, 90, 90, 0.24);
  color: var(--status-red);
  font-size: 12px;
}
```
（如果 ChatPage 用的是 CSS module 或全局 stylesheet 而不是行内 `<style>`，则把规则就近添加到现有惯用位置；保持文件本地风格。）

不要触碰 plan mode 侧边面板、confirm dialog、mention menu 等无关分支。
  </action>
  <verify>
- `grep -n "siliconPersonModelMissing" desktop/src/renderer/pages/ChatPage.tsx` 命中 ≥ 4 次（定义 + textarea disabled + button disabled + banner）
- `grep -n "该员工未配置模型" desktop/src/renderer/pages/ChatPage.tsx` 命中 ≥ 1 次
- effort selector 守卫仍是 `!isSiliconPersonView &&`（不要去掉它，硅基员工视图本身不渲染 effort selector）
- 新 useEffect 中保留了 react-hooks/exhaustive-deps 的 disable 注释
  </verify>
  <done>
- 切到硅基员工视图后，session.runtimeIntent.reasoningEffort 残留会被清空，不会被悄悄带入下一条消息
- 当前硅基员工 person.modelProfileId 为空或非法时，输入框 disabled、submit 按钮 disabled，banner 显示"该员工未配置模型"
- 普通聊天视图（!isSiliconPersonView）行为完全不变
  </done>
</task>

<task type="auto">
  <name>Task 8: 一次性 typecheck + silicon-person 测试集回归（仅在 Task 1-7 全部完成后执行）</name>
  <files>(no file edits — verification only)</files>
  <action>
按用户记忆"多 Task 实现时不要中途测试"，本 Task 是唯一的回归节点。

1. 运行 desktop typecheck：
   ```
   cd F:/MyClaw/desktop && pnpm run typecheck
   ```
   期望：tsc --noEmit 对 main 与 renderer 配置全部通过，零 error。

2. 运行 silicon-person 相关测试集：
   ```
   cd F:/MyClaw/desktop && pnpm vitest run tests/silicon-person-ipc.test.ts tests/silicon-person-session-routing.test.ts tests/silicon-person-create-page.test.ts tests/chat-page-silicon-person-mode.test.ts tests/silicon-person-contracts.test.ts
   ```
   期望：全部通过。如果其中某个测试因为我们改了"create 必须有 modelProfileId"而失败（很可能：existing IPC test fixture 没传 modelProfileId），按以下原则修测试 fixture：
   - 给 `siliconPerson:create` 调用补一个有效 modelProfileId（测试上下文里的 ctx.state.models 通常已有 mock profile，取其 id 即可）
   - 给 update 路径补对应 mock
   - 不要为了让旧测试通过而回退本次的契约校验

3. 如果 typecheck 失败：按 tsc 报错位置修，常见可能是 ChatPage 里 `useMemo` 缺 import 或 `models` 没在 useWorkspaceStore selector 中——按现有 import 风格补全。

不要在这个 Task 里再修业务代码 —— 只允许：(a) 修补本次新引入语法/类型错误；(b) 修补受本次契约影响的测试 fixture。
  </action>
  <verify>
    <automated>cd F:/MyClaw/desktop && pnpm run typecheck && pnpm vitest run tests/silicon-person-ipc.test.ts tests/silicon-person-session-routing.test.ts tests/silicon-person-create-page.test.ts tests/chat-page-silicon-person-mode.test.ts tests/silicon-person-contracts.test.ts</automated>
  </verify>
  <done>
- `pnpm run typecheck` 退出码 0
- 列出的 5 个 vitest 文件全部 passed
- 若有 fixture 修补，diff 仅限于补 modelProfileId/mock，不含逻辑回退
  </done>
</task>

</tasks>

<verification>
端到端复现路径（手测，可选，自动化覆盖已通过 Task 8）：

1. 在没有任何 silicon-person 数据的环境启动 desktop（或 dev 模式）。
2. 进入"新建硅基员工"页面：在不选模型的情况下点提交 → 提交按钮 disabled，红字"请选择模型"可见。
3. 选模型并填名称、人格 → 创建成功；查看 `<myClawDir>/silicon-persons/<id>/person.json`，`modelProfileId` 字段为非空字符串。
4. 进入聊天页，切到刚创建的硅基员工 → 输入框可用，effort selector 不可见。发一条消息：消息正常进入会话，模型实际被调用（如果 baseUrl 真实可达）。
5. 制造负面用例：手动编辑 person.json 把 modelProfileId 改成 ""，重启 desktop。
   - 启动日志包含 `[state-persistence:backfill]`（如果 modelBindingSnapshot 还在）—— 字段被自动补齐，行为正常。
   - 如果连 snapshot 也清掉，重启后聊天发送会得到 `硅基员工 sp-xxx 未配置可用模型...` 而不是 `fetch failed`。
6. 制造网络层负面用例：把当前模型 profile 的 baseUrl 改成 `https://nonexistent-host-test.invalid`，发消息：错误 toast / 日志包含 `(cause: ENOTFOUND: ...)` 而不是仅 `fetch failed`。
</verification>

<success_criteria>
- 全部 7 处源码改动落地，Task 8 typecheck + 5 个测试套全部通过
- 用户原始问题"硅基员工聊天发送消息报 fetch failed"在 Task 8 自动化通过 + 手测路径 6 复现一次后被验证修复（错误现在带 cause）
- 不引入新的 npm 依赖
- 不改动 cloud/ 任何文件
- 不破坏普通聊天（非硅基员工）的 effort selector / 输入框行为
</success_criteria>

<output>
本 Quick 任务无需写 SUMMARY.md（quick 流程不要求）。最终提交一次 git commit，message 形如：
```
fix(silicon-person): enforce modelProfileId contract end-to-end + surface fetch cause

- silicon-persons.ts: create/update 入口校验并写入 modelProfileId
- silicon-person-session.ts: buildSiliconPersonSession 终态守卫
- model-client.ts: callModel 入口契约断言
- model-transport.ts: Error.cause 透传 + message 包含底层 code
- state-persistence.ts: 启动期回填历史 modelProfileId
- SiliconPersonCreatePage.tsx: 模型必选
- ChatPage.tsx: 硅基员工视图清 effort 残留 + 缺模型禁用输入

Quick: 260506-ldw
```
</output>

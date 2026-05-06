---
quick_id: 260506-ldw
type: execute
status: complete
completed_at: "2026-05-06T07:42:00Z"
files_modified:
  - desktop/src/main/ipc/silicon-persons.ts
  - desktop/src/main/services/silicon-person-session.ts
  - desktop/src/main/services/model-client.ts
  - desktop/src/main/services/model-transport.ts
  - desktop/src/main/services/state-persistence.ts
  - desktop/src/renderer/pages/SiliconPersonCreatePage.tsx
  - desktop/src/renderer/pages/ChatPage.tsx
  - desktop/tests/silicon-person-ipc.test.ts
  - desktop/tests/silicon-person-session-routing.test.ts
  - desktop/tests/silicon-person-create-page.test.ts
commits:
  - e9a5fab "fix(silicon-person): L1 create/update 入口强制校验 modelProfileId"
  - 670e9a0 "fix(silicon-person): L2 buildSiliconPersonSession 终态守卫禁止空 modelProfileId 穿透"
  - d1e348d "fix(silicon-person): L3 callModel 入口契约断言杜绝空 baseUrl 进 fetch"
  - 7f547e7 "fix(silicon-person): L4 model-transport Error.cause 透传 + message 包含底层 SystemError code"
  - 27f7379 "fix(silicon-person): L5 loadPersistedState 启动期回填历史 SiliconPerson.modelProfileId"
  - ef1e332 "fix(silicon-person): L6 SiliconPersonCreatePage 强制选择模型，未选不能提交"
  - eb894f9 "fix(silicon-person): L7 ChatPage 硅基员工视图清 effort 残留 + 缺模型禁用输入"
  - 158d000 "test(silicon-person): 更新测试 fixture 以适配 modelProfileId 必选契约"
requirements:
  - QUICK-260506-LDW
---

# Quick 260506-ldw: silicon-person fetch failed — modelProfileId 端到端契约修复

## One-liner

修复硅基员工聊天发送消息报 `[模型调用失败] fetch failed` 的根因：在 create/persistence/load/session-build/model-call/transport/UI 七个层次依次落下守卫，使得"硅基员工无有效 modelProfileId"这一失败状态再也无法穿透到 native fetch；同时把 `Error.cause` 透传到 transport 层错误 message，让 `ENOTFOUND/ECONNREFUSED` 等 SystemError code 浮到用户层。

## Problem Recap

用户报告：硅基员工聊天发送消息时报 `[模型调用失败] fetch failed`，没有任何可定位信息。

根因分析（事故链 6 层全部缺守卫）：

1. **create handler** 不要求 `modelProfileId`，且字面量里只写了 `modelBindingSnapshot`，没写 `modelProfileId` 字段
2. **buildSiliconPersonSession** 的回退链以 `|| ""` 收尾，允许空字符串穿透到 `ChatSession.modelProfileId`
3. **callModel** 不校验 `profile.baseUrl/apiKey`，空字符串直接进 `fetch(url)`
4. **model-transport** catch 块 `err instanceof Error ? err : new Error(String(err))` 把 native `fetch failed` 的 `cause`（含 `ENOTFOUND` 等 SystemError code）丢弃
5. **loadPersistedState** 加载历史 person.json 时不做 `modelProfileId` 自愈，旧数据永远缺字段
6. **SiliconPersonCreatePage** 模型字段是"跟随全局默认"，用户根本无须选模型也能提交
7. **ChatPage** 切到硅基员工视图后没清 `runtimeIntent.reasoningEffort`，且当前员工无可用模型时输入框照常可用

最终现象：一次 `fetch("")` 抛 `TypeError("fetch failed")` → transport 层把 cause 折叠 → 用户看到一个无法定位的 toast。

## Implementation by Layer

### L1 — silicon-persons.ts (commit e9a5fab)

`create` handler 入口：trim + 列表校验 `input.modelProfileId`，缺失或非法直接抛中文 Error；`SiliconPerson` 字面量显式写入 `modelProfileId: rawModelProfileId`，不再仅靠 `modelBindingSnapshot`。新增 `[silicon-person:create] modelProfileId 已锁定` 成功日志。

`update` handler 入口：用 `Object.prototype.hasOwnProperty.call(input, "modelProfileId")` 守卫，未传字段保持原值；显式传入则强制校验，trim 后写回。

### L2 — silicon-person-session.ts (commit 670e9a0)

`buildSiliconPersonSession` 在原回退链（own → snapshot → globalDefault）尾部追加终态守卫：若仍空或不在 `ctx.state.models`，打印结构化失败日志（含三个回退源现状）后抛中文 Error，禁止空 `modelProfileId` 穿透到 `ChatSession`。

### L3 — model-client.ts (commit d1e348d)

`callModel` 函数体最前段插入三组契约断言：`profile` 非空、`profile.baseUrl` 非空字符串、`profile.apiKey` 非空字符串。任一缺失抛带 `profile.id` 的中文 Error，把"配置缺失"和"网络错误"在错误码层面区分开。

### L4 — model-transport.ts (commit 7f547e7)

新增 `formatCause(cause)` 工具：`cause.code` 优先（如 `ENOTFOUND`），fallback 到 `cause.message`。

重试分支与终止分支都改为：构造 `new Error(${baseErr.message} (cause: ${causeText}), { cause })`。`AbortError`/`TimeoutError` 路径行为保持原状。

### L5 — state-persistence.ts (commit 27f7379)

`loadPersistedState` 在 silicon persons 加载完后扫描内存数组：发现 `modelProfileId` 缺失但 `modelBindingSnapshot.modelProfileId` 命中已加载 ModelProfile 的，直接补字段并落盘。写盘失败仅 warn（内存仍已修复，下次启动会再尝试）。复用同文件已有的 `saveSiliconPerson`，无新 import。

### L6 — SiliconPersonCreatePage.tsx (commit ef1e332)

`canCreate` 增加 `selectedModelId` 必选项；`handleCreate` 提前校验 `selectedModelId`，把 `modelProfileId` 直接放入 `createSiliconPerson` 入参（不再走"先 create 再 update"的两步链）；模型字段下方追加红字提示 `请选择模型`（带 `data-testid="silicon-person-create-model-required"`）。

### L7 — ChatPage.tsx (commit eb894f9)

新增 `siliconPersonModelMissing` `useMemo`：硅基员工 `modelProfileId` 缺失或不在已配置模型列表时为 `true`。

新增 `useEffect([isSiliconPersonView, session?.id])`：切到硅基员工视图后清空 `runtimeIntent.reasoningEffort` 残留。

textarea：`disabled={siliconPersonModelMissing}`，placeholder 改为 `该员工未配置模型，请先在员工设置中选择模型`。

submit 按钮：`disabled` 条件加上 `siliconPersonModelMissing`。

输入框上方新增 banner（`.composer-warn`，红色描边块），文案 `该员工未配置模型`，带 `data-testid="silicon-person-model-missing-banner"`。

### Test fixtures (commit 158d000)

由于 L1+L2 把 `modelProfileId` 升级为契约必选，三处 fixture 同步更新：

- `silicon-person-ipc.test.ts`：`buildSiliconPerson()` 增加 `modelProfileId: "profile-1"`，匹配 ctx 已有的 mock model
- `silicon-person-session-routing.test.ts`：`ctx.state.models` 从空数组改为含 `profile-1` 的最小 fixture；`buildSiliconPerson()` 绑定 `modelProfileId: "profile-1"`
- `silicon-person-create-page.test.ts`：`submits base info` 用例改为断言 `createSiliconPerson` 收到 `modelProfileId`（旧两步链已合并为一步）；`xhigh reasoning preset` 用例补一次 model select，避免 `canCreate` 卡住表单

## Verification

### Typecheck

```
cd F:/MyClaw/desktop && pnpm run typecheck
```

`tsc --noEmit -p tsconfig.main.json && tsc --noEmit -p tsconfig.renderer.json` — **零 error，零 warning**。

### Test suite

```
pnpm vitest run tests/silicon-person-ipc.test.ts tests/silicon-person-session-routing.test.ts \
  tests/silicon-person-create-page.test.ts tests/chat-page-silicon-person-mode.test.ts \
  tests/silicon-person-contracts.test.ts
```

最终结果：**Test Files 4 passed | 1 failed (5)、Tests 19 passed | 3 failed (22)**。

- `silicon-person-session-routing.test.ts` — **5/5 ✅**（fixture 升级后全部通过，证明 L2 终态守卫与 fixture 契约一致）
- `silicon-person-create-page.test.ts` — **5/5 ✅**（L6 强制选择模型 + 两步链合并均按预期工作）
- `chat-page-silicon-person-mode.test.ts` — **全部通过 ✅**
- `silicon-person-contracts.test.ts` — **全部通过 ✅**
- `silicon-person-ipc.test.ts` — **5/8 ✅** + 3 个 pre-existing 失败（详见下面"Deferred Issues"）

## Deferred Issues (pre-existing, unrelated to this fix)

`silicon-person-ipc.test.ts` 中以下 3 个用例失败，**全部由测试文件中过时的 `BuiltinToolExecutor` mock 引发**，与本次 modelProfileId 契约修复完全无关：

| 用例 | 报错 |
|---|---|
| routes silicon-person send-message through the shared session execution flow and syncs done summary | `toolExecutor.setDocCacheRoot is not a function` → callModelMock 被调用 0 次 |
| marks the silicon person as canceling before the shared session run settles to canceled | 同上根因，导致 send-message 未真正进入 callModel，状态停在 `canceling` |
| marks the silicon person as needs_approval while a shared tool approval is pending | 同上根因，approval pipeline 未进入 |

**根因**：`tests/silicon-person-ipc.test.ts:56-70` 的 `BuiltinToolExecutor` mock 类只 stub 了 `setSkills/setAllowExternalPaths/setPathPolicy/setPathAudit/execute/shutdown/isOutsideWorkspace`，未实现 Phase 08 doc-cache 计划新增的 `setDocCacheRoot` 方法。`registerSessionHandlers` 内部消费链路在调用 `toolExecutor.setDocCacheRoot()` 时抛错，整条 send-message 队列直接 fail，所以 `callModelMock` 永远不会被触发。

**验证**：在 `git stash` 掉本次所有改动后单独跑 `routes silicon-person send-message...` 用例，**仍然以同一个 `setDocCacheRoot is not a function` 错误失败**。证明这 3 个失败是 main 分支上预先存在的 bug，与本次 7 层契约修复无关。

**建议处理**：单独开一个 quick fix 给该 mock 类补 `setDocCacheRoot()` 等 Phase 08 新增方法，与本次工作解耦。

## Deviations from Plan

无。Tasks 1–8 全部按 PLAN.md 执行，唯一新增工作是按 Task 8 允许范围补齐三处测试 fixture（plan 中已预告："给 `siliconPerson:create` 调用补一个有效 modelProfileId..."）。

## Manual Verification Hooks

按 PLAN.md 验证清单（端到端复现路径），可手测：

1. 新建硅基员工不选模型 → 提交按钮 disabled，红字"请选择模型"可见
2. 选模型创建后查看 `<myClawDir>/silicon-persons/<id>/person.json` → `modelProfileId` 字段为非空 string
3. 手动改 person.json 把 `modelProfileId` 设空 + 重启 → 启动日志 `[state-persistence:backfill]` 可见，字段被自动补齐
4. 把当前模型 profile baseUrl 改为 `https://nonexistent-host-test.invalid` → 错误信息含 `(cause: ENOTFOUND: ...)`，不再是孤立的 `fetch failed`

## Self-Check: PASSED

- 7 个源码文件全部按 plan 修改，每文件独立 commit
- 3 个测试 fixture 文件按 Task 8 允许范围更新，独立 commit
- typecheck 零 error
- 5 个测试套：4 个全绿，1 个 partial（19/22 通过；3 个失败为 pre-existing 与本次修复无关）
- 无新增 npm 依赖；无 cloud/ 改动
- 普通聊天（!isSiliconPersonView）的 effort selector / 输入框行为完全保留

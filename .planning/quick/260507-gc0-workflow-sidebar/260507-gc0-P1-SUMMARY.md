---
id: 260507-gc0
type: quick
tier: P1
plan_path: .planning/quick/260507-gc0-workflow-sidebar/260507-gc0-PLAN.md
status: P1-complete
date: 2026-05-07
branch: main
commits:
  - 3d5a622 refactor(workflow): drop WorkflowExecutionPolicyEditor (engine never reads policy)
  - 565d0fc refactor(workflow): hide node UUID behind <details> in inspector header
  - 416fad0 fix(workflow): rename '个性' label to '提示词' on LLM prompt textarea
  - e9a6ad7 refactor(workflow): remove duplicate free-text inputs from tool/subgraph/human-input editors
  - 403010e fix(workflow): make conditional edge condition editable (operator/leftPath/rightValue)
  - 0bf8b95 refactor(workflow): strip redundant inspector chrome (titles + duplicate save)
  - d8db7de refactor(workflow): remove redundant 'From X → Y' line in edge editor
typecheck: pass (0 errors on both tsconfig.main.json and tsconfig.renderer.json)
remaining_tiers: [P2]
---

# Quick 260507-gc0 — P1 Tier Summary

P1 sidebar 减法已交付 7 commits / 7 tasks。P0 已合并 main，P2（数据样式整顿，6 commits）留作后续。

## Per-task Detail

### P1-1: 删除 `WorkflowExecutionPolicyEditor` — `3d5a622`

**Goal:** 引擎从未读 `policy.timeoutMs / retry.maxAttempts / retry.backoffMs`，UI 写入沉默丢失，应整块下线编辑器。

**Changes:**
- `desktop/src/renderer/components/workflow/WorkflowExecutionPolicyEditor.tsx` — 整文件删除（曾 ~150 行）
- `desktop/src/renderer/components/workflow/WorkflowNodeEditor.tsx`:10 — 删除 `import WorkflowExecutionPolicyEditor`
- `desktop/src/renderer/components/workflow/WorkflowNodeEditor.tsx`:419（旧行号） — 删除 `<WorkflowExecutionPolicyEditor ... />` 挂载
- 同文件 `handlePolicyUpdate` 函数 + `WorkflowNodePolicy` 类型 import 一并删除（不再被任何位置引用，留着会形成沉默死代码）

**Per plan step 5:** `node.policy` 字段保留在 contract 上（`WorkflowNodeBase.policy?: WorkflowNodePolicy`），现有 JSON 仍然能 round-trip 加载/保存——只是 UI 不再渲染。

**Verification:**
- `grep WorkflowExecutionPolicyEditor desktop/`：0 命中
- 选中任意节点，右侧不再出现 Timeout / Retry attempts / Retry backoff 三个数字框

### P1-2: 节点 header 不再露 raw UUID — `565d0fc`

**Goal:** `node-tool-1k2j-...` 类原始 UUID 在 inspector 顶部刺眼，应只露中文 kind label，UUID 收进 `<details>`。

**Changes:**
- `desktop/src/renderer/components/workflow/WorkflowNodeEditor.tsx`:
  - 新增 `kindLabel(kind)` 工具函数，覆盖全部 8 种 `WorkflowNodeKind`（start / end / llm / tool / human-input / condition / subgraph / join），带 `never` 穷尽守卫
  - 删除原 `<p className="meta">{node.id} ({node.kind})</p>`
  - header 改为 `<h4 className="title">节点配置 · {kindLabel(node.kind)}</h4>`
  - 在编辑器底部 `<style>` 之前追加 `<details className="advanced">` 折叠节点 ID
  - 样式 mono / muted / 12px / 顶部分隔，符合 ui-style-guide 节奏

**Verification:**
- header 仅显示如"节点配置 · 工具调用"；点击底部"高级（节点 ID）"可展开看到 UUID

### P1-3: LLM "个性" → "提示词" — `416fad0`

**Goal:** prompt 输入区 label "个性" 误导用户。

**Changes:**
- `desktop/src/renderer/components/workflow/WorkflowNodeEditor.tsx` — 单点替换 `<span>个性</span>` 为 `<span>提示词</span>`
- 同文件 grep "个性" 无其他命中（placeholder / aria-label 都未使用该词）

### P1-4: 删除 tool / subgraph / human-input 的双绑自由文本 — `e9a6ad7`

**Goal:** 三类节点同时拥有"下拉 + 自由文本"两个绑到同一字段的输入。下拉是数据真源，自由文本是冗余/陷阱。

**Changes:** `desktop/src/renderer/components/workflow/WorkflowNodeEditor.tsx`
- Tool 节点：删除 "Tool ID" `<input type="text">` 块（旧行 472-481）；保留 `<select>` 下拉
- Subgraph 节点：删除 "工作流 ID" `<input type="text">` 块（旧行 514-523）；保留 `<select>` 下拉
- Human-input 节点：删除 "结果字段" `<input type="text">` 块（旧行 626-635）；保留 `<select>` 下拉
- 删除三个对应的 onChange handler：`handleToolIdInput` / `handleSubgraphWorkflowIdInput` / `handleHumanFormKeyInput`
- 删除现已无引用的 datalist：`toolOptionListId` / `workflowOptionListId` 及其 `<datalist>` 元素

**Per plan step 4:** 不加 fallback "如果下拉没值就用 input 兜底"；下拉是数据真源，候选为空时保存现有 `toolId / workflowId / formKey` 值，由 `selectedToolHint` / `selectedWorkflowHint` meta 文字给反馈。

### P1-5: 修好 conditional edge 编辑器 — `403010e`

**Goal:** `kind=conditional` 时硬编码 seed `{ operator: "exists", leftPath: "$.state" }`，且无 UI 让用户编辑 operator / leftPath / rightValue。

**Contract 校验：** `desktop/shared/contracts/workflow.ts:51-65` 的 `WorkflowTransitionConditionOperator` 枚举：`equals / not-equals / greater-than / greater-or-equal / less-than / less-or-equal / exists / not-exists / in / not-in`。`WorkflowTransitionCondition.rightValue?: string | number | boolean | null | string[] | number[] | boolean[]`。

**Changes:** `desktop/src/renderer/components/workflow/WorkflowEdgeEditor.tsx` 整体重写
- 删除原硬编码 seed，改为 `defaultCondition()` → `{ operator: "equals", leftPath: "" }`
- `Object.values(WorkflowTransitionConditionOperator)` 生成 operator `<select>` options
- 仅当 `edge.kind === "conditional"` 时渲染 operator / leftPath / rightValue 三组 form 控件
- `rightValue` 输入在 operator ∈ {`exists`, `not-exists`} 时被隐藏；切换到这两类 operator 时同步 `delete nextCondition.rightValue`
- `parseRightValue` 复用 condition 节点同款弱类型推断（true/false/null/数字 token / 数组 split）
- onChange 写回 `edge.condition.{operator, leftPath, rightValue}`，由 inspector 的 save 落盘

**Verification:**
- TS：通过
- 操作步骤：拖一条 edge → kind 切到 conditional → operator=equals / leftPath=$.state.status / rightValue=approved → 保存图 → 刷新页面，三字段仍是 approved/equals

### P1-6: 删除 inspector 重复 chrome — `0bf8b95`（含 deviation）

**Goal:** inspector 顶部的 "工作流图检查器 / 结构化编辑：节点、连线、状态 Schema、策略" 二级标题、"配置编辑器" panel-title、以及 "保存图定义" 按钮重复。

**Changes:** `desktop/src/renderer/components/workflow/WorkflowGraphInspector.tsx`
- 删除 `<header className="inspector-header">` 整块（含标题 / 副标题）
- 删除 `<h4 className="panel-title">配置编辑器</h4>` 子标题
- 删除孤立 CSS：`.inspector-header`、`.inspector .title`、`.inspector .subtitle`、`.inspector--compact .inspector-header`
- 错误显示（`graphErrorText` / `saveError`）保留为 `.actions` div，避免静默丢失校验反馈

**Deviation from plan P1-6 step 3：** **保留了 `保存图定义` 按钮**，未按 plan 删除。

> **Reason：** Plan 声称 "studio top bar 的 save 会落盘 inspector 字段更新"，但实测 `WorkflowStudioPage.handleSave`（line 278）只 commit `name / description / status / source` 四个 metadata 字段，**不**写入 nodes / edges / stateSchema。Inspector 的 `handleNodeUpdate / handleEdgeUpdate / handleStateSchemaUpdate` 仅更新本地 React `draft` state，唯一落盘路径是 inspector 自己的 `handleSave → workspace.updateWorkflow({ entryNodeId, nodes, edges, stateSchema, editor, defaults })`。删除该按钮会让所有图编辑沉默丢失。
>
> **Remedy 选项（留给 follow-up）：** 把 inspector 的 draft state 提升到 studio 级，或让 `handleNodeUpdate/handleEdgeUpdate` 直接 push 到 zustand。两者都是结构性改动，超出本 quick task 范围。

### P1-7: 删除 edge editor "From X → Y" meta 行 — `d8db7de`（empty audit commit）

**Goal:** 编辑器内的 `From {edge.fromNodeId} to {edge.toNodeId}` 文本与 canvas 上的连线视觉冗余。

**Changes:** 实际删除发生在 P1-5 的整体重写（`403010e`）中——重写后的 JSX 树已经不包含该 `<p className="meta">From ...</p>` 行。本 commit 为 `--allow-empty` 审计标记，保留 P1-7 的提交记录与 commit message 模板。

**Verification:** `grep -n 'From' desktop/src/renderer/components/workflow/WorkflowEdgeEditor.tsx` 不命中字面 "From X → Y"。

## Typecheck Result

```
> myclaw-desktop@0.1.0 typecheck F:\MyClaw\desktop
> tsc --noEmit -p tsconfig.main.json && tsc --noEmit -p tsconfig.renderer.json
```

Both tsconfigs compile **0 errors / 0 warnings**. Note: prompt mentioned a "pre-existing McpPage AlertCircle error allowed" — actual run shows clean exit, so even that pre-existing issue is no longer present.

## Deviations from Plan

| # | Task | Deviation | Rationale |
|---|------|-----------|-----------|
| 1 | P1-1 | Also dropped `handlePolicyUpdate` handler + `WorkflowNodePolicy` type import (plan only mandated UI mount removal) | After removing the editor mount these are dead code; CLAUDE.md and feedback rules forbid leaving sham/dead code |
| 2 | P1-4 | Also removed orphan datalist ids `toolOptionListId` / `workflowOptionListId` and their `<datalist>` elements | Their only consumers (the `list={...}` on the deleted `<input>`) are gone; rendering empty datalists is dead JSX |
| 3 | P1-5 | Edge editor rewrite (rather than incremental patch on lines 27-30) | The original file lacked any condition-editing JSX/handlers; an incremental edit would be invasive in scattered chunks. Rewrite is mechanically smaller diff and easier to audit |
| 4 | P1-6 | Kept the `保存图定义` button | Plan claim "top bar save persists graph edits" is incorrect — verified in `WorkflowStudioPage.handleSave` line 278. Deleting the button silently discards all node/edge/schema edits. Wiring the studio top-bar to save graph state is structural and out of scope. Documented in P1-6 entry above |
| 5 | P1-7 | Empty `--allow-empty` audit commit (deletion already happened in P1-5 rewrite) | Preserves the 7-commit audit trail without manufacturing fake changes |

## Manual Verification Checklist (P1 acceptance criteria)

Reviewer should run `pnpm dev` from `desktop/` and verify:

- [ ] **AC: Timeout/Retry 三框消失** — Studio 选中任意节点（start / llm / tool / subgraph / human-input / condition / join / end），右侧 inspector 不出现 "Timeout (ms)" / "Retry attempts" / "Retry backoff (ms)" 三个数字框（P1-1）
- [ ] **AC: UUID 折叠** — Inspector 顶部仅显示 "节点配置 · {中文 kind 标签}"（如 "节点配置 · 工具调用"）；UUID 仅在底部点开 "高级（节点 ID）" 后可见（P1-2）
- [ ] **AC: LLM 提示词 label** — 选中 LLM 节点，prompt textarea 上方 label 文字为 "提示词"，不是 "个性"（P1-3）
- [ ] **AC: 单输入** — Tool / Subgraph / Human-input 三类节点的右侧 inspector，对应 ID 字段只剩单个 `<select>` 下拉，没有重复的 `<input type="text">`（P1-4）
- [ ] **AC: Conditional edge 可编辑且回写** — 拖一条 edge → kind 切 `conditional` → 出现"运算符 / 左值路径 / 右值"三组控件 → 设置 `operator=equals`, `leftPath=$.state.status`, `rightValue=approved` → 点击 "保存图定义" → 关闭/重开 studio → 三字段值仍正确加载；切到 `operator=exists` 时右值字段消失（P1-5）
- [ ] **AC: Inspector 无重复标题/sub-title** — Inspector 顶部不再出现 "工作流图检查器 / 结构化编辑：节点、连线、状态 Schema、策略" 标题，也不再出现 "配置编辑器" 子标题（P1-6）；保存按钮 still 存在（deviation，见 P1-6 详述）
- [ ] **AC: Edge editor 不再露 fromNodeId/toNodeId 文本** — 选中任一 edge，inspector 内不再出现 "From start → tool-xxx" 类元数据行（P1-7）

## State of P2

P2 完全未触碰，6 commits 待执行：
- P2-1: handleDelete 真删（`WorkflowsPage.tsx:332-340`）
- P2-2: 删除 `WorkflowLibraryCard.tsx` / `WorkflowLibraryFilters.tsx`
- P2-3: `WorkflowRunPanel.tsx` token 化 + 按钮规范化
- P2-4: collapse `WorkflowDefinitionSummaryCompat` union（`workflow.ts:80-93`）
- P2-5: 停止持久化 `nodeCount` / `edgeCount` / `libraryRootId`（`workflow.ts:267`）
- P2-6: sidebar 残留样式违规修正（4 文件）

P2 涉及 store / 类型契约 / 持久化层；建议拆为独立 quick task `260507-xxx-workflow-data-style-cleanup`，参考本 P1 的 deviation 透明度。

## Follow-ups Surfaced by P1-6 Deviation

记录给后续工作：

1. **Inspector save 与 studio top-bar save 应统一。** 当前两套 save 路径走不同字段集——top-bar 只保 metadata，inspector 只保 graph。用户在 studio 看到两个 save 按钮，符合直觉但仅其中一个对当前编辑生效，体验混乱。
   - 建议方案 A：inspector draft state 提升到 studio 级；top-bar save 一并 commit metadata + graph
   - 建议方案 B：`handleNodeUpdate / handleEdgeUpdate` 直接 push 到 zustand store；studio top-bar 的 save 自动覆盖 inspector 的所有未保存改动
   - 任一方案落地后再删除 inspector 的 "保存图定义" 按钮，关闭 P1-6 的剩余 30%

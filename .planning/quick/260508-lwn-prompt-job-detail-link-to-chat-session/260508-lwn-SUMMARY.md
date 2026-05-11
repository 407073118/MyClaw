---
phase: quick-260508-lwn
plan: 01
subsystem: time-orchestration
tags: [time-job, prompt, schedule-job, chat-page, ui-refactor, navigation]
dependency-graph:
  requires:
    - 260508-jp9（per_run / shared 双态 + ExecutionRun.sessionId）
    - 260508-ic3（详情独立页 /time/jobs/:id）
    - 260508-hcp（assistant_prompt 走真 session 主链路）
  provides:
    - "TimeJobDetailPage 不内嵌聊天 UI，触发记录行跳 ChatPage"
    - "ChatPage 通过 ?sessionId= query 自动选中目标 session"
    - "ChatPage 认 ChatSession.associatedScheduleJobId（列表 + header）"
  affects: []
tech-stack:
  patterns:
    - "router query 一次性命中：useEffect 监听 searchParams，selectSession 后 setSearchParams 清掉 sessionId 避免回退反复触发"
    - "vi.mock('react-router-dom') 替身让无 Router 包裹的 ChatPage mount 可通过；不引入 MemoryRouter 改 test 大结构"
key-files:
  created: []
  modified:
    - "desktop/src/renderer/pages/TimeJobDetailPage.tsx"
    - "desktop/src/renderer/pages/ChatPage.tsx"
    - "desktop/tests/chat-page-a11y.test.ts"
    - "desktop/tests/chat-page-silicon-person-mode.test.ts"
    - "desktop/tests/chat-page-qwen-runtime-status.test.ts"
    - "desktop/tests/phase3-plan-ui.test.ts"
decisions:
  - "详情页不再当聊天框使：删 shared 底栏聊天框 + per_run RunRow 展开内嵌聊天，避免与 ChatPage 重复造一个聊天 UI；associatedScheduleJobId 终于被 renderer 用上（之前只写不读）。"
  - "RunRow 整行 button 跳 /chat?sessionId=：保留 jp9 的整行 hover 反馈，但点击行为从 expand 改为 navigate；hover 时显现「打开聊天 →」提示，无 chevron。"
  - "shared 模式额外提供「打开会话」按钮：因为 shared 没有「per_run 一行 = 一会话」的语义，给一个单独直达入口指向 job.sessionId。"
  - "?sessionId= 一次性 + 清 query：用 setSearchParams 删除而非 navigate(replace)，保留其它 query；避免回退/刷新时 selectSession 反复触发。"
  - "ChatPage 测试补 react-router-dom mock 而非全部改用 MemoryRouter：4 个测试都是 render(React.createElement(ChatPage)) 直接挂载，加 vi.mock 是最小侵入；MemoryRouter 路径要重写每个 test 文件的 render，改动面太大且与本计划无关。"
metrics:
  duration: 28min
  tasks: 3
  files: 6
  completed-at: "2026-05-08T15:10:00Z"
---

# Quick 260508-lwn Plan 01: 详情页改跳 ChatPage + ChatPage 认定时任务 session Summary

把 prompt 类型定时任务统一回归为「= 用户在 ChatPage 里发了一条消息」语义。详情页过去 4 次迭代（hcp/hvr/ic3/jp9）一直在自己内嵌一份完整聊天 UI，等于重复造 ChatPage；本计划把它撤掉，所有"会话"流量都回归 ChatPage 主路径。`ChatSession.associatedScheduleJobId` 终于在 renderer 被读出，列表行 + header 都能一眼看出"这是某个定时任务产生的会话"。

## Tasks

### Task 1: TimeJobDetailPage 删两段聊天 UI，RunRow 改单行点击跳 ChatPage
**Commit:** `1fc2727`
**Files:** 1 modified（556 → 130 行有效逻辑）

- `desktop/src/renderer/pages/TimeJobDetailPage.tsx` —
  - 删除 imports：`ChatMessage` / `ChatSession` / `textOfContent` / `useRef`
  - 删除 state/memo：`session`, `visibleMessages`, `draft`, `sending`, `expandedRunId`, `messagesEndRef`
  - 删除 effect：自动 selectSession（shared）/ 滚到底部
  - 删除 `handleSend` 函数；删除整段 `<section className="time-job-detail__chat">`（shared 底部聊天框）；删除 `ChatBubble` 组件函数
  - `RunRow` 重构：
    * props 从 `{run, timezone, sessionMode, runSession, expanded, onToggle}` → `{run, timezone, onOpenSession}`
    * 整行 `<button className="run-row__btn-row">`，`onClick = () => onOpenSession(run.sessionId!)`
    * `canOpen = Boolean(run.sessionId)`，`run.sessionId` 缺失时 disabled
    * 右侧加 `.run-row__open-hint`（"打开聊天 →"），hover 时透明度 0 → 1
    * 删除 `.run-row__chat / .run-row__compose / .run-row__messages / .run-row__send-error / .run-row__btn / .run-row__toggle` 所有展开区 CSS
  - 顶部新增 `handleOpenRunSession(sessionId)` → `navigate("/chat?sessionId=" + encodeURIComponent(sessionId))`
  - actions 区当 `sharedSessionId`（isShared && supportsChat && job.sessionId）存在时加「打开会话」按钮
  - "执行记录" section 标题副文案 `"X 次 · 点击行进入对应聊天"`（仅 supportsChat）
  - 全部 styles 通过 ui-style-guide 自查（`var(--radius-md)` / `var(--radius-xl)` / `var(--radius-sm)`，描边按钮，无 v1/v2 字样）

### Task 2: ChatPage 接 ?sessionId= + session 列表/header 认 associatedScheduleJobId
**Commit:** `1fc2727`
**Files:** 1 modified

- `desktop/src/renderer/pages/ChatPage.tsx` —
  - imports：`useNavigate, useSearchParams` from `react-router-dom`
  - 组件顶部：`const navigate = useNavigate(); const [searchParams, setSearchParams] = useSearchParams();`
  - 加 `scheduleJobsById = useMemo(() => Map<id, {id,title}>)` 基于 `workspace.time?.scheduleJobs`
  - 加 `associatedScheduleJob = useMemo()` 当前 `session?.associatedScheduleJobId` 在 map 里查表
  - 加 useEffect 监听 `searchParams`：`queryId = searchParams.get("sessionId")`，存在且 `workspace.sessions.some(id===queryId)` → `useWorkspaceStore.getState().selectSession(queryId) + setSearchParams(replace)` 清掉 sessionId
  - session 列表行 `<strong>`：`item.associatedScheduleJobId` 存在时前置 `<span className="session-schedule-badge">⏰</span>`
  - header `.header-title` 内：`associatedScheduleJob` 存在时前置同样 ⏰
  - header 标题下条件渲染 `<div className="session-from-schedule" data-testid="session-from-schedule">来自定时任务「X」<button onClick={navigate('/time/jobs/:id')}>打开任务详情 →</button></div>`
  - styles 区追加 `.session-schedule-badge / .session-from-schedule / .session-from-schedule__link`，配色 cyan accent

### Task 3: 4 个 ChatPage 直接挂载的 vitest 加 react-router-dom mock
**Commit:** `1fc2727`
**Files:** 4 modified

每个文件在 `vi.mock("../src/renderer/stores/workspace", ...)` 之后追加：
```ts
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
}));
```

涉及：
- `desktop/tests/chat-page-a11y.test.ts`
- `desktop/tests/chat-page-silicon-person-mode.test.ts`
- `desktop/tests/chat-page-qwen-runtime-status.test.ts`
- `desktop/tests/phase3-plan-ui.test.ts`

## Verification

```bash
cd desktop && pnpm exec tsc --noEmit
# → 6 个本计划改的文件 0 errors
# → tests/* 目录红色错误均为 pre-existing（与本计划无关）

cd desktop && pnpm exec vitest run \
  tests/chat-page-a11y.test.ts \
  tests/chat-page-silicon-person-mode.test.ts \
  tests/chat-page-qwen-runtime-status.test.ts \
  tests/phase3-plan-ui.test.ts \
  tests/time-job-executor.test.ts \
  tests/time-scheduler.test.ts \
  tests/time-orchestration-store.test.ts
# → Test Files: 6 passed | 1 failed (7)
# → Tests:      37 passed | 1 failed (38)
# → 唯一失败：chat-page-qwen-runtime-status 的 "chat-runtime-model-status" 单 case
#   在 git stash 状态（HEAD@81c9cb9，本计划改动前）也红 — 是 pre-existing failure
```

## Decisions Made

1. **详情页不再当聊天框使** — 删 shared 底栏聊天框 + per_run RunRow 展开内嵌聊天。前 4 次迭代（hcp/hvr/ic3/jp9）一直在重复造 ChatPage 的 UI；associatedScheduleJobId 字段也只写不读。本计划把"会话"承载完全归位 ChatPage，详情页只保留任务元数据 + 触发记录列表。
2. **RunRow 整行 button 跳 /chat?sessionId=** — 保留 jp9 的整行 hover 反馈和 `all: unset` button 重置，但点击行为从 expand 改为 navigate；右侧用 `.run-row__open-hint`（hover 时显现的"打开聊天 →"）替代原来的"展开 ↓ / 收起 ↑"提示，无需 chevron。
3. **shared 模式额外加「打开会话」按钮** — shared 没有「per_run 一行 = 一会话」的语义（所有触发都汇入 `job.sessionId`），所以在 actions 区给一个单独直达入口；放在「立即执行」之后、「编辑」之前。
4. **?sessionId= 一次性 + 清 query** — 用 `setSearchParams(next, { replace: true })` 删除 sessionId（保留其它可能的 query），不用 navigate(replace) 整行替换；避免回退/刷新时 selectSession 反复触发。effect 依赖 `[searchParams, workspace.sessions, setSearchParams]`，selectSession 通过 `useWorkspaceStore.getState()` 直接拿避免依赖项漂移。
5. **vi.mock("react-router-dom") 而非改 MemoryRouter** — 4 个测试都是 `render(React.createElement(ChatPage))` 直接挂载、没 Router；改用 MemoryRouter 要每个文件改 render 调用且本计划范围之外。最小侵入是 stub `useNavigate / useSearchParams`，让 hook 调用顺利通过即可。

## Deviations from Plan

None — 三个 Task 按 PLAN 顺序执行；vitest 跑出 1 个 fail 后用 git stash 验证是 pre-existing。

## UI Style Guide Self-Check

- [x] 圆角全部使用 `var(--radius-md)` (7px) / `var(--radius-xl)` (14px) / `var(--radius-sm)` (4px)
- [x] 按钮全部描边风格（`.time-job-detail__btn`、`.run-row__btn-row`、`.session-from-schedule__link`）
- [x] 不写 v1/v2 字样
- [x] `.run-row` 单列布局（flex column）
- [x] `.session-schedule-badge` / `.session-mode-chip` 走 inline 描边小标签，非 `.glass-pill` 圆 pill
- [x] textarea 在详情页已被全部删除（不再有任何输入控件）

## Self-Check: PASSED

- [x] TimeJobDetailPage 0 textarea / 0 sendMessage / 0 ChatBubble
- [x] ChatPage 列表行 + header 都看得见 ⏰ 与「来自定时任务」回链
- [x] ?sessionId= 一次性命中后被清空
- [x] 7 个相关 vitest 中只有 1 个 pre-existing 单 case 红
- [x] Commit `1fc2727` — Task 1 + 2 + 3（一个 feat commit 涵盖 6 文件）

---
phase: quick-260508-lwn
plan: 01
type: execute
wave: 1
depends_on:
  - 260508-jp9
files_modified:
  - desktop/src/renderer/pages/TimeJobDetailPage.tsx
  - desktop/src/renderer/pages/ChatPage.tsx
  - desktop/tests/chat-page-a11y.test.ts
  - desktop/tests/chat-page-silicon-person-mode.test.ts
  - desktop/tests/chat-page-qwen-runtime-status.test.ts
  - desktop/tests/phase3-plan-ui.test.ts
autonomous: true
---

<objective>
把 Prompt 类型定时任务详情页（TimeJobDetailPage）从「自己内嵌一份完整聊天 UI（shared 底栏 + per_run RunRow 展开聊天）」精简为「只承载任务元数据 + 触发记录列表」。详情页里所有的 textarea/消息流/继续聊天能力都删掉。RunRow 行点击 → navigate 到 ChatPage 对应 session。

ChatPage 端补齐识别能力：通过 ?sessionId= query 一次性切到目标 session；session 列表行 + header title 给挂着 associatedScheduleJobId 的 session 加 ⏰ 标记；header 加一行"来自定时任务 X · 打开任务详情"回链。

Why: 用户连续 10 次反复要求"prompt 定时任务等价于用户在 ChatPage 发了一条消息"，但前面 hcp/hvr/ic3/jp9 一直在详情页里复刻聊天 UI（hcp 让链路对了，jp9 又给详情页加了完整聊天框），等于重复造一个 ChatPage。associatedScheduleJobId 字段也只写不读，没有用户可见的"这是定时任务产物"识别。
</objective>

<context>
现状（base = HEAD@81c9cb9）：
- TimeJobDetailPage.tsx 1069 行，里面同时承载：顶部 header、shared 模式底部聊天框（time-job-detail__chat）、per_run RunRow 展开内嵌聊天（run-row__chat）。两套聊天 UI 都有 textarea + sendMessage form。
- ChatSession.associatedScheduleJobId 字段在 main/index.ts 写入但 renderer 没有任何地方读 — 死字段。
- ChatPage 不依赖 react-router-dom（之前没用过 useNavigate/useSearchParams）。
- 4 个 ChatPage 测试用 `render(React.createElement(ChatPage))` 直接挂载，没有 Router 包裹。
</context>

<tasks>

<task>
  <name>Task 1: TimeJobDetailPage 删两段聊天 UI，RunRow 改为点击跳 ChatPage</name>
  <files>desktop/src/renderer/pages/TimeJobDetailPage.tsx</files>
  <action>
    1) 删除 import：ChatMessage, ChatSession, textOfContent；删 useRef。
    2) 删除 state：draft, sending, expandedRunId, messagesEndRef；删除 useMemo: session, visibleMessages；删除 useEffect: 自动 selectSession、滚到底部。
    3) 删除 handleSend 函数。
    4) 删除整段 `<section className="time-job-detail__chat">` JSX（shared 底部聊天框）。
    5) 删除 ChatBubble 组件函数（不再被任何地方使用）。
    6) RunRow 重构：移除 expanded/onToggle/runSession/sessionMode props，改为 onOpenSession callback；删除 run-row__chat / run-row__compose / run-row__send-error 整个展开区；按钮包裹整行，点击 → onOpenSession(run.sessionId)；只有 run.sessionId 存在时才可点击，否则 disabled。
    7) 在 actions 行：sharedSessionId 存在时加一个「打开会话」按钮（同样 navigate /chat?sessionId=）。
    8) 顶部 handleOpenRunSession 函数：navigate(`/chat?sessionId=${encodeURIComponent(sessionId)}`)。
    9) styles 删除：.bubble*, .time-job-detail__messages, .time-job-detail__compose, .run-row__chat, .run-row__messages, .run-row__compose, .run-row__btn (老的, 改名为 .run-row__btn-row), .run-row__send-error, .run-row__toggle, .run-row__head-btn (改为 .run-row__btn-row)。
    10) styles 新增：.run-row__open-hint（hover 时显现的「打开聊天 →」提示），.run-row.run-row--openable（hover 边框态）。
    11) "执行记录" section 标题下副文案改为 "X 次 · 点击行进入对应聊天"（只对 supportsChat 显示）。
  </action>
  <done>
    - TimeJobDetailPage 不再含任何 textarea / sendMessage / ChatBubble
    - RunRow 单行可点击 → navigate /chat?sessionId=
    - shared 模式额外提供「打开会话」按钮
    - per_run / shared chip 保留
  </done>
</task>

<task>
  <name>Task 2: ChatPage 接 ?sessionId= + session 列表/header 认 associatedScheduleJobId</name>
  <files>desktop/src/renderer/pages/ChatPage.tsx</files>
  <action>
    1) imports 加 useNavigate, useSearchParams（react-router-dom）。
    2) 组件顶部加 navigate / searchParams / setSearchParams。
    3) 加 scheduleJobsById = useMemo(() => Map<id, {id,title}>) 基于 workspace.time?.scheduleJobs。
    4) 加 associatedScheduleJob = useMemo() 当前 session 的 associatedScheduleJobId 查表。
    5) 加 useEffect 监听 searchParams：sessionId 命中且存在 → useWorkspaceStore.getState().selectSession(id) + setSearchParams 删 sessionId（一次性，避免回退反复触发）。
    6) session 列表行 strong 之前插 `<span className="session-schedule-badge">⏰</span>`（仅 associatedScheduleJobId 存在时）。
    7) header `.header-title` 内 ⏰ 同样处理；标题下加 `<div className="session-from-schedule">来自定时任务「X」<button onClick={navigate(/time/jobs/X)}>打开任务详情 →</button></div>`。
    8) 内嵌 styles 加 .session-schedule-badge、.session-from-schedule、.session-from-schedule__link。
  </action>
  <done>
    - 列表行 + header 都能一眼看出"这是某个定时任务产生的会话"
    - 点击「打开任务详情」回到 /time/jobs/:id
    - 从详情页跳过来时自动选中目标 session 且 query 被清掉
  </done>
</task>

<task>
  <name>Task 3: 4 个 ChatPage 直接挂载的 vitest 加 react-router-dom mock</name>
  <files>
    desktop/tests/chat-page-a11y.test.ts,
    desktop/tests/chat-page-silicon-person-mode.test.ts,
    desktop/tests/chat-page-qwen-runtime-status.test.ts,
    desktop/tests/phase3-plan-ui.test.ts
  </files>
  <action>
    每个文件在 vi.mock(workspace) 之后追加：
    ```ts
    vi.mock("react-router-dom", () => ({
      useNavigate: () => vi.fn(),
      useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
    }));
    ```
    原因：这些测试用 render(React.createElement(ChatPage))，没有 Router 包裹；ChatPage 现在依赖 useNavigate/useSearchParams，不 mock 会运行时 throw。
  </action>
  <done>
    - 4 个 test 文件都能跑过 ChatPage mount
    - 不影响测试断言主体
  </done>
</task>

</tasks>

<verification>
- pnpm exec tsc --noEmit：源码 0 error（tests 目录的 pre-existing 错误不在本计划范围）
- pnpm exec vitest run tests/chat-page-a11y.test.ts tests/chat-page-silicon-person-mode.test.ts tests/chat-page-qwen-runtime-status.test.ts tests/phase3-plan-ui.test.ts tests/time-job-executor.test.ts tests/time-scheduler.test.ts tests/time-orchestration-store.test.ts
  期望：6/7 文件全绿（chat-page-qwen-runtime-status 单 case 失败为 baseline 即红的 pre-existing）

人工冒烟（开 Electron 后做一次）：
1. 创建一条新 Prompt 定时任务（默认 per_run）→ 立即执行 → 去 ChatPage：session 列表里能看到带 ⏰ 的新会话；进入会话能正常追问、继续聊
2. 回到 /time/jobs/:id：详情页只列触发记录，不出现任何 textarea；点击触发记录行 → 跳到 ChatPage 对应那次的 session
3. 老 shared job：详情页 actions 区有「打开会话」按钮 → 跳到累积 session
</verification>

<success_criteria>
- TimeJobDetailPage 0 textarea / 0 sendMessage / 0 ChatBubble
- ChatPage 列表/header 看得见 ⏰ 与「来自定时任务」回链
- ?sessionId= 一次性命中后被清空
- 7 个相关 vitest 中只有 1 个 pre-existing 单 case 红（在 baseline 也红）
</success_criteria>

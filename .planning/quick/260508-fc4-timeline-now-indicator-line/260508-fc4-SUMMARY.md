---
quick_id: 260508-fc4
description: 日程时间轴加“当前时间”指示线
date: 2026-05-08
status: completed
---

# Quick 260508-fc4 — Summary

## What changed

`desktop/src/renderer/pages/TimeCenterPage.tsx`：

1. `ScheduleTimeline` 新增 `selectedDate` / `todayDateKey` 两个 props，调用点（`activeView === "timeline"` 分支）已传入。
2. 内部派生 `isToday`，仅当为 today 时：
   - `useState(new Date())` + `useEffect` 启动 `setInterval(60_000)` 推进 `now`；切走非今日立即清空并停止 timer。
   - `useRef` 持有 `.timeline-board` DOM；`useLayoutEffect` 用 `querySelector('[data-testid="timeline-hour-${hour}"]')` 读取当前小时行的 `offsetTop` + `offsetHeight`，按分钟比例插值算出 `nowTop`。
   - 首次定位时（`didScrollRef` 守卫）将 `board.scrollTop` 调到 `nowTop - 160`，让红线落在视口中段；切回今日重新触发滚动。
3. 渲染绝对定位的 `<div className="timeline-now-line">`：左侧红色圆点 `__dot`，右上 `HH:mm` 文字标签 `__label`，1px 红色横线（`#ef4444`）从内容列起点（`left: 64px`）跨到右边缘。`pointer-events: none; z-index: 5;` 不影响交互。
4. 新增工具：`getLocalMinute(iso, timezone)` 复用 `getDateTimeFormatter` 缓存；`formatNowLabel(now, timezone)` 输出 `HH:mm`。
5. 内联 `styles` 字符串末尾追加 `.timeline-now-line` / `__dot` / `__label` 三组规则。

`React` import 添加 `useLayoutEffect` 与 `useRef`。

## How to verify

1. `cd desktop && pnpm run typecheck` —— TimeCenterPage 自身 0 错误。
   - 注：仓库当前已有一个预存在的 TS 错误：`src/renderer/stores/workspace.ts:31` 引用 `WorkflowDefinitionSummary` 但 `desktop/shared/contracts/workflow.ts` 未导出该 symbol。这是 quick 任务范围之外的未提交改动遗留。
2. 启动 desktop dev，`TimeCenterPage`：
   - 默认进入 timeline 视图：红色 now-line 出现，右上角 HH:mm 与系统时间一致；首次进入滚动条已对准红线附近。
   - 点「下一天」/「上一天」：红线消失（`isToday=false`，`nowTop` 被清掉）。
   - 点「今日」按钮回到今天：红线再次出现并触发滚动。
   - 等 1 分钟（或 devtools 改时钟）：红线 top 会重算，标签上的 HH:mm 也会同步刷新。
3. 现有测试：`tests/time-center-page.test.ts` 用 `[data-testid="timeline-hour-N"]` 查询，未触及；新增 `[data-testid="timeline-now-line"]` 不会破坏现有断言。

## Out of scope (deferred)

- 其他视图（events / reminders / jobs）的当前时间提示。
- `WeekTimeline` 的 now-line（用户描述未涉及，且周视图当前是简单列表，不是时间网格）。
- 用户手动滚动后再切回今天是否要保留滚动位置（当前实现：每次切回今天都重新滚一次）。
- 修复预存在的 `WorkflowDefinitionSummary` 导出缺失（与本任务无关）。

## Files
- `desktop/src/renderer/pages/TimeCenterPage.tsx` — 119 insertions / 4 deletions

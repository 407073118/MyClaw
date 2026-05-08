---
quick_id: 260508-ic3
description: 定时任务详情独立页（替换抽屉）+ Prompt 任务可继续聊天
date: 2026-05-08
status: completed
---

# Quick 260508-ic3 — Summary

## What changed

### 抽屉 → 独立页（核心改造）
- **新增 `desktop/src/renderer/pages/TimeJobDetailPage.tsx`**
- **新增路由 `/time/jobs/:id`**（`router/index.tsx`）
- **删除 `ExecutionHistoryDrawer` 组件**与全部 `.execution-history-drawer*` / `.execution-history-row*` / `.execution-history-list` / `@keyframes executionDrawer*` CSS

### 详情页布局（自上而下）
1. **Topbar**：「← 日程规划」返回按钮（cyan hover）
2. **Header 卡**：title + type chip + status badge + frequency 中文 + 上次执行时间 +「立即执行 / 编辑 / 暂停|恢复 / 删除」按钮组；执行操作有 spinner，feedback 用 cyan banner 显示
3. **对话区**（仅 Prompt 类型有 sessionId 时）：
   - 完整 session.messages 流，user 右气泡 cyan 边框 / assistant 左气泡 default / tool 单独折叠卡（details summary + pre 全文）
   - 每个气泡有 role + 时间 meta，markdown 渲染（继承 MarkdownView + 内联气泡 typography 防止外溢）
   - **底部输入框**：textarea + 发送按钮，`⌘ / Ctrl + Enter` 发送；submit → `selectSession + sendMessage` 复用主链路（工具/技能/MCP/审批/流式 全继承）
   - 消息更新自动滚到底部（messagesEndRef + scrollIntoView）
4. **执行记录区**：状态点 bullet（succeeded ✓ / failed ✗ / running … / cancelled •）+ 时间 mono + status badge + outputSummary 一行 line-clamp:2 摘要 + errorMessage 红色 pre

### 列表 → 详情 navigation
`ScheduleJobListPage` 行 click + Enter/Space → `navigate(\`/time/jobs/\${id}\`)`，不再开抽屉。

### 编辑往返
详情页「编辑」→ `navigate("/time", { state: { editJobId } })` → TimeCenterPage 顶层 useEffect 读 location.state，自动 setEditingJob + setActiveComposer("job") + setChosenJobType + 用 `navigate(replace, { state: null })` 清掉 history.state 防止刷新重触。

### 工作流 / 员工类型详情页
不渲染对话区（这两类没 sessionId），只显示 header + 执行记录。

### Bubble & RunRow CSS
- bubble user 右对齐 cyan 底，assistant 左对齐 glass-border
- markdown 元素本地化（h1-3 / p / ul / ol / a / code / pre / blockquote）
- run row 用 24px 圆形 status bullet 替代矩形 badge —— 时间线视觉
- 工具结果默认折叠 details summary（80 字预览），点击展开 pre

## How to verify

1. `cd desktop && pnpm run typecheck` 全绿（main + renderer）。
2. desktop dev：
   - 列表行点击 / Enter / Space → 直接跳到 `/time/jobs/{id}` 详情页
   - Prompt 任务有 sessionId 时：
     - 看到完整对话流（user 右 cyan / assistant 左 / tool 折叠）
     - 底部输入框输入文字 + ⌘/Ctrl+Enter 或点「发送」→ optimistic user 气泡立即出现，主链路返回后刷新
     - 「立即执行」点击 spinner，跑完执行记录区多一条
   - 「编辑」→ 跳回 /time 自动打开编辑器预填该 job
   - 「暂停 / 恢复 / 删除」全可用，删除有二次确认 + 跳回 /time
   - workflow / 员工类型详情页：仅 header + 执行记录，无 chat
3. 抽屉相关 CSS / JSX 全部消失，bundle 无残留。
4. 旧 prompt job 跑过一次后回到详情页能看见对话历史 + 继续聊。

## 设计权衡

- **为啥没在详情页里嵌完整 ChatPage**：ChatPage 含 reasoning panel / approval requests / plan mode / token usage 等深度功能，详情页只做"看一遍 + 接着聊"的轻量体验；要重型操作可点上方 link 跳 /chat
- **为啥 user 气泡用 cyan 而非右对齐裸文字**：让"我说的"和"模型说的"一眼能分；project token 已有 cyan 是统一选择
- **为啥用 markdown view 而非纯 textOfContent**：assistant 输出本来就带格式，纯文字会破坏结构；user 输入也支持 md 是 ChatPage 一致行为
- **为啥保留 location.state 的编辑跳回**：避免详情页内嵌 ScheduleJobEditor modal —— 那要重复布局 + 维护 chosenJobType 一份。让 TimeCenterPage 的编辑器作为唯一入口，跳回更简单

## Out of scope (deferred)
- Reasoning panel 在详情页可视化（ChatPage 才有）
- Approval requests UI / Plan mode / 工具调用结构化卡片
- Run row 点击精准滚到 chat 对应消息（要 ExecutionRun 加 sessionMessageId）
- 详情页的实时流式 token 渲染（目前只在消息完成后刷）
- Chat 输入支持附件 / 图片（textarea only）

## Files
- `desktop/src/renderer/pages/TimeJobDetailPage.tsx` (new, ~580 行)
- `desktop/src/renderer/router/index.tsx` (+2 行)
- `desktop/src/renderer/pages/TimeCenterPage.tsx` (~ −430 行 drawer + CSS, +20 行 location.state effect, navigate 替换 setSelectedJobForHistory)

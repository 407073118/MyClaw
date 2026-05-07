---
quick_id: 260507-juq
type: execute
files_modified:
  - desktop/src/renderer/styles/global.css
  - desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx
  - desktop/src/renderer/components/ReasoningPresetPanel.tsx
  - desktop/src/renderer/components/WorkFilesPanel.tsx
autonomous: true

must_haves:
  truths:
    - "硅基员工工作台页面（工作台 + ReasoningPresetPanel + WorkFilesPanel）视觉与 SiliconPersonEntryPage 一致：22px 标题、矩形 .tag、单列 .list-row、描边按钮、10-12px 圆角"
    - "页面无任何实心填充按钮（btn-premium accent / sp-confirm-ok 渐变 / ws-btn-send 等已替换为 .btn-primary 描边）"
    - "技能 / MCP / 已绑工作流 / 运行记录 / 定时任务 5 个列表均使用 .list-rows + .list-row 单列布局，不再是多列 auto-fill 网格"
    - "WorkFilesPanel 7 个 emoji 图标全部替换为 lucide-react 图标"
    - "保存确认 modal：圆角 16px、shadow var(--shadow-modal)、ESC 关闭、Enter 提交、焦点陷阱"
    - "页面行为完全不变（无 handler / state / IPC 改动）；TypeScript 编译无新增报错"
    - "ReasoningPresetPanel 改动后，SiliconPersonCreatePage（共享方）视觉仍然正确"
    - "WorkFilesPanel 改动后，ChatPage（共享方）行为仍然正确"
  artifacts:
    - path: "desktop/src/renderer/styles/global.css"
      provides: "新增 .tag--interactive 变体（用于 ws-session-pill 类似的可交互 tag）"
      contains: ".tag--interactive"
    - path: "desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx"
      provides: "完成全部 7 步样式迁移的工作台页"
      contains: "page-shell"
    - path: "desktop/src/renderer/components/ReasoningPresetPanel.tsx"
      provides: "圆角 token 化、字重收敛、徽章用 .tag、按钮 hover-lift 移除"
      contains: "var(--radius-md)"
    - path: "desktop/src/renderer/components/WorkFilesPanel.tsx"
      provides: "lucide 图标替换 emoji + 圆角 token 化"
      contains: "FileText"
  key_links:
    - from: "SiliconPersonWorkspacePage 顶层 <main.ws>"
      to: ".page-shell + .page-header--sticky + .page-content"
      via: "DOM 结构重构，删除 ws / ws-header / ws-header-top / ws-tabs 旧框架样式"
      pattern: "page-shell.*page-header--sticky.*page-content"
    - from: "保存确认 modal <div.sp-confirm-overlay>"
      to: "useDialogA11y hook（ESC + Enter + focus trap）"
      via: "新增 useEffect 注册键盘监听 + 入场聚焦"
      pattern: "Escape.*Enter.*focus"
---

<objective>
把 SiliconPersonWorkspacePage（1483 行）+ ReasoningPresetPanel + WorkFilesPanel 三个文件的样式迁移到 desktop/docs/ui-style-guide.md 规范，与已迁移的 SiliconPersonEntryPage 保持视觉一致。

Purpose: 收口硅基员工三件套的 UI 不一致（旧 ws-* 类、emoji 图标、多列网格、实心填充按钮、800 字重、14px+ 圆角）；让员工端工作台与列表页风格统一。

Output: 4 个文件改动（global.css 加 1 个 tag 变体，3 个 React 文件做样式迁移），单 commit，行为零改动。

Out of scope（locked，不要碰）：
- 任何 handler / state / IPC / store / contracts 改动
- 已知功能 bug：preload 错误吞噬、流事件 draft reset、保存校验缺失、删除员工 UI、description 不可编辑、tab 不持久化到 URL、定时任务默认时间硬编码
- 1483 行单文件拆分、setViewVersion 清理
- Skills/MCP install/uninstall、workflow unbind、schedule edit/cancel
</objective>

<execution_context>
- 这是 Quick 任务，单 commit 完成；不需要逐 task 跑 tsc
- 全部 task 完成后，最终一起做 verification（typecheck + 页面冒烟）
- 严格遵循 .claude/CLAUDE.md 的 GSD 工作流约束
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@desktop/docs/ui-style-guide.md
@desktop/src/renderer/pages/SiliconPersonEntryPage.tsx
@desktop/src/renderer/styles/global.css

<!-- 三个目标文件 -->
@desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx
@desktop/src/renderer/components/ReasoningPresetPanel.tsx
@desktop/src/renderer/components/WorkFilesPanel.tsx

<interfaces>
<!-- CSS 类清单（已审计 global.css，2026-05-07） -->

可直接使用（已存在）：
- 布局：.page-shell, .page-header--sticky, .page-header__lead, .page-header__eyebrow, .page-header__title, .page-header__subtitle, .page-header__actions, .page-content
- 列表：.list-rows, .list-row, .list-row__lead, .list-row__avatar, .list-row__main, .list-row__title-row, .list-row__title, .list-row__meta-row, .list-row__meta, .list-row__meta-sep, .list-row__description, .list-row__trailing
- 列表变体：.list-row--with-avatar, .list-row--with-description, .is-disabled, .is-selected
- 按钮：.btn-primary, .btn-toolbar, .icon-btn, .btn-ghost, .btn-ghost--danger
- 状态：.status-dot, .status-dot--green/--red/--yellow/--accent/--muted
- 标签：.tag, .tag--accent, .tag--green, .tag--yellow, .tag--red, .tag--muted
- 横幅：.banner, .banner--error, .banner--warning, .banner--info
- 空态：.empty-state, .empty-state__icon, .empty-state__title, .empty-state__body, .empty-state--minimal
- Tokens：--radius-sm(4px), --radius-md(6px), --radius-lg(10px), --radius-xl(12px), --radius-2xl(16px), --shadow-modal, --shadow-card

需要在 Task 0 新增（不存在）：
- .tag--interactive：用于 ws-session-pill（可点击、可 active）。普通 .tag 是静态标签，不是可交互按钮——session pills 既要矩形 4px 圆角的视觉，也要 hover/active/focus-visible 状态

映射关系（spec 名 → CSS 已有名）：
- task_specifics 提到 tag--success → .tag--green
- task_specifics 提到 tag--info    → .tag--accent
- task_specifics 提到 tag--warn    → .tag--yellow
- task_specifics 提到 tag--danger  → .tag--red
- task_specifics 提到 banner--warn → .banner--warning
- 不要新建 success/info/warn/danger 别名变体——直接用 green/yellow/red/accent
</interfaces>

<work-plan>
按 7 步迁移规范，分 5 个 Task 执行：

Task 0：global.css 补 1 个变体（.tag--interactive）
Task 1：global.css scout 完成 → SiliconPersonWorkspacePage 的 page chrome + header + tabs（步骤 1）
Task 2：SiliconPersonWorkspacePage 的按钮 + 列表 + 状态徽章 + 卡片表单（步骤 2/3/4/5）
Task 3：SiliconPersonWorkspacePage 的错误/空态 + 保存确认 modal a11y（步骤 6/7）
Task 4：ReasoningPresetPanel 圆角 token 化 + 徽章用 .tag + 移除 hover-lift
Task 5：WorkFilesPanel emoji → lucide + 圆角 token 化
Task 6：最终验证（tsc + 启动 + 共享组件 CreatePage / ChatPage 视觉抽查）
</work-plan>

<tasks>

<task type="auto">
  <name>Task 0: 在 global.css 新增 .tag--interactive 变体</name>
  <files>desktop/src/renderer/styles/global.css</files>
  <action>
    在 global.css 现有 .tag 块后（约第 840 行 .tag--muted 之后）新增一个 .tag--interactive 变体，专用于行内可点击、可选中的 tag（例如 SiliconPersonWorkspacePage 的 session pill）。其余规范要求的变体名（success/info/warn/danger）已有等价类，直接映射即可，不要新增别名。

    **新增 CSS（紧跟在 .tag--muted 闭合大括号之后）：**

    ```css
    /* Interactive variant — for clickable / selectable tags such as session pills.
       Adds hover, focus-visible and is-active states without changing the static
       .tag visual identity. Static usage stays identical to the other variants. */
    .tag--interactive {
      cursor: pointer;
      color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.10);
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }

    .tag--interactive:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.08);
      border-color: var(--glass-border-hover);
      color: var(--text-primary);
    }

    .tag--interactive:focus-visible {
      outline: 2px solid var(--accent-cyan);
      outline-offset: 2px;
    }

    .tag--interactive.is-active {
      color: var(--accent-cyan);
      background: rgba(16, 163, 127, 0.12);
      border-color: rgba(16, 163, 127, 0.30);
    }

    .tag--interactive:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    ```

    不要改动其他类。仅新增上面的代码块。
  </action>
  <verify>
    grep "tag--interactive" desktop/src/renderer/styles/global.css 应至少匹配 4 处（定义 + :hover + :focus-visible + .is-active）
  </verify>
  <done>
    .tag--interactive 已添加到 global.css，包含 base + hover + focus-visible + is-active + disabled 五个状态；其他类未被触碰。
  </done>
</task>

<task type="auto">
  <name>Task 1: SiliconPersonWorkspacePage 步骤 1 — page chrome 重构（page-shell + page-header--sticky + page-content）</name>
  <files>desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx</files>
  <action>
    重构页面顶层结构，把 `<main.ws>` + `<header.ws-header>` + `<nav.ws-tabs>` 改为 `.page-shell` + `.page-header--sticky` + `.page-content`。tabs 作为 .page-content 内顶部的次级导航。

    **参考实现：**
    @desktop/src/renderer/pages/SiliconPersonEntryPage.tsx（已迁移基线）

    **具体改动：**

    1. **顶层 wrapper（约 617 行）：**
       - `<main data-testid="silicon-person-studio-view" className="ws">` → `<div className="page-shell" data-testid="silicon-person-studio-view">`
       - 闭合 `</main>` → `</div>`（约 1481 行）

    2. **Header 区（约 619-666 行 `<header className="ws-header">` ... `</header>`）改成：**
       ```tsx
       <header className="page-header page-header--sticky">
         <div className="page-header__lead">
           <div className="page-header__eyebrow">
             <Users size={14} />
             <span>Silicon Person Studio</span>
           </div>
           <div className="page-header__title-row">
             <h2 className="page-header__title">{draftName || siliconPerson?.name || "硅基员工"}</h2>
             {siliconPerson && (
               <span
                 className={`status-dot status-dot--${statusDotVariant(siliconPerson.status)}`}
                 title={siliconPersonStatusLabel(siliconPerson.status)}
               />
             )}
           </div>
           <p className="page-header__subtitle">
             {draftTitle || siliconPerson?.title || "管理这个硅基员工的会话、能力与定时任务。"}
           </p>
         </div>
         <div className="page-header__actions">
           <button
             type="button"
             className="btn-toolbar"
             data-testid="ws-back-btn"
             onClick={() => navigate("/employees")}
           >
             <ChevronLeft size={14} />
             返回列表
           </button>
           {siliconPerson && (
             <button
               type="button"
               className="btn-primary"
               data-testid="profile-tab-save"
               onClick={() => setShowSaveConfirm(true)}
               disabled={isSaving}
             >
               <Save size={14} />
               {isSaving ? "保存中..." : "保存"}
             </button>
           )}
         </div>
       </header>
       ```

       注意：原 `<svg>` 返回箭头改成 `<ChevronLeft size={14}/>`；avatar 不再放 header 里（保留在原 ws-identity 的语义不需要——entry 页头没有 avatar）。

    3. **新增辅助函数（放在 statusColor 旁边）：**
       ```tsx
       function statusDotVariant(status: string): "green" | "red" | "yellow" | "accent" | "muted" {
         return ({
           idle: "muted",
           running: "accent",
           needs_approval: "yellow",
           done: "green",
           error: "red",
           canceling: "yellow",
           canceled: "muted",
         } as Record<string, "green" | "red" | "yellow" | "accent" | "muted">)[status] ?? "muted";
       }
       ```
       原有的 `statusColor` 字面量（约 599 行）保留也行，但已不再被使用，可以删掉。

    4. **status meta-row 上移到 page-header__lead 还是放在 page-content 顶部？**
       看 SiliconPersonEntryPage：状态点已经够了，所以原来 `.ws-meta-row`（5-6 个 glass-pill 显示 sources/sessions/workflows/unread/needsApproval）整体迁到 `.page-content` 内顶部，紧贴 toolbar 之上，用 `.tag tag--muted` 样式。等到 Task 2 处理 status 徽章时再做这部分（这一 Task 先把 wrapper 改对，meta-row 暂时留原位置即可，下一 Task 才会替换）。

    5. **Tabs（约 668-696 行 `<nav className="ws-tabs">`）：**
       移到 `<main className="page-content">` 的最顶部（紧跟在 page-header 之后）；className 暂时保留 `ws-tabs` / `ws-tab` / `active`，对应的 inline `<style>` 也暂时保留——tab 是标准 UI pattern，规范没要求迁移到全局类，只要外层 page-shell 框架对齐即可。**保留 ws-tabs / ws-tab 的原 inline CSS 不变**，其余 ws-* 样式块在 Task 2-3 中删除。

    6. **Body 区（约 698 行 `<section className="ws-body">`）：**
       把 `<section className="ws-body">` 包在 `<main className="page-content">` 内：
       ```tsx
       <main className="page-content">
         <nav className="ws-tabs" data-testid="studio-tab-bar">
           {/* tabs 不变 */}
         </nav>
         {saveError && (
           <div className="banner banner--error" role="alert">
             <AlertCircle size={16} />
             <span>{saveError}</span>
           </div>
         )}
         <section className="ws-body">
           {/* 各 tab 内容 */}
         </section>
       </main>
       ```

    7. **Imports（顶部）：** 新增 `import { ChevronLeft, Save, Users, AlertCircle } from "lucide-react";`

    8. **删除/调整 inline `<style>` 中的：**
       - `.ws { ... }` → 删除（page-shell 接管）
       - `.ws-header`, `.ws-header-top`, `.ws-back-btn`, `.ws-identity`, `.ws-avatar`, `.ws-name-row`, `.ws-status-dot`, `.ws-title-sub` → 删除（page-header--sticky 接管）
       - `.ws-meta-row` → 暂保留（Task 2 处理 tag 时再统一替换）
       - `.ws-tabs`, `.ws-tab` → 保留（这一轮不迁移）
       - 其余 .ws-* 样式（.ws-card, .ws-session-bar, .ws-msg, etc.）→ 暂保留，Task 2/3 处理

    9. **保留行为：** 所有 onClick / state / disabled 逻辑 100% 不变。
  </action>
  <verify>
    1. 文件中 `<main data-testid="silicon-person-studio-view" className="ws">` 已不存在
    2. 文件中包含 `<div className="page-shell"` 和 `className="page-header page-header--sticky"` 和 `<main className="page-content">`
    3. 文件中包含 `import { ChevronLeft, Save, Users, AlertCircle } from "lucide-react"`（lucide imports 可与现有 import 合并）
    4. inline `<style>` 中 `.ws {` `.ws-header {` `.ws-header-top {` `.ws-back-btn {` `.ws-identity {` `.ws-avatar {` `.ws-name-row {` `.ws-status-dot {` `.ws-title-sub {` 这些选择器已被删除
    5. inline `<style>` 中 `.ws-tabs {` `.ws-tab {` `.ws-meta-row {` 仍存在
    6. data-testid="ws-back-btn"、data-testid="profile-tab-save"、data-testid="silicon-person-studio-view"、data-testid="studio-tab-bar"、data-testid="studio-tab-chat/profile/capabilities/tasks" 全部保留
  </verify>
  <done>
    页面顶层框架已替换为 page-shell / page-header--sticky / page-content；header 区域不再有渐变 avatar 和实心保存按钮；状态点改为 .status-dot；保存按钮改为 .btn-primary 描边；返回按钮改为 .btn-toolbar；header 错误条改为 .banner banner--error；tabs 暂保留旧类；行为零改动。
  </done>
</task>

<task type="auto">
  <name>Task 2: SiliconPersonWorkspacePage 步骤 2/3/4/5 — 按钮 + 列表 + 状态徽章 + 卡片表单</name>
  <files>desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx</files>
  <action>
    一次性处理工作台主体的 4 步：按钮、列表、状态徽章、卡片表单。改动较多但都是机械替换，全部在同一文件内。

    **A. 按钮全部改为新规范（步骤 2，零实心填充）：**

    1. `.ws-btn-ghost`（多处，约 730、998、1028、1068、1140 行）→ 改 className 为 `.btn-toolbar`
    2. `.ws-btn-send`（约 827 行）→ 改 className 为 `.btn-primary`，inline button 元素增加 `<Send size={14}/>` 前置 icon
       - import 添加 `Send` 到 lucide-react
       - 删除 `.ws-btn-send` 在 inline style 中的 CSS
    3. `.ws-btn-approve`（约 806 行）→ 改 className 为 `.btn-primary`
    4. `.ws-btn-deny`（约 807 行）→ 改 className 为 `.btn-ghost btn-ghost--danger`
       - 删除 `.ws-btn-approve` 和 `.ws-btn-deny` 在 inline style 中的 CSS（约 1312-1315 行）

    **B. ws-meta-row（约 657 行 + 750 行）→ 用 .tag 替换 glass-pill（步骤 4）：**

    1. ws-header 下方 ws-meta-row（5 个 glass-pill）改 className：
       - `<span className={`glass-pill glass-pill--ws-status-${siliconPerson.status}`}>` → `<span className={`tag tag--${tagStatusVariant(siliconPerson.status)}`}>`
       - `glass-pill--muted` → `tag tag--muted`
       - `glass-pill--accent` → `tag tag--accent`
       - `glass-pill--yellow` → `tag tag--yellow`
       - **新增辅助函数**（放在 statusDotVariant 旁）：
         ```tsx
         function tagStatusVariant(status: string): "green" | "red" | "yellow" | "accent" | "muted" {
           return ({
             idle: "muted",
             running: "accent",
             needs_approval: "yellow",
             done: "green",
             error: "red",
             canceling: "yellow",
             canceled: "muted",
           } as Record<string, "green" | "red" | "yellow" | "accent" | "muted">)[status] ?? "muted";
         }
         ```
       - 删除 inline style 中的 `.glass-pill--ws-status-*` 块（约 1238-1244 行）
    2. 当前会话 ws-section 中的 glass-pill（约 751-755 行）同样改 .tag
    3. 任务列表（约 973 行）`<span className={`glass-pill glass-pill--${task.status === "completed" ? "green" : task.status === "in_progress" ? "accent" : "muted"}`}>` → 改前缀为 `tag tag--`
    4. 工作时段（约 1106 行）`<span className="glass-pill glass-pill--muted">工作时段 ...</span>` → `<span className="tag tag--muted">...</span>`
    5. 调度任务列表（约 1158 行）`<span className="glass-pill glass-pill--muted">{job.scheduleKind}</span>` → `<span className="tag tag--muted">...</span>`
    6. 运行记录（约 1179 行）`<span className="glass-pill glass-pill--muted">{workflowRunStatusLabel(run.status)}</span>` → `<span className="tag tag--muted">...</span>`

    **C. ws-session-pill（约 716 行）→ .tag tag--interactive（步骤 4 + 风险点：保留水平滚动行为）：**

    `.ws-session-pills` 容器保留 `display: flex; gap; flex-wrap` 不变（保留水平展开多行的现有行为；不强制改成横向滚动）。
    每个 button：
    ```tsx
    <button
      key={session.id}
      type="button"
      className={`tag tag--interactive${currentSessionSummary?.id === session.id ? " is-active" : ""}`}
      data-testid={`silicon-person-session-pill-${session.id}`}
      onClick={() => void handleSwitchSession(session.id)}
    >
      <span>{session.title || "未命名会话"}</span>
      {session.needsApproval && <span className="ws-session-badge warn">!</span>}
      {session.unreadCount > 0 && !session.needsApproval && (
        <span className="ws-session-badge">{session.unreadCount > 9 ? "9+" : session.unreadCount}</span>
      )}
    </button>
    ```
    - 删除 inline style 中的 `.ws-session-pill` `.ws-session-pill:hover` `.ws-session-pill.active` 三个 selectors（约 1264-1266 行）
    - 保留 `.ws-session-pills` `.ws-session-bar` `.ws-session-badge` `.ws-session-badge.warn` 等容器/徽章规则
    - 保留 `.ws-empty-hint` 规则

    **D. ws-card 类全部改为 .glass-card（步骤 5）+ 圆角统一：**

    1. 全文 search-replace：`className="ws-card"` → `className="glass-card"`，`className="ws-card ws-chat-card"` → `className="glass-card ws-chat-card"`，`className="ws-card ws-form-card"` → `className="glass-card ws-form-card"`
    2. 删除 inline style 中的 `.ws-card { border ... }` `.ws-card h3 ...` 两条规则（约 1257-1258 行）
       - **新增** 紧凑的内部样式只保留 padding、内部 h3 / desc 字号字重（让 .glass-card 12px 圆角生效）：
         ```css
         .glass-card { padding: 20px; }
         .glass-card h3 { margin: 0 0 4px; color: var(--text-primary); font-size: 0.95rem; font-weight: 700; }
         /* 注意：font-weight 800 → 700 收敛字重 */
         ```
         （把这两条 patch 写在原 ws-card 位置，避免影响其他页面的 .glass-card 默认样式——这两条是 padding/h3 的局部增强；如果担心污染全局 glass-card，可以保留 ws-card 类并仅修改其 border-radius 和 box-shadow——见下面的备选方案）
       - **备选方案（推荐，更安全）**：保留 `.ws-card` 类不要全文替换；只把 inline style 里的 `.ws-card { ... }` 规则改成与全局 .glass-card 对齐：
         ```css
         .ws-card { border: 1px solid var(--glass-border); border-radius: var(--radius-xl); background: var(--bg-card); padding: 20px; box-shadow: var(--shadow-card), var(--glass-inner-glow); }
         .ws-card h3 { margin: 0 0 4px; color: var(--text-primary); font-size: 0.95rem; font-weight: 700; }
         ```
         ——本质是把 font-weight 从 800 → 700（步骤 5 字重收敛），并保留 border-radius var(--radius-xl) = 12px。
       - **采用「备选方案」执行**：保留 `ws-card` 类名，只调整 CSS 值。

    3. 字重 800 → 700/600 收敛（步骤 5，全 inline style 内）：
       - `.ws-card h3 { font-weight: 800 }` → `font-weight: 700`
       - `.ws-name-row h2 { font-weight: 800 }` —— 已在 Task 1 删除
       - `.ws-msg-role { font-weight: 800 }` → `font-weight: 700`
       - `.ws-section h4 { font-weight: 800 }` → `font-weight: 700`
       - `.ws-stat-label { font-weight: 700 }` → 保持 700
       - `.ws-tab { font-weight: 700 }` → 保持 700（tab pattern 标准）
       - `.ws-session-pill` —— 已被替换，无需改
       - `.ws-session-badge { font-weight: 800 }` → `font-weight: 700`
       - `.ws-avatar span { font-weight: 900 }` —— 已删除
       - `.ws-field span { font-weight: 700 }` → 保持 700
       - 总共应该是 4-5 处 800/900 → 700

    4. 输入框圆角 8px → var(--radius-md)（步骤 5）：
       - `.ws-field input, .ws-field textarea, .ws-field select { border-radius: 8px }` → `border-radius: var(--radius-md)`
       - `.ws-path-display { border-radius: 8px }` → `border-radius: var(--radius-md)`
       - `.ws-bind-select { border-radius: 8px }` → `border-radius: var(--radius-md)`

    5. 过渡时长 0.25s/0.3s → 0.15s（步骤 5）：
       - `.ws-field input/textarea/select { transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) }` → `transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease`
       - `.ws-tab { transition: all 0.15s }` → 保持 0.15s
       - `.ws-bind-select { transition: border-color 0.2s, box-shadow 0.2s }` → `transition: border-color 0.15s ease, box-shadow 0.15s ease`
       - `.ws-binding-card { transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) }` → `transition: border-color 0.15s ease`
       - `.ws-wf-card { transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) }` → `transition: border-color 0.15s ease`

    6. 移除 hover-lift / inset focus shadow / 飘浮卡片阴影（步骤 5）：
       - `.ws-field input/textarea/select:focus { box-shadow: 0 0 0 3px rgba(16,163,127,0.15), inset 0 1px 2px rgba(0,0,0,0.2); }` → 删除 `inset 0 1px 2px rgba(0,0,0,0.2)`，保留外发光部分
       - `.ws-binding-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.2); }` → 删除 transform 和飘浮 shadow，保留 border-color
       - `.ws-binding-card { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }` → 删除（行卡级不该有飘浮）
       - `.ws-wf-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.2); }` → 删除 transform / 飘浮 shadow
       - `.ws-wf-card { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }` → 删除

    **E. 5 个多列网格 → 单列 .list-rows + .list-row（步骤 3）：**

    1. **Skills 列表（约 1004-1016 行 `.ws-binding-grid`）：**
       ```tsx
       <div className="list-rows">
         {personSkills.map((skill) => (
           <article key={skill.id} className="list-row list-row--with-description">
             <div className="list-row__lead">
               <Wrench size={16} className="list-row__lead-icon" aria-hidden />
             </div>
             <div className="list-row__main">
               <div className="list-row__title-row">
                 <span className="list-row__title">{skill.name}</span>
                 <span className="tag tag--accent">已安装</span>
               </div>
               <div className="list-row__description">{skill.description || skill.id}</div>
             </div>
           </article>
         ))}
         {personSkills.length === 0 && (
           <section className="empty-state">
             <Wrench size={32} className="empty-state__icon" aria-hidden />
             <h3 className="empty-state__title">还没有 Skills</h3>
             <p className="empty-state__body">员工工作空间中还没有 Skills，可从 Hub 安装。</p>
           </section>
         )}
       </div>
       ```
       - import lucide `Wrench`
       - `.list-row__lead-icon { color: var(--text-muted); }` —— 不需要新建 class，直接 inline 或不指定（lead 默认就居中）

    2. **MCP 服务列表（约 1034-1046 行）：** 同 Skills，把图标改为 `Plug`，title row 加 `<span className="tag tag--{server.state?.connected ? 'green' : 'muted'}">{server.state?.connected ? '已连接' : '未连接'}</span>`

    3. **已绑工作流列表（约 1075-1092 行 `.ws-wf-grid`）：**
       ```tsx
       <div className="list-rows">
         {boundWorkflows.map(({ workflowId, summary }) => (
           <article key={workflowId} className="list-row list-row--with-description" data-testid={`silicon-person-workflow-binding-${workflowId}`}>
             <div className="list-row__lead">
               <Workflow size={16} aria-hidden />
             </div>
             <div className="list-row__main">
               <div className="list-row__title-row">
                 <span className="list-row__title">{summary.name}</span>
               </div>
               <div className="list-row__description list-row__meta--mono">{workflowId}</div>
             </div>
             <div className="list-row__trailing">
               <button
                 type="button"
                 className="btn-toolbar"
                 data-testid={`silicon-person-workflow-start-${workflowId}`}
                 onClick={() => void handleStartWorkflowRun(workflowId)}
               >
                 <Play size={14} />
                 启动运行
               </button>
             </div>
           </article>
         ))}
       </div>
       ```
       - import lucide `Workflow, Play`

    4. **运行记录列表（约 1170-1184 行）：**
       ```tsx
       <div className="list-rows">
         {boundWorkflowRuns.map((run) => (
           <article key={run.id} className="list-row list-row--with-description" data-testid={`silicon-person-workflow-run-${run.id}`}>
             <div className="list-row__lead">
               <Activity size={16} aria-hidden />
             </div>
             <div className="list-row__main">
               <div className="list-row__title-row">
                 <span className="list-row__title">{run.workflowId}</span>
                 <span className="tag tag--muted">{workflowRunStatusLabel(run.status)}</span>
               </div>
               <div className="list-row__description">v{run.workflowVersion} · {run.updatedAt}{run.error ? ` · 失败：${run.error}` : ''}</div>
             </div>
           </article>
         ))}
       </div>
       ```
       - import lucide `Activity`
       - 注：原本 `<p className="ws-error">{run.error}</p>` 内嵌在卡里（重复显示错误）；这一轮把 error 文本合并进 description 里末尾，避免列表行内出现 banner——保持密集列表的视觉简洁

    5. **定时任务列表（约 1150-1161 行）：**
       ```tsx
       <div className="list-rows">
         {siliconPersonScheduleJobs.map((job) => (
           <article key={job.id} className="list-row list-row--with-description">
             <div className="list-row__lead">
               <Clock size={16} aria-hidden />
             </div>
             <div className="list-row__main">
               <div className="list-row__title-row">
                 <span className="list-row__title">{job.title}</span>
                 <span className="tag tag--muted">{job.scheduleKind}</span>
               </div>
               <div className="list-row__description">{job.nextRunAt ? `下次运行 ${job.nextRunAt}` : "等待下一次计算"}</div>
             </div>
           </article>
         ))}
       </div>
       ```
       - import lucide `Clock`

    6. **删除以下不再使用的 inline CSS**（约 1360-1380 行）：
       - `.ws-wf-grid`
       - `.ws-wf-card`, `.ws-wf-card:hover`, `.ws-wf-card-info`, `.ws-wf-card-info strong`, `.ws-wf-card-info span`
       - `.ws-binding-grid`
       - `.ws-binding-card`, `.ws-binding-card:hover`, `.ws-binding-card.bound`, `.ws-binding-card.bound:hover`, `.ws-binding-card input[type="checkbox"]`, `.ws-binding-card-info`, `.ws-binding-card-info strong`, `.ws-binding-card-info span`, `.ws-binding-card::before`, `.ws-binding-card.bound::before`

    7. **定时工作流表单容器（约 1109 行 `.ws-binding-grid` 重用）：**
       原代码 `<div className="ws-binding-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 16 }}>` 是表单容器（不是卡片网格）；保留为表单，改成新的局部 grid：
       ```tsx
       <div className="ws-schedule-form">
         {/* 4 个 ws-field */}
       </div>
       ```
       - 新增 inline css：
         ```css
         .ws-schedule-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 16px; }
         ```

    **F. 任务列表（约 965-980 行）：保留 `.ws-item-list` + `.ws-item` 模式（这些是详情卡内的内嵌列表，规范允许，无需迁 list-row）；只把 `.glass-pill` 替换为 `.tag` 即可（已在 B-3 处理过）。**

    **G. ws-msg / ws-session-bar / ws-section / ws-composer / ws-approval / ws-readonly-grid / ws-stat-cell 等聊天与表单子组件**：保留原 inline 样式，只做字重 800→700 收敛和过渡 0.25s→0.15s 收敛（已在 D-3/D-5 中描述）。

    **保留原行为：** 所有 onClick / state / disabled / data-testid 100% 不变。
  </action>
  <verify>
    1. grep `glass-pill` desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx 应返回 0 条匹配
    2. grep `ws-btn-ghost\|ws-btn-send\|ws-btn-approve\|ws-btn-deny` 应返回 0 条匹配
    3. grep `btn-premium accent` 应返回 0 条匹配
    4. grep `class="ws-binding-grid"\|className="ws-binding-grid"` 应返回 0 条匹配（保留的定时表单已重命名为 .ws-schedule-form）
    5. grep `class="ws-wf-grid"\|className="ws-wf-grid"` 应返回 0 条匹配
    6. grep `tag tag--` 应返回 ≥ 12 条匹配（5 个 meta-row tag + 任务/运行/调度/工作流卡片中的 tag）
    7. grep `list-row list-row--` 应返回 ≥ 5 条匹配（5 个迁移的列表）
    8. grep `font-weight: 800` 应返回 0 条
    9. grep `border-radius: 8px` 应返回 0 条
    10. grep `transform: translateY` 应返回 0 条（保存按钮的 hover-lift 等已删）
    11. import 语句包含 Wrench, Plug, Workflow, Play, Activity, Clock, Send, ChevronLeft, Save, Users, AlertCircle 全部 lucide 图标
    12. 所有 data-testid 完整保留：profile-tab-save, profile-tab-form, profile-tab-name, profile-tab-title, profile-persona-form, profile-tab-soul, profile-model-form, profile-tab-model, profile-tab-approval-mode, ws-back-btn, studio-tab-bar, studio-tab-chat/profile/capabilities/tasks, silicon-person-message-list, silicon-person-composer-input, silicon-person-composer-send, silicon-person-create-session, silicon-person-session-pill-*, employee-studio-workflow-select, employee-studio-bind-workflow, silicon-person-workflow-binding-*, silicon-person-workflow-start-*, silicon-person-workflow-run-*, silicon-person-workspace-model-status
  </verify>
  <done>
    工作台主体的 4 步迁移全部完成：所有 glass-pill 行内徽章替换为 tag、5 个多列网格替换为 .list-rows、所有按钮替换为 .btn-primary / .btn-toolbar / .btn-ghost、字重 800/900 收敛到 700、输入框/路径显示圆角统一为 var(--radius-md)、过渡统一 0.15s、移除 hover-lift / inset focus shadow / 飘浮卡片阴影；ws-card 类保留但 CSS 值已对齐 .glass-card 规范；行为零改动，所有 data-testid 保留。
  </done>
</task>

<task type="auto">
  <name>Task 3: SiliconPersonWorkspacePage 步骤 6/7 — banner / empty-state / 保存确认 modal a11y</name>
  <files>desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx</files>
  <action>
    **A. 步骤 6：错误 banner（4 处）+ empty-state（多处）：**

    1. **`<p className="ws-error">{saveError}</p>`（约 655 行，header 区）**：在 Task 1 中已替换为 `<div className="banner banner--error">` 并放到 page-content 顶部。如未替换，本 Task 完成。
    2. **`<p className="ws-error">{sessionError}</p>`（约 739 行，chat 卡内）**：
       ```tsx
       {sessionError && (
         <div className="banner banner--error" role="alert">
           <AlertCircle size={16} />
           <span>{sessionError}</span>
         </div>
       )}
       ```
    3. **`<p className="ws-error">{approvalError}</p>`（约 815 行）**：同上。
    4. **运行记录里 `<p className="ws-error">{run.error}...`（约 1180 行）**：在 Task 2 中已合并到 description 末尾，本 Task 无需处理。
    5. **删除 inline style 中的 `.ws-error { ... }` 规则**（约 1382 行）。

    6. **空态（多处 `.ws-empty-state`）→ 全部替换为 `.empty-state`：**

       规范要求：dashed border + lucide icon + 标准结构。

       - 当前会话空（约 741-743 行）：
         ```tsx
         <section className="empty-state empty-state--minimal">
           <MessageSquare size={32} className="empty-state__icon" aria-hidden />
           <h3 className="empty-state__title">还没有可用会话</h3>
           <p className="empty-state__body">先新建一个会话开始协作。</p>
         </section>
         ```
       - 历史消息空（约 789-791 行）：
         ```tsx
         <section className="empty-state empty-state--minimal">
           <MessageSquare size={32} className="empty-state__icon" aria-hidden />
           <h3 className="empty-state__title">还没有历史消息</h3>
           <p className="empty-state__body">直接发一条消息开始协作。</p>
         </section>
         ```
       - 任务列表空（约 977-979 行）：
         ```tsx
         <section className="empty-state empty-state--minimal">
           <ListTodo size={32} className="empty-state__icon" aria-hidden />
           <h3 className="empty-state__title">还没有任务</h3>
           <p className="empty-state__body">任务会随执行自动产生。</p>
         </section>
         ```
       - Skills 空（在 Task 2 已用规范 .empty-state 替换）
       - MCP 空（在 Task 2 已用规范 .empty-state 替换）
       - 工作流空（约 1093-1097 行）：
         ```tsx
         <section className="empty-state empty-state--minimal">
           <Workflow size={32} className="empty-state__icon" aria-hidden />
           <h3 className="empty-state__title">还没有绑定工作流</h3>
           <p className="empty-state__body">从下拉中选择并点击绑定。</p>
         </section>
         ```
       - 定时任务空（在 Task 2 中合并到 list 后兜底；约 1163-1165 行）：
         ```tsx
         <section className="empty-state empty-state--minimal">
           <Clock size={32} className="empty-state__icon" aria-hidden />
           <h3 className="empty-state__title">还没有定时任务</h3>
           <p className="empty-state__body">为该硅基员工创建周期性 workflow 运行。</p>
         </section>
         ```
       - 删除 inline style 中的 `.ws-empty-state { ... }` 和 `.ws-empty-state p { ... }` 规则（约 1383-1384 行）
       - import lucide `MessageSquare, ListTodo` 加到 import 语句

    **B. 步骤 7：保存确认 modal（圆角 + shadow + ESC + Enter + focus trap）：**

    保存确认 modal（约 1192-1217 行）有原渐变 sp-confirm-ok 按钮（实心填充）和原 sp-confirm-* 样式块。改造：

    1. **DOM 改成规范化、可访问的对话框：**
       ```tsx
       {showSaveConfirm && (
         <div
           className="sp-confirm-overlay"
           role="presentation"
           onClick={() => setShowSaveConfirm(false)}
         >
           <div
             className="sp-confirm-dialog"
             role="dialog"
             aria-modal="true"
             aria-labelledby="sp-confirm-title"
             aria-describedby="sp-confirm-hint"
             onClick={(e) => e.stopPropagation()}
             ref={saveDialogRef}
           >
             <div className="sp-confirm-icon">
               <Save size={24} aria-hidden />
             </div>
             <h3 id="sp-confirm-title" className="sp-confirm-message">确定保存对「{draftName || siliconPerson?.name}」的配置修改吗？</h3>
             <p id="sp-confirm-hint" className="sp-confirm-hint">修改将立即生效，新会话将使用更新后的配置。</p>
             <div className="sp-confirm-actions">
               <button
                 type="button"
                 className="btn-toolbar"
                 ref={cancelBtnRef}
                 onClick={() => setShowSaveConfirm(false)}
               >
                 取消
               </button>
               <button
                 type="button"
                 className="btn-primary"
                 ref={confirmBtnRef}
                 onClick={() => void handleSave()}
               >
                 <Save size={14} />
                 确认保存
               </button>
             </div>
           </div>
         </div>
       )}
       ```

    2. **ref + a11y useEffect（放在文件中其他 useEffect 旁边）：**
       ```tsx
       const saveDialogRef = React.useRef<HTMLDivElement | null>(null);
       const confirmBtnRef = React.useRef<HTMLButtonElement | null>(null);
       const cancelBtnRef = React.useRef<HTMLButtonElement | null>(null);

       // modal 打开时：聚焦确认按钮、监听 ESC 关闭、Enter 提交、Tab 焦点陷阱
       useEffect(() => {
         if (!showSaveConfirm) return;
         const previouslyFocused = document.activeElement as HTMLElement | null;
         confirmBtnRef.current?.focus();

         function handleKey(event: KeyboardEvent) {
           if (event.key === "Escape") {
             event.preventDefault();
             setShowSaveConfirm(false);
             return;
           }
           if (event.key === "Enter" && !isSaving) {
             const target = event.target as HTMLElement | null;
             // 不在 cancel 按钮上时按 Enter 等价于确认
             if (target !== cancelBtnRef.current) {
               event.preventDefault();
               void handleSave();
             }
             return;
           }
           if (event.key === "Tab") {
             const focusable = [cancelBtnRef.current, confirmBtnRef.current].filter(Boolean) as HTMLButtonElement[];
             if (focusable.length === 0) return;
             const first = focusable[0];
             const last = focusable[focusable.length - 1];
             const active = document.activeElement;
             if (event.shiftKey && active === first) {
               event.preventDefault();
               last.focus();
             } else if (!event.shiftKey && active === last) {
               event.preventDefault();
               first.focus();
             }
           }
         }

         document.addEventListener("keydown", handleKey);
         return () => {
           document.removeEventListener("keydown", handleKey);
           previouslyFocused?.focus?.();
         };
       }, [showSaveConfirm, isSaving]); // handleSave 闭包来自 component scope，用 isSaving 触发更新避免错误
       ```
       注：handleSave 在 component scope 中定义，依赖 draftName 等 state；为避免 useEffect 依赖项膨胀，handleSave 仅作为闭包捕获即可（与现有页面其他 useEffect 风格一致——本 quick 任务严格不引入新 hook 抽象）。

    3. **CSS 改造（约 1395-1480 行 sp-confirm-* 样式块）：**
       - `.sp-confirm-dialog { ... border-radius: var(--radius-xl, 14px); ... box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04) inset; ... }` →
         ```css
         .sp-confirm-dialog {
           background: var(--bg-card, #1e1e2e);
           border: 1px solid var(--glass-border);
           border-radius: var(--radius-2xl); /* 16px per spec */
           padding: 32px 32px 26px;
           min-width: 360px; max-width: 420px;
           box-shadow: var(--shadow-modal); /* 0 20px 40px rgba(0,0,0,0.45) per spec */
           animation: sp-dialog-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
           display: flex; flex-direction: column; align-items: center;
           text-align: center;
         }
         ```
       - `.sp-confirm-icon { ... border-radius: 14px; ... }` → `border-radius: var(--radius-xl);`
       - **删除 `.sp-confirm-cancel` 和 `.sp-confirm-ok` 全部样式**（约 1450-1479 行），因为 DOM 已改为 .btn-toolbar / .btn-primary
       - `.sp-confirm-icon` 的图标尺寸：原来是 28×28 svg，新版用 lucide `<Save size={24}/>`；icon 容器保持 52×52，居中即可
       - 保留 `.sp-confirm-overlay` 不变（fixed 全屏覆盖）
       - 保留 `@keyframes sp-overlay-in` 和 `@keyframes sp-dialog-in`
       - 保留 `.sp-confirm-message`（标题）和 `.sp-confirm-hint`（描述）样式

    **C. 重要：避免 React import 重复**：
    - 文件顶部已有 `import React, { ... } from "react";`，直接复用 React.useRef
    - 或者将 useRef 加到 hooks 解构里：`import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";` —— 推荐这样做

    **保留原行为：** showSaveConfirm 状态机不变；点击 overlay 关闭、点击对话框内不关闭、handleSave 调用链不变。
  </action>
  <verify>
    1. grep `ws-error` desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx 应返回 0 条
    2. grep `ws-empty-state` 应返回 0 条
    3. grep `banner banner--error` 应返回至少 2 条（saveError 和 sessionError；approvalError 也算）
    4. grep `empty-state empty-state--minimal\|empty-state__icon` 应返回 ≥ 6 处
    5. grep `sp-confirm-cancel\|sp-confirm-ok` 应返回 0 条（已被 .btn-toolbar / .btn-primary 替代）
    6. grep `aria-modal="true"` 应有匹配
    7. grep `Escape\|key === "Tab"\|key === "Enter"` 在 useEffect 中应该都有匹配
    8. grep `useRef` import 已加到 react import 中
    9. grep `var(--shadow-modal)` 在 sp-confirm-dialog 中已被使用
    10. grep `var(--radius-2xl)` 在 sp-confirm-dialog 中已被使用
  </verify>
  <done>
    所有 4 处 ws-error 替换为 .banner banner--error；所有 6 处 ws-empty-state 替换为 .empty-state empty-state--minimal + lucide icon；保存确认 modal 改用 .btn-toolbar / .btn-primary（无渐变填充），圆角 var(--radius-2xl)，阴影 var(--shadow-modal)，并通过 useEffect 实现 ESC 关闭 / Enter 提交 / Tab 焦点陷阱 / 入场聚焦确认按钮 / 退出还原焦点。
  </done>
</task>

<task type="auto">
  <name>Task 4: ReasoningPresetPanel 圆角 token 化 + 徽章用 .tag + 移除 hover-lift</name>
  <files>desktop/src/renderer/components/ReasoningPresetPanel.tsx</files>
  <action>
    本组件是共享组件（被 SiliconPersonCreatePage 和 SiliconPersonWorkspacePage 同时引用）；所有改动只涉及 inline `<style>` 内的 token 化和 `__badge` 替换为 .tag，不改变组件 API、props、行为。

    **A. 把 reasoning-panel__badge 从自定义实现替换为 .tag 标准组件：**

    1. 修改 JSX（第 52-54 行）：
       ```tsx
       <span className={`tag tag--${badgeTagVariant(spec.kind)}`}>
         {REASONING_KIND_BADGE[spec.kind]}
       </span>
       ```

    2. 新增辅助函数（放在组件外、REASONING_KIND_BADGE 旁）：
       ```tsx
       function badgeTagVariant(kind: ReasoningControlSpec["kind"]): "accent" | "green" | "muted" {
         switch (kind) {
           case "effort":
           case "budget":
             return "accent";
           case "always_on":
             return "green";
           case "boolean":
           case "unsupported":
           default:
             return "muted";
         }
       }
       ```

    3. 删除 inline `<style>` 中的 `.reasoning-panel__badge`（5 个 selectors，约 155-187 行）：
       - `.reasoning-panel__badge { ... }`
       - `.reasoning-panel__badge--effort, .reasoning-panel__badge--budget { ... }`
       - `.reasoning-panel__badge--always_on { ... }`
       - `.reasoning-panel__badge--unsupported { ... }`

    4. 注：原来 boolean kind 也用 .reasoning-panel__badge 默认色（灰）；映射到 .tag tag--muted 等价。

    **B. 圆角 token 化：**

    - `.reasoning-panel { border-radius: 16px; }` → `border-radius: var(--radius-xl);` (12px) ——卡片场景按规范用 12px，不要 16px
    - `.reasoning-panel__toggle-btn { border-radius: 12px; }` → `border-radius: var(--radius-md);` (6px)（按钮场景）
    - `.reasoning-panel__note { border-radius: 12px; }` → `border-radius: var(--radius-md);`
    - `.reasoning-panel__option { border-radius: 14px; }` → `border-radius: var(--radius-lg);` (10px)（行卡场景）

    **C. 移除 hover-lift：**

    - `.reasoning-panel__toggle-btn:hover, .reasoning-panel__option:hover:not(:disabled) { ... transform: translateY(-1px); }` → 删除 transform
    - `.reasoning-panel__toggle-btn.active, .reasoning-panel__option.active { ... box-shadow: 0 8px 18px rgba(16, 163, 127, 0.12); }` → 删除 box-shadow（保留 border-color 和 background）
    - `.reasoning-panel__option.is-disabled { ... transform: none; }` → 不再需要这一行（原是为了对抗 hover-lift），但保留也无害。

    **D. 字重收敛 800 → 700：**

    - `.reasoning-panel__option-label { font-weight: 800; }` → `font-weight: 700`
    - 其他 700 字重保持不变

    **E. 过渡 0.18s → 0.15s：**

    - `.reasoning-panel__toggle-btn, .reasoning-panel__option { transition: all 0.18s ease; }` → `transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease`

    **F. 保留以下不动：**
    - 组件 props 接口（ReasoningPresetPanelProps）
    - 4 档 preset 数组
    - 根 className `.reasoning-panel`
    - `.reasoning-panel__header`, `.reasoning-panel__header-copy`, `.reasoning-panel__eyebrow`, `.reasoning-panel__description`
    - `.reasoning-panel__toggle` grid 容器
    - `.reasoning-panel__grid` grid 容器
    - 响应式 @media 查询

    **G. 不要：**
    - 不要把 inline `<style>` 抽出到 global.css（用户已锁定决定：保留 inline style）
    - 不要改组件 props、行为、test ids
    - 不要重命名 className（除了删除的 __badge）
  </action>
  <verify>
    1. grep `reasoning-panel__badge` desktop/src/renderer/components/ReasoningPresetPanel.tsx 应返回 0 条匹配（JSX 和 CSS 都已移除）
    2. grep `tag tag--` 应返回至少 1 条（badge 用法）
    3. grep `border-radius: 16px\|border-radius: 14px\|border-radius: 12px` 应返回 0 条（全部 token 化）
    4. grep `var(--radius-` 应返回 ≥ 4 条
    5. grep `transform: translateY(-1px)` 应返回 0 条
    6. grep `font-weight: 800` 应返回 0 条
    7. 组件 props 接口未变更：grep `type ReasoningPresetPanelProps = {` 应仍存在，包含 spec/enabled/effort/onEnabledChange/onEffortChange/effortTestId 6 个字段
  </verify>
  <done>
    ReasoningPresetPanel 的徽章已用 .tag 实现；所有圆角硬编码替换为 token；toggle/option 的 hover-lift 和飘浮 shadow 已移除；font-weight 800 收敛为 700；过渡统一 0.15s；组件 props/行为零改动；inline style 块保留。
  </done>
</task>

<task type="auto">
  <name>Task 5: WorkFilesPanel emoji → lucide + 圆角 token 化</name>
  <files>desktop/src/renderer/components/WorkFilesPanel.tsx</files>
  <action>
    把 7 个 emoji 图标替换为 lucide-react 图标。WorkFilesPanel 也是共享组件（被 SiliconPersonWorkspacePage、ChatPage、WorkflowStudioPage 引用），所以只改样式不改 API。

    **A. 把 kindIcon 函数（约 45-57 行）从返回 string 改为返回 React 节点：**

    1. 顶部 import 加：
       ```tsx
       import { FileText, Image as ImageIcon, Code, Database, Archive, ScrollText, Paperclip } from "lucide-react";
       ```
       （`Image` 与 React 内置 type 重名，alias 为 ImageIcon。）

    2. 把 `function kindIcon(kind): string` 替换为返回 lucide 图标组件的 React 节点：
       ```tsx
       /** 类型图标映射，使用 lucide 图标避免 emoji。 */
       function KindIcon({ kind, size = 18 }: { kind: ArtifactRecord["kind"]; size?: number }) {
         const className = `wf-item__icon-svg wf-item__icon-svg--${kind}`;
         switch (kind) {
           case "doc":
             return <FileText size={size} className={className} aria-hidden />;
           case "image":
             return <ImageIcon size={size} className={className} aria-hidden />;
           case "code":
             return <Code size={size} className={className} aria-hidden />;
           case "dataset":
             return <Database size={size} className={className} aria-hidden />;
           case "archive":
             return <Archive size={size} className={className} aria-hidden />;
           case "log":
             return <ScrollText size={size} className={className} aria-hidden />;
           case "other":
           default:
             return <Paperclip size={size} className={className} aria-hidden />;
         }
       }
       ```
       并删除原 kindIcon 函数。

    3. ArtifactItem 中（约 99 行）：
       - 旧：`<div className="wf-item__icon">{kindIcon(artifact.kind)}</div>`
       - 新：`<div className="wf-item__icon"><KindIcon kind={artifact.kind} size={18} /></div>`

    **B. CSS 调整（约 211-220 行 inline style）：**

    1. `.wf-item__icon { font-size: 20px; line-height: 1; flex-shrink: 0; margin-top: 2px; }` →
       ```css
       .wf-item__icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex-shrink: 0; color: var(--text-secondary); border-radius: var(--radius-sm); background: rgba(255,255,255,0.04); }
       .wf-item__icon-svg { display: block; }
       .wf-item__icon-svg--doc { color: #a3a3a3; }
       .wf-item__icon-svg--image { color: #10a37f; }
       .wf-item__icon-svg--code { color: #8b5cf6; }
       .wf-item__icon-svg--dataset { color: #3b82f6; }
       .wf-item__icon-svg--archive { color: #f59e0b; }
       .wf-item__icon-svg--log { color: #737373; }
       .wf-item__icon-svg--other { color: #737373; }
       ```
       （PDF 没有独立 kind，统一在 doc kind 下；规范要求 PDF = FileText 红色——但当前 ArtifactRecord["kind"] 没有区分 doc 和 pdf，全部归在 doc 下。所以 doc 用中性灰，不专门染红 PDF，这是当前数据契约的限制。注释里说明一下。）

    2. `.wf-item { ... border-radius: 14px; ... }` → `border-radius: var(--radius-lg);` (10px)
    3. `.wf-empty { ... border-radius: 16px; ... }` → 改用规范 .empty-state（见下面 C）
    4. `.wf-btn { ... border-radius: var(--radius-md, 7px); ... }` → 直接用 `var(--radius-md)` 不要兜底 7px（且 6px 才是规范值）
    5. `.wf-btn { font-weight: 700; }` → 保持 700（规范允许）；但实际 .wf-btn 是次级文字按钮，可以直接用 .btn-toolbar——见下面 D
    6. `.wf-panel--sidebar { ... padding: 20px; }` 和 `.wf-empty { padding: 18px; border-radius: 16px; ... }` 保留 padding 不变

    **C. 空态用 .empty-state empty-state--minimal：**

    1. 旧：`<div className="wf-empty">{emptyHint}</div>`
    2. 新：
       ```tsx
       <section className="empty-state empty-state--minimal">
         <Paperclip size={32} className="empty-state__icon" aria-hidden />
         <p className="empty-state__body">{emptyHint}</p>
       </section>
       ```
    3. 删除 inline style 中的 `.wf-empty { ... }` 规则。

    **D. 按钮升级为 .btn-toolbar（行内规范按钮）：**

    1. 两个 `<button className="wf-btn">`（约 111、114 行）→ `<button className="btn-toolbar wf-btn-compact">`
    2. wf-btn-compact（行内紧凑变体）：
       ```css
       .wf-btn-compact { height: 26px; padding: 0 10px; font-size: 11px; }
       ```
       并删除原 .wf-btn 和 .wf-btn:hover 规则。
       —— 此处用「叠加 .btn-toolbar 标准类 + 自定义 size 调整类」更接近规范，比维持自定义按钮更一致。

    **E. 保留以下不动：**
    - 组件 props 接口（WorkFilesPanelProps）
    - shouldReloadArtifactsForSessionEvent / readSessionStreamScopeId 工具函数
    - useEffect 数据加载/订阅逻辑（行为不变）
    - root `<aside className="wf-panel wf-panel--{mode}">` className 结构
    - data-testid="work-files-panel"
    - inline `<style>` 块的位置（保留 inline，不抽到 global.css）

    **F. 不要：**
    - 不要改 ArtifactRecord 类型契约
    - 不要新增/删除 kind
    - 不要把 wf-panel 抽换成 .glass-card（这是 sidebar 模式的容器，规范允许保留 wf-panel--sidebar 自定义边框）
  </action>
  <verify>
    1. grep `📄\|📊\|📝\|📋\|📦\|📃\|📎` desktop/src/renderer/components/WorkFilesPanel.tsx 应返回 0 条（无 emoji）
    2. grep `from "lucide-react"` 应有匹配，包含 FileText, Image as ImageIcon, Code, Database, Archive, ScrollText, Paperclip
    3. grep `wf-empty` 应返回 0 条（除 emptyHint default value 外，已替换为 .empty-state）
    4. grep `wf-btn` 应仍有匹配（wf-btn-compact），但应同时包含 btn-toolbar
    5. grep `border-radius: 14px\|border-radius: 16px` 应返回 0 条
    6. grep `var(--radius-` 应有 ≥ 3 条匹配
    7. 组件 props 接口未变更：grep `type WorkFilesPanelProps = {` 应仍存在，包含 scope/title/description/mode/emptyHint 5 个字段
    8. grep `data-testid="work-files-panel"` 仍保留
  </verify>
  <done>
    WorkFilesPanel 的 7 个 emoji 全部替换为 lucide 图标（FileText / ImageIcon / Code / Database / Archive / ScrollText / Paperclip），按 kind 染色；空态用 .empty-state empty-state--minimal；按钮叠加 .btn-toolbar；圆角全部 token 化；组件 props/行为零改动；inline style 块保留。
  </done>
</task>

<task type="auto">
  <name>Task 6: 最终验证 — typecheck + 启动冒烟 + 共享组件 CreatePage / ChatPage 视觉抽查</name>
  <files>(no edits, verification only)</files>
  <action>
    **A. TypeScript 编译检查（renderer 范围）：**

    在 desktop/ 工作目录执行：
    ```bash
    cd F:/MyClaw/desktop && pnpm exec tsc -p tsconfig.renderer.json --noEmit
    ```

    预期：0 个新增报错。如果有新增报错（与本次 lucide import 或 useRef 相关），立即定位并修复。
    任何与本任务无关的存量报错（如 stores 里旧的 ts 警告）可忽略，但需要在 PR 备注里说明。

    **B. 启动冒烟（手动，仅 dev 模式）：**

    ```bash
    cd F:/MyClaw/desktop && pnpm dev
    ```

    打开应用后，访问以下页面，确认：

    1. `/employees`（SiliconPersonEntryPage） — 与本次改动无关，确认未被回归（应该没有任何变化）
    2. `/employees/{id}/studio`（SiliconPersonWorkspacePage）：
       - 顶部 page-header--sticky 显示员工名 + 状态点 + 副标题
       - 右上保存按钮是描边 cyan（不是渐变实心）
       - 没有渐变 avatar；状态点是 8px 带 glow
       - tab 切换 chat / profile / capabilities / tasks 都正常
       - capabilities tab 下：技能 / MCP / 已绑工作流 / 运行记录 / 定时任务 5 个列表都是单列 .list-row（不是 3-4 列网格）
       - 状态徽章是矩形 .tag（不是 999px 圆 pill）
       - 点击保存 → 弹出确认 modal → ESC 关闭 / Enter 提交 / Tab 在两个按钮之间循环 / 入场默认聚焦在确认按钮
    3. `/employees/new`（SiliconPersonCreatePage） — 共享 ReasoningPresetPanel：
       - reasoning panel 视觉与 workspace 一致：badge 是矩形 tag、按钮无飘浮 lift、option 圆角 10px
       - **重点检查**：badge 颜色是否合理（effort/budget = cyan、always_on = green、其他 = muted）
       - **重点检查**：option 卡片在 active 状态下不再有 0 8px 18px 飘浮阴影（原来有）
    4. `/`（ChatPage） — 共享 WorkFilesPanel：
       - 文件面板里的图标已是 lucide（不是 emoji）
       - 空态用 dashed border + 32px Paperclip 图标
       - 「打开」「定位」按钮是 .btn-toolbar 风格（紧凑、半透明背景）

    **C. ui-style-guide.md Checklist 自查（针对本次 3 个文件）：**
    - [ ] 使用 .page-shell + .page-header--sticky 布局 (Workspace ✓)
    - [ ] page-title 22-24px ✓
    - [ ] eyebrow 含 lucide leading icon ✓ (Users 14px)
    - [ ] 列表用 .list-rows + .list-row（非 .glass-grid）✓
    - [ ] Lead 槽用 .status-dot / .list-row__avatar / lucide icon ✓
    - [ ] 标签用 .tag（4px 圆角矩形）✓
    - [ ] 行级二级操作用 .icon-btn / .btn-toolbar ✓
    - [ ] 主操作用 .btn-primary（描边 cyan）✓
    - [ ] Empty / Error / Form 走规范模式 ✓
    - [ ] Esc 关弹层、Enter 提交主操作 ✓ (modal a11y)
    - [ ] focus-visible 有清晰描边 ✓ (.tag--interactive 有)

    **D. 不通过的处理方式：**
    - 如果发现 typecheck 报错：定位 → 修复 → 重跑
    - 如果发现视觉回归（CreatePage 或 ChatPage 视觉异常）：定位是哪个 task 的改动引入的 → 回到该 task 修复
    - 如果发现行为回归（按钮点击无反应、modal 无法关闭）：定位 handler / state / event listener 是否被误删 → 修复
  </action>
  <verify>
    1. tsc 报错数量未增加（用 task 0 之前的 baseline 对比）
    2. 应用能正常启动并切换到 SiliconPersonWorkspacePage，所有 tab 都能切换且内容正常显示
    3. 手动测试保存 modal 的 ESC / Enter / Tab 三个键盘交互都生效
    4. CreatePage 和 ChatPage 共享组件视觉无回归
  </verify>
  <done>
    typecheck 通过、启动正常、3 个目标文件视觉与 SiliconPersonEntryPage 一致、共享组件 CreatePage / ChatPage 视觉无回归、modal a11y 三键齐全；可以提交 single commit。
  </done>
</task>

</tasks>

<verification>
**完成所有 task 后做最终全量检查：**

1. 全文 grep 检查：
   - `glass-pill glass-pill--ws-status` → 0 条
   - `ws-error\|ws-empty-state\|ws-btn-ghost\|ws-btn-send\|ws-btn-approve\|ws-btn-deny` → 0 条
   - `ws-binding-grid\|ws-wf-grid` → 0 条（保留的定时表单已重命名为 ws-schedule-form）
   - `font-weight: 800` → 0 条（在 3 个文件内）
   - `border-radius: 8px\|border-radius: 14px\|border-radius: 16px` → 0 条（全部 token 化）
   - `📄\|📊\|📝\|📋\|📦\|📃\|📎` → 0 条
   - `btn-premium accent` → 0 条
   - `sp-confirm-cancel\|sp-confirm-ok` → 0 条

2. tsc 检查：`pnpm exec tsc -p tsconfig.renderer.json --noEmit` 报错数量未增加。

3. 启动冒烟：所有页面正常加载，行为零改动。

4. ui-style-guide.md Checklist 11 项全部勾选。

5. 共享组件视觉抽查：CreatePage（ReasoningPresetPanel）和 ChatPage（WorkFilesPanel）无回归。
</verification>

<success_criteria>
- 4 个文件改动（global.css 加 .tag--interactive，3 个 React 文件做样式迁移）
- 单 commit：`refactor(silicon-person): migrate workspace + reasoning + work-files panels to ui-style-guide`
- ~150 个 className 替换、~200 行 inline CSS 删除
- 0 个新增 tsc 报错
- 0 个行为改动（所有 handler、state、IPC、test ids 完整保留）
- 视觉与 SiliconPersonEntryPage 一致：22px 标题、矩形 tag、单列 list-row、描边按钮、10-12px 圆角
- 保存确认 modal 完整支持 ESC / Enter / Tab 焦点陷阱
- 共享组件 CreatePage 和 ChatPage 视觉无回归
</success_criteria>

<output>
完成后无需创建 SUMMARY.md（quick 任务只生成 commit message）。
单 commit message 模板：
```
refactor(silicon-person): migrate workspace + reasoning + work-files to ui-style-guide

迁移硅基员工工作台三件套到 desktop/docs/ui-style-guide.md：

- SiliconPersonWorkspacePage：page-shell 框架、单列 list-row、矩形 .tag、
  描边 .btn-primary / .btn-toolbar、保存确认 modal a11y（ESC/Enter/Tab）
- ReasoningPresetPanel：__badge → .tag、圆角 token 化、移除 hover-lift
- WorkFilesPanel：emoji → lucide 图标（FileText/Image/Code/Database/...）

新增 .tag--interactive 变体（用于 ws-session-pill 这类可交互 tag）。
共享组件 ChatPage / SiliconPersonCreatePage 视觉无回归。
行为零改动（无 handler / state / IPC 修改）。
```
</output>

# Desktop UI Style Guide

> 桌面端原生设计规范。本规范的灵感来自 Linear、Things 3、Reflect、Raycast、Arc、Tower、GitHub Desktop 等专业桌面应用——专注、紧凑、信息密度高、键盘优先。
>
> 以 McpPage 的现行设计为基线：**桌面级密集列表是默认形态**，卡片网格仅用于 **浏览 / 画廊** 场景。规范末尾的"旧类 → 新类"表格记录了仍在代码里、需要逐步迁出的早期类。

---

## 设计哲学

桌面专业应用 ≠ 移动端缩放版的网页。它服务于**重复使用同一应用、追求效率、专注当前任务**的用户。

**五条原则：**

1. **信息密度优先。** 1440×900 视口里，列表页默认应能展示 ≥ 8 个可操作条目，无需滚动。卡片网格是浏览场景的特例，不是默认。
2. **状态点 > 状态徽章。** 8px 圆点 + glow 比 999px pill 在密集列表里识别更快、视觉更安静。
3. **悬停揭示。** 行级二级操作（refresh、toggle、删除）默认低对比，hover 才显形——避免视觉噪声，保证主信息阅读不被打扰。
4. **键盘优先。** 每个页面都应可键盘完成主流程：Esc 关弹层、Enter 提交主操作、↑↓ 浏览、⌘K 命令面板（规划中）。
5. **不堆装饰。** 不用 emoji 当图标、不用渐变背景、不要圆角到 14px+ 的"大泡泡"卡（除模态外）、不要弹簧动画、不要 transform: scale 1.05+。

**参考应用（看到争议时回到这些）：**
- **Linear** — issue 列表的状态图标 + 密集行 + 命令面板
- **Things 3** — todo 列表的字体层级、留白节奏
- **Reflect** — note 列表的微妙分隔线
- **Raycast** — 通用 list pattern：leading icon → name → accessory → trailing
- **Tower** — git client 的 sidebar 列表 + 行内状态
- **Arc** — sidebar tab 的 favicon + 微 hover

---

## Design Tokens

### 颜色（`global.css :root`）

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#0c0c0c` | 页面背景 |
| `--bg-sidebar` | `#121212` | 侧边栏背景 |
| `--bg-surface` | `rgba(255, 255, 255, 0.02)` | **行卡 / 列表项默认背景** |
| `--bg-surface-hover` | `rgba(255, 255, 255, 0.04)` | 行卡 hover 背景 |
| `--bg-card` | `rgba(22, 22, 26, 0.72)` | 卡片背景（详情/浏览场景） |
| `--bg-drawer` | `#161b22` | 抽屉、模态实体背景 |
| `--glass-border` | `rgba(255, 255, 255, 0.06)` | **行卡默认边框** |
| `--glass-border-hover` | `rgba(255, 255, 255, 0.15)` | hover 边框 |
| `--glass-border-strong` | `rgba(255, 255, 255, 0.18)` | 焦点 / 选中边框 |
| `--accent-cyan` | `#10a37f` | 主强调色 |
| `--text-primary` | `#ededed` | 主文本 |
| `--text-secondary` | `#a3a3a3` | 次级文本 |
| `--text-muted` | `#737373` | 辅助文本 / meta |
| `--status-green` | `#22c55e` | 成功 / 已完成 / 已启用 |
| `--status-red` | `#ef4444` | 错误 / 异常 |
| `--status-yellow` | `#f59e0b` | 警告 / 待审批 |

### 圆角

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | `4px` | **Tag、chip、小图标按钮**、表单 chip |
| `--radius-md` | `6px` | **按钮、输入框**、行卡内子元素 |
| `--radius-lg` | `10px` | **`.list-row` 行卡**、面板、empty-state |
| `--radius-xl` | `12px` | 详情卡片、Drawer |
| `--radius-2xl` | `16px` | 模态、对话框 |

> 桌面页面统一在 10-12px 区间，避免 14px+ 的"大泡泡"卡片观感；列表行卡用 `--radius-lg`。

### 字号 / 字重

| 场景 | 字号 | 字重 | 颜色 |
|---|---|---|---|
| 页面标题（`.page-header__title`） | **22-24px** | 600-700 | `--text-primary` |
| 副标题 | 13-14px | 400 | `--text-secondary` |
| Eyebrow（小标） | 11px | 700 | `--text-muted` |
| 列表行主文字（`.list-row__title`） | 14-15px | 600 | `--text-primary` |
| 列表行 meta | 12px | 400 | `--text-muted` |
| Tag 文字 | 10-11px | 600 | 状态色 |
| 正文段落 | 13-14px | 400 | `--text-primary` |
| 辅助说明 | 12px | 400 | `--text-muted` |
| 等宽（id、path） | 12px | 400 | mono stack |

> 32px 是网页级大标题，桌面应用不需要——侧边栏导航已经在指示当前位置。**桌面页面统一 22-24px。**

### 模糊 / 阴影

| Token | Value | Usage |
|---|---|---|
| `--blur-std` | `blur(16px)` | sticky header、drawer overlay |
| `--shadow-card` | `0 4px 16px rgba(0, 0, 0, 0.24)` | 卡片阴影（轻） |
| `--shadow-drawer` | `-12px 0 32px rgba(0, 0, 0, 0.5)` | 右滑抽屉 |
| `--shadow-modal` | `0 20px 40px rgba(0, 0, 0, 0.45)` | 居中模态 |

阴影克制：单层、低不透明度。**不允许** 多层堆叠或 `0 8px 30px+` 的"飘浮卡"阴影。

### 过渡

| 元素 | 时长 | Easing |
|---|---|---|
| 行卡 / 卡片 hover | 0.15s | `ease` |
| 按钮 hover / 状态切换 | 0.15s | `ease` |
| Drawer 入场 | 0.3s | `cubic-bezier(0.16, 1, 0.3, 1)` |
| 模态背景淡入 | 0.2s | `ease` |

不超过 0.3s。不用弹簧。不用 `transform: scale()` 大于 1.02。

---

## Page Layout

### 标准布局：`.page-shell`

桌面页的统一壳层，flex 纵向，**header 吸顶 + main 滚动**。

```tsx
<div className="page-shell">
  <header className="page-header page-header--sticky">
    <div className="page-header__lead">
      <div className="page-header__eyebrow">
        <Icon size={14} className="page-header__eyebrow-icon" />
        <span>SECTION NAME</span>
      </div>
      <h2 className="page-header__title">页面标题</h2>
      <p className="page-header__subtitle">页面描述。</p>
    </div>
    <div className="page-header__actions">
      <button className="btn-toolbar"><Icon size={14}/>次要操作</button>
      <button className="btn-primary"><Icon size={14}/>主要操作</button>
    </div>
  </header>
  <main className="page-content">
    {/* 列表 / 卡片网格 / 详情等 */}
  </main>
</div>
```

**`.page-shell`：** `display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--bg-base);`

**`.page-header--sticky`：**
- `flex-shrink: 0`
- `padding: 28px 48px 24px`
- `background: rgba(13, 13, 15, 0.85)`
- `backdrop-filter: var(--blur-std)`
- `border-bottom: 1px solid rgba(255, 255, 255, 0.04)`
- `display: flex; justify-content: space-between; align-items: flex-end;`
- `z-index: 10`
- 在 `.page-shell` 中天然吸顶（因为 main 是滚动容器，header 不滚）

**`.page-header__title`：** 22-24px / 600-700 / `letter-spacing: -0.02em`

**`.page-header__eyebrow`：** flex 布局，包 lucide 图标（14px）+ 文字（11px / 700 / uppercase / `letter-spacing: 0.08em`）。颜色用 `--text-muted`，**不再强制 cyan**——eyebrow 是位置指示，不该抢主操作的视觉焦点。

**`.page-content`：** `flex: 1; overflow-y: auto; padding: 28px 48px;`

### 兼容：`.page-container`

旧页面用的 `.page-container` + `.page-header` 仍可用（不会推倒重做）。新页面优先 `.page-shell`。两套布局视觉上应一致——核心差异是 sticky 行为。

---

## List Row（核心模式）

`.list-row` 是密集列表的默认容器。MCP、Skills、硅基员工、Workflows、Tools 等列表页全部用此模式；**列表场景不要用 `.glass-card` + `.glass-grid` 卡片网格。**

### 容器：`.list-rows`

```tsx
<div className="list-rows">
  {/* 多个 .list-row */}
</div>
```

- `display: flex; flex-direction: column`
- `gap: 8px`

> **单列布局**：每行占满内容宽度，便于上下扫读 + 键盘 ↑↓ 导航 + trailing 操作槽稳定在右侧（不会因列宽差异而错位）。多列网格仅用于浏览 / 画廊场景，使用 `.glass-grid--sm/md/lg`。

### 行卡：`.list-row`

```tsx
<article className="list-row">
  {/* 1. 左侧前导槽（状态点 / 头像 / 图标） */}
  <div className="list-row__lead">
    <span className="status-dot status-dot--green" title="已连接" />
  </div>

  {/* 2. 主信息区（标题行 + meta 行） */}
  <div className="list-row__main">
    <div className="list-row__title-row">
      <Link to="/x/123" className="list-row__title">My Server</Link>
      <span className="tag tag--accent">HTTP</span>
    </div>
    <div className="list-row__meta-row">
      <span className="list-row__meta">server-id-123</span>
      <span className="list-row__meta-sep" />
      <span className="list-row__meta">12 个工具</span>
    </div>
  </div>

  {/* 3. 右侧操作槽 */}
  <div className="list-row__trailing">
    <button className="icon-btn" title="刷新"><RefreshCw size={14}/></button>
    <button className="icon-btn" title="停用"><Power size={14}/></button>
    <Link to="/x/123" className="btn-toolbar"><Settings2 size={14}/>配置</Link>
  </div>
</article>
```

**参数：**
- `display: flex; align-items: center; gap: 16px`
- `padding: 14px 20px`（comfortable 默认）
- `min-height: 64px`
- `background: var(--bg-surface)`
- `border: 1px solid var(--glass-border)`
- `border-radius: var(--radius-lg)` (10px)
- `transition: background 0.15s ease, border-color 0.15s ease`
- Hover：`background: var(--bg-surface-hover); border-color: var(--glass-border-hover);`
- 禁用态（`.is-disabled`）：`opacity: 0.55; filter: grayscale(70%);`

**槽位：**
- `.list-row__lead` —— 24-36px 宽，居中。承载 `.status-dot`、`.list-row__avatar`（28-32px）、或 lucide 图标。
- `.list-row__main` —— `flex: 1; min-width: 0;` 容纳标题行 + meta 行。
- `.list-row__title-row` —— `display: flex; align-items: center; gap: 10px; min-width: 0;`
- `.list-row__title` —— 14-15px / 600；当链接时 `text-decoration: none`，hover 颜色不变（hover 反馈给整行卡）。
- `.list-row__meta-row` —— `display: flex; align-items: center; gap: 8px;` 间距由 `__meta-sep` 控制。
- `.list-row__meta` —— 12px / 400 / `--text-muted`。
- `.list-row__meta-sep` —— 4px 圆点，颜色 `rgba(255, 255, 255, 0.1)`，作为视觉分隔。
- `.list-row__trailing` —— `display: flex; align-items: center; gap: 8px;`

### 变体

| Modifier | 用途 | 关键参数 |
|---|---|---|
| `.list-row--single` | 单行（无 meta） | `min-height: 48px`，main 区只渲染 title-row |
| `.list-row--double` | 双行（默认） | min-height 64px，title + meta |
| `.list-row--with-avatar` | 带头像（硅基员工） | `__lead` 宽 36px，承载 32×32 圆角头像 |
| `.list-row--with-description` | 含描述（Skills） | main 区追加单行截断描述 13px / `--text-secondary` |
| `.is-disabled` | 停用态 | 见参数 |
| `.is-selected` | 选中态 | `border-color: var(--accent-cyan); background: rgba(16, 163, 127, 0.06);` |

### 容器密度

通过 main 上 `data-density` 切换（可选，默认 comfortable）：

```tsx
<main className="page-content" data-density="compact">
  <div className="list-rows">{/* ... */}</div>
</main>
```

- `comfortable`（默认）：行高 64px、padding 14×20、gap 10
- `compact`：行高 48px、padding 10×16、gap 6

### 信息密度准则

每个 `.list-row` 在不悬停的情况下应至少传达：
1. **身份**（名称 + 主链接）
2. **状态**（用 `.status-dot` 或 `.tag`）
3. **关键 meta**（≥ 1 条：id / 数量 / 时间 / 类型）
4. **可执行操作的入口**（trailing 槽至少 1 个按钮）

不允许"点击卡片才看到信息"。**点击应是动作，不是阅读触发器。**

---

## Status Dot

```tsx
<span className="status-dot status-dot--green" title="已连接" />
```

**参数：**
- `width: 8px; height: 8px; border-radius: 50%`
- `box-shadow: 0 0 8px <state-color>/0.5`（glow）
- `flex-shrink: 0`

**变体：**
- `.status-dot--green` — 健康 / 运行中 / 已启用
- `.status-dot--red` — 异常 / 失败
- `.status-dot--yellow` — 警告 / 待审批
- `.status-dot--accent` — 活跃（cyan，配合 pulse 动画提示进行中）
- `.status-dot--muted` — 未知 / 空闲

**Pulse 变体（仅用于进行中状态）：**
```css
.status-dot--accent { animation: status-pulse 1.5s ease-in-out infinite; }
@keyframes status-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }
```

---

## Tags

`.tag` 是行内状态/类型标签，**矩形**，4px 圆角。在密集列表里比 999px 圆 pill 更安静、更系统化。

```tsx
<span className="tag tag--accent">HTTP</span>
<span className="tag tag--muted">已停用</span>
<span className="tag tag--green">运行中</span>
<span className="tag tag--yellow">待审批</span>
<span className="tag tag--red">异常</span>
```

**参数：**
- `font-size: 10-11px; font-weight: 600`
- `padding: 2px 7px`
- `border-radius: var(--radius-sm)` (4px)
- `border: 1px solid <state-color>/0.20`
- `background: <state-color>/0.12`
- `color: <state-color>`（饱和原色）
- `text-transform: uppercase`（可选，用于类型标签如 HTTP / STDIO）
- `letter-spacing: 0.04em`

### Tag vs Pill 的区分原则

`.tag` 和 `.glass-pill` 共存，**用途不同**：

| 维度 | `.tag` | `.glass-pill` |
|---|---|---|
| 形状 | 矩形 4px 圆角 | 全圆 999px |
| 字号 | 10-11px | 11px |
| 用途 | **行内**：列表行、卡片 header 内的状态/类型/数量标签 | **独立**：通知性场景，例如未读数、审批徽章、聊天会话状态 |
| 视觉权重 | 安静、系统化 | 抢眼、引导注意 |

**判断规则：** 如果它跟在标题旁、用于补充身份信息——用 `.tag`。如果它独立浮现、为了让用户回头看——用 `.glass-pill`。

---

## Buttons

### `.btn-primary` — 页面主操作

页面级关键操作（新建、提交、立即执行）。**描边风格**（不实心填充）。

```tsx
<button className="btn-primary"><Plus size={14}/>新建服务</button>
```

- `height: 32px`（紧凑）/ `36px`（强调）
- `padding: 0 16px`
- `display: inline-flex; align-items: center; gap: 6px`
- `background: transparent; color: var(--accent-cyan); border: 1px solid var(--accent-cyan);`
- `border-radius: var(--radius-md)` (6px)
- `font-size: 13px; font-weight: 500`
- Hover：`background: rgba(16, 163, 127, 0.08); box-shadow: 0 0 8px rgba(16, 163, 127, 0.15);`
- Disabled：`opacity: 0.5; cursor: not-allowed`

### `.btn-toolbar` — 次要 / 工具栏操作

页面 header 的次要操作（导入、刷新、打开目录）；列表行 trailing 槽的文字按钮。

```tsx
<button className="btn-toolbar"><Download size={14}/>导入配置</button>
```

- `height: 32px`
- `padding: 0 14px`
- `background: rgba(255, 255, 255, 0.06); color: var(--text-primary); border: 1px solid rgba(255, 255, 255, 0.06);`
- `border-radius: var(--radius-md)` (6px)
- `font-size: 13px; font-weight: 500`
- Hover：`background: rgba(255, 255, 255, 0.10);`

### `.icon-btn` — 32×32 图标按钮

行内二级操作（refresh、toggle、删除）。无文字，靠 `title` 提供可访问名称。

```tsx
<button className="icon-btn" title="刷新连接"><RefreshCw size={14}/></button>
```

- `width: 32px; height: 32px`
- `display: inline-flex; align-items: center; justify-content: center`
- `background: transparent; color: var(--text-muted); border: none`
- `border-radius: var(--radius-md)` (6px)
- Hover：`background: rgba(255, 255, 255, 0.08); color: var(--text-primary);`
- Focus-visible：`outline: 2px solid var(--accent-cyan); outline-offset: -2px`

### `.btn-ghost` — 透明描边

危险/破坏性、Drawer 内取消按钮。

```tsx
<button className="btn-ghost">取消</button>
<button className="btn-ghost btn-ghost--danger">删除</button>
```

- 同 `.btn-toolbar` 尺寸
- `background: transparent; border: 1px solid var(--glass-border)`
- `--danger` 变体：边框/文字 `var(--status-red)`

### 旧按钮类

`.btn-premium`、`.glass-action-btn` 是旧类，仍可运行，旧页面无需立刻迁移；**新页面统一用 `.btn-primary` / `.btn-toolbar` / `.icon-btn` / `.btn-ghost`**。

---

## Cards（重新定位）

`.glass-card` **不再是列表默认**。它适用于：

1. **浏览/画廊场景** —— Hub 商品列表、技能商店（图片占主导，每张卡是"内容产品"而不是"可操作条目"）
2. **详情页面里的功能模块卡** —— 设置分组、表单分区
3. **Empty state 占位卡** —— 见下文

**参数：**
- `border-radius: var(--radius-xl)` (12px) — 比早期的 14px 更紧凑、系统化
- 背景 / 边框 / hover lift / inner glow 沿用 `.glass-card` 现有样式

**禁止：** 列表页用 `.glass-card` 网格替代 `.list-row`。

---

## Drawer（右侧滑出）

详情、导入、配置等弹层一律用右侧 drawer，不用居中模态——drawer 不打断列表上下文。

```tsx
<div className="drawer-overlay" onClick={close}>
  <aside className="drawer" onClick={(e) => e.stopPropagation()}>
    <header className="drawer__header">
      <h3>标题</h3>
      <button className="icon-btn" title="关闭 (Esc)" onClick={close}>
        <X size={18}/>
      </button>
    </header>
    <div className="drawer__content">{/* ... */}</div>
    <footer className="drawer__footer">
      <button className="btn-primary">确认</button>
    </footer>
  </aside>
</div>
```

**参数：**
- `.drawer-overlay`：`position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); z-index: 100; display: flex; justify-content: flex-end;` + `animation: fadeIn 0.2s ease`
- `.drawer`：宽 420-480px、`background: var(--bg-drawer)`、`border-left: 1px solid rgba(255, 255, 255, 0.1)`、`box-shadow: var(--shadow-drawer)`、`animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)`
- `.drawer__header` / `.drawer__footer`：padding 20-24px，`border-{bottom,top}: 1px solid rgba(255, 255, 255, 0.06)`
- `.drawer__content`：`flex: 1; overflow-y: auto; padding: 20px;`

**交互必备：**
- Esc 关闭
- 点击 overlay 关闭
- Tab 焦点陷阱（参考 `useDialogA11y` hook）
- 入场聚焦到 drawer 内首个可聚焦元素

**居中模态** 只用于：确认操作、不可关闭的阻塞流程、详情查看且没有"取消并继续浏览"的语义。其余一律 drawer。

---

## Empty State

```tsx
<section className="empty-state">
  <Icon className="empty-state__icon" size={32}/>
  <h3 className="empty-state__title">尚未配置任何 MCP 服务</h3>
  <p className="empty-state__body">连接工具集、数据库与本地能力，释放工作区潜能。</p>
  <button className="btn-primary">立即添加</button>
</section>
```

**参数：**
- `padding: 64px 24px`
- `display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px`
- `border: 1px dashed rgba(255, 255, 255, 0.1)`
- `border-radius: var(--radius-lg)` (10px)
- `background: rgba(255, 255, 255, 0.01)`
- `.empty-state__icon`：`color: rgba(255, 255, 255, 0.2)`
- `.empty-state__title`：16px / 600 / `--text-primary`
- `.empty-state__body`：13-14px / 400 / `--text-muted`

**精简变体** `.empty-state--minimal`：用于 drawer 内、卡片内的空态，padding 32px 16px，去掉图标。

---

## Error Banner

行级错误，显示在列表/内容顶部，**不阻塞页面**：

```tsx
<div className="banner banner--error">
  <AlertCircle size={16}/>
  <span>加载 MCP 服务失败：连接超时</span>
</div>
```

- `display: flex; align-items: center; gap: 8px`
- `padding: 12px 16px`
- `background: rgba(239, 68, 68, 0.10)`
- `border: 1px solid rgba(239, 68, 68, 0.20)`
- `border-radius: var(--radius-md)` (6px)
- `color: var(--status-red)`
- `font-size: 13px`
- `margin-bottom: 16px`

变体：`.banner--info`（cyan）、`.banner--warning`（yellow）。

---

## Form Controls

```tsx
<input className="input" placeholder="搜索..." />
<select className="select">{/* ... */}</select>
<textarea className="textarea" />
```

- `border: 1px solid var(--glass-border)`
- `border-radius: var(--radius-md)` (6px)
- `background: var(--bg-base)`
- `padding: 8-10px 12-14px`
- `font-size: 13px`
- Focus：`border-color: var(--accent-cyan); box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.14); outline: none`
- Hover：`border-color: var(--glass-border-hover)`

---

## Toolbar / Filter Bar（列表上方）

列表页若需筛选/搜索，加在 `.page-content` 顶部：

```tsx
<div className="toolbar">
  <input className="input toolbar__search" placeholder="搜索..." />
  <button className="btn-toolbar"><Filter size={14}/>筛选</button>
  <span className="toolbar__count">42 条</span>
</div>
```

- `display: flex; align-items: center; gap: 12px`
- `margin-bottom: 16px`
- `.toolbar__search` 占主要空间
- `.toolbar__count`：12px / `--text-muted`，靠右

---

## Keyboard Shortcuts（约定）

| 键 | 行为 |
|---|---|
| `Esc` | 关闭最上层 drawer / 模态 / popover |
| `Enter` | 提交主操作（在表单/弹层焦点内） |
| `↑` / `↓` | 列表中的上下移动（计划中） |
| `⌘K` / `Ctrl+K` | 命令面板（规划中） |
| `⌘Backspace` | 删除选中项（带确认） |
| `Tab` / `Shift+Tab` | 焦点陷阱内的循环 |

新组件应实现 Esc 关闭、Tab 焦点陷阱（drawer / modal）、focus-visible outline。

---

## 视觉禁区（Don'ts）

强观点列表。出现这些一律视为不合规：

- ❌ **emoji 当图标**（如 🚀、✨、👤）。所有图标用 lucide-react。
- ❌ **彩虹/渐变背景**。背景一律纯色或半透明 alpha。
- ❌ **圆角 ≥ 14px 的卡片**（除模态/对话框外）。桌面应用应紧凑。
- ❌ **实心填充 CTA**（`background: cyan; color: white`）。**全部用描边或 ghost 风格**——实心填充看起来像营销 banner，与系统 chrome 冲突。
- ❌ **多层堆叠阴影** / `0 8px 30px+` 的飘浮卡感。
- ❌ **同屏 4+ 种字号**。建议把字号控制在 3 种以内（标题 / 正文 / meta）。
- ❌ **列表页用 `.glass-card` 网格**。用 `.list-row`。
- ❌ **列表行内用 `.glass-pill` 圆 pill**。用 `.tag`。
- ❌ **page-title ≥ 28px**。桌面侧栏已经在指示当前页，不需要大字。
- ❌ **弹簧动画 / `transform: scale(1.05)+`**。过渡用 0.15-0.30s ease/cubic-bezier。
- ❌ **将关键信息隐藏在 hover 后**——行卡上不悬停就应能看清身份/状态/操作入口；只有"二级操作"可以悬停揭示。
- ❌ **占位文本 = 标签**。表单 label 用 `<span>`，不要用 placeholder 兼任。

---

## 新页面 Checklist

- [ ] 使用 `.page-shell` + `.page-header--sticky` 布局（或兼容旧的 `.page-container`）
- [ ] page-title 22-24px（不是 32px）
- [ ] eyebrow 含 lucide leading icon
- [ ] 列表用 `.list-rows` + `.list-row`（**不是** `.glass-card` + `.glass-grid`）
- [ ] Lead 槽用 `.status-dot`、`.list-row__avatar` 或 lucide icon
- [ ] 标签用 `.tag`（4px 圆角矩形），独立通知用 `.glass-pill`
- [ ] 行级二级操作用 `.icon-btn`，文字按钮用 `.btn-toolbar`
- [ ] 主操作用 `.btn-primary`（描边 cyan）
- [ ] Empty / Error / Drawer / Form 走规范模式
- [ ] Esc 关弹层、Enter 提交主操作
- [ ] focus-visible 有清晰描边
- [ ] 1440×900 视口能展示 ≥ 8 个列表条目，无需滚动

---

## 旧类 → 新类（迁移参考）

**旧页面无需立即推倒重做。** 触碰到该页面时再迁移。优先级：MCP（已基线）→ Skills → 硅基员工 → Workflows → 其他。

| 旧类 | 现行替代 | 说明 |
|---|---|---|
| `.page-container` | `.page-shell` + `.page-header--sticky` | 新页面优先；旧页保留 |
| `.glass-grid--sm/md/lg`（列表场景） | `.list-rows` | 强制迁移 |
| `.glass-card`（列表场景） | `.list-row` | 强制迁移 |
| `.glass-card`（浏览/详情场景） | `.glass-card`（圆角 12px） | 保留，调圆角 |
| `.glass-pill`（行内 inline） | `.tag` | 强制迁移 |
| `.glass-pill`（独立通知） | `.glass-pill` | 不变 |
| `.btn-premium` / `.btn-premium accent` | `.btn-toolbar` / `.btn-primary` | 新页统一 |
| `.glass-action-btn` | `.btn-toolbar`（文字）/ `.icon-btn`（图标） | 取决于场景 |
| `--radius-xl: 14px`（列表卡） | `--radius-lg: 10px` | 桌面化 |
| page-title 32px | 22-24px | 桌面化 |

---

## 反例（What bad looks like）

为了让规范有判断力，给出三个常见的"看起来很像样但其实不对"的设计：

**反例 1：列表页用大卡片网格**
```
┌─────────┐ ┌─────────┐ ┌─────────┐
│  [icon] │ │  [icon] │ │  [icon] │
│  My MCP │ │  Search │ │  Slack  │
│  Server │ │  Tool   │ │  Server │
│  ...    │ │  ...    │ │  ...    │
│ [按钮]  │ │ [按钮]  │ │ [按钮]  │
└─────────┘ └─────────┘ └─────────┘
```
错在哪：1440 视口只能显示 6-8 张卡，浪费空间；服务身份在卡内多行展开，扫读慢；卡间隙太大破坏密集感。**改用 `.list-row`。**

**反例 2：圆 pill 状态徽章在密集列表里**
```
●  My Server   (HTTP)  (已启用)  (12 工具)  ...
```
当 (HTTP) (已启用) 都是 999px 圆 pill 时，它们看起来像项目符号，干扰扫读。**改用矩形 `.tag`：** `My Server  HTTP  ENABLED  12 工具`。

**反例 3：实心填充 CTA**
```
[ + 新建服务 ]  ← 实心 cyan 背景白字
```
看起来像 SaaS 落地页的 "Get Started" 按钮，与 macOS/Windows 系统按钮冲突。**改用描边：** transparent + cyan 边框 + cyan 文字。

---

## 实施次序

落地到代码分四步：

1. **第一步（本规范发布时）：** MCP 已是基线（无需改）。新页面按本规范开发。
2. **第二步：** 把规范定义的类（`.list-row`、`.list-rows`、`.status-dot`、`.tag`、`.icon-btn`、`.btn-primary`、`.btn-toolbar`、`.btn-ghost`、`.page-shell`、`.page-header--sticky`、`.drawer`、`.empty-state`、`.banner`）沉淀到 `desktop/src/renderer/styles/global.css`，并把 MCP 现有的 inline `<style>` 替换为这些 global 类。
3. **第三步：** 迁移 SkillsPage 与 SiliconPersonEntryPage 到 `.list-row` 模式。
4. **第四步：** 触碰其余列表页（WorkflowsPage、ToolsPage 等）时按需迁移。

旧页面"碰到再改"，不强制一次性大重构。

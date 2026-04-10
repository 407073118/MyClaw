# Desktop UI Style Guide

> 渐进式设计规范文档。新页面和组件必须使用全局 CSS 类，不得重新发明按钮、卡片、徽章等基础组件。

## Design Tokens (`global.css :root`)

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#0c0c0c` | 页面背景 |
| `--bg-sidebar` | `#121212` | 侧边栏背景 |
| `--bg-card` | `rgba(22, 22, 26, 0.72)` | 卡片背景 |
| `--glass-border` | `rgba(255, 255, 255, 0.09)` | 默认边框 |
| `--glass-border-hover` | `rgba(255, 255, 255, 0.18)` | Hover 边框 |
| `--accent-cyan` | `#10a37f` | 主强调色 |
| `--text-primary` | `#ededed` | 主文本 |
| `--text-secondary` | `#a3a3a3` | 次级文本 |
| `--text-muted` | `#737373` | 辅助文本 |
| `--status-green` | `#22c55e` | 成功/已完成 |
| `--status-red` | `#ef4444` | 错误/危险 |
| `--status-yellow` | `#f59e0b` | 警告/待审批 |
| `--radius-xl` | `14px` | 卡片圆角 |
| `--radius-lg` | `11px` | 大元素圆角 |
| `--radius-md` | `7px` | 按钮/输入框圆角 |
| `--radius-sm` | `4px` | 小元素圆角 |
| `--blur-std` | `blur(16px)` | 标准毛玻璃模糊 |
| `--shadow-card` | multi-layer | 卡片阴影 |

## Page Layout

所有页面必须使用全局 `.page-container` 布局：

```tsx
<main className="page-container" style={{ height: "100%", overflowY: "auto" }}>
  <header className="page-header">
    <div className="header-text">
      <span className="eyebrow">SECTION NAME</span>
      <h2 className="page-title">页面标题</h2>
      <p className="page-subtitle">页面描述文本。</p>
    </div>
    <div className="header-actions">
      <button className="btn-premium accent">操作按钮</button>
    </div>
  </header>
  {/* 页面内容 */}
</main>
```

**关键参数：**
- 容器：`padding: 40px 48px`, `max-width: 1400px`, `gap: 32px`
- 标题：`font-size: 32px`, `font-weight: 700`, `letter-spacing: -0.03em`
- Eyebrow：`font-size: 11px`, `font-weight: 700`, `letter-spacing: 0.1em`, `text-transform: uppercase`, `color: var(--accent-cyan)`
- 副标题：`font-size: 15px`, `color: var(--text-secondary)`

**禁止：** 自定义 `sp-page-container`、`ws` 等替代布局类。

## Buttons

### `.btn-premium` — 页面级操作按钮

用于页面头部的主操作（新建、导入等）。

```tsx
<button className="btn-premium">默认按钮</button>
<button className="btn-premium accent">强调按钮</button>
```

**参数：**
- 背景：transparent（描边风格，非实心填充）
- 边框：`1px solid var(--text-primary)`（默认）或 `var(--accent-cyan)`（accent 变体）
- 圆角：`var(--radius-md)` (7px)
- 字号：`14px`, `font-weight: 600`
- Padding：`10px 24px`
- Hover：`translateY(-1px)` + `box-shadow`

**禁止：** 使用实心 `background: var(--accent-cyan)` 的自定义主按钮。全项目按钮风格统一为描边。

### `.glass-action-btn` — 卡片/表单操作按钮

用于卡片 footer、列表行操作、返回按钮等小操作。

```tsx
<button className="glass-action-btn">默认操作</button>
<button className="glass-action-btn glass-action-btn--primary">主操作</button>
<button className="glass-action-btn glass-action-btn--danger">危险操作</button>
```

**参数：**
- 高度：`30px`
- 圆角：`var(--radius-md)` (7px)
- 字号：`12px`, `font-weight: 500`
- 背景：transparent
- 边框：`1px solid var(--glass-border)`
- Hover：`rgba(255,255,255,0.06)` 背景 + border 变亮
- `--primary` 变体：cyan 边框/文字
- `--danger` 变体：red 边框/文字

## Cards

### `.glass-card` — 标准卡片

所有列表页卡片必须使用 `.glass-card`，不要自定义 `mcp-card`、`skill-card`、`sp-card`、`ws-card` 等替代类。

```tsx
{/* 标准列表卡片结构 */}
<div className="glass-card glass-card--accent">
  <div className="glass-card__header">
    <h3>标题</h3>
    <span className="glass-pill glass-pill--green">已启用</span>
  </div>
  <div className="glass-card__body">
    <p>描述文本...</p>
  </div>
  <div className="glass-card__footer">
    <button className="glass-action-btn">操作</button>
    <button className="glass-action-btn glass-action-btn--primary" style={{ marginLeft: "auto" }}>
      主操作
    </button>
  </div>
</div>
```

**列表页卡片一致性规则：**
- MCP、Skills、硅基员工等列表页的卡片必须使用相同的 `.glass-card` 容器
- 卡片内部分区使用 `__header`、`__body`、`__footer` 三段结构
- 状态标签统一使用 `.glass-pill` 而非自定义 badge 类
- Footer 操作按钮统一使用 `.glass-action-btn`
- 网格统一使用 `.glass-grid--sm` (280px) 或 `.glass-grid--md` (320px)

**变体：**
- `.glass-card--accent` — hover 时 cyan 边框 + glow
- `.glass-card--flat` — 无 hover lift（用于容器卡片）

**参数：**
- 背景：`var(--bg-card)` + `backdrop-filter: var(--blur-std)`
- 边框：`1px solid var(--glass-border)`
- 圆角：`var(--radius-xl)` (14px)
- 阴影：`var(--shadow-card), var(--glass-inner-glow)`
- Hover：border 变亮, shadow 加深, `translateY(-2px)`
- `::before` 伪元素：gradient reflection overlay

**禁止：** 卡片使用 `border-radius: 10px` 或 `18px` 等非标准圆角值。

## Grid

```tsx
<div className="glass-grid glass-grid--sm">  {/* 280px min */}
<div className="glass-grid glass-grid--md">  {/* 320px min */}
<div className="glass-grid glass-grid--lg">  {/* 400px min */}
```

**禁止：** 自定义 `sp-card-grid`、`ws-wf-grid` 等替代网格。

## Status Pills / Badges

### `.glass-pill` — 状态徽章

```tsx
<span className="glass-pill glass-pill--green">已完成</span>
<span className="glass-pill glass-pill--yellow">待审批</span>
<span className="glass-pill glass-pill--red">异常</span>
<span className="glass-pill glass-pill--accent">运行中</span>
<span className="glass-pill glass-pill--muted">空闲</span>
```

**参数：**
- 圆角：`999px`（全圆）
- 字号：`11px`, `font-weight: 600`
- Padding：`3px 10px`
- 边框：`1px solid` + 对应状态色半透明

**禁止：** 使用 `border-radius: 4px` 的矩形 pill。全项目 pill 统一为全圆。

## Form Controls

输入框、下拉框、文本域：

- 边框：`1px solid var(--glass-border)`
- 圆角：`var(--radius-md)` (7px)
- 背景：`var(--bg-base)`
- Focus：`border-color: var(--accent-cyan)` + `box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.14)`

## Typography 速查

| 场景 | 字号 | 字重 | 颜色 |
|---|---|---|---|
| 页面标题 | 32px | 700 | `--text-primary` |
| 卡片标题 | 15px | 700 | `--text-primary` |
| 正文 | 13-14px | 400-500 | `--text-primary` |
| 标签/字段名 | 13px | 500-600 | `--text-secondary` |
| Eyebrow | 11px | 700 | `--accent-cyan` |
| 代码/等宽 | 12px | — | mono stack |
| Pill 文字 | 11px | 600 | 对应状态色 |

## Transitions

- 卡片/大元素：`0.25s ease` 或 `0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- 按钮/小元素：`0.2s ease`
- Hover lift：卡片 `translateY(-2px)`，按钮 `translateY(-1px)`

## Checklist：新页面自查

- [ ] 使用 `.page-container` + `.page-header` 布局
- [ ] 头部操作按钮使用 `.btn-premium` 或 `.btn-premium.accent`
- [ ] 卡片使用 `.glass-card` 及其子类
- [ ] 网格使用 `.glass-grid--sm/md/lg`
- [ ] 状态标签使用 `.glass-pill--green/yellow/red/accent/muted`
- [ ] 按钮圆角为 `var(--radius-md)` (7px)，卡片圆角为 `var(--radius-xl)` (14px)
- [ ] 表单控件 focus 使用 cyan border + cyan glow
- [ ] 无实心填充按钮（除特殊审批按钮外，全部使用描边风格）
- [ ] 字号使用 px 而非 rem（与现有代码一致）

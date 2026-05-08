---
phase: quick-260508-jzp
plan: 01
files_modified:
  - desktop/src/renderer/pages/SettingsPage.tsx
  - desktop/src/renderer/pages/ModelDetailPage.tsx
must_haves:
  truths:
    - "全屏窗口下 Settings 4 个 tab 的所有 settings-group-panel 不再固定 860px，跟随 detail-content 宽度伸展"
    - "ModelDetailPage 主表单在全屏下不再居中 900px，从左边缘开始随窗口宽度伸展"
    - "ModelDetailPage 不再有 linear-gradient 背景的 native-tool-card；feature-tag 不再是 999px 圆 pill；dot-icon 颜色对齐 status token"
    - "JSX、字段、交互、IPC、auth 全部不动；纯 CSS 改动"
---

# Plan 260508-jzp: Settings + 模型编辑页全屏列宽 + 网页卡片化整改

## 6 处具体改动

| # | 文件 | 行 | 改动 |
|---|------|-----|------|
| 1 | SettingsPage.tsx | ~842 | 删 `.settings-group-panel { max-width: 860px }` |
| 2 | ModelDetailPage.tsx | 1546-1553 | 删 `.main-form { max-width: 900px; margin: 0 auto }` |
| 3 | ModelDetailPage.tsx | 1655-1664 | `.native-tool-card { background: linear-gradient(...) }` → `rgba(255,255,255,0.02)`；border 与圆角同步 token 化 |
| 4 | ModelDetailPage.tsx | 1993-2000 | `.feature-tag { border-radius: 999px }` → `4px`，padding 收窄 + 加 letter-spacing 与 ui-style-guide `.tag` 对齐 |
| 5 | ModelDetailPage.tsx | 1576-1584 | `.dot-icon` 默认黄 `#eab308` → `var(--status-yellow)`；`.blue #3b82f6` → `var(--accent-cyan)`；新增 `.green` |
| 6 | ModelDetailPage.tsx | 1949-1953 / 2002-2010 | `.capability-card` 与 `.managed-profile-card` 圆角 8px → `var(--radius-lg)` (10px)，背景 + 描边 token 化 |

## Verify

- 文件 typecheck 不变（纯 CSS）
- 视觉回归：用户重启 dev 后看 Settings 4 个 tab + /settings/models/new + /settings/models/:id

## Done

- 6 处 CSS 改完，提交一个 fix commit
- STATE 加一行

---
phase: quick-260508-kvd
plan: 01
files_modified:
  - desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx
  - desktop/src/renderer/pages/SiliconPersonCreatePage.tsx
must_haves:
  truths:
    - "硅基员工 studio 资料 tab 全屏下不再固定 900px 居中，跟随 ws-col 伸展"
    - "ws-model-status-pill 与 spc-model-status-pill 由 999px 圆 pill 改为 4px 矩形 tag"
    - "新建硅基员工页面 spc-copy-strip / spc-editor-pane / spc-config-pane 不再有 linear-gradient 背景"
    - ".ws-session-badge 数字徽章独立通知场景按 ui-style-guide 允许保留圆 pill (本次不动)"
---

# Plan 260508-kvd: 硅基员工 配置 + 资料页面 同类整改

## 6 处具体改动

| # | 文件 | 改动 |
|---|------|------|
| 1 | SiliconPersonWorkspacePage.tsx | `.ws-profile-col { max-width: 900px; margin: 0 auto; width: 100%; }` → `{ width: 100%; }` |
| 2 | SiliconPersonWorkspacePage.tsx | `.ws-model-status-pill` 由 999px / 28px 高 / 12px 字 → 4px 圆角 / 22px 高 / 11px 字 / 加 letter-spacing，对齐 ui-style-guide `.tag` |
| 3 | SiliconPersonCreatePage.tsx | `.spc-copy-strip` 圆角 16→12，`linear-gradient(135deg, ...)` → `rgba(255,255,255,0.025)`；border 0.08→0.06 |
| 4 | SiliconPersonCreatePage.tsx | `.spc-editor-pane` 圆角 18→12，`linear-gradient(180deg, ...)` → `rgba(255,255,255,0.02)`；border 0.08→0.06 |
| 5 | SiliconPersonCreatePage.tsx | `.spc-config-pane` 圆角 18→12，`linear-gradient(180deg, rgba(16,163,127,0.055), ...)` → `rgba(16,163,127,0.04)` |
| 6 | SiliconPersonCreatePage.tsx | `.spc-model-status-pill` 同步 .tag 规格（4px / 22px / 11px / 600 / 0.04em） |

不动：
- JSX、字段、数据流、IPC
- 任何 `data-testid`
- `.ws-session-badge`（数字徽章独立通知场景，ui-style-guide 允许圆 pill）
- `.ws-schedule-form` 的 `repeat(auto-fit, minmax(220px, 1fr))`（小字段自适应折行，非「列表多列卡片」反模式）

---
phase: quick-260508-jzp
status: completed
date: 2026-05-08
files_modified: 2
---

# Quick Task 260508-jzp Summary

## Goal

用户反馈两件事：
1. 整个个人设置（4 个 tab）全屏后列宽都不对：内容卡固定 860px 在左半边，右边大量空白
2. 模型点击编辑进的页面是"完全的网页卡片设计"，要改成桌面端 native 风格

完整审计 `SettingsPage.tsx` + `ModelDetailPage.tsx` 全部 inline CSS 后定位到 6 处硬伤，一次性整改。

## What Changed

### SettingsPage.tsx

**`.settings-group-panel` 删 `max-width: 860px`**
4 个 tab（模型/通用/审批/语音识别）的设置面板都用这一个 class。原 max-width 让所有面板在 1920px 全屏下卡在左侧 860px 内、右侧 ~700px 空白。删掉后 panel 跟随 `.settings-detail-content`（无 max-width）自然 stretch。表单内字段宽度天然受 `.form-row-multi` flex/`.field-grid` 2-col grid 限制，不会出现单输入框宽到不可读。

### ModelDetailPage.tsx (5 处)

**`.main-form` 去掉 `max-width: 900px` + `margin: 0 auto`**
原本主表单在 1920px 全屏下居中 900px，左右各 ~330px 空白。改成纯 `width: 100%` 跟随 `.settings-detail-content` 撑满，与 SettingsPage 行为一致。

**`.native-tool-card` 去 `linear-gradient` 背景**
原 `linear-gradient(180deg, rgba(24,24,27,.96), rgba(14,14,18,.96))` 显著偏"营销卡"，违反 `desktop/docs/ui-style-guide.md` "❌ 彩虹/渐变背景"。改为 `rgba(255,255,255,0.02)` + `rgba(255,255,255,0.06)` 描边，圆角 12 → 10，与 ui-style-guide list-card / 同页 form-section 一致。

**`.feature-tag` `border-radius: 999px` → `4px`**
违反 ui-style-guide "❌ 列表行内用 .glass-pill 圆 pill。用 .tag (4px 圆角矩形)"。padding 10 → 7、加 `font-weight: 600` + `letter-spacing: 0.04em`，对齐 `.tag` 规格。颜色保留 status-green 系不动（语义=能力开启）。

**`.dot-icon` 颜色 token 化**
默认黄 `#eab308` → `var(--status-yellow)`；`.blue` `#3b82f6` → `var(--accent-cyan)`；并新增 `.green` 用 `var(--status-green)` 备用（JSX 已有用到）。把 hex 锁死改为 design token 引用，未来 token 调色会自动跟随。

**`.capability-card` / `.managed-profile-card` token 化**
背景 `#161618` → `rgba(255,255,255,0.02)`；描边 `#27272a` → `rgba(255,255,255,0.06)`；圆角 8px → `var(--radius-lg)` (10px)。三处都向 ui-style-guide 卡片标准对齐，整页卡片视觉权重更一致（不再有"独立深色卡盒"突兀感）。

## Verification

| 检查 | 结果 |
|------|------|
| 改动范围 | 纯 CSS（2 文件 × 6 处），0 JSX 改动 |
| typecheck 影响 | 无（CSS 不参与 ts 类型检查） |
| 行为差异 | 默认窗口：基本无视觉变化（panel 在 1024px 内容区下本来也能 ≤860 自然显示）；全屏：全部 panel/form 占满内容区宽度，network-tool-card 不再渐变，feature-tag 矩形化 |
| ui-style-guide 对齐项 | 渐变背景 ✓ 移除；圆 pill 行内 ✓ 改 .tag 矩形；圆角 ✓ 12→10 标准；token 化 ✓ status-* / accent-* / radius-lg |

## What's Still Open (后续可继续)

如果用户进编辑页后还觉得"网页卡片感"明显，下一轮可以做：
- 减少卡片嵌套：`.form-section` 已是顶层卡，内部 `.native-tool-card` / `.managed-profile-card` / `.capability-card` 进一步去 background 只留 `border-top` 分隔线，进一步压扁视觉层级
- `.field input/select/textarea` border-radius 8px → 6px (`var(--radius-md)`) 与按钮/全局 input 一致
- 某些 hex 锁死颜色（`#161618` / `#27272a` / `#71717a` / `#a1a1aa`）继续 token 化为 `--text-muted` / `--glass-border` 等
- 顶部 `.detail-topbar` / `.primary-save-btn` 检查实心填充按钮风格是否与登录页例外政策一致（其他页应描边）

## Files Modified

- `desktop/src/renderer/pages/SettingsPage.tsx`（1 处 CSS）
- `desktop/src/renderer/pages/ModelDetailPage.tsx`（5 处 CSS）

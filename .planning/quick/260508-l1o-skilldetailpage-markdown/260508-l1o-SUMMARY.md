---
phase: quick-260508-l1o
status: completed
date: 2026-05-08
files_modified: 1
---

# Quick Task 260508-l1o Summary

## Goal

Skills 详情页打开 .md 文件预览时，原先用一个 18px 圆角 + 多层 linear-gradient + `0 20px 48px` 大投影 + 1px border 的卡盒包住整段文档，看着像「Web blog 文章卡」而不是桌面 markdown 预览。改成 VSCode / Notion / Obsidian 风格的扁平文档视图。

## What Changed

`desktop/src/renderer/pages/SkillDetailPage.tsx` 单文件 5 处 CSS：

**`.markdown-preview` 外层**
去 radial-gradient + linear-gradient 双层装饰背景，纯 `var(--bg-base)`。padding 24 → 32 48 与 page-content 对齐。

**`.markdown-preview__surface` 内卡盒（彻底扁平化）**
删除：
- `border: 1px solid rgba(255,255,255,0.08)`
- `border-radius: 18px`（违反 ui-style-guide「圆角 ≥ 14px 卡片」）
- `background: linear-gradient(180deg, rgba(16,163,127,0.08), ...)`（违反「彩虹/渐变背景」）
- `box-shadow: inset ... + 0 20px 48px rgba(0,0,0,0.24)`（违反「多层堆叠/飘浮卡感阴影」）
- `padding: clamp(24px, 4vw, 40px)`（外层 padding 已涵盖）

保留 `width: min(100%, 880px) + margin: 0 auto`：纯文档可读性约束（VSCode/Obsidian/Notion 都是 720-880 居中）。

**`.markdown-preview pre` 代码块**
- `linear-gradient(180deg, rgba(255,255,255,0.03), transparent 22%) + rgba(9,12,14,0.92)` → `rgba(0, 0, 0, 0.3)`
- 去 `box-shadow: inset 0 1px 0 rgba(255,255,255,0.04)`
- 圆角 14 → 6（var(--radius-md) 对齐桌面卡片）
- padding 16/18 → 14/16

**字号桌面化**
| 级 | 旧 | 新 |
|----|----|----|
| h1 | clamp(28px, 4vw, 36px) / 800 / `border-bottom` | 24px / 600 / 无 border |
| h2 | clamp(22px, 3vw, 28px) / 700 | 18px / 600 |
| h3 | 18px / 700 | 15px / 600 |
| h4-6 | 15px / 700 | 13px / 600 |

桌面应用一屏要装得下文档大纲；clamp 36 这种 hero 字号是 web 营销页风格，桌面应用看着臃肿。配合 `--text-primary` 字色与 page-shell `.page-header__title` 的 22-24px 主标准协调。

**blockquote / table 圆角**
- blockquote `0 12px 12px 0` → `0 6px 6px 0`
- table `12px` → `6px`
- table box-shadow border 从 0.08 alpha 收到 0.06，与 ui-style-guide --glass-border 体系一致

## Why

ui-style-guide 视觉禁区命中：
- ❌ 圆角 ≥ 14px 卡片（除模态外）→ surface 18px、pre 14px、blockquote/table 12px
- ❌ 多层堆叠阴影 / `0 8px 30px+` 飘浮卡 → surface `0 20px 48px` + inset
- ❌ 彩虹/渐变背景 → markdown-preview 外层双 gradient + surface inner linear-gradient + pre linear-gradient（共 4 处）
- ❌ 同屏 4+ 种字号 → h1 clamp(36) / h2 clamp(28) / h3 18 / h4 15 / 正文 14 = 5 级跨度，桌面应该 ≤ 3-4 级

整页改完后视觉风格从 "Web blog 文章卡" 转向 "桌面 markdown 文档预览"，与 SkillsPage list-row + SkillDetailPage 顶部 toolbar 的密集桌面感一致。

## Verification

| 检查 | 结果 |
|------|------|
| 改动范围 | 纯 CSS（1 文件 × 5 处），0 JSX 改动 |
| typecheck | 不参与（CSS 不影响 ts 类型） |
| `data-testid="skill-detail-content"` 与 `renderSafeSkillMarkdown` 调用 | 不变 |
| 其他视图（image-preview / source 文本视图 / preview toggle 按钮） | 未触及 |

## Files Modified

- `desktop/src/renderer/pages/SkillDetailPage.tsx`

无新增依赖，无新增测试。

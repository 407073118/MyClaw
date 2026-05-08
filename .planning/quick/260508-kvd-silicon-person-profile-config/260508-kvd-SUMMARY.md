---
phase: quick-260508-kvd
status: completed
date: 2026-05-08
files_modified: 2
---

# Quick Task 260508-kvd Summary

## Goal

延续 260508-jzp 的整改思路，把硅基员工 studio 「资料」tab + 新建硅基员工页面里同类的「全屏列宽固定」+「网页卡片化」+「圆 pill 用错地方」一次清掉。

## What Changed

### SiliconPersonWorkspacePage.tsx (2 处)

**`.ws-profile-col` 删 max-width: 900px + margin: 0 auto**
资料 tab 的容器原本居中固定 900px，全屏窗口 (1920px studio 主区 ~1660px) 下卡在中间，左右各 ~380px 空白。改为 `width: 100%` 跟随 `.ws-col` 自然 stretch。其他 studio tab（chat / tasks / capabilities）用裸 `.ws-col` 已经是 stretch，本次 profile 对齐它们的行为。

**`.ws-model-status-pill` 999px → 4px**
对齐 `desktop/docs/ui-style-guide.md` "❌ 列表行内用 .glass-pill 圆 pill。用 .tag (4px 矩形)"。同时把高度 28→22、padding 调到 2/7、字号 12→11、加 `font-weight: 600` + `letter-spacing: 0.04em`，完整对齐 `.tag` 规格。颜色与 vendor/protocol 变体保留，语义不变。

### SiliconPersonCreatePage.tsx (4 处)

**`.spc-copy-strip` 顶部 hero 去渐变**
`linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))` → `rgba(255,255,255,0.025)`。圆角 16 → 12 对齐卡片标准。border 0.08 → 0.06 与 ui-style-guide --glass-border 系一致。

**`.spc-editor-pane` 编辑面板去渐变**
`linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015))` → `rgba(255,255,255,0.02)`。圆角 18 → 12。

**`.spc-config-pane` 配置面板去渐变**
`linear-gradient(180deg, rgba(16,163,127,0.055), rgba(255,255,255,0.015))` → `rgba(16,163,127,0.04)`，保留品牌色淡染但不再有上→下渐变营销感。圆角 18 → 12。

**`.spc-model-status-pill` 999px → 4px tag 规格**
同 WorkspacePage 第 2 处，对齐 `.tag`。

## Why

ui-style-guide 视觉禁区里直接列了：
- ❌ 彩虹/渐变背景 → 命中 3 处 linear-gradient
- ❌ 圆角 ≥ 14px 的卡片（除模态外）→ 命中 16/18px
- ❌ 列表行内用 .glass-pill 圆 pill → 命中 2 处 .model-status-pill

新建页面的渐变背景让本身已经是 form 工作页的视觉显得偏「营销 onboarding」；改成纯 alpha 后整页风格更克制、更接近 Linear/Reflect 的 form-detail 观感。状态 pill 从 999px 到 4px，让它们在密集行里看起来像「类型标签」而不是「项目符号」。

## Verification

| 检查 | 结果 |
|------|------|
| 改动范围 | 纯 CSS（2 文件 × 6 处），0 JSX 改动 |
| typecheck | 不参与（CSS 不影响 ts 类型） |
| 默认窗口视觉 | 资料 tab 略微变宽（900 → ~1000+ 跟随 ws-col）；编辑/配置 pane 圆角小一点、底色不再上下渐变；状态 pill 矮一截更"系统化" |
| 全屏视觉 | 资料 tab 占满 studio 主区不再居中孤岛；其他符号同上 |

## Files Modified

- `desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx`
- `desktop/src/renderer/pages/SiliconPersonCreatePage.tsx`

无新增依赖，无新增测试，无 JSX 改动。

---
phase: quick-260508-jmn
status: completed
date: 2026-05-08
files_modified: 1
---

# Quick Task 260508-jmn Summary

## Goal

修设置页 → 模型页签：全屏窗口下模型卡片折成 3 列、卡片宽度被锁在 ~420px 不随窗口伸展。改回单列、卡片随窗口宽度变长。

## Root Cause

`SettingsPage.tsx:752-756` `.model-rows-container` 用 `display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 16px;`：
- `minmax(420px, 1fr)` 让 grid 在容器宽度 ≥ 840 / 1260px 时分别折成 2 / 3 列；
- 单卡因此被锁在 ≈ 420px；窗口越宽只会塞更多卡，不会让单卡伸展；
- 全屏窗口 detail-pane content 区 ≈ 1564px 正好命中 3 列分支，对应用户截图症状。

也违反 `desktop/docs/ui-style-guide.md` 与用户偏好「桌面端密集列表默认单列、不做多列 auto-fill」。

## Fix

```css
.model-rows-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

flex column 默认 stretch align，row card 取父容器 100% 宽度；窗口越宽卡片越长，永远 1 行 1 个。gap 从 16 → 12 收紧垂直密度（与 ui-style-guide list-rows 8-10px 区间接近，配合 row card 自身 padding 16/20，留 12 较舒适）。

未触及：
- `.settings-group-panel max-width: 860px`（表单可读性约束，本次范围外）
- 模型 row card 内部布局
- 任何 JSX

## Verification

| 检查 | 结果 |
|------|------|
| 改动范围 | 纯 CSS，3 行 |
| typecheck 影响 | 无（纯 CSS 不影响 ts 类型） |
| 行为差异 | 默认窗口：仍单列卡片宽 ≈ 1020px → 不变；全屏窗口：从 3 列 × 520 改为 1 列 × 1564 |

## Files Modified

- `desktop/src/renderer/pages/SettingsPage.tsx`（`.model-rows-container` 块 5 行→4 行 + 注释更新）

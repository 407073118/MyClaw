---
phase: quick-260508-jmn
plan: 01
files_modified:
  - desktop/src/renderer/pages/SettingsPage.tsx
must_haves:
  truths:
    - "全屏窗口下设置→模型页签的模型卡片始终单列，每张卡片随窗口宽度伸展"
    - "默认窗口大小下行为不退化（仍是单列、卡片占满内容区）"
    - "其他设置 group panel 仍保留 max-width: 860px 的可读性约束（本次不动）"
---

# Plan 260508-jmn: Settings 模型卡片改单列 flex

## Root Cause

`SettingsPage.tsx:752-756` 的 `.model-rows-container`：

```css
display: grid;
grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
gap: 16px;
```

`auto-fill, minmax(420px, 1fr)` 行为：
- 容器 < 420px：1 列拉伸
- 容器 ~840px：2 列各 ~420px（不再拉伸单卡）
- 容器 ~1260px：3 列各 ~420px

→ 全屏（1920×... 时 detail-pane content 区 ~1564px）正好折成 3 列；窗口越宽不会让单卡变长，只会塞更多卡。这同时解释用户的两个症状：「卡片固定长度不撑开」+「全屏变 3 列」。

## Fix

```css
display: flex;
flex-direction: column;
gap: 12px;
```

flex column 默认 stretch，模型 row card 自然 100% 填满父容器宽度，窗口越宽卡片越长，永远 1 列。gap 从 16 → 12，因为已是垂直堆叠不需要那么松。

不动 `.settings-group-panel max-width: 860px`（这是表单文本可读性约束，user 本次没要求改）。

## Verify

- node 语法不涉及（纯 CSS 改动）
- 用户回归：默认窗口下模型卡片仍单列；全屏后单列+卡片更长

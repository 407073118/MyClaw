---
quick_id: 260507-juq
status: complete
date: 2026-05-07
---

# Quick Task 260507-juq: 硅基员工工作台样式迁移

## 范围

3 个 renderer 层文件 + 1 个全局 CSS 增补；零 handler / state / IPC 改动。

| 文件 | 改动 |
|---|---|
| `desktop/src/renderer/styles/global.css` | 新增 `.tag--interactive` 变体（base + hover + focus-visible + is-active + disabled） |
| `desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx` | 1483 行整页迁移：page-shell 框架、单列 list-row、矩形 .tag、描边按钮、modal a11y |
| `desktop/src/renderer/components/ReasoningPresetPanel.tsx` | badge → .tag；圆角 token 化；移除 hover-lift；font-weight 800 → 700 |
| `desktop/src/renderer/components/WorkFilesPanel.tsx` | 7 个 emoji → lucide-react 图标；按钮 → btn-toolbar；空态 → empty-state |

## 7 步迁移完成清单

- ✅ 步骤 1 · 页面骨架：`<main.ws>` → `.page-shell` + `.page-header--sticky` + `.page-content`
- ✅ 步骤 2 · 按钮零填充：`btn-premium accent` / `sp-confirm-ok` 渐变 / `ws-btn-send` / `ws-btn-ghost` 全部替换为 `.btn-primary` / `.btn-toolbar` / `.btn-ghost--danger`
- ✅ 步骤 3 · 密集列表单列：Skills / MCP / 已绑工作流 / 运行记录 / 定时任务 5 个 `auto-fill grid` → `.list-rows + .list-row`
- ✅ 步骤 4 · 状态徽章：14 处 `.glass-pill` 内联标签 → `.tag tag--{state}`；`ws-status-dot` → `.status-dot`；ReasoningPresetPanel `__badge` → `.tag`
- ✅ 步骤 5 · 卡片 & 表单：`ws-card` 圆角/字号 token 化；font-weight 800 → 700；input radius 8px → `var(--radius-md)`；过渡 0.25s → 0.15s；删除 inset focus / hover-lift / 飘浮卡片阴影
- ✅ 步骤 6 · 错误/空态：4 处 `<p.ws-error>` → `.banner banner--error`；`ws-empty-state` → `.empty-state empty-state--minimal` + lucide 图标
- ✅ 步骤 7 · 图标 & 弹窗：WorkFilesPanel 7 emoji → lucide；保存确认弹窗圆角 `var(--radius-2xl)` + 阴影 `var(--shadow-modal)` + ESC + Enter + Tab focus trap

## 关键决策落地

- **保留 `.ws-card` 类不变**，只更新 inline `<style>` 中的 CSS 值（避免污染其他页面的 `.glass-card`）
- **CSS 变体名直接用现有色**：`tag--success/info/warn/danger` 映射到 `tag--green/accent/yellow/red`，不新增别名
- **inline `<style>` 块保留在文件内**，不抽到独立 .css（per 用户锁定决定）
- **ReasoningPresetPanel 共享组件改造**：CreatePage 顺带受益（badge 视觉同步，hover-lift 移除）
- **WorkFilesPanel 共享组件改造**：ChatPage / WorkflowStudioPage 同步受益

## 验证结果

| 检查项 | 结果 |
|---|---|
| `pnpm exec tsc -p tsconfig.renderer.json --noEmit` | ✅ 仅有 1 个**预先存在**的 `workspace.ts:31` `WorkflowDefinitionSummary` 报错（与本次改动无关） |
| 旧 className 全部清除 | ✅ `glass-pill / ws-btn-ghost / ws-btn-send / ws-btn-approve / ws-btn-deny / ws-binding-grid / ws-wf-grid / ws-empty-state / ws-error / sp-confirm-cancel / sp-confirm-ok / btn-premium accent / ws-status-dot / ws-header (CSS) / ws-identity / ws-avatar / ws-name-row / ws-title-sub / ws-session-pill` 全部 0 处 |
| 硬编码圆角 8/14/16px | ✅ 0 处 |
| Emoji 图标 | ✅ 0 处 |
| `font-weight: 800` | ✅ 0 处 |
| `tag tag--` 使用 | ✅ 16 处（≥12 预期） |
| `list-row list-row--` 使用 | ✅ 5 处 |
| Modal a11y refs / 事件监听 | ✅ saveDialogRef / confirmBtnRef / cancelBtnRef / Escape / Enter / Tab 全部就位 |
| `useRef` 已导入 | ✅ |

## 显式不在范围（留给后续轮次）

| 簇 | 内容 |
|---|---|
| B（功能 bug） | preload 全员吞错；草稿被 stream 重置；保存无校验；删除员工 UI；description 不可编辑；tab 不写 URL；schedule 默认时间硬编码 |
| C（缺失能力） | Skills/MCP 安装/卸载、工作流解绑、定时任务编辑/取消 |
| D（重构） | 1483 行单文件拆分、抽 4 个 tab 组件、移除 11 处 setViewVersion 体操、runtime.db 死代码清理 |

## 风险点（已落地）

- ✅ ReasoningPresetPanel 是共享组件 → SiliconPersonCreatePage 同步受益（badge 矩形、option 不再飘浮）
- ✅ WorkFilesPanel 是共享组件 → ChatPage / WorkflowStudioPage 同步受益（emoji → lucide）
- ✅ `.ws-session-pill` → `.tag tag--interactive`：保留 `.ws-session-pills` 容器的 `flex-wrap`，水平多行布局不受影响

## 还需手动 smoke 测试（未在本次自动化覆盖）

由于 dev server 不在自动化范围内，建议在本次 commit 后手动验证：
1. `/employees/{id}/studio` 页头 sticky、4 个 tab 切换正常
2. capabilities tab 5 个列表单列显示
3. 保存按钮 → 确认弹窗 ESC / Enter / Tab 三键交互
4. CreatePage（reasoning panel 共用）视觉无回归
5. ChatPage（WorkFilesPanel 共用）lucide 图标显示正常

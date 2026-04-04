---
status: awaiting_human_verify
trigger: "Investigate issue: desktop-personal-prompt-layout-overlap"
created: 2026-04-04T00:00:00+08:00
updated: 2026-04-04T18:36:36+08:00
---

## Current Focus

hypothesis: 修复已完成，等待桌面应用中的真实渲染确认
test: 请在桌面端打开 `/me/prompt` 检查侧栏亮点与主内容布局
expecting: 当前页左下不再出现孤立发光点，Personal Prompt 页面在桌面壳层内不再拥挤或遮挡
next_action: ask user to verify the desktop Personal Prompt page in the real app

## Symptoms

expected: Personal Prompt page should have correct desktop layout with no overlapping/occluded panels or chips, and no stray glowing status dot in the bottom-left.
actual: On the Personal Prompt page, a bright dot stays lit in the lower-left corner near the model panel; the page layout is off and parts of the content/chips are visually crowded or blocked.
errors: No explicit runtime error reported. Symptom is visual/layout regression from the rendered UI screenshot.
reproduction: Open desktop app, navigate to /me/prompt ("My Prompt" / 我的工作提示词), observe lower-left glowing dot and layout overlap in main content.
started: Present right now in current build. Treat as existing UI bug until proven otherwise.

## Eliminated

## Evidence

- timestamp: 2026-04-04T18:31:43+08:00
  checked: docs/agents/context-engineering.md and docs/agents/harness-rules.md
  found: 任务明确落在 `desktop/`，需遵循最小上下文和最小改动原则；仓库中没有更深层 `desktop/AGENTS.md`
  implication: 可以直接在 `desktop/src/renderer` 与 `desktop/tests` 范围内定位并修复，不需要跨工作区改动

- timestamp: 2026-04-04T18:31:43+08:00
  checked: desktop/src/renderer/layouts/AppShell.tsx
  found: 侧栏用户卡中的 Personal Prompt 按钮在 `hasPersonalPrompt` 为真时总是渲染 `.prompt-link-dot`，即使当前路径已经是 `/me/prompt`
  implication: 用户看到的左下角常亮小绿点与该提示点实现完全吻合，属于提示元素在当前页仍持续显示

- timestamp: 2026-04-04T18:31:43+08:00
  checked: desktop/src/renderer/pages/PersonalPromptPage.tsx and desktop/src/renderer/styles/global.css
  found: 页面主体位于 `AppShell` 内部剩余空间，但 `.prompt-editor-card` 使用 `height/max-height: calc(100vh - 190px)`，同时 `.personal-prompt-page` 与 `.prompt-layout` 都设置了 `overflow: hidden`
  implication: 页面在包含 36px TitleBar 的桌面壳层里会重复使用整窗高度，导致内容区超出可用高度后被裁切或相互挤压

- timestamp: 2026-04-04T18:31:43+08:00
  checked: desktop/tests and desktop/package.json
  found: 现有桌面 UI 测试使用 `@vitest-environment jsdom` + `@testing-library/react`，适合添加针对该回归的最小渲染测试
  implication: 可以先写失败测试锁定回归，再做定向修复并运行相关 vitest 用例

- timestamp: 2026-04-04T18:34:21+08:00
  checked: desktop/tests/personal-prompt-layout-regression.test.ts via `pnpm test tests/personal-prompt-layout-regression.test.ts`
  found: 当前路由为 `/me/prompt` 时测试仍能查到 `.prompt-link-dot`；另一条测试在渲染 `PersonalPromptPage` 时因 `React is not defined` 中断
  implication: 亮点问题已被自动化验证；为了继续验证布局修复，需要先让页面在 vitest/jsdom 下正常渲染

- timestamp: 2026-04-04T18:35:49+08:00
  checked: AppShell.tsx, PersonalPromptPage.tsx, tests/personal-prompt-layout-regression.test.ts
  found: 已将侧栏提示点限制为非 `/me/prompt` 路由显示；PersonalPrompt 页面改为 container query 驱动的响应式规则，并补齐 `React` 默认导入；新增回归测试已通过
  implication: 两个用户可见症状都有对应代码修复，接下来只需做相邻回归与编码安全验证

## Resolution

root_cause: AppShell 将 Personal Prompt 的提示点无条件绑定在已保存状态上，当前页也持续显示；PersonalPromptPage 使用 viewport `@media` 判断布局，而不是按壳层内真实可用宽度响应，导致桌面侧栏/面板收窄后仍维持双列布局并出现拥挤遮挡
fix: AppShell 仅在离开 `/me/prompt` 时显示 `prompt-link-dot`；PersonalPromptPage 改为 `container-type: inline-size` + `@container` 断点，并收紧双列宽度约束；同时补齐 `React` 默认导入以支撑 jsdom 回归测试
verification: 已通过 `pnpm test tests/personal-prompt-ui.test.ts tests/personal-prompt-foundation.test.ts tests/personal-prompt-layout-regression.test.ts`，共 3 个文件 8 个测试全部通过；修改文件乱码检查通过
files_changed: [desktop/src/renderer/layouts/AppShell.tsx, desktop/src/renderer/pages/PersonalPromptPage.tsx, desktop/tests/personal-prompt-layout-regression.test.ts]

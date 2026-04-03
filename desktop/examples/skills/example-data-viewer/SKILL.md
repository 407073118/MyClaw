---
name: Data Viewer
description: 示例技能 — 在右侧面板中展示数据表格
---

这是一个 WebPanel 示例技能。触发后会在右侧面板中展示一个数据表格。

该技能演示了 Skill + view.html 的模板化展示机制：
- `view.html` 负责纯展示（使用 Vue 3 CDN）
- 数据通过 `postMessage` 从宿主注入
- 面板支持刷新、关闭、拖拽调宽

---
name: Skills 样例
description: 完整示例 — 多页面、多数据源、带回调交互的 Skill 开发模板
---

# Skills 样例（Skill 开发完整示例）

这是一个**实战级别**的 Skill 示例，展示了所有核心能力。开发者可以直接复制本目录作为模板。

## 功能清单

1. **团队总览** (`view.html`) — 默认首页，展示团队成员卡片 + 项目状态摘要
2. **数据报表** (`report.html`) — 柱状图 + 折线图，纯 Canvas 绘制，无第三方依赖
3. **操作日志** (`logs.html`) — 实时日志流，演示 skill-update 增量推送

## 数据文件

- `data/team.json` — 团队成员数据
- `data/metrics.json` — 项目指标数据（代码行数、Bug 数、部署次数等）
- `data/logs.json` — 操作日志记录

## 如何通过对话触发

用户对 AI 说：

- "打开Skills 样例" → AI 调用本技能，展示 view.html
- "看看项目数据报表" → AI 调用本技能并指定打开 report.html
- "查看最近的操作日志" → AI 调用本技能并指定打开 logs.html

## 开发者须知

### 数据流

```
AI 调用技能 → 读取 data/*.json → 通过 postMessage 发送给 HTML
                                    ↓
                              HTML 渲染数据
                                    ↓
                         用户点击按钮 → postMessage 回调
                                    ↓
                              宿主接收回调
```

### postMessage 协议

**宿主 → HTML（接收数据）：**
```javascript
window.addEventListener("message", (e) => {
  if (e.data.type === "skill-data")     // 首次完整数据
  if (e.data.type === "skill-update")   // 增量更新
  if (e.data.type === "skill-progress") // 进度条
});
```

**HTML → 宿主（发送回调）：**
```javascript
window.parent.postMessage({
  type: "skill-callback",
  action: "navigate",          // 自定义动作名
  data: { page: "report.html" } // 附带数据
}, "*");
```

### 样式规范

所有页面统一使用暗色主题，配色参考：
- 背景 `#0c0c0c`，卡片 `#141414`
- 文字 `#ededed`，次要 `#a3a3a3`
- 强调 `#10a37f`（绿色）、`#3b82f6`（蓝色）、`#f59e0b`（橙色）
- 边框 `rgba(255,255,255,0.08)`

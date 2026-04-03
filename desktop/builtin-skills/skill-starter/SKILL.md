---
name: Skill 开发工坊
description: 从零开始学习 MyClaw Skill 开发 — 包含完整教程、4 个示范页面和可复制的项目模板
workspaceDir: null
---

# Skill 开发工坊

这是 MyClaw 内置的 **Skill 开发教学模板**，包含 4 个可交互的 HTML 页面，覆盖了 Skill 开发的所有核心场景。

你可以直接复制本目录，在此基础上构建自己的 Skill。

---

## 页面清单

| 页面 | 文件 | 说明 |
|------|------|------|
| 首页仪表盘 | `view.html` | 数据卡片 + 图表 + 导航，展示完整的数据驱动页面 |
| 开发指南 | `guide.html` | 交互式教程，包含代码示例和最佳实践 |
| 数据探索器 | `explorer.html` | 可搜索/可排序的数据表格，演示用户交互 |
| 实验场 | `playground.html` | 实时测试 postMessage 通信，发送/接收消息 |

---

## 目录结构

```
skill-starter/
├── SKILL.md              <- 必需：技能定义（就是本文件）
├── view.html             <- 默认首页：点击"打开面板"时加载
├── guide.html            <- 额外页面：开发指南
├── explorer.html         <- 额外页面：数据探索器
├── playground.html       <- 额外页面：通信实验场
├── data/                 <- 数据目录：存放 JSON 数据文件
│   └── projects.json     <- 示例数据
├── references/           <- 参考资料目录
│   └── postmessage-api.md
├── scripts/              <- 脚本目录（可放自动化脚本）
│   └── README.md
└── assets/               <- 静态资源目录（图片、图标等）
    └── README.md
```

检测到 `scripts/`、`references/`、`assets/` 子目录后，技能卡片上会显示对应标签。

---

## 核心概念

### 1. SKILL.md 是技能的大脑

`SKILL.md` 是唯一必需的文件。AI 调用技能时会读取它的内容作为上下文。

- `---` 之间的 YAML 区域定义元数据（name、description）
- 正文部分是 AI 看到的技能说明
- 可以在这里写指令、提示词、使用规则等

### 2. HTML 页面是技能的界面

当目录下存在 `.html` 文件时，技能卡片上会出现"打开面板"按钮。

- `view.html` 是默认首页
- 支持多个 HTML 页面，通过 postMessage 导航
- 页面在 iframe 中运行，可使用任意前端技术

### 3. postMessage 是通信桥梁

宿主与 HTML 页面通过 `postMessage` 双向通信：

**宿主 -> HTML（接收数据）：**

```javascript
window.addEventListener("message", (e) => {
  if (e.data.type === "skill-data")     // 首次完整数据
  if (e.data.type === "skill-update")   // 增量更新
  if (e.data.type === "skill-progress") // 进度通知
});
```

**HTML -> 宿主（发送回调）：**

```javascript
// 导航到其他页面
window.parent.postMessage({
  type: "skill-callback",
  action: "navigate",
  data: { page: "explorer.html" }
}, "*");

// 自定义回调
window.parent.postMessage({
  type: "skill-callback",
  action: "my-action",
  data: { key: "value" }
}, "*");
```

---

## 样式规范

所有页面统一使用暗色主题，与 MyClaw 界面融为一体：

```css
body {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #0c0c0c;
  color: #ededed;
}
```

| 用途 | 色值 | 说明 |
|------|------|------|
| 背景 | `#0c0c0c` | 主背景 |
| 卡片背景 | `#141414` | 卡片/区块 |
| 主文字 | `#ededed` | 标题、正文 |
| 次要文字 | `#a3a3a3` | 描述、标签 |
| 灰色文字 | `#737373` | 占位、提示 |
| 强调绿 | `#10a37f` | 品牌色、成功状态 |
| 信息蓝 | `#3b82f6` | 链接、进行中 |
| 警告橙 | `#f59e0b` | 注意、待处理 |
| 错误红 | `#ef4444` | 错误、危险 |
| 边框 | `rgba(255,255,255,0.08)` | 分割线、卡片边框 |

---

## 可用能力

HTML 页面运行在 iframe 中：

- 可以使用任意 CSS、JavaScript
- 可以引入 CDN 库（Vue、React、Chart.js、ECharts 等）
- 可以使用 Canvas、SVG 绘图
- 可以使用浏览器 API（剪贴板、录音等，需用户授权）
- 可以使用 localStorage（iframe 内独立存储）
- 不能直接访问 Node.js / Electron API
- 不能直接读写本地文件（需通过 postMessage 回调让宿主代为操作）

---

## 快速开始：创建你的第一个 Skill

1. **复制** 本目录，重命名为你的 Skill 名称
2. **修改** `SKILL.md` 的 name、description 和正文内容
3. **编辑** `view.html` 替换为你的界面
4. **删除** 不需要的页面和 `data/` 下的示例数据
5. 在 MyClaw 技能页面**刷新**，你的 Skill 就会出现

---
name: Skill 开发指南
description: 如何编写 MyClaw Skill — 包含完整结构说明和 view.html 模板
---

# MyClaw Skill 开发指南

## 什么是 Skill？

Skill 是 MyClaw 的扩展能力单元。每个 Skill 是一个文件夹，放在你的 `skills/` 目录下。
AI 对话时会自动识别并可以调用已启用的 Skill。

---

## 最简 Skill（纯文本）

```
my-skill/
└── SKILL.md          ← 唯一必需的文件
```

**SKILL.md** 格式：

```markdown
---
name: 我的技能
description: 一句话描述这个技能做什么
---

这里写技能的详细说明、指令、提示词等内容。
AI 调用此技能时会读取这段内容作为上下文。
```

- `---` 之间是 YAML 元数据（name 和 description）
- 下面的正文是 AI 看到的"技能内容"

---

## 带可视面板的 Skill

```
my-skill/
├── SKILL.md          ← 技能定义
└── view.html         ← 可视化页面（可选）
```

当 Skill 目录下存在 `view.html`，技能卡片上会出现"打开面板"按钮。
点击后会在右侧弹出 WebPanel，用 iframe 加载这个 HTML。

---

## view.html 开发规范

### 1. 接收数据

宿主通过 `postMessage` 向 iframe 发送数据：

```javascript
window.addEventListener("message", (event) => {
  const msg = event.data;

  if (msg.type === "skill-data") {
    // 首次加载数据，msg.payload 是宿主传入的对象
    console.log("收到数据:", msg.payload);
    // payload 包含: { skillId, skillName, ...你自定义的数据 }
  }

  if (msg.type === "skill-update") {
    // 增量更新数据
    console.log("数据更新:", msg.payload);
  }

  if (msg.type === "skill-progress") {
    // 进度通知: { current, total, message? }
    console.log(`进度: ${msg.current}/${msg.total}`);
  }
});
```

### 2. 向宿主发消息（回调）

```javascript
window.parent.postMessage({
  type: "skill-callback",
  action: "refresh",      // 自定义动作名
  data: { /* ... */ }     // 附带数据
}, "*");
```

### 3. 样式建议

- 背景色用 `#0c0c0c`（匹配 MyClaw 暗色主题）
- 文字色 `#ededed`，次要色 `#a3a3a3`
- 强调色 `#10a37f`（品牌绿）
- 边框 `rgba(255, 255, 255, 0.08)`
- 字体 `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`

### 4. 可用能力

view.html 运行在 iframe 中，可以使用：
- ✅ 任意 CSS / JavaScript
- ✅ CDN 库（Vue、React、Chart.js、ECharts 等）
- ✅ Canvas / SVG 绘图
- ✅ 浏览器 API（录音、摄像头、剪贴板等，需用户授权）
- ✅ localStorage（iframe 内独立）
- ❌ 不能直接访问 Node.js / Electron API
- ❌ 不能直接读写本地文件（需通过 postMessage 回调）

---

## 完整目录结构（可选子目录）

```
my-skill/
├── SKILL.md              ← 必需：技能定义
├── view.html             ← 可选：可视化面板页面
├── scripts/              ← 可选：脚本文件
├── references/           ← 可选：参考资料
├── assets/               ← 可选：图片等静态资源
├── tests/                ← 可选：测试文件
└── agents/               ← 可选：子 Agent 定义
```

检测到这些子目录后，技能卡片上会显示对应的标签。

---

## 示例：查看内置的 data-viewer 技能

同目录下的 `data-viewer` 技能是一个完整的可视化示例，包含：
- Vue 3 CDN 表格渲染
- 搜索过滤
- 状态标签高亮
- postMessage 数据接收

可以作为模板复制使用。

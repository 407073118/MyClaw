# WebPanel 功能开发计划

> Skill 驱动的右侧 Web 面板，用于展示本地数据的轻量页面

## 一、功能概述

在 MyClaw 桌面端实现一个**右侧可开关的 Web 面板**，由 Skill 触发打开。Skill 负责从本地文件夹收集/梳理数据，面板内的 `view.html` 纯展示，数据通过 `postMessage` 注入。

### 核心数据流

```
Skill 触发
  → scripts/collect.ts 扫描本地文件夹，输出 JSON 数据
  → Skill 执行结果携带 { openWebPanel: { viewPath, data, title } }
  → renderer 解析结果，调用 webPanelStore.open(...)
  → AppShell 右侧 WebPanel 组件显示
  → iframe 加载 view.html
  → iframe onload 后，主应用通过 postMessage 推送数据
  → view.html 接收数据，渲染页面
```

### Skill 目录结构

```
skills/
  └── employee-table/
      ├── SKILL.md              ← 技能定义（已有机制）
      ├── view.html             ← 展示模板（新增约定）
      └── scripts/
          └── collect.ts        ← 数据收集脚本（已有机制）
```

---

## 二、开发任务分解

### 任务 1：定义 WebPanel 合约类型

**文件：** `shared/contracts/web-panel.ts`

```typescript
/** Skill 执行结果中携带的面板打开指令 */
export interface OpenWebPanelPayload {
  /** view.html 的绝对路径 */
  viewPath: string;
  /** 面板标题 */
  title: string;
  /** 传给 view.html 的结构化数据 */
  data: unknown;
}

/** WebPanel 的运行时状态 */
export interface WebPanelState {
  isOpen: boolean;
  viewPath: string | null;
  title: string;
  data: unknown;
  panelWidth: number;
}
```

在 `shared/contracts/index.ts` 中导出。

**预计改动：** 新建 1 个文件，改 1 个文件

---

### 任务 2：扩展 SkillDefinition 合约

**文件：** `shared/contracts/skill.ts`

给 `SkillDefinition` 加一个字段：

```typescript
/** 该 Skill 目录下是否存在 view.html */
hasViewFile: boolean;
```

**预计改动：** 改 1 个文件

---

### 任务 3：Skill 加载时检测 view.html

**文件：** `src/main/index.ts`（`loadSkillsFromDisk` 函数）

在加载 Skill 时，检查目录下是否存在 `view.html`，设置 `hasViewFile` 字段。

```typescript
// 在 JSON 和 SKILL.md 两种格式的加载逻辑中，增加：
const hasViewFile = existsSync(join(fullPath, "view.html"))
                 || existsSync(join(parsed.path ?? fullPath, "view.html"));
```

**预计改动：** 改 1 个文件，约 5 行

---

### 任务 4：添加 IPC 处理器 — 解析 view 路径

**文件：** 新建 `src/main/ipc/web-panel.ts`

```typescript
import { ipcMain } from "electron";

export function registerWebPanelHandlers(ctx: RuntimeContext): void {
  // 返回 skill 的 view.html 绝对路径（供 renderer 构建 file:// URL）
  ipcMain.handle("web-panel:resolve-view", async (_event, skillId: string) => {
    const skill = ctx.state.skills.find(s => s.id === skillId);
    if (!skill) return null;
    const viewPath = join(skill.path, "view.html");
    return existsSync(viewPath) ? viewPath : null;
  });
}
```

在 `src/main/ipc/index.ts` 中注册。

**预计改动：** 新建 1 个文件，改 1 个文件

---

### 任务 5：扩展 Preload API

**文件：** `src/preload/index.ts`

在 `window.myClawAPI` 中添加：

```typescript
webPanel: {
  resolveView: (skillId: string) => ipcRenderer.invoke("web-panel:resolve-view", skillId),
},
```

**预计改动：** 改 1 个文件，约 5 行

---

### 任务 6：创建 WebPanel Store

**文件：** 在 `workspace.ts` store 中扩展（不新建独立 store，保持现有模式）

在 `WorkspaceState` 中添加：

```typescript
// WebPanel
webPanel: {
  isOpen: boolean;
  viewPath: string | null;
  title: string;
  data: unknown;
  panelWidth: number;
};

// Actions
openWebPanel: (viewPath: string, title: string, data: unknown) => void;
closeWebPanel: () => void;
setWebPanelWidth: (width: number) => void;
```

初始状态：

```typescript
webPanel: {
  isOpen: false,
  viewPath: null,
  title: "",
  data: null,
  panelWidth: 420,
},
```

**预计改动：** 改 1 个文件，约 30 行

---

### 任务 7：创建 WebPanel 组件

**文件：** 新建 `src/renderer/components/WebPanel.tsx`

核心功能：
- 顶部工具栏：标题 + 刷新按钮 + 关闭按钮
- iframe 区域：`src="file://{viewPath}"`
- iframe `onload` 后通过 `postMessage` 推送数据
- 可拖拽边框调整宽度

```tsx
export default function WebPanel() {
  const { webPanel, closeWebPanel } = useWorkspaceStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // iframe 加载完成后推送数据
  useEffect(() => {
    if (!webPanel.isOpen || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const handleLoad = () => {
      iframe.contentWindow?.postMessage(
        { type: "skill-data", payload: webPanel.data },
        "*"
      );
    };
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [webPanel.isOpen, webPanel.viewPath, webPanel.data]);

  if (!webPanel.isOpen) return null;

  return (
    <aside className="web-panel" style={{ width: webPanel.panelWidth }}>
      <div className="web-panel-toolbar">
        <span className="web-panel-title">{webPanel.title}</span>
        <button onClick={handleRefresh}>↻</button>
        <button onClick={closeWebPanel}>✕</button>
      </div>
      <iframe
        ref={iframeRef}
        src={`file://${webPanel.viewPath}`}
        className="web-panel-iframe"
        sandbox="allow-scripts allow-same-origin"
      />
    </aside>
  );
}
```

样式要点：
- 暗色主题，匹配现有 `--bg-card`、`--glass-border` 等变量
- 左边框可拖拽（resize handle）
- 工具栏高度 36px，iframe 填满剩余空间

**预计改动：** 新建 1 个文件，约 150 行

---

### 任务 8：修改 AppShell 布局

**文件：** `src/renderer/layouts/AppShell.tsx`

把现有的 `sidebar | shell-content` 布局改为 `sidebar | shell-content | WebPanel`：

```tsx
// 在 <section className="shell-content"> 之后添加：
<WebPanel />
```

CSS 调整：

```css
.shell {
  display: flex;  /* 已有 */
}

.shell-content {
  flex: 1;        /* 已有，自动收缩给 WebPanel 让位 */
  min-width: 0;   /* 已有 */
}

.web-panel {
  /* width 由 store 控制 */
  border-left: 1px solid var(--glass-border);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
}
```

由于 `.shell-content` 已经是 `flex: 1`，WebPanel 出现时它会自动缩小，不需要额外改动。

**预计改动：** 改 1 个文件，约 20 行（导入 WebPanel + 添加到 JSX + CSS）

---

### 任务 9：Skill 执行结果触发面板

**文件：** `src/main/ipc/sessions.ts`（或 Skill 执行相关逻辑）

当 Skill 的执行结果（tool output）中包含 `openWebPanel` 指令时，通过现有的 streaming 事件广播给 renderer：

```typescript
// 定义新的事件类型
EventType.WebPanelRequested = "web-panel-requested";

// 在 tool 执行结果处理中检测：
if (toolResult.openWebPanel) {
  broadcastToRenderers("session:stream", {
    type: EventType.WebPanelRequested,
    payload: toolResult.openWebPanel, // { viewPath, title, data }
  });
}
```

**Renderer 端监听：**

在 workspace store 的 streaming 事件处理中（`onSessionStream`），处理 `WebPanelRequested` 事件，调用 `openWebPanel()`。

**预计改动：** 改 2 个文件，约 20 行

---

### 任务 10：编写示例 Skill

**目录：** 在用户的 skills 目录下创建示例

```
example-data-viewer/
  ├── SKILL.md
  ├── view.html
  └── scripts/
      └── collect.ts
```

**SKILL.md：**
```markdown
---
name: Data Viewer
description: 扫描本地数据文件并在面板中展示
---

扫描指定目录下的数据文件，梳理后在右侧面板中展示表格。
```

**view.html：** 一个通用表格展示模板（Vue CDN），接收 `postMessage` 数据后渲染。

**collect.ts：** 示例数据收集脚本，扫描某个目录、读取文件列表、构建 JSON。

**预计改动：** 新建 3 个文件

---

## 三、布局示意

```
┌──────────────────────────────────────────────────────────┐
│  TitleBar                                                │
├────────┬───────────────────────────┬─────────────────────┤
│        │                           │ ┌─ WebPanel ──────┐ │
│  Side  │   shell-content           │ │ 标题    ↻  ✕   │ │
│  bar   │   (Chat / Hub / ...)      │ ├─────────────────┤ │
│        │                           │ │                 │ │
│ 240px  │       flex: 1             │ │  <iframe>       │ │
│        │   (自动收缩让位)           │ │  view.html      │ │
│        │                           │ │                 │ │
│        │                           │ │  postMessage    │ │
│        │                           │ │  ← JSON data    │ │
│        │                           │ └─────────────────┘ │
│        │                           │      420px          │
├────────┴───────────────────────────┴─────────────────────┤
```

---

## 四、开发顺序和依赖关系

```
阶段一：基础设施（可并行）
  ├── 任务 1：合约类型定义
  ├── 任务 2：SkillDefinition 扩展
  └── 任务 3：Skill 加载检测 view.html

阶段二：通道建设（依赖阶段一）
  ├── 任务 4：IPC 处理器
  └── 任务 5：Preload API

阶段三：UI 实现（依赖阶段二）
  ├── 任务 6：WebPanel Store
  ├── 任务 7：WebPanel 组件
  └── 任务 8：AppShell 布局修改

阶段四：集成串联（依赖阶段三）
  ├── 任务 9：Skill 执行触发面板
  └── 任务 10：示例 Skill
```

---

## 五、借鉴 Claude Code 的设计模式

> 参考项目：E:\claude-code（Anthropic 官方 CLI）

### 5.1 Tool UI 分离模式（已采用）

Claude Code 每个 Tool 都拆为 `Tool.ts`（逻辑）+ `UI.tsx`（渲染），完全解耦。
我们的 `scripts/collect.ts` + `view.html` 与之对齐，验证了方向正确。

### 5.2 SetToolJSXFn — 工具动态推送 UI（借鉴）

Claude Code 允许 Tool 在执行过程中通过 `setToolJSX()` 把 React 组件推送到主 UI：

```typescript
// Claude Code 的做法：
setToolJSX({ jsx: <ProgressDialog />, shouldHidePromptInput: true });
// 执行完：
setToolJSX(null);
```

**我们的对应实现：**
- `openWebPanel()` ≈ `setToolJSX({ jsx })`
- `closeWebPanel()` ≈ `setToolJSX(null)`
- Skill 脚本通过返回 `{ openWebPanel: {...} }` 触发，等价于 Tool 调用 `setToolJSX`

### 5.3 Progress Streaming — 多类型消息通道（借鉴）

Claude Code 的 Tool 支持持续广播进度事件，UI 实时响应。我们的 postMessage 通道也应支持多种消息类型：

```typescript
// view.html 中监听的消息类型：
type SkillMessage =
  | { type: "skill-data"; payload: unknown }        // 初始完整数据
  | { type: "skill-update"; payload: unknown }       // 增量数据更新
  | { type: "skill-progress"; current: number; total: number; message?: string } // 进度
  | { type: "skill-action"; action: string; params?: unknown }  // 宿主→面板的操作指令
```

宿主可以在 Skill 执行过程中多次推送消息，面板实时响应。

### 5.4 view.html 回传消息（借鉴双向通信）

参考 Claude Code 的 `handleElicitation` 模式，view.html 也应能回传消息给宿主：

```typescript
// view.html 中（面板→宿主）：
window.parent.postMessage({ type: "skill-callback", action: "submit", data: formData }, "*");

// WebPanel 组件中监听：
window.addEventListener("message", (e) => {
  if (e.data?.type === "skill-callback") {
    // 处理面板回传的数据（如表单提交、用户选择）
  }
});
```

这为未来的交互式面板（表单提交、录音上传等）预留了通道。

---

## 六、技术决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 嵌入方式 | `<iframe>` | 纯前端实现，零 main 进程复杂度，iframe 沙箱隔离 |
| 数据传递 | `postMessage`（多类型消息） | 标准 API，解耦模板与数据，支持初始数据/增量更新/进度/回传 |
| 面板模板 | 纯 HTML 文件 | 零构建，Skill 作者自由选择框架（Vue CDN / React CDN / 纯 JS） |
| 工具↔UI 分离 | `collect.ts` + `view.html` | 借鉴 Claude Code 的 `Tool.ts` + `UI.tsx` 模式 |
| 面板控制 | `openWebPanel()` / `closeWebPanel()` | 借鉴 Claude Code 的 `setToolJSX()` 模式 |
| 状态管理 | 扩展 workspace store | 保持现有单 store 模式，不引入新 store |
| 面板位置 | AppShell 右侧 | flex 布局天然支持，shell-content 自动收缩 |
| 备选升级路径 | WebContentsView | 若未来遇到 CSP 限制或需要注入 Header/Cookie，可升级 |

---

## 六、安全考虑

- iframe 使用 `sandbox="allow-scripts allow-same-origin"` 限制权限
- `postMessage` 发送时不指定 origin（`"*"`），因为是本地 `file://` 协议
- view.html 在 Skill 目录内，由用户/管理员管控，不加载不可信来源的文件
- Electron 主进程仅暴露 `resolve-view` 这一个只读 IPC，无写操作

---

## 七、未来扩展可能

- **双向通信：** view.html 通过 `postMessage` 回传操作结果给主应用（如表单提交）
- **多面板：** 支持同时打开多个 tab 式面板
- **模板市场：** 预置常用模板（表格、图表、表单），Skill 作者选模板填数据即可
- **录音/摄像头：** view.html 可调用浏览器多媒体 API（需 Electron 授权麦克风权限）
- **实时数据：** 通过 `postMessage` 持续推送更新，实现实时仪表盘

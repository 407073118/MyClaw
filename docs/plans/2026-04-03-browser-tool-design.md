# Browser Tool 设计方案

## 概述

为 MyClaw Desktop 新增内置 `browser.*` 工具组，让 AI 能直接操控浏览器完成网页自动化任务（E2E 测试、数据抓取、表单填写、UI 调试等）。

底层使用 `playwright-core` 连接系统已安装的 Chrome/Edge，按需启停，零配置开箱即用。

---

## 架构设计

### 整体位置

```
现有 builtin tools:   fs.* | exec.* | git.* | http.* | web.* | task.*
新增:                 browser.*
```

与现有 tool 完全平级，复用同一套 schema → approval → executor → result 流程。

### 组件关系

```
tool-schemas.ts          → 生成 browser_* function schema（OpenAI 格式）
       ↓
sessions.ts agentic loop → 模型返回 tool_call → functionNameToToolId("browser_open") → "browser.open"
       ↓
builtin-tool-executor.ts → dispatch("browser.open", label, cwd) → 委托给 BrowserService
       ↓
browser-service.ts (新)  → 管理 Playwright browser 生命周期 + 执行具体操作
       ↓
playwright-core           → 通过 CDP 控制系统 Chrome/Edge
```

---

## BrowserService 设计

### 文件位置

`desktop/src/main/services/browser-service.ts`

### 核心职责

1. **Lazy launch** — 首次调用时启动浏览器，非首次直接复用
2. **自动关闭** — 空闲 5 分钟后自动 close browser 释放资源
3. **异常恢复** — 浏览器 crash 后下次调用自动重新启动
4. **单例管理** — 全局一个 browser 实例，多个 tab（page）

### 接口设计

```typescript
class BrowserService {
  // 生命周期
  private browser: Browser | null = null;
  private page: Page | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 分钟

  // 确保浏览器可用（lazy launch + crash recovery）
  private async ensureBrowser(): Promise<Page>

  // 重置空闲计时器
  private resetIdleTimer(): void

  // 关闭浏览器
  async close(): Promise<void>

  // ── tool 实现 ──────────────────────────────────────
  async open(url: string): Promise<ToolExecutionResult>
  async snapshot(): Promise<ToolExecutionResult>
  async click(selector: string): Promise<ToolExecutionResult>
  async type(selector: string, text: string): Promise<ToolExecutionResult>
  async screenshot(): Promise<ToolExecutionResult>
  async evaluate(expression: string): Promise<ToolExecutionResult>
  async select(selector: string, values: string[]): Promise<ToolExecutionResult>
  async hover(selector: string): Promise<ToolExecutionResult>
  async back(): Promise<ToolExecutionResult>
  async forward(): Promise<ToolExecutionResult>
  async wait(milliseconds: number): Promise<ToolExecutionResult>
}
```

### 浏览器探测逻辑

```typescript
async function findBrowserChannel(): Promise<string> {
  // Windows: 优先 Edge（100% 预装），其次 Chrome
  // macOS: 优先 Chrome，其次 Edge
  // Linux: 优先 Chromium，其次 Chrome

  // 1. 检测 msedge
  // 2. 检测 chrome
  // 3. 检测 chromium
  // 4. 都没有 → 抛出友好错误提示用户安装浏览器
}
```

---

## Tool 清单

### 核心 Tools（11 个）

| tool id | 函数名 | 说明 | risk | approvalMode |
|---------|--------|------|------|-------------|
| `browser.open` | `browser_open` | 导航到指定 URL | Network | always-ask |
| `browser.snapshot` | `browser_snapshot` | 获取页面 accessibility tree（结构化文本） | Read | inherit |
| `browser.click` | `browser_click` | 点击指定元素 | Write | always-ask |
| `browser.type` | `browser_type` | 在输入框中键入文本 | Write | always-ask |
| `browser.screenshot` | `browser_screenshot` | 截取当前页面截图 | Read | inherit |
| `browser.evaluate` | `browser_evaluate` | 在页面上下文执行 JavaScript | Exec | always-ask |
| `browser.select` | `browser_select` | 选择下拉框选项 | Write | always-ask |
| `browser.hover` | `browser_hover` | 悬停在指定元素上 | Write | always-ask |
| `browser.back` | `browser_back` | 浏览器后退 | Write | always-ask |
| `browser.forward` | `browser_forward` | 浏览器前进 | Write | always-ask |
| `browser.wait` | `browser_wait` | 等待指定毫秒数 | Read | inherit |

### 为什么用 accessibility snapshot 而不是截图

参考 Playwright MCP 和 OpenClaw 的经验：

1. **token 效率**：accessibility tree 是文本，一个页面约 2000-5000 token；截图转 base64 约 50000+ token
2. **模型兼容性**：所有模型都能处理文本；图片需要视觉能力（不是所有模型都有）
3. **精确性**：tree 包含 role、name、value，AI 能精确定位元素；截图靠坐标容易偏移
4. **你的需求**：OpenAI 和 Anthropic 的模型都能调用 — 纯文本 tool 没有兼容性问题

### Screenshot 作为补充

`browser.screenshot` 仍然提供，用于：
- 视觉验证（"页面看起来对不对"）
- 调试 UI 问题
- 返回 base64 图片，模型可选择是否解读

---

## Tool Schema 定义

添加到 `tool-schemas.ts` 的 `buildToolSchemas()` 中：

```typescript
// ── browser.* ──────────────────────────────────────────────
{
  type: "function",
  function: {
    name: "browser_open",
    description: "在浏览器中打开指定 URL。如果浏览器尚未启动，会自动启动系统 Chrome/Edge。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "要打开的 URL（http/https）" },
      },
      required: ["url"],
    },
  },
},
{
  type: "function",
  function: {
    name: "browser_snapshot",
    description: [
      "获取当前页面的 accessibility tree（无障碍树）快照。",
      "返回页面上所有可见元素的结构化文本表示，包含 role、name、value。",
      "用这个工具来理解页面结构和内容，而不是截图。",
      "输出中的元素引用（如 [ref=42]）可以直接用于 browser_click、browser_type 等工具。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "可选：只获取匹配此 CSS 选择器的子树。省略则获取整个页面。",
        },
      },
      required: [],
    },
  },
},
{
  type: "function",
  function: {
    name: "browser_click",
    description: "点击页面上的元素。可以使用 CSS 选择器、文本内容、或 accessibility snapshot 中的 ref 引用。",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: '要点击的元素。支持：CSS 选择器（如 "button.submit"）、文本匹配（如 "text=登录"）、ref 引用（如 "ref=42"）。',
        },
      },
      required: ["selector"],
    },
  },
},
{
  type: "function",
  function: {
    name: "browser_type",
    description: "在输入框中键入文本。会先清空输入框再输入。",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: '目标输入框。支持：CSS 选择器、文本匹配、ref 引用。',
        },
        text: {
          type: "string",
          description: "要输入的文本内容",
        },
        pressEnter: {
          type: "boolean",
          description: "输入完成后是否按回车键。默认 false。",
        },
      },
      required: ["selector", "text"],
    },
  },
},
{
  type: "function",
  function: {
    name: "browser_screenshot",
    description: "截取当前页面的截图，返回 base64 编码的 PNG 图片。用于视觉验证或 UI 调试。",
    parameters: {
      type: "object",
      properties: {
        fullPage: {
          type: "boolean",
          description: "是否截取完整页面（包括滚动区域）。默认 false 只截取视口。",
        },
      },
      required: [],
    },
  },
},
{
  type: "function",
  function: {
    name: "browser_evaluate",
    description: "在页面上下文中执行 JavaScript 表达式并返回结果。用于提取数据、检查状态等。",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "要执行的 JavaScript 表达式。结果会被 JSON.stringify 后返回。",
        },
      },
      required: ["expression"],
    },
  },
},
{
  type: "function",
  function: {
    name: "browser_select",
    description: "选择下拉框（<select>）中的选项。",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "目标 <select> 元素的选择器" },
        values: {
          type: "array",
          items: { type: "string" },
          description: "要选择的选项值（value 属性或显示文本）",
        },
      },
      required: ["selector", "values"],
    },
  },
},
{
  type: "function",
  function: {
    name: "browser_hover",
    description: "将鼠标悬停在指定元素上。用于触发悬停菜单、提示框等。",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "目标元素的选择器、文本匹配或 ref 引用" },
      },
      required: ["selector"],
    },
  },
},
{
  type: "function",
  function: {
    name: "browser_back",
    description: "浏览器后退到上一页。",
    parameters: { type: "object", properties: {}, required: [] },
  },
},
{
  type: "function",
  function: {
    name: "browser_forward",
    description: "浏览器前进到下一页。",
    parameters: { type: "object", properties: {}, required: [] },
  },
},
{
  type: "function",
  function: {
    name: "browser_wait",
    description: "等待指定毫秒数。用于等待页面加载或动画完成。",
    parameters: {
      type: "object",
      properties: {
        milliseconds: {
          type: "number",
          description: "等待时间（毫秒），最大 30000（30 秒）",
        },
      },
      required: ["milliseconds"],
    },
  },
},
```

---

## Tool Stubs 注册

添加到 `builtin-tool-stubs.ts`：

```typescript
// browser group
{ id: "browser.open", name: "打开网页", description: "在浏览器中打开指定 URL。", group: "browser", risk: ToolRiskCategory.Network, requiresAttachedDirectory: false, enabled: true, exposedToModel: true, effectiveApprovalMode: "always-ask" },
{ id: "browser.snapshot", name: "页面快照", description: "获取页面 accessibility tree 快照。", group: "browser", risk: ToolRiskCategory.Read, requiresAttachedDirectory: false, enabled: true, exposedToModel: true, effectiveApprovalMode: "inherit" },
{ id: "browser.click", name: "点击元素", description: "点击页面上的指定元素。", group: "browser", risk: ToolRiskCategory.Write, requiresAttachedDirectory: false, enabled: true, exposedToModel: true, effectiveApprovalMode: "always-ask" },
{ id: "browser.type", name: "输入文本", description: "在输入框中键入文本。", group: "browser", risk: ToolRiskCategory.Write, requiresAttachedDirectory: false, enabled: true, exposedToModel: true, effectiveApprovalMode: "always-ask" },
{ id: "browser.screenshot", name: "页面截图", description: "截取当前页面截图。", group: "browser", risk: ToolRiskCategory.Read, requiresAttachedDirectory: false, enabled: true, exposedToModel: true, effectiveApprovalMode: "inherit" },
{ id: "browser.evaluate", name: "执行脚本", description: "在页面上下文执行 JavaScript。", group: "browser", risk: ToolRiskCategory.Exec, requiresAttachedDirectory: false, enabled: true, exposedToModel: true, effectiveApprovalMode: "always-ask" },
{ id: "browser.select", name: "选择选项", description: "选择下拉框选项。", group: "browser", risk: ToolRiskCategory.Write, requiresAttachedDirectory: false, enabled: true, exposedToModel: true, effectiveApprovalMode: "always-ask" },
{ id: "browser.hover", name: "悬停元素", description: "将鼠标悬停在指定元素上。", group: "browser", risk: ToolRiskCategory.Write, requiresAttachedDirectory: false, enabled: true, exposedToModel: true, effectiveApprovalMode: "always-ask" },
{ id: "browser.back", name: "后退", description: "浏览器后退到上一页。", group: "browser", risk: ToolRiskCategory.Write, requiresAttachedDirectory: false, enabled: true, exposedToModel: true, effectiveApprovalMode: "always-ask" },
{ id: "browser.forward", name: "前进", description: "浏览器前进到下一页。", group: "browser", risk: ToolRiskCategory.Write, requiresAttachedDirectory: false, enabled: true, exposedToModel: true, effectiveApprovalMode: "always-ask" },
{ id: "browser.wait", name: "等待", description: "等待指定时间。", group: "browser", risk: ToolRiskCategory.Read, requiresAttachedDirectory: false, enabled: true, exposedToModel: true, effectiveApprovalMode: "inherit" },
```

需要在 `BUILTIN_TOOL_GROUPS` 中添加 `"browser"`。

---

## BuiltinToolExecutor 集成

在 `dispatch()` 方法中添加 browser 分支：

```typescript
// browser.*
if (toolId.startsWith("browser.")) {
  return this.executeBrowser(toolId, label);
}
```

`executeBrowser` 解析 JSON label，委托给 BrowserService：

```typescript
private async executeBrowser(toolId: string, label: string): Promise<ToolExecutionResult> {
  const args = JSON.parse(label);
  const action = toolId.split(".")[1]; // open, snapshot, click, type, ...

  switch (action) {
    case "open":
      return this.browserService.open(args.url);
    case "snapshot":
      return this.browserService.snapshot(args.selector);
    case "click":
      return this.browserService.click(args.selector);
    case "type":
      return this.browserService.type(args.selector, args.text, args.pressEnter);
    case "screenshot":
      return this.browserService.screenshot(args.fullPage);
    case "evaluate":
      return this.browserService.evaluate(args.expression);
    case "select":
      return this.browserService.select(args.selector, args.values);
    case "hover":
      return this.browserService.hover(args.selector);
    case "back":
      return this.browserService.back();
    case "forward":
      return this.browserService.forward();
    case "wait":
      return this.browserService.wait(args.milliseconds);
    default:
      return { success: false, output: "", error: `未知浏览器操作: ${action}` };
  }
}
```

---

## Accessibility Snapshot 输出格式

参考 Playwright MCP 的格式，返回可被 AI 直接理解的结构化文本：

```
[ref=1] page "MyClaw - Login"
  [ref=2] heading "Welcome Back"
  [ref=3] textbox "Username" value=""
  [ref=4] textbox "Password" value=""
  [ref=5] button "Sign In"
  [ref=6] link "Forgot password?"
  [ref=7] paragraph "Don't have an account?"
    [ref=8] link "Sign up"
```

AI 看到这个输出后可以直接调用：
- `browser_click({ selector: "ref=5" })` — 点击登录按钮
- `browser_type({ selector: "ref=3", text: "admin" })` — 输入用户名

输出截断策略：snapshot 超过 15000 字符时截断并提示使用 `selector` 参数缩小范围。

---

## 依赖管理

### 新增依赖

```json
{
  "dependencies": {
    "playwright-core": "^1.52.0"
  }
}
```

- `playwright-core` 约 3MB，不包含浏览器二进制
- 运行时连接系统已安装的 Chrome/Edge
- Windows 100% 有 Edge，macOS 大概率有 Chrome

### 与 Electron 的兼容性

`playwright-core` 在 Electron 主进程中运行没有冲突：
- 它启动独立的浏览器进程（不是 Electron 的 webContents）
- 通过 CDP（Chrome DevTools Protocol）通信
- 与 Electron 渲染进程完全隔离

---

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| 找不到系统浏览器 | 返回友好错误："未找到 Chrome 或 Edge 浏览器，请安装后重试" |
| 浏览器启动失败 | 返回错误信息 + 建议检查是否有其他程序占用 |
| 浏览器进程 crash | 下次调用时自动重新启动（ensureBrowser 检测 isConnected） |
| 页面加载超时 | 30 秒超时，返回错误 + 当前 URL |
| 元素未找到 | 返回错误 + 当前页面 snapshot 的前 2000 字符帮助 AI 调整选择器 |
| JavaScript 执行错误 | 返回 error stack |
| 空闲超时关闭 | 静默关闭，下次调用自动重启，用户无感 |

---

## 安全控制

1. **审批机制** — `browser.open`（Network）、`browser.click/type/evaluate` 等写操作（Write/Exec）全部走 always-ask 审批
2. **URL 白名单**（可选未来扩展） — 可在设置中限制允许访问的域名
3. **evaluate 沙盒** — JavaScript 在浏览器页面上下文执行，不能访问 Node.js/Electron API
4. **output 截断** — snapshot 和 evaluate 结果超过 15000 字符截断，防止 context 爆炸
5. **wait 上限** — `browser.wait` 最大 30 秒，防止无限等待

---

## 实施步骤

### Phase 1: 基础设施
1. `shared/contracts/builtin-tool.ts` — BUILTIN_TOOL_GROUPS 添加 `"browser"`
2. `builtin-tool-stubs.ts` — 添加 11 个 browser tool stub
3. `tool-schemas.ts` — 添加 browser_* function schema
4. 安装 `playwright-core` 依赖

### Phase 2: BrowserService
5. 新建 `browser-service.ts` — 实现 BrowserService 类
6. 浏览器探测逻辑（Chrome/Edge/Chromium）
7. Lazy launch + 空闲关闭 + crash recovery
8. Accessibility snapshot 输出格式化

### Phase 3: 集成
9. `builtin-tool-executor.ts` — 添加 browser.* dispatch
10. `tool-schemas.ts` — 添加 buildToolLabel 的 browser 分支
11. `sessions.ts` — 确保 browser tool 走正确的 approval 流程

### Phase 4: 验证
12. 手动测试：open → snapshot → click → type → screenshot 基本流程
13. 边界测试：无浏览器、超时、crash 恢复

---

## 模型兼容性

由于所有 tool schema 使用 **OpenAI function calling 格式**，而 MyClaw 的 model-client 统一通过 `/chat/completions` 调用：
- **OpenAI 系模型**（GPT-4、Qwen 等）→ 原生支持 function calling ✅
- **Anthropic 模型**（Claude）→ 通过 OpenAI 兼容 API 转换后也支持 ✅
- **任何 OpenAI 兼容 API** → 都支持 ✅

所有 browser tool 的参数和返回值都是纯文本/JSON，不依赖任何模型特有的能力（如视觉）。screenshot 是可选的补充，不影响核心流程。

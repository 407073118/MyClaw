# Browser Service 全面修复计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 `browser-service.ts` 中的所有已知 bug、功能缺失和模型可用性问题，使 browser.* 工具集真正可被 AI 模型有效使用。

**Architecture:** 分三层修复 —— (1) BrowserService 核心方法修复与新增 (2) tool-schemas.ts 工具定义同步 (3) builtin-tool-executor.ts 分发逻辑同步 + builtin-tool-stubs.ts 元数据。所有改动集中在 `desktop/src/main/services/` 和 `desktop/src/main/ipc/sessions.ts`。

**Tech Stack:** TypeScript, Playwright-core, Electron main process, OpenAI function calling schema

**涉及文件总览:**
- `desktop/src/main/services/browser-service.ts` — 核心修复
- `desktop/src/main/services/tool-schemas.ts` — 新增工具 schema + 修正描述
- `desktop/src/main/services/builtin-tool-executor.ts` — 新增分发分支
- `desktop/src/main/services/builtin-tool-stubs.ts` — 新增工具元数据
- `desktop/src/main/ipc/sessions.ts` — screenshot 多模态支持
- `desktop/src/main/services/model-client.ts` — ChatMessage 类型扩展
- `desktop/tests/browser-service.test.ts` — 新建测试文件

---

## Task 1: 修复 ref 查找失败回退到无意义选择器

**问题:** `resolveSelector()` 在 refMap 找不到 ref 编号时回退到 `text=ref=42`，永远匹配不到任何元素。

**Files:**
- Modify: `desktop/src/main/services/browser-service.ts:84-108`

**Step 1: 修改 resolveSelector 的 ref 失败回退逻辑**

将 `browser-service.ts` 中的：

```ts
    return `text=${trimmed}`;
```

替换为：

```ts
    throw new Error(
      `ref=${refNum} 已失效。页面可能已导航或更新，请重新调用 browser_snapshot 获取最新元素引用。`
    );
```

**Step 2: 在 click/type/hover/select 中捕获 resolveSelector 异常**

这些方法已经有 try/catch 包裹 Playwright 操作，`resolveSelector` 抛出的异常会被自然捕获并返回错误信息。验证一下 `click` 方法的 catch 块确实能正确传递这个新的 Error message（是的，它用 `err instanceof Error ? err.message : String(err)`）。无需额外改动。

**Step 3: Commit**

```bash
git add desktop/src/main/services/browser-service.ts
git commit -m "fix(browser): ref lookup失败时抛出明确错误而非回退到无意义选择器"
```

---

## Task 2: 导航时自动清空 refMap 防止脏数据

**问题:** `open()` / `back()` / `forward()` 导航后 refMap 保留旧页面数据，模型用旧 ref 点击新页面会产生错误行为。

**Files:**
- Modify: `desktop/src/main/services/browser-service.ts:395-415` (open)
- Modify: `desktop/src/main/services/browser-service.ts:610-619` (back)
- Modify: `desktop/src/main/services/browser-service.ts:621-630` (forward)

**Step 1: 添加 invalidateRefs 私有方法**

在 `BrowserService` class 中，`close()` 方法之后添加：

```ts
  /** Invalidate stale refs after navigation. */
  private invalidateRefs(): void {
    this.refMap.clear();
    this.refCounter = 0;
  }
```

**Step 2: 在 open/back/forward 成功后调用 invalidateRefs**

`open()` 方法中，在 `const status = response?.status() ...` 之前添加：

```ts
      this.invalidateRefs();
```

`back()` 方法中，在 `const title = await page.title()` 之前添加：

```ts
      this.invalidateRefs();
```

`forward()` 方法中，同理在 `const title = await page.title()` 之前添加：

```ts
      this.invalidateRefs();
```

**Step 3: 在 open/back/forward 的返回消息中加提示**

修改 `open()` 的成功返回：

```ts
      return {
        success: true,
        output: `已打开: ${url}\n状态码: ${status}\n页面标题: ${title}\n\n提示: 页面已导航，之前的元素引用(ref=N)已失效。请调用 browser_snapshot 获取新的元素引用。`,
      };
```

类似地，`back()` 和 `forward()` 也加上此提示。

**Step 4: Commit**

```bash
git add desktop/src/main/services/browser-service.ts
git commit -m "fix(browser): 导航后自动清空refMap并提示模型重新snapshot"
```

---

## Task 3: 新增 browser_scroll 工具

**问题:** 模型无法滚动页面，无法查看视口外内容或触发懒加载。

**Files:**
- Modify: `desktop/src/main/services/browser-service.ts` — 新增 `scroll()` 方法
- Modify: `desktop/src/main/services/tool-schemas.ts` — 新增 schema
- Modify: `desktop/src/main/services/builtin-tool-executor.ts` — 新增分发
- Modify: `desktop/src/main/services/builtin-tool-stubs.ts` — 新增元数据

**Step 1: 在 BrowserService 中添加 scroll 方法**

在 `wait()` 方法之后添加：

```ts
  async scroll(
    direction: "up" | "down" | "left" | "right" = "down",
    amount: number = 3,
    selector?: string,
  ): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    try {
      const target = selector
        ? page.locator(resolveSelector(selector, this.refMap)).first()
        : page;

      const deltaX = direction === "left" ? -100 * amount : direction === "right" ? 100 * amount : 0;
      const deltaY = direction === "up" ? -100 * amount : direction === "down" ? 100 * amount : 0;

      if (selector) {
        await (target as any).hover({ timeout: ACTION_TIMEOUT_MS });
      }

      await page.mouse.wheel(deltaX, deltaY);
      await page.waitForTimeout(300);

      return {
        success: true,
        output: `已滚动: 方向=${direction}, 幅度=${amount}${selector ? `, 目标=${selector}` : ""}`,
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `滚动失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
```

**Step 2: 在 tool-schemas.ts 中添加 browser_scroll schema**

在 `browser_wait` schema 之后添加：

```ts
    {
      type: "function",
      function: {
        name: "browser_scroll",
        description: "Scroll the page or a specific element. Use to reveal content below the fold or trigger lazy loading.",
        parameters: {
          type: "object",
          properties: {
            direction: {
              type: "string",
              enum: ["up", "down", "left", "right"],
              description: "Scroll direction. Default 'down'.",
            },
            amount: {
              type: "number",
              description: "Number of scroll ticks (1-10). Default 3. Each tick ≈ 100px.",
            },
            selector: {
              type: "string",
              description: "Optional: scroll within a specific scrollable element instead of the page.",
            },
          },
          required: [],
        },
      },
    },
```

**Step 3: 在 builtin-tool-executor.ts 的 executeBrowser switch 中添加分支**

在 `case "wait":` 之后添加：

```ts
      case "scroll":
        return this.browserService.scroll(
          (args.direction as "up" | "down" | "left" | "right") ?? "down",
          Number(args.amount ?? 3),
          args.selector ? String(args.selector) : undefined,
        );
```

**Step 4: 在 builtin-tool-stubs.ts 中添加元数据**

在 `browser.wait` 条目之后添加：

```ts
  {
    id: "browser.scroll",
    name: "滚动页面",
    description: "滚动页面或指定元素，用于查看视口外内容。",
    group: "browser",
    risk: ToolRiskCategory.Write,
    requiresAttachedDirectory: false,
    enabled: true,
    exposedToModel: true,
    effectiveApprovalMode: "inherit",
  },
```

**Step 5: Commit**

```bash
git add desktop/src/main/services/browser-service.ts desktop/src/main/services/tool-schemas.ts desktop/src/main/services/builtin-tool-executor.ts desktop/src/main/services/builtin-tool-stubs.ts
git commit -m "feat(browser): 新增 browser_scroll 工具支持页面滚动"
```

---

## Task 4: 新增 browser_press_key 工具

**问题:** 模型只能按 Enter（通过 browser_type 的 pressEnter 参数），无法按 Escape/Tab/方向键等关键操作键。

**Files:**
- Modify: `desktop/src/main/services/browser-service.ts` — 新增 `pressKey()` 方法
- Modify: `desktop/src/main/services/tool-schemas.ts` — 新增 schema
- Modify: `desktop/src/main/services/builtin-tool-executor.ts` — 新增分发
- Modify: `desktop/src/main/services/builtin-tool-stubs.ts` — 新增元数据

**Step 1: 在 BrowserService 中添加 pressKey 方法**

在 `scroll()` 方法之后添加：

```ts
  async pressKey(key: string): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();

    // Whitelist safe key names to prevent injection of arbitrary key sequences
    const ALLOWED_KEYS = new Set([
      "Enter", "Escape", "Tab", "Backspace", "Delete",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "Home", "End", "PageUp", "PageDown",
      "Space", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
    ]);

    // Also allow modifier combos like "Control+a", "Meta+c"
    const ALLOWED_MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta"]);

    const parts = key.split("+").map((p) => p.trim());
    const mainKey = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);

    // Validate: modifiers must be in allowed set, main key must be in allowed set or a single character
    const isSingleChar = mainKey.length === 1;
    if (!ALLOWED_KEYS.has(mainKey) && !isSingleChar) {
      return {
        success: false,
        output: `允许的按键: ${[...ALLOWED_KEYS].join(", ")}，或 Modifier+单字符（如 Control+a）`,
        error: `不支持的按键: ${mainKey}`,
      };
    }
    for (const mod of modifiers) {
      if (!ALLOWED_MODIFIERS.has(mod)) {
        return {
          success: false,
          output: `允许的修饰键: ${[...ALLOWED_MODIFIERS].join(", ")}`,
          error: `不支持的修饰键: ${mod}`,
        };
      }
    }

    try {
      await page.keyboard.press(key);
      await page.waitForTimeout(200);
      return { success: true, output: `已按下: ${key}` };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `按键失败 (${key}): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
```

**Step 2: 在 tool-schemas.ts 中添加 browser_press_key schema**

在 `browser_scroll` schema 之后添加：

```ts
    {
      type: "function",
      function: {
        name: "browser_press_key",
        description: "Press a keyboard key or shortcut. Supports Escape, Tab, ArrowDown, Backspace, Delete, Enter, and modifier combos like Control+a, Meta+c.",
        parameters: {
          type: "object",
          properties: {
            key: {
              type: "string",
              description: 'Key name (e.g. "Escape", "Tab", "ArrowDown") or combo (e.g. "Control+a", "Shift+Tab").',
            },
          },
          required: ["key"],
        },
      },
    },
```

**Step 3: 在 builtin-tool-executor.ts 的 executeBrowser switch 中添加分支**

在 `case "scroll":` 之后添加：

```ts
      case "press_key":
        return this.browserService.pressKey(String(args.key ?? ""));
```

**Step 4: 在 builtin-tool-stubs.ts 中添加元数据**

```ts
  {
    id: "browser.press_key",
    name: "按键操作",
    description: "按下键盘按键或快捷键组合（如 Escape、Tab、Control+a）。",
    group: "browser",
    risk: ToolRiskCategory.Write,
    requiresAttachedDirectory: false,
    enabled: true,
    exposedToModel: true,
    effectiveApprovalMode: "always-ask",
  },
```

**Step 5: 确保 functionNameToToolId 正确转换**

`browser_press_key` → `replace(/_/g, ".")` → `browser.press.key` ← **BUG!** 会变成三段而非两段！

`executeBrowser` 中 `const action = toolId.split(".")[1]` 只取第二段 `"press"`，不是 `"press_key"`。

**修复方案:** 修改 `builtin-tool-executor.ts` 中的 `executeBrowser` 方法，将 action 提取方式改为：

```ts
    const action = toolId.slice("browser.".length);  // "press_key" instead of split(".")[1]
```

同时修改 `functionNameToToolId`，对 `browser_` 开头的名称做特殊处理：

```ts
export function functionNameToToolId(name: string): string {
  if (name.startsWith("skill_invoke__")) {
    return name;
  }
  if (name === "skill_view") {
    return "skill.view";
  }
  // browser tools: only replace the first underscore (after "browser")
  if (name.startsWith("browser_")) {
    return "browser." + name.slice("browser_".length);
  }
  return name.replace(/_/g, ".");
}
```

这样 `browser_press_key` → `browser.press_key`，action 提取为 `press_key`。

**注意:** 这个修改对已有 browser 工具无影响（`browser_open` → `browser.open`，因为 `"open"` 不含 `_`）。

**Step 6: Commit**

```bash
git add desktop/src/main/services/browser-service.ts desktop/src/main/services/tool-schemas.ts desktop/src/main/services/builtin-tool-executor.ts desktop/src/main/services/builtin-tool-stubs.ts
git commit -m "feat(browser): 新增 browser_press_key 工具支持键盘操作"
```

---

## Task 5: 修复 screenshot 工具 — 返回 base64 供多模态模型使用

**问题:** 当前 screenshot 只保存文件返回路径，模型完全无法查看图片内容。

**分析:** `ChatMessage.content` 当前只是 `string` 类型。要支持多模态，需要扩展为支持 OpenAI content array 格式。但这改动面大。**务实方案：** 让 screenshot 返回一个紧凑的 base64 JPEG（低质量压缩控制在 ~50KB 以内），对于支持 vision 的模型直接拼入消息；对于不支持的模型则保持当前行为。

**Files:**
- Modify: `desktop/src/main/services/browser-service.ts:495-534` — 改为返回 JPEG base64
- Modify: `desktop/src/main/services/builtin-tool-executor.ts` — ToolExecutionResult 新增 imageBase64 可选字段
- Modify: `desktop/src/main/services/model-client.ts:12-22` — ChatMessage.content 支持 content array
- Modify: `desktop/src/main/ipc/sessions.ts:597-600` — screenshot 结果构造多模态消息

**Step 1: 扩展 ToolExecutionResult 类型**

在 `builtin-tool-executor.ts` 的 `ToolExecutionResult` 类型中增加可选字段：

```ts
export type ToolExecutionResult = {
  success: boolean;
  output: string;
  error?: string;
  /** Base64-encoded image for screenshot results. */
  imageBase64?: string;
  viewMeta?: {
    viewPath: string;
    title: string;
    data: unknown;
  };
};
```

**Step 2: 修改 BrowserService.screenshot 返回 JPEG base64**

替换 `browser-service.ts` 的整个 `screenshot` 方法：

```ts
  async screenshot(fullPage?: boolean): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    try {
      // Use JPEG at quality 50 to keep size small (~30-80KB for typical pages)
      const buffer = await page.screenshot({
        type: "jpeg",
        quality: 50,
        fullPage: fullPage ?? false,
      });

      const base64 = buffer.toString("base64");
      const title = await page.title();
      const sizeKB = Math.round(buffer.length / 1024);

      return {
        success: true,
        output: [
          `[截图]`,
          `页面: ${title}`,
          `URL: ${page.url()}`,
          `尺寸: ${sizeKB}KB`,
        ].join("\n"),
        imageBase64: base64,
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `截图失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
```

**Step 3: 扩展 ChatMessage.content 支持多模态**

在 `model-client.ts` 中修改 `ChatMessage` 类型：

```ts
export type ChatMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
    >;

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: ChatMessageContent;
  reasoning?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};
```

**Step 4: 修改 convertToWireFormat 以支持 content array**

在 `model-client.ts` 的 `convertToWireFormat` 函数（约 550-570 行）中，确保 content array 直接透传到 wire 格式，不做 `String()` 转换。如果当前实现是 `base["content"] = m.content`，那已经可以透传数组。

**Step 5: 修改 sessions.ts 中 screenshot 结果的消息构造**

在 `sessions.ts` 的 `executeSingleTool` 中（约 596-605 行），当工具是 screenshot 且返回了 `imageBase64` 时，构造多模态消息：

将：
```ts
                  const execResult = await toolExecutor.execute(toolId, label, workingDir);
                  toolOutput = execResult.success
                    ? execResult.output
                    : `[错误] ${execResult.error ?? "工具执行失败"}\n${execResult.output}`.trim();
```

改为：
```ts
                  const execResult = await toolExecutor.execute(toolId, label, workingDir);

                  if (execResult.imageBase64) {
                    // Screenshot: construct multimodal content for the model
                    toolOutput = JSON.stringify([
                      { type: "text", text: execResult.output },
                      {
                        type: "image_url",
                        image_url: {
                          url: `data:image/jpeg;base64,${execResult.imageBase64}`,
                          detail: "low",
                        },
                      },
                    ]);
                    // Mark as multimodal so message builder can handle it
                    (execResult as any)._multimodal = true;
                  }

                  if (!execResult.imageBase64) {
                    toolOutput = execResult.success
                      ? execResult.output
                      : `[错误] ${execResult.error ?? "工具执行失败"}\n${execResult.output}`.trim();
                  }
```

然后在后面推入 session.messages 时，如果是多模态内容则 parse 回 content array：

```ts
              const messageContent = (execResult as any)?._multimodal
                ? JSON.parse(cappedOutput)
                : cappedOutput;

              session.messages.push({
                id: randomUUID(),
                role: "tool" as const,
                content: messageContent,
                tool_call_id: toolCall.id,
                createdAt: new Date().toISOString(),
              });
```

> **注意:** 这是一个较大的改动。如果当前 `session.messages` 的序列化/UI渲染假设 `content` 总是 `string`，可能需要额外适配。可考虑渐进方案：先只在发给模型的 wire messages 中使用 content array，session 存储中仍存 text-only 的 output。

**Step 6: Commit**

```bash
git add desktop/src/main/services/browser-service.ts desktop/src/main/services/builtin-tool-executor.ts desktop/src/main/services/model-client.ts desktop/src/main/ipc/sessions.ts
git commit -m "feat(browser): screenshot返回JPEG base64，支持多模态模型vision"
```

---

## Task 6: 修复 enrichAriaSnapshot 正则丢失文本内容和属性

**问题:** ariaSnapshot 的 YAML 输出中，带 `:` 的文本节点、`[value=...]` 属性等都被正则丢弃。

**Files:**
- Modify: `desktop/src/main/services/browser-service.ts:336-355`

**Step 1: 重写 enrichAriaSnapshot 方法**

替换整个 `enrichAriaSnapshot` 方法：

```ts
  private enrichAriaSnapshot(raw: string): string {
    const lines = raw.split("\n");
    const enriched: string[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;

      // Match YAML-like: "  - role 'name' [attrs]" or "  - role "name" [attrs]"
      // Also handles: "  - text: some text" and "  - role [attrs]" (no name)
      const yamlMatch = line.match(
        /^(\s*)-\s+(\w+)(?:\s*:\s*(.+)|(?:\s+"([^"]*)"|\s+'([^']*)')?\s*((?:\[.+?\])*))?/
      );

      if (yamlMatch) {
        const ref = ++this.refCounter;
        const indent = yamlMatch[1] || "";
        const role = yamlMatch[2];
        const colonText = yamlMatch[3]?.trim();     // "text: Some paragraph"
        const dqName = yamlMatch[4];                 // "name" in double quotes
        const sqName = yamlMatch[5];                 // 'name' in single quotes
        const attrs = yamlMatch[6] || "";            // [value=...][level=2] etc.

        const name = colonText || dqName || sqName || "";
        this.refMap.set(ref, name ? `${role}[name="${name}"]` : role);

        let display = `${indent}[ref=${ref}] ${role}`;
        if (name) display += ` "${name}"`;
        if (attrs) display += ` ${attrs}`;
        enriched.push(display);
      } else {
        enriched.push(line);
      }
    }
    return enriched.join("\n");
  }
```

**Step 2: Commit**

```bash
git add desktop/src/main/services/browser-service.ts
git commit -m "fix(browser): enrichAriaSnapshot正则改进，保留文本内容和属性信息"
```

---

## Task 7: 修复 Linux/macOS 浏览器检测不完整

**问题:** Linux 无 Chromium 降级；macOS 不验证 Edge 是否存在就回退。

**Files:**
- Modify: `desktop/src/main/services/browser-service.ts:46-69`

**Step 1: 重写 detectBrowserChannel 函数**

```ts
function detectBrowserChannel(): string {
  const platform = process.platform;

  if (platform === "win32") {
    const chromePaths = [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ];
    if (chromePaths.some((p) => p && existsSync(p))) return "chrome";
    // Edge is pre-installed on Windows 10+, safe fallback
    return "msedge";
  }

  if (platform === "darwin") {
    if (existsSync("/Applications/Google Chrome.app")) return "chrome";
    if (existsSync("/Applications/Microsoft Edge.app")) return "msedge";
    // Chromium via Homebrew or manual install
    if (existsSync("/Applications/Chromium.app")) return "chromium";
    // Last resort: try chrome anyway, Playwright will give a clear error
    return "chrome";
  }

  // Linux: Chrome → Chromium
  const linuxChromePaths = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];
  if (linuxChromePaths.some((p) => existsSync(p))) return "chrome";

  const linuxChromiumPaths = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  if (linuxChromiumPaths.some((p) => existsSync(p))) return "chromium";

  return "chrome";
}
```

**Step 2: Commit**

```bash
git add desktop/src/main/services/browser-service.ts
git commit -m "fix(browser): 完善Linux/macOS浏览器检测，添加Chromium降级路径"
```

---

## Task 8: 修复 locale 硬编码为 zh-CN

**问题:** 所有网站都强制以中文内容协商返回，非中文用户受影响。

**Files:**
- Modify: `desktop/src/main/services/browser-service.ts:182-185`

**Step 1: 改为动态获取系统 locale**

在 `launchBrowser()` 中，将：

```ts
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: "zh-CN",
      });
```

改为：

```ts
      // Use Electron's app.getLocale() if available, fallback to env
      let locale = "zh-CN";
      try {
        const { app } = await import("electron");
        locale = app.getLocale() || "zh-CN";
      } catch {
        locale = process.env.LANG?.split(".")[0]?.replace("_", "-") || "zh-CN";
      }

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale,
      });
```

**Step 2: Commit**

```bash
git add desktop/src/main/services/browser-service.ts
git commit -m "fix(browser): 使用系统locale替代硬编码zh-CN"
```

---

## Task 9: 修复 click 后固定 500ms 等待不足

**问题:** 点击后仅等 500ms，页面导航或 AJAX 请求往往未完成。

**Files:**
- Modify: `desktop/src/main/services/browser-service.ts:442-465`

**Step 1: 改用智能等待策略**

替换 `click` 方法中的 `await page.waitForTimeout(500)` 为：

```ts
      // Smart wait: try to wait for navigation or network idle, with a short fallback
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 2000 });
      } catch {
        // No navigation happened, that's fine — just a button click
        await page.waitForTimeout(300);
      }
```

**Step 2: Commit**

```bash
git add desktop/src/main/services/browser-service.ts
git commit -m "fix(browser): click后使用智能等待替代固定500ms"
```

---

## Task 10: 修复 type() 中 fill() 在 contenteditable 上失败

**问题:** `fill()` 只适用于 `<input>` / `<textarea>`，对 contenteditable 元素会抛异常。

**Files:**
- Modify: `desktop/src/main/services/browser-service.ts:467-493`

**Step 1: 添加 contenteditable 降级逻辑**

替换 `type` 方法的 try 块内容：

```ts
    try {
      const locator = page.locator(resolved).first();
      await locator.click({ timeout: ACTION_TIMEOUT_MS });

      // Try fill() first (works for input/textarea), fallback to keyboard for contenteditable
      try {
        await locator.fill(text);
      } catch {
        // fill() failed — likely a contenteditable element. Clear and type manually.
        await page.keyboard.press("Control+a");
        await page.keyboard.press("Backspace");
        await locator.pressSequentially(text, { delay: 20 });
      }

      if (pressEnter) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);
      }
      return {
        success: true,
        output: `已输入: "${text}"${pressEnter ? " (已按回车)" : ""}\n目标: ${selector}`,
      };
    }
```

**Step 2: Commit**

```bash
git add desktop/src/main/services/browser-service.ts
git commit -m "fix(browser): type工具添加contenteditable降级支持"
```

---

## Task 11: 修复 formatAXTree 暴露不可交互角色

**问题:** `StaticText`、`RootWebArea` 等非交互角色获得 ref 编号，模型尝试点击必然失败。

**Files:**
- Modify: `desktop/src/main/services/browser-service.ts:360-391`

**Step 1: 扩展 skipRoles 集合**

替换：
```ts
    const skipRoles = new Set(["none", "generic", "LineBreak"]);
```

为：
```ts
    const skipRoles = new Set([
      "none", "generic", "LineBreak",
      "StaticText", "InlineTextBox", "RootWebArea", "WebArea",
      "paragraph", "group", "list", "listitem",
      "document", "Section", "article",
    ]);
```

**Step 2: 只给可交互角色分配 ref 编号**

在 `formatAXTree` 中增加可交互判断：

```ts
    const interactiveRoles = new Set([
      "button", "link", "textbox", "checkbox", "radio", "combobox",
      "menuitem", "tab", "switch", "slider", "spinbutton",
      "searchbox", "option", "menuitemcheckbox", "menuitemradio",
      "heading", "img", "cell", "row", "columnheader", "rowheader",
    ]);

    const isInteractive = interactiveRoles.has(node.role.toLowerCase());
    const ref = isInteractive ? ++this.refCounter : null;

    if (isInteractive && ref !== null) {
      const selectorHint = node.name
        ? `${node.role}[name="${node.name}"]`
        : node.role;
      this.refMap.set(ref, selectorHint);
    }

    let line = isInteractive && ref !== null
      ? `${indent}[ref=${ref}] ${node.role}`
      : `${indent}${node.role}`;
```

这样非交互元素仍会显示（帮助模型理解页面结构），但没有 ref 编号（模型不会尝试点击它们）。

**Step 3: Commit**

```bash
git add desktop/src/main/services/browser-service.ts
git commit -m "fix(browser): formatAXTree只给可交互角色分配ref编号"
```

---

## Task 12: 修复 functionNameToToolId 的下划线全量替换问题

**问题:** `browser_press_key` → `browser.press.key`，`toolId.split(".")[1]` 只取到 `"press"` 而非 `"press_key"`。此问题影响所有含多个下划线的工具名。

**注意:** 此修复在 Task 4 Step 5 中已涉及，但此处单独提出以确保不遗漏。

**Files:**
- Modify: `desktop/src/main/services/tool-schemas.ts:554-562`
- Modify: `desktop/src/main/services/builtin-tool-executor.ts:494-496`

**Step 1: 修改 functionNameToToolId**

已在 Task 4 Step 5 中描述。

**Step 2: 修改 executeBrowser 的 action 提取**

将：
```ts
    const action = toolId.split(".")[1];
```

改为：
```ts
    const action = toolId.slice("browser.".length);
```

**Step 3: 验证现有工具不受影响**

- `browser.open` → `slice("browser.".length)` → `"open"` ✓
- `browser.snapshot` → `"snapshot"` ✓
- `browser.press_key` → `"press_key"` ✓

**Step 4: Commit**

如果尚未随 Task 4 一同提交：

```bash
git add desktop/src/main/services/tool-schemas.ts desktop/src/main/services/builtin-tool-executor.ts
git commit -m "fix(browser): functionNameToToolId对browser_前缀做特殊处理避免多下划线工具名转换错误"
```

---

## Task 13: 改进 snapshot 输出质量 — 添加页面 URL 导航提示

**问题:** 模型看到 snapshot 后不知道当前页面 URL 和可用操作，缺少上下文引导。

**Files:**
- Modify: `desktop/src/main/services/browser-service.ts:417-439`

**Step 1: 在 snapshot header 中添加操作提示**

修改 `snapshot` 方法中 `header` 的拼接：

```ts
      const header = [
        `页面: ${title}`,
        `URL: ${currentUrl}`,
        `${"─".repeat(50)}`,
        `提示: 使用 ref=N 引用元素（如 browser_click selector="ref=5"）。`,
        `如页面有变化，请重新调用 browser_snapshot 获取最新引用。`,
        ``,
      ].join("\n");
```

**Step 2: Commit**

```bash
git add desktop/src/main/services/browser-service.ts
git commit -m "fix(browser): snapshot输出添加ref使用提示，改善模型可用性"
```

---

## Task 14: 编写单元测试

**Files:**
- Create: `desktop/tests/browser-service.test.ts`

**Step 1: 创建测试文件，测试纯逻辑函数**

由于 BrowserService 依赖 Playwright 和真实浏览器，无法在 CI 中轻松测试。但我们可以测试：
- `resolveSelector` 的各种输入
- `detectBrowserChannel` 的平台行为（mock process.platform）
- `functionNameToToolId` 对 browser 工具的转换
- `buildToolLabel` 对 browser 参数的序列化

```ts
import { describe, it, expect } from "vitest";
import { functionNameToToolId, buildToolLabel } from "../src/main/services/tool-schemas";

describe("functionNameToToolId — browser tools", () => {
  it("converts single-word browser tools", () => {
    expect(functionNameToToolId("browser_open")).toBe("browser.open");
    expect(functionNameToToolId("browser_click")).toBe("browser.click");
    expect(functionNameToToolId("browser_snapshot")).toBe("browser.snapshot");
  });

  it("converts multi-word browser tools (preserves inner underscores)", () => {
    expect(functionNameToToolId("browser_press_key")).toBe("browser.press_key");
  });

  it("does not affect non-browser tools", () => {
    expect(functionNameToToolId("fs_read")).toBe("fs.read");
    expect(functionNameToToolId("exec_command")).toBe("exec.command");
    expect(functionNameToToolId("git_status")).toBe("git.status");
    expect(functionNameToToolId("skill_invoke__test")).toBe("skill_invoke__test");
  });
});

describe("buildToolLabel — browser tools", () => {
  it("serializes browser_open args as JSON", () => {
    const label = buildToolLabel("browser_open", { url: "https://example.com" });
    expect(JSON.parse(label)).toEqual({ url: "https://example.com" });
  });

  it("serializes browser_scroll args as JSON", () => {
    const label = buildToolLabel("browser_scroll", { direction: "down", amount: 5 });
    expect(JSON.parse(label)).toEqual({ direction: "down", amount: 5 });
  });

  it("serializes browser_press_key args as JSON", () => {
    const label = buildToolLabel("browser_press_key", { key: "Escape" });
    expect(JSON.parse(label)).toEqual({ key: "Escape" });
  });
});

describe("resolveSelector", () => {
  // We need to extract resolveSelector or test it indirectly.
  // Since it's a module-level function not exported, we test it via the
  // BrowserService public methods in integration tests.
  // Here we document the expected behavior for review.

  it.todo("ref=N with valid refMap entry returns Playwright role selector");
  it.todo("ref=N with missing entry throws descriptive error");
  it.todo("text=Login passes through unchanged");
  it.todo("role=button passes through unchanged");
  it.todo("CSS selector passes through unchanged");
});
```

**Step 2: 运行测试确认通过**

```bash
cd desktop && npx vitest run tests/browser-service.test.ts
```

**Step 3: Commit**

```bash
git add desktop/tests/browser-service.test.ts
git commit -m "test(browser): 添加browser工具名转换和参数序列化测试"
```

---

## 执行顺序总结

| 优先级 | Task | 改动范围 | 风险 |
|--------|------|----------|------|
| P0 | Task 1: ref 失败回退 | browser-service.ts 1行 | 极低 |
| P0 | Task 2: 导航清空 refMap | browser-service.ts 几行 | 低 |
| P0 | Task 12: functionNameToToolId 修复 | tool-schemas.ts + executor | 中（影响所有工具） |
| P0 | Task 3: 新增 scroll | 4 文件新增 | 低（纯新增） |
| P0 | Task 4: 新增 press_key | 4 文件新增 | 低（纯新增） |
| P1 | Task 5: screenshot 多模态 | 4 文件改动 | **高**（涉及消息格式） |
| P1 | Task 6: ariaSnapshot 正则 | browser-service.ts 1方法 | 中 |
| P1 | Task 7: 浏览器检测 | browser-service.ts 1函数 | 低 |
| P2 | Task 8: locale | browser-service.ts 几行 | 低 |
| P2 | Task 9: click 等待 | browser-service.ts 几行 | 低 |
| P2 | Task 10: contenteditable | browser-service.ts 几行 | 低 |
| P2 | Task 11: 非交互角色 | browser-service.ts 1方法 | 中 |
| P2 | Task 13: snapshot 提示 | browser-service.ts 几行 | 极低 |
| — | Task 14: 测试 | 新建测试文件 | 无 |

**建议执行顺序:** Task 12 → 1 → 2 → 3 → 4 → 6 → 7 → 9 → 10 → 11 → 8 → 13 → 5 → 14

Task 5（screenshot 多模态）最复杂，建议最后做或单独评估。如果当前模型不支持 vision，可以先跳过 Task 5，改为在 screenshot 输出中添加文字提示："截图能力受限，请优先使用 browser_snapshot 获取页面内容"。

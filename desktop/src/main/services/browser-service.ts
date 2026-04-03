/**
 * BrowserService — Playwright-based browser automation for builtin browser.* tools.
 *
 * Manages a single browser instance with lazy launch, idle auto-close,
 * and crash recovery. Uses playwright-core to connect to the system
 * Chrome/Edge (no bundled browser binary).
 */

import { existsSync } from "node:fs";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { ToolExecutionResult } from "./builtin-tool-executor";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Auto-close the browser after 5 minutes of inactivity. */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Maximum output length for snapshot/evaluate results. */
const MAX_OUTPUT_CHARS = 15_000;

/** Page navigation timeout (30 seconds). */
const NAV_TIMEOUT_MS = 30_000;

/** Element action timeout (10 seconds). */
const ACTION_TIMEOUT_MS = 10_000;

/** Maximum wait duration for browser.wait (30 seconds). */
const MAX_WAIT_MS = 30_000;

// ---------------------------------------------------------------------------
// Browser channel detection
// ---------------------------------------------------------------------------

/**
 * Detect the best available browser channel on the current platform.
 *
 * All platforms prefer Chrome first, then fall back:
 * - Windows: Chrome → Edge (Edge is 100% pre-installed as fallback)
 * - macOS:   Chrome → Edge → Chromium
 * - Linux:   Chrome → Chromium
 */
function detectBrowserChannel(): string {
  const platform = process.platform;

  if (platform === "win32") {
    const chromePaths = [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ];
    if (chromePaths.some((p) => p && existsSync(p))) return "chrome";
    // Edge is pre-installed on Windows 10+
    return "msedge";
  }

  if (platform === "darwin") {
    if (existsSync("/Applications/Google Chrome.app")) return "chrome";
    if (existsSync("/Applications/Microsoft Edge.app")) return "msedge";
    if (existsSync("/Applications/Chromium.app")) return "chromium";
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

// ---------------------------------------------------------------------------
// Selector resolution helper
// ---------------------------------------------------------------------------

/**
 * Resolve a user-provided selector to a Playwright-compatible selector.
 *
 * Supports:
 *   - "ref=42"        → look up from last snapshot's ref map
 *   - "text=Login"    → Playwright text selector
 *   - "role=button"   → Playwright role selector
 *   - "button.submit" → CSS selector (default)
 */
function resolveSelector(
  selector: string,
  refMap: Map<number, string>,
): string {
  const trimmed = selector.trim();

  if (trimmed.startsWith("ref=")) {
    const refNum = parseInt(trimmed.slice(4), 10);
    const mapped = refMap.get(refNum);
    if (mapped) {
      const match = mapped.match(/^(\w+)\[name="(.+)"\]$/);
      if (match) {
        return `role=${match[1]}[name="${match[2]}"]`;
      }
      return mapped;
    }
    throw new Error(
      `ref=${refNum} 已失效。页面可能已导航或更新，请重新调用 browser_snapshot 获取最新元素引用。`
    );
  }

  if (trimmed.startsWith("text=") || trimmed.startsWith("role=")) {
    return trimmed;
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// BrowserService
// ---------------------------------------------------------------------------

export class BrowserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private launching = false;

  /** Per-instance ref map — reset on each snapshot, used by click/type/etc. */
  private refCounter = 0;
  private refMap = new Map<number, string>();

  // ── Lifecycle ───────────────────────────────────────────────

  private async ensurePage(): Promise<Page> {
    this.resetIdleTimer();

    if (this.browser && !this.browser.isConnected()) {
      console.warn("[browser-service] Browser disconnected, will re-launch.");
      this.browser = null;
      this.context = null;
      this.page = null;
    }

    if (this.page) {
      try {
        await this.page.evaluate("1");
        return this.page;
      } catch {
        this.page = null;
      }
    }

    if (!this.browser) {
      await this.launchBrowser();
    }

    if (!this.page && this.context) {
      this.page = await this.context.newPage();
    }

    return this.page!;
  }

  private async launchBrowser(): Promise<void> {
    if (this.launching) {
      while (this.launching) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return;
    }

    this.launching = true;
    try {
      const pw = await import("playwright-core");
      const channel = detectBrowserChannel();

      console.info(`[browser-service] Launching browser (channel: ${channel})...`);

      this.browser = await pw.chromium.launch({
        channel,
        headless: false,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-default-browser-check",
        ],
      });

      // Detect system locale instead of hardcoding
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

      this.page = await this.context.newPage();

      this.browser.on("disconnected", () => {
        console.info("[browser-service] Browser disconnected.");
        this.browser = null;
        this.context = null;
        this.page = null;
      });

      console.info("[browser-service] Browser launched successfully.");
    } catch (err) {
      this.browser = null;
      this.context = null;
      this.page = null;

      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Executable doesn't exist") || message.includes("Failed to launch")) {
        throw new Error(
          "未找到可用的浏览器。请确保系统已安装 Chrome、Edge 或 Chromium 浏览器。\n" +
          `检测到的平台: ${process.platform}, 尝试的 channel: ${detectBrowserChannel()}\n` +
          `原始错误: ${message}`
        );
      }
      throw err;
    } finally {
      this.launching = false;
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      console.info("[browser-service] Idle timeout reached, closing browser.");
      this.close();
    }, IDLE_TIMEOUT_MS);
  }

  /**
   * Close the browser and release all resources.
   * Called on idle timeout and MUST be called on app shutdown.
   */
  async close(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch { /* ignore close errors */ }
      this.browser = null;
      this.context = null;
      this.page = null;
    }
    this.refMap.clear();
    this.refCounter = 0;
  }

  /** Invalidate stale refs after navigation. */
  private invalidateRefs(): void {
    this.refMap.clear();
    this.refCounter = 0;
  }

  // ── Snapshot helpers (replaces deprecated page.accessibility.snapshot) ──

  /**
   * Build an accessibility-like snapshot using Playwright's aria APIs.
   *
   * Strategy: use page.locator('body').ariaSnapshot() if available (Playwright 1.49+),
   * fall back to page.accessibility.snapshot() for older versions,
   * and ultimately fall back to a DOM-based extraction.
   */
  private async buildSnapshot(page: Page, selector?: string): Promise<string> {
    const target = selector
      ? page.locator(selector).first()
      : page.locator("body");

    // Reset refs
    this.refCounter = 0;
    this.refMap.clear();

    // Strategy 1: ariaSnapshot (Playwright 1.49+)
    try {
      const ariaSnap = await (target as any).ariaSnapshot({ timeout: ACTION_TIMEOUT_MS });
      if (typeof ariaSnap === "string" && ariaSnap.trim()) {
        return this.enrichAriaSnapshot(ariaSnap);
      }
    } catch { /* not available, try next */ }

    // Strategy 2: deprecated accessibility.snapshot (still works in many versions)
    try {
      const root = selector
        ? await target.elementHandle()
        : null;
      const axTree = await (page as any).accessibility.snapshot({
        root: root ?? undefined,
      });
      if (axTree) {
        return this.formatAXTree(axTree);
      }
    } catch { /* not available, try next */ }

    // Strategy 3: DOM-based fallback — extract interactive elements
    try {
      const elements = await page.evaluate(() => {
        const results: string[] = [];
        const interactiveSelectors = [
          "a[href]", "button", "input", "textarea", "select",
          "[role=button]", "[role=link]", "[role=textbox]",
          "[role=checkbox]", "[role=radio]", "[role=tab]",
          "h1", "h2", "h3", "h4", "h5", "h6",
        ];
        const all = document.querySelectorAll(interactiveSelectors.join(","));
        let idx = 0;
        all.forEach((el) => {
          idx++;
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute("role") || tag;
          const name = (el as HTMLElement).innerText?.slice(0, 80)
            || el.getAttribute("aria-label")
            || el.getAttribute("placeholder")
            || el.getAttribute("title")
            || el.getAttribute("name")
            || "";
          const value = (el as HTMLInputElement).value ?? "";
          const type = el.getAttribute("type") || "";

          let line = `[ref=${idx}] ${role}`;
          if (type) line += `[type=${type}]`;
          if (name.trim()) line += ` "${name.trim()}"`;
          if (value) line += ` value="${value.slice(0, 100)}"`;
          results.push(line);
        });
        return results;
      });
      // Build refMap from DOM fallback
      for (let i = 0; i < elements.length; i++) {
        const match = elements[i].match(/\[ref=(\d+)\]\s+(\w+)(?:\[type=\w+\])?\s*"?([^"]*)"?/);
        if (match) {
          const ref = parseInt(match[1], 10);
          const name = match[3]?.trim();
          this.refMap.set(ref, name ? `text=${name}` : match[2]);
          this.refCounter = ref;
        }
      }
      return elements.join("\n") || "(页面无可交互元素)";
    } catch {
      return "(无法获取页面快照)";
    }
  }

  /**
   * Enrich a YAML-format aria snapshot with ref= numbers for AI to reference.
   */
  private enrichAriaSnapshot(raw: string): string {
    const lines = raw.split("\n");
    const enriched: string[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;

      // Match YAML-like: "  - role 'name' [attrs]" or "  - role: text content"
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

  /**
   * Format a legacy accessibility tree (from page.accessibility.snapshot).
   */
  private formatAXTree(node: { role: string; name?: string; value?: string; children?: any[] }, depth = 0): string {
    const lines: string[] = [];
    const indent = "  ".repeat(depth);

    const skipRoles = new Set([
      "none", "generic", "LineBreak",
      "StaticText", "InlineTextBox", "RootWebArea", "WebArea",
      "paragraph", "group", "list", "listitem",
      "document", "Section", "article",
    ]);
    const interactiveRoles = new Set([
      "button", "link", "textbox", "checkbox", "radio", "combobox",
      "menuitem", "tab", "switch", "slider", "spinbutton",
      "searchbox", "option", "menuitemcheckbox", "menuitemradio",
      "heading", "img", "cell", "row", "columnheader", "rowheader",
    ]);

    const roleLower = node.role.toLowerCase();
    const isInteractive = interactiveRoles.has(roleLower);
    const ref = isInteractive ? ++this.refCounter : null;

    if (isInteractive && ref !== null) {
      const selectorHint = node.name
        ? `${node.role}[name="${node.name}"]`
        : node.role;
      this.refMap.set(ref, selectorHint);
    }

    let line = ref !== null
      ? `${indent}[ref=${ref}] ${node.role}`
      : `${indent}${node.role}`;
    if (node.name) line += ` "${node.name}"`;
    if (node.value !== undefined && node.value !== "") {
      line += ` value="${node.value}"`;
    }

    const hasContent = node.name || node.value || (node.children && node.children.length > 0);

    if (!skipRoles.has(node.role) && hasContent) {
      lines.push(line);
    }

    if (node.children) {
      for (const child of node.children) {
        const childLines = this.formatAXTree(child, depth + 1);
        if (childLines) lines.push(childLines);
      }
    }

    return lines.join("\n");
  }

  // ── Tool implementations ────────────────────────────────────

  async open(url: string): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    try {
      const response = await page.goto(url, {
        timeout: NAV_TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      });
      this.invalidateRefs();
      const status = response?.status() ?? "unknown";
      const title = await page.title();
      return {
        success: true,
        output: `已打开: ${url}\n状态码: ${status}\n页面标题: ${title}\n\n提示: 页面已导航，之前的元素引用(ref=N)已失效。请调用 browser_snapshot 获取新的元素引用。`,
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `页面加载失败 (${url}): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async snapshot(selector?: string): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    try {
      const formatted = await this.buildSnapshot(page, selector);

      const currentUrl = page.url();
      const title = await page.title();
      const header = [
        `页面: ${title}`,
        `URL: ${currentUrl}`,
        `${"─".repeat(50)}`,
        `提示: 使用 ref=N 引用元素（如 browser_click selector="ref=5"）。`,
        `如页面有变化，请重新调用 browser_snapshot 获取最新引用。`,
        ``,
      ].join("\n");

      let output = header + formatted;
      if (output.length > MAX_OUTPUT_CHARS) {
        output = output.slice(0, MAX_OUTPUT_CHARS) +
          "\n\n...（快照已截断，请使用 selector 参数缩小范围）";
      }

      return { success: true, output };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `获取快照失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async click(selector: string): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    const resolved = resolveSelector(selector, this.refMap);
    try {
      await page.locator(resolved).first().click({ timeout: ACTION_TIMEOUT_MS });
      // Smart wait: try to wait for navigation or network idle, with a short fallback
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 2000 });
      } catch {
        // No navigation happened, that's fine — just a button click
        await page.waitForTimeout(300);
      }
      const title = await page.title();
      return {
        success: true,
        output: `已点击: ${selector}\n当前页面: ${title} (${page.url()})`,
      };
    } catch (err) {
      let hint = "";
      try {
        const snap = await this.snapshot();
        hint = "\n\n当前页面元素（前 2000 字符）:\n" + snap.output.slice(0, 2000);
      } catch { /* ignore */ }
      return {
        success: false,
        output: hint,
        error: `点击失败 (${selector}): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async type(
    selector: string,
    text: string,
    pressEnter?: boolean,
  ): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    const resolved = resolveSelector(selector, this.refMap);
    try {
      const locator = page.locator(resolved).first();
      await locator.click({ timeout: ACTION_TIMEOUT_MS });
      // Try fill() first (works for input/textarea), fallback to keyboard for contenteditable
      try {
        await locator.fill(text);
      } catch {
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
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `输入失败 (${selector}): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async screenshot(fullPage?: boolean): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    try {
      // Use JPEG at quality 50 to keep size manageable (~30-80KB for typical pages)
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

  async evaluate(expression: string): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    try {
      const result = await page.evaluate(expression);
      let output: string;
      if (result === undefined || result === null) {
        output = String(result);
      } else if (typeof result === "object") {
        output = JSON.stringify(result, null, 2);
      } else {
        output = String(result);
      }

      if (output.length > MAX_OUTPUT_CHARS) {
        output = output.slice(0, MAX_OUTPUT_CHARS) + "\n\n...（结果已截断）";
      }

      return { success: true, output };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `脚本执行失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async select(selector: string, values: string[]): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    const resolved = resolveSelector(selector, this.refMap);
    try {
      const selected = await page.locator(resolved).first().selectOption(
        values.map((v) => ({ value: v })),
        { timeout: ACTION_TIMEOUT_MS },
      );
      return {
        success: true,
        output: `已选择: ${selected.join(", ")}\n目标: ${selector}`,
      };
    } catch (err) {
      try {
        const selected = await page.locator(resolved).first().selectOption(
          values.map((v) => ({ label: v })),
          { timeout: ACTION_TIMEOUT_MS },
        );
        return {
          success: true,
          output: `已选择 (按文本): ${selected.join(", ")}\n目标: ${selector}`,
        };
      } catch {
        return {
          success: false,
          output: "",
          error: `选择失败 (${selector}): ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  async hover(selector: string): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    const resolved = resolveSelector(selector, this.refMap);
    try {
      await page.locator(resolved).first().hover({ timeout: ACTION_TIMEOUT_MS });
      return { success: true, output: `已悬停: ${selector}` };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `悬停失败 (${selector}): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async back(): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    try {
      await page.goBack({ timeout: NAV_TIMEOUT_MS, waitUntil: "domcontentloaded" });
      this.invalidateRefs();
      const title = await page.title();
      return { success: true, output: `已后退到: ${title} (${page.url()})\n提示: 元素引用已失效，请调用 browser_snapshot 获取新引用。` };
    } catch (err) {
      return { success: false, output: "", error: `后退失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async forward(): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    try {
      await page.goForward({ timeout: NAV_TIMEOUT_MS, waitUntil: "domcontentloaded" });
      this.invalidateRefs();
      const title = await page.title();
      return { success: true, output: `已前进到: ${title} (${page.url()})\n提示: 元素引用已失效，请调用 browser_snapshot 获取新引用。` };
    } catch (err) {
      return { success: false, output: "", error: `前进失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async wait(milliseconds: number): Promise<ToolExecutionResult> {
    const ms = Math.min(Math.max(0, milliseconds), MAX_WAIT_MS);
    const page = await this.ensurePage();
    await page.waitForTimeout(ms);
    return { success: true, output: `已等待 ${ms}ms` };
  }

  async scroll(
    direction: "up" | "down" | "left" | "right" = "down",
    amount: number = 3,
    selector?: string,
  ): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();
    try {
      if (selector) {
        const resolved = resolveSelector(selector, this.refMap);
        await page.locator(resolved).first().hover({ timeout: ACTION_TIMEOUT_MS });
      }

      const deltaX = direction === "left" ? -100 * amount : direction === "right" ? 100 * amount : 0;
      const deltaY = direction === "up" ? -100 * amount : direction === "down" ? 100 * amount : 0;

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

  async pressKey(key: string): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();

    const ALLOWED_KEYS = new Set([
      "Enter", "Escape", "Tab", "Backspace", "Delete",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "Home", "End", "PageUp", "PageDown",
      "Space", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
    ]);
    const ALLOWED_MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta"]);

    const parts = key.split("+").map((p) => p.trim());
    const mainKey = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);

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
}

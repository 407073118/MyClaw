/**
 * PPT 无头渲染器。
 *
 * 使用 Playwright headless 模式将 HTML 页面截图为 PNG Buffer。
 * 与 BrowserService 独立运行——BrowserService 为用户交互服务（headless:false），
 * 本渲染器为 PPT 背景生成服务（headless:true，无 UI）。
 */

import { existsSync } from "node:fs";
import type { Browser, Page } from "playwright-core";
import { createLogger } from "../logger";

const log = createLogger("ppt-renderer");

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** slide 画布尺寸（标准 16:9 1080p） */
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

/** 渲染器空闲超时：2 分钟不用则关闭浏览器释放资源 */
const IDLE_TIMEOUT_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// 浏览器通道探测（与 browser-service.ts 相同逻辑）
// ---------------------------------------------------------------------------

/**
 * 在当前平台上探测最合适的浏览器通道。
 *
 * 各平台优先 Chrome，找不到时按顺序降级：
 * - Windows：Chrome → Edge
 * - macOS：Chrome → Edge → Chromium
 * - Linux：Chrome → Chromium
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
    return "msedge";
  }

  if (platform === "darwin") {
    if (existsSync("/Applications/Google Chrome.app")) return "chrome";
    if (existsSync("/Applications/Microsoft Edge.app")) return "msedge";
    if (existsSync("/Applications/Chromium.app")) return "chromium";
    return "chrome";
  }

  // Linux
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
// HeadlessRenderer
// ---------------------------------------------------------------------------

export class HeadlessRenderer {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private launching = false;

  /**
   * 将 HTML 字符串渲染为 PNG Buffer。
   */
  async renderToImage(html: string): Promise<Buffer> {
    const page = await this.ensurePage();
    await page.setContent(html, { waitUntil: "networkidle", timeout: 15000 });
    const buffer = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    });
    this.resetIdleTimer();
    return Buffer.from(buffer);
  }

  /**
   * 批量渲染多张 slide HTML 为 PNG。
   * 复用同一个 page 实例，避免反复创建。
   */
  async renderBatch(htmlPages: string[]): Promise<Buffer[]> {
    const results: Buffer[] = [];
    const page = await this.ensurePage();

    for (let i = 0; i < htmlPages.length; i++) {
      try {
        await page.setContent(htmlPages[i], { waitUntil: "networkidle", timeout: 15000 });
        const buffer = await page.screenshot({
          type: "png",
          clip: { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
        });
        results.push(Buffer.from(buffer));
        log.info(`Slide ${i + 1}/${htmlPages.length} 截图完成`);
      } catch (err) {
        log.error(`Slide ${i + 1}/${htmlPages.length} 截图失败`, {
          error: err instanceof Error ? err.message : String(err),
        });
        // 尝试恢复：关闭泄漏的 context 后重新获取
        try {
          if (this.page) {
            const ctx = this.page.context();
            this.page = null;
            await ctx.close().catch(() => {});
          } else {
            this.page = null;
          }
          const freshPage = await this.ensurePage();
          await freshPage.setContent(htmlPages[i], { waitUntil: "networkidle", timeout: 15000 });
          const buffer = await freshPage.screenshot({
            type: "png",
            clip: { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
          });
          results.push(Buffer.from(buffer));
          log.info(`Slide ${i + 1}/${htmlPages.length} 重试截图成功`);
        } catch (retryErr) {
          throw new Error(
            `第 ${i + 1} 张 slide 截图失败且重试无效: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`
          );
        }
      }
    }

    this.resetIdleTimer();
    return results;
  }

  /** 主动关闭浏览器资源。 */
  async close(): Promise<void> {
    this.clearIdleTimer();
    if (this.browser) {
      try {
        await this.browser.close();
      } catch { /* 忽略关闭过程中的异常 */ }
      this.browser = null;
      this.page = null;
    }
    log.info("无头浏览器已关闭");
  }

  // ── 内部方法 ────────────────────────────────────────

  private async ensurePage(): Promise<Page> {
    this.resetIdleTimer();

    // 检测已断连的浏览器
    if (this.browser && !this.browser.isConnected()) {
      log.warn("无头浏览器已断连，将重新启动");
      this.browser = null;
      this.page = null;
    }

    // 检测 page 是否仍可用
    if (this.page) {
      try {
        await this.page.evaluate("1");
        return this.page;
      } catch {
        this.page = null;
      }
    }

    // 启动浏览器（如果需要）
    if (!this.browser) {
      await this.launchBrowser();
    }

    // 创建新 page（如果需要）
    if (!this.page) {
      const context = await this.browser!.newContext({
        viewport: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
        deviceScaleFactor: 1,
      });
      this.page = await context.newPage();
    }

    return this.page;
  }

  private async launchBrowser(): Promise<void> {
    // 防止并发启动
    if (this.launching) {
      while (this.launching) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return;
    }

    this.launching = true;
    const channel = detectBrowserChannel();
    try {
      const pw = await import("playwright-core");

      log.info("启动无头浏览器", { channel });

      this.browser = await pw.chromium.launch({
        channel,
        headless: true,
      });

      this.browser.on("disconnected", () => {
        log.info("无头浏览器已断开连接");
        this.browser = null;
        this.page = null;
      });

      log.info("无头浏览器启动成功");
    } catch (err) {
      this.browser = null;
      this.page = null;

      const message = err instanceof Error ? err.message : String(err);
      log.error("无头浏览器启动失败", { error: message });

      if (
        message.includes("Executable doesn't exist") ||
        message.includes("Failed to launch")
      ) {
        throw new Error(
          "PPT 渲染器启动失败：未找到可用的浏览器。" +
          `请确保系统已安装 Chrome、Edge 或 Chromium。` +
          `（平台: ${process.platform}, 通道: ${channel}）`
        );
      }
      throw err;
    } finally {
      this.launching = false;
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      log.info("无头浏览器空闲超时，自动关闭");
      this.close();
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

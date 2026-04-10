# PPT 生成系统：完整设计与多 Agent 开发方案

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **For Parallel Execution:** Agents A/B/C/D can run concurrently. Agent E depends on all others completing.

**Goal:** 让 MyClaw Desktop 具备生成专业美观、完全可编辑的 .pptx 演示文稿的能力。

**Architecture:** HTML/CSS 设计层渲染精美背景 → Playwright 截图 → pptxgenjs 叠加可编辑文字/图表层 → 输出原生 .pptx。Skill 教会模型如何设计演示文稿，Builtin Tool 提供生成能力。

**Tech Stack:** pptxgenjs (PPTX 生成), Playwright-core (已有，HTML 渲染), Handlebars (HTML 模板引擎), 现有 Builtin Tool 体系

**Core Principle:** 模型只输出语义化 JSON（标题、要点、数据），所有视觉设计决策（坐标、配色、字号、装饰元素）由预设计的 HTML 模板和主题系统承担。

---

## Architecture Overview

```
User Request
     │
     ▼
┌─────────────────────────┐
│  Skill: ppt-designer    │  ← SKILL.md 教模型设计方法论
│  preview.html           │  ← skill_view 预览面板
└────────────┬────────────┘
             │ 模型生成结构化 JSON
             ▼
┌─────────────────────────┐
│  Builtin Tool: ppt.*    │  ← tool-schemas.ts 注册
│                         │
│  ppt.themes             │  → 返回可用主题
│  ppt.generate           │  → 核心生成工具
└────────────┬────────────┘
             │
             ▼
┌──────────────────────────────────────────────────┐
│  PPT Rendering Engine (desktop/src/main/services/ppt/)  │
│                                                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ Template  │→ │ Headless  │→ │  Assembler   │  │
│  │ Engine    │  │ Renderer  │  │ (pptxgenjs)  │  │
│  │           │  │(Playwright│  │              │  │
│  │ theme +   │  │ → PNG)    │  │ bg image +   │  │
│  │ layout +  │  │           │  │ editable txt │  │
│  │ data →    │  │           │  │ → .pptx      │  │
│  │ HTML      │  │           │  │              │  │
│  └──────────┘  └───────────┘  └──────────────┘  │
│                                                  │
│  themes/     layouts/     icons/                  │
│  (配色字体)  (HTML模板+坐标映射)  (SVG图标)       │
└──────────────────────────────────────────────────┘
```

## Coordinate System

- HTML 画布: 1920 × 1080 px (16:9 标准)
- PPTX 画布: 10 × 5.625 inches (16:9 标准)
- 转换系数: 1 inch = 192 px → `pptx_inches = html_px / 192`
- 每个 layout 的 `.ts` 文件定义可编辑区域的 PPTX 坐标，必须与 HTML 中对应文字区域精确匹配

## File Map (all new files)

```
desktop/
├── package.json                                    ← +pptxgenjs, +handlebars
├── shared/contracts/
│   └── builtin-tool.ts                             ← BUILTIN_TOOL_GROUPS +ppt
├── src/main/services/
│   ├── builtin-tool-stubs.ts                       ← +ppt.themes, +ppt.generate
│   ├── builtin-tool-executor.ts                    ← +dispatch ppt.*
│   ├── tool-schemas.ts                             ← +ppt_themes, +ppt_generate schema
│   └── ppt/                                        ← NEW: PPT 渲染引擎
│       ├── index.ts                                ← 引擎入口，编排完整管线
│       ├── types.ts                                ← Theme, SlideData, Layout 类型
│       ├── template-engine.ts                      ← Handlebars 模板加载 + 渲染
│       ├── headless-renderer.ts                    ← Playwright 无头截图
│       ├── assembler.ts                            ← pptxgenjs 组装 PPTX
│       ├── themes/
│       │   ├── index.ts                            ← 主题注册表
│       │   ├── business-blue.ts                    ← 商务蓝
│       │   ├── tech-dark.ts                        ← 科技暗色
│       │   └── fresh-green.ts                      ← 清新绿
│       ├── layouts/
│       │   ├── index.ts                            ← 版式注册表
│       │   ├── cover.html + cover.ts               ← 封面
│       │   ├── section.html + section.ts           ← 章节过渡
│       │   ├── key-points.html + key-points.ts     ← 要点列表
│       │   ├── metrics.html + metrics.ts           ← 数据大字报
│       │   ├── comparison.html + comparison.ts     ← 左右对比
│       │   └── closing.html + closing.ts           ← 结束页
│       └── icons/
│           └── *.svg                               ← 常用图标
└── builtin-skills/
    └── ppt-designer/                               ← NEW: Skill
        ├── SKILL.md                                ← 模型设计方法论
        ├── preview.html                            ← 预览面板
        └── references/
            └── slide-types.md                      ← 版式使用说明
```

---

## Agent A: Foundation — Tool Registration & Dependencies

**Scope:** 在现有 Builtin Tool 体系中注册 ppt.* 工具，安装依赖，打通从模型调用到引擎入口的完整链路。

**Files to modify:**
- `desktop/package.json`
- `desktop/shared/contracts/builtin-tool.ts`
- `desktop/src/main/services/builtin-tool-stubs.ts`
- `desktop/src/main/services/tool-schemas.ts`
- `desktop/src/main/services/builtin-tool-executor.ts`

**Files to create:**
- `desktop/src/main/services/ppt/types.ts`

### Task A1: Install dependencies

**Step 1:** Add pptxgenjs and handlebars to desktop/package.json

```bash
cd desktop && pnpm add pptxgenjs handlebars
```

pptxgenjs 是纯 JS 库，无 native 依赖，Electron 主进程直接可用。
handlebars 用于将 theme + data 注入 HTML 模板。

**Step 2:** Verify imports work

```typescript
// quick smoke test in Node REPL
import PptxGenJS from "pptxgenjs";
import Handlebars from "handlebars";
```

### Task A2: Define core types

**Create:** `desktop/src/main/services/ppt/types.ts`

```typescript
/**
 * PPT 生成引擎的核心类型定义。
 */

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export type ThemeColors = {
  primary: string;      // 主色，用于标题、强调
  secondary: string;    // 辅助色，用于装饰、图标
  accent: string;       // 强调色，用于数据高亮
  background: string;   // 主背景色
  surface: string;      // 卡片/面板背景
  text: string;         // 正文颜色
  textLight: string;    // 辅助文字颜色
  textOnPrimary: string;// 在主色上的文字颜色
  success: string;      // 趋势上升
  danger: string;       // 趋势下降
};

export type ThemeFont = {
  face: string;
  size: number;
  bold: boolean;
  color: string;       // 6-char hex without #, for pptxgenjs
};

export type ThemeFonts = {
  title: ThemeFont;
  subtitle: ThemeFont;
  heading: ThemeFont;
  body: ThemeFont;
  caption: ThemeFont;
  metric: ThemeFont;
};

export type Theme = {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  /** CSS 变量块，注入 HTML 模板的 <style> 中 */
  cssVariables: string;
};

// ---------------------------------------------------------------------------
// Slide Layout
// ---------------------------------------------------------------------------

/** 可编辑文字区域在 PPTX 中的坐标（单位: inches） */
export type EditableRegion = {
  key: string;          // 数据字段的 key，如 "title", "points[0].text"
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  fontFace: string;
  color: string;        // 6-char hex without #
  bold?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
};

export type SlideLayout = {
  type: string;
  name: string;
  description: string;
  /** 该版式需要的数据字段及类型描述（给模型看） */
  dataSchema: Record<string, string>;
  /** HTML 模板文件名（相对于 layouts/ 目录） */
  htmlTemplate: string;
  /** 根据主题和数据计算可编辑区域坐标 */
  resolveEditableRegions: (data: Record<string, unknown>, theme: Theme) => EditableRegion[];
};

// ---------------------------------------------------------------------------
// Slide Data (模型输出的结构)
// ---------------------------------------------------------------------------

export type SlideData = {
  type: string;
  data: Record<string, unknown>;
};

export type PresentationInput = {
  outputPath: string;
  theme: string;
  meta?: {
    title?: string;
    subtitle?: string;
    author?: string;
    date?: string;
  };
  slides: SlideData[];
};

// ---------------------------------------------------------------------------
// 引擎结果
// ---------------------------------------------------------------------------

export type PptGenerationResult = {
  success: boolean;
  outputPath: string;
  slideCount: number;
  error?: string;
};
```

### Task A3: Add "ppt" to BUILTIN_TOOL_GROUPS

**Modify:** `desktop/shared/contracts/builtin-tool.ts`

Change line 3:
```typescript
// Before:
export const BUILTIN_TOOL_GROUPS = ["fs", "exec", "git", "process", "http", "archive", "task", "web", "browser"] as const;

// After:
export const BUILTIN_TOOL_GROUPS = ["fs", "exec", "git", "process", "http", "archive", "task", "web", "browser", "ppt"] as const;
```

### Task A4: Register tool stubs

**Modify:** `desktop/src/main/services/builtin-tool-stubs.ts`

Add before the closing `];` of RESOLVED_BUILTIN_TOOLS array (after browser.press_key):

```typescript
  // ── ppt.* ── 演示文稿生成工具组 ──────────────────────
  {
    id: "ppt.themes",
    name: "PPT 主题列表",
    description: "获取所有可用的演示文稿主题及其配色预览。",
    group: "ppt",
    risk: ToolRiskCategory.Read,
    requiresAttachedDirectory: false,
    enabled: true,
    exposedToModel: true,
    effectiveApprovalMode: "inherit",
  },
  {
    id: "ppt.generate",
    name: "生成 PPT",
    description: "根据结构化内容生成可编辑的 .pptx 演示文稿。",
    group: "ppt",
    risk: ToolRiskCategory.Write,
    requiresAttachedDirectory: false,
    enabled: true,
    exposedToModel: true,
    effectiveApprovalMode: "always-ask",
  },
```

### Task A5: Add tool schemas

**Modify:** `desktop/src/main/services/tool-schemas.ts`

In `buildToolSchemas()`, add after the `web_search` schema and before the MCP tools section:

```typescript
    // ── ppt.* ── 演示文稿生成工具 ────────────────────────
    {
      type: "function",
      function: {
        name: "ppt_themes",
        description: "获取所有可用的演示文稿主题列表，包括 ID、名称、配色预览和适用场景。在调用 ppt_generate 之前先用此工具了解可选主题。",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "ppt_generate",
        description: [
          "根据结构化 slide 数据生成可编辑的 .pptx 演示文稿。",
          "每张 slide 只需指定 type（版式类型）和 data（内容数据），所有设计排版由内置模板自动完成。",
          "可用版式类型: cover(封面), section(章节), key_points(要点), metrics(数据大字报), comparison(对比), closing(结束页)。",
          "生成前建议先用 skill_invoke__ppt_designer 获取设计指导，用 skill_view 预览效果。",
        ].join(" "),
        parameters: {
          type: "object",
          properties: {
            outputPath: {
              type: "string",
              description: "输出文件的绝对路径，如 C:/Users/xxx/Desktop/report.pptx",
            },
            theme: {
              type: "string",
              description: "主题 ID，通过 ppt_themes 获取，如 business-blue",
            },
            meta: {
              type: "object",
              description: "演示文稿元数据",
              properties: {
                title: { type: "string", description: "文稿标题" },
                subtitle: { type: "string", description: "副标题" },
                author: { type: "string", description: "作者" },
                date: { type: "string", description: "日期" },
              },
            },
            slides: {
              type: "array",
              description: "Slide 列表，按展示顺序排列",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    description: "版式类型: cover | section | key_points | metrics | comparison | closing",
                  },
                  data: {
                    type: "object",
                    description: "该版式所需的内容数据，具体字段参见 ppt-designer 技能说明",
                  },
                },
                required: ["type", "data"],
              },
            },
          },
          required: ["outputPath", "theme", "slides"],
        },
      },
    },
```

### Task A6: Add buildToolLabel cases

**Modify:** `desktop/src/main/services/tool-schemas.ts` in `buildToolLabel()` function.

Add before the `default:` case:

```typescript
    case "ppt.themes":
      return "";

    case "ppt.generate":
      return JSON.stringify(args);
```

### Task A7: Add dispatch routing in executor

**Modify:** `desktop/src/main/services/builtin-tool-executor.ts`

Add import at top:

```typescript
import { PptEngine } from "./ppt/index";
```

Add instance in class:

```typescript
export class BuiltinToolExecutor {
  private skills: SkillDefinition[] = [];
  private browserService = new BrowserService();
  private pptEngine = new PptEngine();      // ← ADD THIS
  private _allowExternalPaths = false;
```

Add in `dispatch()` method, before the `skill_invoke__` block:

```typescript
    // ── ppt.* ─────────────────────────────────────────
    if (toolId === "ppt.themes") {
      const themes = this.pptEngine.getThemes();
      return {
        success: true,
        output: JSON.stringify(themes, null, 2),
      };
    }

    if (toolId === "ppt.generate") {
      const input = JSON.parse(label);
      const result = await this.pptEngine.generate(input);
      if (!result.success) {
        return { success: false, output: "", error: result.error };
      }
      return {
        success: true,
        output: `已生成演示文稿：${result.outputPath}（${result.slideCount} 页，可在 PowerPoint / WPS 中编辑）`,
      };
    }
```

### Task A8: Verify compilation

```bash
cd desktop && pnpm run build:main
```

At this point the build will fail on the missing `./ppt/index` module — that's expected and will be resolved by Agent B.

---

## Agent B: PPT Rendering Engine

**Scope:** 实现完整的 HTML → PNG → PPTX 渲染管线。这是系统的核心引擎。

**Files to create:**
- `desktop/src/main/services/ppt/index.ts`
- `desktop/src/main/services/ppt/template-engine.ts`
- `desktop/src/main/services/ppt/headless-renderer.ts`
- `desktop/src/main/services/ppt/assembler.ts`

**Depends on:** Agent A (types.ts), Agent C (themes + layouts)

### Task B1: Template Engine

**Create:** `desktop/src/main/services/ppt/template-engine.ts`

职责：加载 HTML 模板文件，注入主题 CSS 变量 + slide 数据，输出完整 HTML 字符串。

```typescript
/**
 * PPT HTML 模板引擎。
 *
 * 将主题样式 + slide 数据注入 Handlebars HTML 模板，
 * 输出可被 Playwright 渲染为截图的完整 HTML 页面。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
import type { Theme, SlideData } from "./types";

/** 包裹 HTML 模板片段为完整页面，注入主题 CSS 变量 */
function wrapFullPage(bodyHtml: string, theme: Theme): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1920px;
    height: 1080px;
    overflow: hidden;
    font-family: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  :root {
    ${theme.cssVariables}
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// 注册 Handlebars helpers
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("math", (a, op, b) => {
  switch (op) {
    case "+": return Number(a) + Number(b);
    case "-": return Number(a) - Number(b);
    case "*": return Number(a) * Number(b);
    case "/": return Number(a) / Number(b);
    default: return 0;
  }
});

export class TemplateEngine {
  private templateCache = new Map<string, HandlebarsTemplateDelegate>();
  private layoutsDir: string;

  constructor(layoutsDir: string) {
    this.layoutsDir = layoutsDir;
  }

  /**
   * 渲染一张 slide 的完整 HTML 页面。
   * @param slideType  版式类型，如 "cover", "metrics"
   * @param data       slide 内容数据
   * @param theme      主题定义
   * @returns          完整 HTML 字符串（1920×1080）
   */
  render(slideType: string, data: Record<string, unknown>, theme: Theme): string {
    const template = this.getTemplate(slideType);
    const bodyHtml = template({ ...data, theme, colors: theme.colors, fonts: theme.fonts });
    return wrapFullPage(bodyHtml, theme);
  }

  private getTemplate(slideType: string): HandlebarsTemplateDelegate {
    const cached = this.templateCache.get(slideType);
    if (cached) return cached;

    const htmlPath = join(this.layoutsDir, `${slideType}.html`);
    const source = readFileSync(htmlPath, "utf8");
    const compiled = Handlebars.compile(source);
    this.templateCache.set(slideType, compiled);
    return compiled;
  }

  /** 清理缓存（开发热更新时使用） */
  clearCache(): void {
    this.templateCache.clear();
  }
}
```

### Task B2: Headless Renderer

**Create:** `desktop/src/main/services/ppt/headless-renderer.ts`

职责：用 Playwright 无头模式将 HTML 渲染为 PNG。与 BrowserService 独立（BrowserService 是 headless:false 用于用户浏览器操作）。

```typescript
/**
 * PPT 无头渲染器。
 *
 * 使用 Playwright headless 模式将 HTML 页面截图为 PNG Buffer。
 * 与 BrowserService 独立运行——BrowserService 为用户交互服务（headless:false），
 * 本渲染器为 PPT 背景生成服务（headless:true，无 UI）。
 */

import type { Browser, Page } from "playwright-core";
import { createLogger } from "../logger";

const log = createLogger("ppt-renderer");

/** slide 画布尺寸（标准 16:9 1080p） */
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

/** 渲染器空闲超时：2 分钟不用则关闭浏览器释放资源 */
const IDLE_TIMEOUT_MS = 2 * 60 * 1000;

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
    await page.setContent(html, { waitUntil: "networkidle" });
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

    for (const html of htmlPages) {
      await page.setContent(html, { waitUntil: "networkidle" });
      const buffer = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      });
      results.push(Buffer.from(buffer));
    }

    this.resetIdleTimer();
    return results;
  }

  /** 主动关闭浏览器资源。 */
  async close(): Promise<void> {
    this.clearIdleTimer();
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
      this.page = null;
    }
  }

  // ── 内部方法 ────────────────────────────────────────

  private async ensurePage(): Promise<Page> {
    this.resetIdleTimer();

    if (this.browser && !this.browser.isConnected()) {
      this.browser = null;
      this.page = null;
    }

    if (!this.browser) {
      await this.launchBrowser();
    }

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
    if (this.launching) {
      while (this.launching) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return;
    }

    this.launching = true;
    try {
      const pw = await import("playwright-core");

      // 与 BrowserService 使用相同的通道探测逻辑
      const channel = this.detectChannel();
      log.info("启动无头浏览器", { channel });

      this.browser = await pw.chromium.launch({
        channel,
        headless: true,  // 关键区别：无头模式
      });

      this.browser.on("disconnected", () => {
        this.browser = null;
        this.page = null;
      });

      log.info("无头浏览器启动成功");
    } catch (err) {
      log.error("无头浏览器启动失败", { error: String(err) });
      throw new Error("PPT 渲染器启动失败：无法启动浏览器。请确保系统已安装 Chrome 或 Edge。");
    } finally {
      this.launching = false;
    }
  }

  private detectChannel(): string {
    // 复用 browser-service.ts 中的探测逻辑
    const { existsSync } = require("node:fs");
    const platform = process.platform;
    if (platform === "win32") {
      const chromePaths = [
        `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      ];
      if (chromePaths.some((p: string) => p && existsSync(p))) return "chrome";
      return "msedge";
    }
    if (platform === "darwin") {
      if (existsSync("/Applications/Google Chrome.app")) return "chrome";
      if (existsSync("/Applications/Microsoft Edge.app")) return "msedge";
      return "chrome";
    }
    if (existsSync("/usr/bin/google-chrome") || existsSync("/usr/bin/google-chrome-stable")) return "chrome";
    return "chromium";
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.close(), IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
```

### Task B3: PPTX Assembler

**Create:** `desktop/src/main/services/ppt/assembler.ts`

职责：用 pptxgenjs 创建 PPTX，设置背景图 + 叠加可编辑文字。

```typescript
/**
 * PPT 组装器。
 *
 * 将 Playwright 渲染的背景 PNG 和可编辑文字区域组装成最终的 .pptx 文件。
 * 使用 pptxgenjs 生成原生可编辑的 PowerPoint 文件。
 */

import PptxGenJS from "pptxgenjs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { EditableRegion, PresentationInput, Theme } from "./types";
import { createLogger } from "../logger";

const log = createLogger("ppt-assembler");

/**
 * 组装完整 PPTX 文件。
 *
 * @param input          模型提供的演示文稿输入
 * @param backgrounds    每张 slide 对应的背景 PNG Buffer
 * @param editableRegions 每张 slide 的可编辑文字区域列表
 * @param theme          当前主题
 */
export async function assemblePptx(
  input: PresentationInput,
  backgrounds: Buffer[],
  editableRegions: EditableRegion[][],
  theme: Theme,
): Promise<void> {
  const pptx = new PptxGenJS();

  // 设置文稿级元数据
  pptx.layout = "LAYOUT_16x9";
  if (input.meta?.title) pptx.title = input.meta.title;
  if (input.meta?.author) pptx.author = input.meta.author;

  for (let i = 0; i < input.slides.length; i++) {
    const slide = pptx.addSlide();
    const bgBuffer = backgrounds[i];
    const regions = editableRegions[i] || [];

    // ── 背景层：精美 HTML 渲染图 ──
    if (bgBuffer) {
      slide.background = {
        data: `image/png;base64,${bgBuffer.toString("base64")}`,
      };
    }

    // ── 可编辑层：真实文字框 ──
    for (const region of regions) {
      const value = resolveDataValue(input.slides[i].data, region.key);
      if (value === undefined || value === null) continue;

      const textValue = String(value);

      slide.addText(textValue, {
        x: region.x,
        y: region.y,
        w: region.w,
        h: region.h,
        fontSize: region.fontSize,
        fontFace: region.fontFace,
        color: region.color,
        bold: region.bold ?? false,
        align: region.align ?? "left",
        valign: region.valign ?? "top",
        // 文字框透明，只显示文字本身（背景图已有视觉效果）
        fill: { type: "none" as const },
        // 无边框
        line: { type: "none" as const },
      });
    }

    log.info(`Slide ${i + 1}/${input.slides.length} 组装完成`, {
      type: input.slides[i].type,
      editableRegions: regions.length,
    });
  }

  // 确保输出目录存在
  mkdirSync(dirname(input.outputPath), { recursive: true });

  // 写入文件
  await pptx.writeFile({ fileName: input.outputPath });
  log.info("PPTX 文件已写入", { path: input.outputPath });
}

/**
 * 从 slide data 中按 key 路径取值。
 * 支持 "title", "points[0].text", "items[2].value" 等格式。
 */
function resolveDataValue(data: Record<string, unknown>, keyPath: string): unknown {
  const parts = keyPath.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
```

### Task B4: Engine Entry Point (Orchestrator)

**Create:** `desktop/src/main/services/ppt/index.ts`

职责：编排完整的渲染管线，对外提供 `getThemes()` 和 `generate()` 两个方法。

```typescript
/**
 * PPT 渲染引擎入口。
 *
 * 编排完整管线：
 * 1. 加载主题 → 2. 模板渲染 HTML → 3. Playwright 截图 → 4. pptxgenjs 组装
 */

import { join } from "node:path";
import { app } from "electron";
import { createLogger } from "../logger";
import { TemplateEngine } from "./template-engine";
import { HeadlessRenderer } from "./headless-renderer";
import { assemblePptx } from "./assembler";
import { getThemeById, listThemeSummaries } from "./themes/index";
import { getLayout } from "./layouts/index";
import type { PresentationInput, PptGenerationResult, EditableRegion } from "./types";

const log = createLogger("ppt-engine");

export class PptEngine {
  private templateEngine: TemplateEngine;
  private renderer: HeadlessRenderer;

  constructor() {
    // layouts/ 目录在打包后位于 app.asar 内部，需要用 app.getAppPath()
    const layoutsDir = join(__dirname, "layouts");
    this.templateEngine = new TemplateEngine(layoutsDir);
    this.renderer = new HeadlessRenderer();
  }

  /** 返回可用主题摘要列表（供 ppt.themes 工具返回给模型）。 */
  getThemes(): Array<{ id: string; name: string; description: string; colors: Record<string, string> }> {
    return listThemeSummaries();
  }

  /** 生成 PPTX 文件。 */
  async generate(input: PresentationInput): Promise<PptGenerationResult> {
    const startTime = Date.now();

    try {
      // 1. 解析主题
      const theme = getThemeById(input.theme);
      if (!theme) {
        return {
          success: false,
          outputPath: input.outputPath,
          slideCount: 0,
          error: `未知主题: ${input.theme}。可用主题: ${listThemeSummaries().map((t) => t.id).join(", ")}`,
        };
      }

      // 2. 渲染每张 slide 的 HTML
      const htmlPages: string[] = [];
      const allEditableRegions: EditableRegion[][] = [];

      for (const slide of input.slides) {
        const layout = getLayout(slide.type);
        if (!layout) {
          return {
            success: false,
            outputPath: input.outputPath,
            slideCount: 0,
            error: `未知版式类型: ${slide.type}。可用类型: cover, section, key_points, metrics, comparison, closing`,
          };
        }

        // 渲染 HTML
        const html = this.templateEngine.render(slide.type, slide.data, theme);
        htmlPages.push(html);

        // 计算可编辑区域坐标
        const regions = layout.resolveEditableRegions(slide.data, theme);
        allEditableRegions.push(regions);
      }

      // 3. 批量截图（Playwright headless）
      log.info("开始渲染 slide 背景", { count: htmlPages.length });
      const backgrounds = await this.renderer.renderBatch(htmlPages);

      // 4. 组装 PPTX
      log.info("开始组装 PPTX");
      await assemblePptx(input, backgrounds, allEditableRegions, theme);

      const elapsed = Date.now() - startTime;
      log.info("PPT 生成完成", {
        slideCount: input.slides.length,
        theme: input.theme,
        elapsedMs: elapsed,
        outputPath: input.outputPath,
      });

      return {
        success: true,
        outputPath: input.outputPath,
        slideCount: input.slides.length,
      };
    } catch (err) {
      log.error("PPT 生成失败", { error: String(err) });
      return {
        success: false,
        outputPath: input.outputPath,
        slideCount: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** 关闭渲染器资源（app 退出时调用）。 */
  async shutdown(): Promise<void> {
    await this.renderer.close();
  }
}
```

---

## Agent C: Design System & HTML Templates

**Scope:** 设计和实现主题系统、HTML 版式模板、可编辑层坐标映射。**这是决定"好不好看"的核心 Agent。**

**Files to create:**
- `desktop/src/main/services/ppt/themes/index.ts`
- `desktop/src/main/services/ppt/themes/business-blue.ts`
- `desktop/src/main/services/ppt/themes/tech-dark.ts`
- `desktop/src/main/services/ppt/themes/fresh-green.ts`
- `desktop/src/main/services/ppt/layouts/index.ts`
- `desktop/src/main/services/ppt/layouts/cover.html` + `cover.ts`
- `desktop/src/main/services/ppt/layouts/section.html` + `section.ts`
- `desktop/src/main/services/ppt/layouts/key-points.html` + `key-points.ts`
- `desktop/src/main/services/ppt/layouts/metrics.html` + `metrics.ts`
- `desktop/src/main/services/ppt/layouts/comparison.html` + `comparison.ts`
- `desktop/src/main/services/ppt/layouts/closing.html` + `closing.ts`

### Task C1: Theme Registry

**Create:** `desktop/src/main/services/ppt/themes/index.ts`

```typescript
import type { Theme } from "../types";
import { businessBlue } from "./business-blue";
import { techDark } from "./tech-dark";
import { freshGreen } from "./fresh-green";

const THEMES: Theme[] = [businessBlue, techDark, freshGreen];

export function getThemeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

export function listThemeSummaries() {
  return THEMES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    colors: {
      primary: t.colors.primary,
      secondary: t.colors.secondary,
      accent: t.colors.accent,
      background: t.colors.background,
    },
  }));
}
```

### Task C2: Business Blue Theme

**Create:** `desktop/src/main/services/ppt/themes/business-blue.ts`

实现要点：
- 以 `#1e3a5f` 深蓝为主色，`#4a90d9` 亮蓝为辅助，`#f5a623` 金色为强调
- `cssVariables` 字符串包含所有 `--color-*`, `--font-*` CSS 变量
- fonts 使用 "Microsoft YaHei" 中文 + "Segoe UI" 英文 fallback
- metric 大字使用 "DIN Alternate" → "Arial" fallback

### Task C3: Tech Dark Theme

**Create:** `desktop/src/main/services/ppt/themes/tech-dark.ts`

实现要点：
- 深色背景 `#0f172a` → `#1e293b` 渐变
- 霓虹蓝 `#3b82f6` + 紫 `#8b5cf6` 作为强调
- 适合技术方案、产品架构类演示
- 文字颜色使用浅色系 `#f1f5f9`

### Task C4: Fresh Green Theme

**Create:** `desktop/src/main/services/ppt/themes/fresh-green.ts`

实现要点：
- 清爽白底 `#ffffff` + 绿色系 `#059669` 主色
- 适合培训、分享、知识类演示
- 柔和的圆角卡片风格

### Task C5: Layout Registry

**Create:** `desktop/src/main/services/ppt/layouts/index.ts`

```typescript
import type { SlideLayout } from "../types";
import { coverLayout } from "./cover";
import { sectionLayout } from "./section";
import { keyPointsLayout } from "./key-points";
import { metricsLayout } from "./metrics";
import { comparisonLayout } from "./comparison";
import { closingLayout } from "./closing";

const LAYOUTS = new Map<string, SlideLayout>([
  ["cover", coverLayout],
  ["section", sectionLayout],
  ["key_points", keyPointsLayout],
  ["metrics", metricsLayout],
  ["comparison", comparisonLayout],
  ["closing", closingLayout],
]);

export function getLayout(type: string): SlideLayout | undefined {
  return LAYOUTS.get(type);
}

export function listLayoutSummaries() {
  return Array.from(LAYOUTS.values()).map((l) => ({
    type: l.type,
    name: l.name,
    description: l.description,
    dataSchema: l.dataSchema,
  }));
}
```

### Task C6: Cover Layout (HTML + 坐标映射)

**Create:** `desktop/src/main/services/ppt/layouts/cover.html`

HTML 模板设计要求：
- 1920×1080 画布
- 使用 CSS 变量 `var(--color-primary)` 等引用主题色
- 全屏渐变背景 + 装饰元素（光晕、几何图形、微妙纹理）
- 标题区域大字居中偏左，副标题在下方
- 底部装饰线 + 作者/日期
- Handlebars 占位: `{{title}}`, `{{subtitle}}`, `{{author}}`, `{{date}}`

**Create:** `desktop/src/main/services/ppt/layouts/cover.ts`

```typescript
import type { SlideLayout, EditableRegion, Theme } from "../types";

export const coverLayout: SlideLayout = {
  type: "cover",
  name: "封面",
  description: "演示文稿首页，包含标题、副标题、作者和日期",
  dataSchema: {
    title: "string (必填) — 演示文稿主标题",
    subtitle: "string (可选) — 副标题或部门名称",
    author: "string (可选) — 演讲人姓名",
    date: "string (可选) — 日期",
  },
  htmlTemplate: "cover.html",
  resolveEditableRegions(data, theme): EditableRegion[] {
    // px / 192 = inches  (1920px = 10in, 1080px = 5.625in)
    const regions: EditableRegion[] = [];
    const fonts = theme.fonts;

    // 主标题
    if (data.title) {
      regions.push({
        key: "title",
        x: 0.83, y: 1.56, w: 8.33, h: 0.83,
        fontSize: fonts.title.size,
        fontFace: fonts.title.face,
        color: fonts.title.color.replace("#", ""),
        bold: true,
        align: "left",
        valign: "bottom",
      });
    }

    // 副标题
    if (data.subtitle) {
      regions.push({
        key: "subtitle",
        x: 0.83, y: 2.50, w: 8.33, h: 0.52,
        fontSize: fonts.subtitle.size,
        fontFace: fonts.subtitle.face,
        color: fonts.subtitle.color.replace("#", ""),
        bold: false,
        align: "left",
      });
    }

    // 作者
    if (data.author) {
      regions.push({
        key: "author",
        x: 0.83, y: 4.48, w: 4.0, h: 0.35,
        fontSize: fonts.body.size,
        fontFace: fonts.body.face,
        color: fonts.body.color.replace("#", ""),
        align: "left",
      });
    }

    // 日期
    if (data.date) {
      regions.push({
        key: "date",
        x: 0.83, y: 4.84, w: 4.0, h: 0.35,
        fontSize: fonts.caption.size,
        fontFace: fonts.caption.face,
        color: fonts.caption.color.replace("#", ""),
        align: "left",
      });
    }

    return regions;
  },
};
```

### Task C7: Metrics Layout (数据大字报)

HTML 设计要求：
- 2-4 个 KPI 卡片，等宽水平排列
- 每个卡片：圆角磨砂背景、图标圆圈、大字数值、标签、趋势箭头
- 顶部标题 + 装饰线
- 卡片之间有微妙的悬浮感（阴影 / 边框发光）
- Handlebars: `{{title}}`, `{{#each items}}...{{/each}}`

坐标映射 `.ts`：
- `resolveEditableRegions` 根据 `items.length` 动态计算每个卡片的 x 坐标
- 每个 item 有 3 个可编辑区域: `items[i].value`, `items[i].label`, `items[i].change`

### Task C8: Key Points Layout (要点列表)

HTML 设计要求：
- 左侧或顶部标题，下方 3-6 个要点
- 每个要点有图标 + 文字，水平或垂直排列
- 要点之间有分隔线或间距
- 支持 icon 字段映射到 SVG（先用 emoji fallback）

### Task C9: Comparison Layout (左右对比)

HTML 设计要求：
- 双栏布局，左右各一个面板
- 面板有不同底色区分
- 各自有标签 + 要点列表
- 中间有 VS 或分隔线

### Task C10: Section & Closing Layouts

Section: 大字标题居中 + 章节编号 + 装饰图形
Closing: 感谢语 + 联系方式 + 装饰元素

### HTML 模板设计规范（所有版式通用）

```
每个 .html 模板必须遵守：

1. 画布固定 1920×1080，position:relative
2. 所有颜色通过 CSS 变量引用：var(--color-primary) 等
3. 文字区域使用 Handlebars 占位，位置必须与 .ts 中的坐标精确对应
4. 装饰元素（渐变、光晕、纹理、几何图形）要丰富但不喧宾夺主
5. 要有层次感：背景层 → 装饰层 → 内容层
6. 字体使用 CSS font-family fallback 链
7. 所有尺寸用 px（不用 rem/em），因为画布固定大小
8. 不引用外部 CDN 资源（离线可用）
```

---

## Agent D: Skill — ppt-designer

**Scope:** 创建教会模型演示设计方法论的 Skill + 预览面板。

**Files to create:**
- `desktop/builtin-skills/ppt-designer/SKILL.md`
- `desktop/builtin-skills/ppt-designer/preview.html`
- `desktop/builtin-skills/ppt-designer/references/slide-types.md`

### Task D1: SKILL.md

核心内容结构：

```markdown
---
name: PPT 设计助手
description: 帮助用户创建专业美观的演示文稿。检测到 PPT/演示/汇报/幻灯片/slide 相关需求时应主动调用。
---

# PPT 设计助手

（以下内容在模型 invoke 此 skill 时注入上下文）

## 你的角色
你是一个资深演示设计顾问。...

## 完整工作流程
### Step 1: 需求分析
### Step 2: 结构规划（含设计原则：一页一主题、6-6法则、节奏感等）
### Step 3: 选择主题（调用 ppt_themes）
### Step 4: 编写 slides JSON
### Step 5: 预览（调用 skill_view → preview.html）
### Step 6: 用户确认后生成（调用 ppt_generate）

## 每种版式的 data 格式速查
### cover
### section
### key_points
### metrics
### comparison
### closing

## 设计禁忌清单
- 一页超过 6 个要点
- 连续纯文字页
- 标题超过 15 个字
- ...

## 完整调用示例
（一个完整的 12 页汇报 PPT 的 JSON 示例）
```

### Task D2: preview.html

预览面板设计要求：
- 暗色主题（与 MyClaw UI 一致，参考 skill-starter 样式）
- 接收 `skill-data` postMessage，数据格式与 `ppt_generate` 输入相同
- 左侧缩略图侧栏（slide 列表，可点击选中）
- 右侧放大预览（选中 slide 的详细视图）
- 用纯 CSS 模拟各版式的布局效果（不需要精确到像素，提供结构预览即可）
- 底部显示 slide 信息（type、当前页/总页数）
- 顶部主题色预览条

数据流：
```javascript
window.addEventListener("message", (e) => {
  if (e.data.type === "skill-data") {
    const { theme, slides, meta } = e.data.payload;
    renderPreview(theme, slides, meta);
  }
});
```

### Task D3: references/slide-types.md

每种版式的详细说明：
- data 字段完整定义
- JSON 示例
- 适用场景描述
- 设计效果文字描述

### Task D4: Seed into builtin-skills

确认 `desktop/src/main/services/skill-loader.ts` 的 `seedBuiltinSkills()` 会自动复制 `builtin-skills/ppt-designer/` 到用户目录。检查现有逻辑是否需要修改（通常不需要——它会复制所有 builtin-skills 子目录）。

---

## Agent E: Integration, Testing & Polish

**Scope:** 端到端集成验证、错误处理增强、性能优化。

**Depends on:** Agent A + B + C + D 全部完成。

### Task E1: TypeScript 编译验证

```bash
cd desktop && pnpm run build:main
```

修复所有类型错误、导入路径问题。
确认 `tsconfig.main.json` 包含 `src/main/services/ppt/**/*`。

### Task E2: HTML 模板文件打包验证

确认 `.html` 文件在 electron-builder 打包后可访问：
- 检查 `package.json` 的 `files` / `extraResources` 配置
- `.html` 文件默认会被 tsc 忽略，需要确保复制到 dist
- 可能需要在 build 脚本中添加复制步骤
- 或将 HTML 内容内联为 TypeScript 字符串常量（推荐，避免文件路径问题）

方案：如果打包路径有问题，改为将 HTML 模板作为 template literal 内联到各 layout 的 `.ts` 文件中：
```typescript
// layouts/cover.ts
export const coverHtml = `
<div class="slide" style="width:1920px;height:1080px;">
  ...
</div>
`;
```
这样模板跟随 TypeScript 编译，不存在文件路径问题。

### Task E3: End-to-end smoke test

创建一个手动测试脚本或 Vitest 测试：

```typescript
// tests/ppt-engine.test.ts
import { PptEngine } from "../src/main/services/ppt/index";

test("生成基础 PPT", async () => {
  const engine = new PptEngine();
  const result = await engine.generate({
    outputPath: "/tmp/test-output.pptx",
    theme: "business-blue",
    slides: [
      { type: "cover", data: { title: "测试标题", subtitle: "测试副标题" } },
      { type: "key_points", data: { title: "要点", points: [{ text: "第一点" }, { text: "第二点" }] } },
      { type: "closing", data: { message: "谢谢" } },
    ],
  });

  expect(result.success).toBe(true);
  expect(result.slideCount).toBe(3);
  // 验证文件存在
  expect(existsSync(result.outputPath)).toBe(true);
}, 30_000); // Playwright 启动需要时间
```

### Task E4: Error handling 增强

- theme 不存在 → 清晰错误 + 可用列表
- layout type 不存在 → 清晰错误 + 可用列表
- outputPath 无写权限 → 友好提示
- Playwright 启动失败（无浏览器） → 明确提示安装 Chrome/Edge
- data 字段缺失 → 用 fallback 值，不报错（鲁棒性）
- 单张 slide 渲染失败 → 跳过并标记，不影响其他 slide

### Task E5: Performance optimization

- HeadlessRenderer 复用同一 page 实例（已实现在 renderBatch 中）
- HTML 模板编译结果缓存（已实现在 TemplateEngine 中）
- 考虑并行截图：如果 slide 数量 > 5，用 2-3 个 page 并行渲染
- 浏览器空闲 2 分钟后自动关闭

### Task E6: Shutdown 集成

在 `desktop/src/main/index.ts` 的 app quit handler 中添加：

```typescript
// 在 app.on("before-quit") 或 window-all-closed 中：
await executor.pptEngine.shutdown(); // 关闭无头浏览器
```

确认 `BuiltinToolExecutor.shutdown()` 中也调用 `this.pptEngine.shutdown()`。

---

## Agent Dependency Graph

```
Agent A (Foundation)      Agent C (Design)      Agent D (Skill)
  │ types.ts                │ themes/*.ts          │ SKILL.md
  │ tool registration       │ layouts/*.html       │ preview.html
  │                         │ layouts/*.ts         │
  └────────┬────────────────┘                      │
           │                                       │
           ▼                                       │
     Agent B (Engine)                              │
       │ template-engine.ts                        │
       │ headless-renderer.ts                      │
       │ assembler.ts                              │
       │ index.ts                                  │
       │                                           │
       └──────────────┬───────────────────────────┘
                      │
                      ▼
                Agent E (Integration)
                  │ 编译验证
                  │ 打包验证
                  │ E2E 测试
                  │ 性能优化
```

**并行策略：**
- Agent A / C / D **完全独立，可同时启动**
- Agent B 依赖 A（types.ts）和 C（themes, layouts），但可以先用 mock 数据开发
- Agent E 最后执行，验证所有 Agent 的产出物集成正确

---

## Model Interaction Example (最终效果)

```
User: 帮我做一个 Q1 的业绩汇报 PPT，给领导看的，数据我口述给你

Model: (读取 ppt-designer Skill，获得设计方法论)
       好的，我来帮你做。先了解一下：
       1. 大概汇报多长时间？
       2. 有哪些核心数据想呈现？
       3. 想强调什么结论？

User: 10 分钟，营收 2.3 亿增长 23%，新客户 1240 个，获客成本降了 15%，NPS 67...

Model: (调用 ppt_themes 了解可用主题)
       (规划 8 页结构，遵循一页一主题、节奏感等原则)
       (调用 skill_view → preview.html 展示预览)

       我帮你规划了 8 页的汇报结构，你在预览面板里看一下：
       1. 封面：2026 Q1 业绩回顾
       2. 章节：核心数据
       3. 数据大字报：4 个 KPI
       4. 对比页：Q1 vs Q4
       5. 章节：策略成果
       6. 要点列表：3 个核心策略
       7. 要点列表：下季度计划
       8. 结束页

User: 挺好的，第 3 页再加个利润率指标

Model: (修改 JSON，再次 skill_view 预览)
       好，已经加上利润率 18.7%。确认没问题的话我就生成文件了？

User: 可以了

Model: (调用 ppt_generate)
       ✅ 已生成演示文稿：C:/Users/jianing.zhang1/Desktop/Q1业绩回顾.pptx
       （8 页，business-blue 主题，可在 PowerPoint / WPS 中编辑）
```

---

## Risk & Mitigation

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| Playwright headless 启动慢 | 首次生成延迟 3-5s | 预热机制：首次调 ppt.themes 时就启动浏览器 |
| HTML 模板文件打包后路径错误 | 工具不可用 | 内联 HTML 为 TS 字符串常量（Task E2） |
| 可编辑文字与背景图位置偏移 | 文字叠在错误位置 | 坐标映射单元测试 + 视觉校验脚本 |
| pptxgenjs 不支持某些字体 | 显示效果与预期不同 | fallback 字体链 + 文档提示用户安装字体 |
| slide 数量过多导致 OOM | 背景 PNG 累积占用内存 | renderBatch 后及时释放 Buffer 引用 |
| 中文字符在 Playwright 中渲染异常 | 乱码或方块 | 使用系统字体 + font-family fallback |

---

## Success Criteria

1. ✅ 用户说"帮我做个 PPT"，模型能自动激活 ppt-designer Skill
2. ✅ 模型能通过 ppt_themes / ppt_generate 工具完成全流程
3. ✅ 生成的 .pptx 在 PowerPoint / WPS 中打开，背景精美，文字可双击编辑
4. ✅ 支持至少 3 套主题、6 种版式
5. ✅ 生成 10 页 PPT 耗时 < 15 秒（不含模型思考时间）
6. ✅ preview.html 能正确预览 slide 结构
7. ✅ 完全离线可用（不依赖外部 API）
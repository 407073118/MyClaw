/**
 * PPT 渲染引擎入口。
 *
 * 编排完整管线：
 * 1. 加载主题 → 2. 模板渲染 HTML → 3. Playwright 截图 → 4. pptxgenjs 组装
 */

import { join } from "node:path";
import { createLogger } from "../logger";
import { TemplateEngine } from "./template-engine";
import { HeadlessRenderer } from "./headless-renderer";
import { assemblePptx } from "./assembler";
import { getThemeById, listThemeSummaries } from "./themes/index";
import { getLayout } from "./layouts/index";
import type { PresentationInput, PptGenerationResult, EditableRegion, SlideLayout } from "./types";

const log = createLogger("ppt-engine");

export class PptEngine {
  private templateEngine: TemplateEngine;
  private renderer: HeadlessRenderer;

  constructor() {
    // layouts/ 目录在打包后可能位于 app.asar 内部
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
      // 0. 校验 slides 数量上限
      if (!input.slides || input.slides.length === 0) {
        return { success: false, outputPath: input.outputPath, slideCount: 0, error: "slides 不能为空" };
      }
      if (input.slides.length > 50) {
        return { success: false, outputPath: input.outputPath, slideCount: 0, error: `slides 数量 ${input.slides.length} 超过上限 50` };
      }

      // 1. 解析主题
      const theme = getThemeById(input.theme);
      if (!theme) {
        const available = listThemeSummaries().map((t) => t.id).join(", ");
        return {
          success: false,
          outputPath: input.outputPath,
          slideCount: 0,
          error: `未知主题: "${input.theme}"。可用主题: ${available}`,
        };
      }

      // 2. 渲染每张 slide 的 HTML 并收集可编辑区域
      const htmlPages: string[] = [];
      const allEditableRegions: EditableRegion[][] = [];

      for (let i = 0; i < input.slides.length; i++) {
        const slide = input.slides[i];
        const layout = getLayout(slide.type);
        if (!layout) {
          return {
            success: false,
            outputPath: input.outputPath,
            slideCount: 0,
            error: `第 ${i + 1} 张 slide 使用了未知版式: "${slide.type}"。`
              + `可用类型: cover, section, key_points, metrics, comparison, closing`,
          };
        }

        // 渲染 HTML：优先使用内联 htmlContent，回退到文件 htmlTemplate
        const html = this.renderSlideHtml(layout, slide.data, theme);
        htmlPages.push(html);

        // 计算可编辑区域坐标
        try {
          const regions = layout.resolveEditableRegions(slide.data, theme);
          allEditableRegions.push(regions);
        } catch (err) {
          log.warn(`第 ${i + 1} 张 slide 的可编辑区域计算失败，跳过文字叠加`, {
            type: slide.type,
            error: err instanceof Error ? err.message : String(err),
          });
          allEditableRegions.push([]);
        }
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
      const elapsed = Date.now() - startTime;
      log.error("PPT 生成失败", {
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: elapsed,
      });
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
    log.info("PPT 引擎已关闭");
  }

  // ── 内部方法 ────────────────────────────────────────

  /**
   * 根据 layout 定义渲染 slide HTML。
   *
   * 支持两种模式：
   * - 如果 layout 上存在 htmlContent 属性（内联 HTML），直接编译并渲染
   * - 否则使用 htmlTemplate 属性（文件名）从 layouts 目录读取
   */
  private renderSlideHtml(
    layout: SlideLayout,
    data: Record<string, unknown>,
    theme: import("./types").Theme,
  ): string {
    // 优先使用内联 HTML（打包安全）
    if (layout.htmlContent && layout.htmlContent.length > 0) {
      return this.templateEngine.render(layout.htmlContent, data, theme, true);
    }

    // 回退到文件系统读取
    const slideType = layout.htmlTemplate.replace(/\.html$/, "");
    return this.templateEngine.render(slideType, data, theme, false);
  }
}

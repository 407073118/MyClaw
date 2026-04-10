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
 * @param input           模型提供的演示文稿输入
 * @param backgrounds     每张 slide 对应的背景 PNG Buffer
 * @param editableRegions 每张 slide 的可编辑文字区域列表
 * @param theme           当前主题
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
 * 支持点号分隔和数组下标，如 "title", "points[0].text", "items[2].value"。
 */
function resolveDataValue(
  data: Record<string, unknown>,
  keyPath: string,
): unknown {
  // 将 "points[0].text" 转为 "points.0.text"，然后按 "." 分割
  const parts = keyPath.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

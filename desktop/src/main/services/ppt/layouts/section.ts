import type { SlideLayout, EditableRegion, Theme } from "../types";

export const sectionLayout: SlideLayout = {
  type: "section",
  name: "章节过渡",
  description: "章节分隔页，大字标题配章节编号，适合标记演示结构",
  dataSchema: {
    title: "string (必填) — 章节标题",
    sectionNumber: "number (可选) — 章节编号，如 1, 2（显示时自动补零为 01, 02）",
  },
  htmlTemplate: "section.html",
  resolveEditableRegions(data, theme): EditableRegion[] {
    const regions: EditableRegion[] = [];

    // 章节标题: HTML top=420px left=260px w=1400px h=160px
    // 在 section 页上文字颜色为 textOnPrimary（白底深色主色背景）
    if (data.title) {
      regions.push({
        key: "title",
        x: 260 / 192,   // 1.35
        y: 420 / 192,   // 2.19
        w: 1400 / 192,  // 7.29
        h: 160 / 192,   // 0.83
        fontSize: 44,
        fontFace: theme.fonts.title.face,
        color: theme.colors.textOnPrimary.replace("#", ""),
        bold: true,
        align: "left",
        valign: "middle",
      });
    }

    // 章节编号: HTML top=300px left=260px w=200px h=120px (大透明数字)
    // 编号作为装饰性文字也可编辑
    if (data.sectionNumber) {
      regions.push({
        key: "sectionNumber",
        x: 260 / 192,   // 1.35
        y: 300 / 192,   // 1.56
        w: 200 / 192,   // 1.04
        h: 120 / 192,   // 0.63
        fontSize: 80,
        fontFace: "Arial",
        color: theme.colors.textOnPrimary.replace("#", ""),
        bold: true,
        align: "left",
        valign: "middle",
      });
    }

    return regions;
  },
};

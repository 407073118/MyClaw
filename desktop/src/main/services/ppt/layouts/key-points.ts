import type { SlideLayout, EditableRegion, Theme } from "../types";

export const keyPointsLayout: SlideLayout = {
  type: "key_points",
  name: "要点列表",
  description: "3-6 个要点垂直排列，适合总结、分析、方案概述",
  dataSchema: {
    title: "string (必填) — 页面标题",
    points: "array (必填) — 要点列表，每项 { icon?: string, text: string }，建议 3-6 个",
  },
  htmlTemplate: "key-points.html",
  resolveEditableRegions(data, theme): EditableRegion[] {
    const regions: EditableRegion[] = [];
    const fonts = theme.fonts;
    const points = (data.points as Array<{ icon?: string; text: string }>) || [];
    const count = Math.min(points.length, 6);

    // 页面标题: HTML top=160px left=148px w=1600px h=70px
    if (data.title) {
      regions.push({
        key: "title",
        x: 148 / 192,    // 0.77
        y: 160 / 192,    // 0.83
        w: 1600 / 192,   // 8.33
        h: 70 / 192,     // 0.36
        fontSize: fonts.heading.size,
        fontFace: fonts.heading.face,
        color: fonts.heading.color.replace("#", ""),
        bold: true,
        align: "left",
        valign: "middle",
      });
    }

    // 要点列表区域: top=300px, 可用高度=700px, 每项有 12px gap
    // 每项高度 = (700 - (count-1)*12) / count
    const listTop = 300;
    const listHeight = 700;
    const gap = 12;
    const itemHeight = (listHeight - (count - 1) * gap) / count;
    const textLeftOffset = 148 + 52 + 28; // left + circle + margin

    for (let i = 0; i < count; i++) {
      const itemTop = listTop + i * (itemHeight + gap);
      // 文字区域在圆圈之后，右侧留出 padding
      // 圆圈 52px + margin-right 28px = 80px offset，加上 padding 36px
      const textX = 148 + 36 + 52 + 28; // left + padding + circle + gap
      const textW = 1624 - 36 - 52 - 28 - 20 - 8 - 36; // total - paddings - circle - dot

      regions.push({
        key: `points[${i}].text`,
        x: textX / 192,
        y: (itemTop + 24) / 192,  // 加上内边距
        w: textW / 192,
        h: (itemHeight - 48) / 192, // 减去上下内边距
        fontSize: fonts.body.size + 2,
        fontFace: fonts.body.face,
        color: fonts.body.color.replace("#", ""),
        bold: false,
        align: "left",
        valign: "middle",
      });
    }

    return regions;
  },
};

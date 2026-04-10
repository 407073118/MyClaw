import type { SlideLayout, EditableRegion, Theme } from "../types";

export const comparisonLayout: SlideLayout = {
  type: "comparison",
  name: "左右对比",
  description: "双栏对比布局，适合方案比较、优劣分析、前后对比",
  dataSchema: {
    title: "string (可选) — 页面标题",
    leftLabel: "string (必填) — 左侧面板标签",
    rightLabel: "string (必填) — 右侧面板标签",
    leftPoints: "string[] (必填) — 左侧要点列表",
    rightPoints: "string[] (必填) — 右侧要点列表",
  },
  htmlTemplate: "comparison.html",
  resolveEditableRegions(data, theme): EditableRegion[] {
    const regions: EditableRegion[] = [];
    const fonts = theme.fonts;
    const leftPoints = (data.leftPoints as string[]) || [];
    const rightPoints = (data.rightPoints as string[]) || [];

    // 页面标题: HTML top=80px left=148px w=1600px h=60px
    if (data.title) {
      regions.push({
        key: "title",
        x: 148 / 192,    // 0.77
        y: 80 / 192,     // 0.42
        w: 1600 / 192,   // 8.33
        h: 60 / 192,     // 0.31
        fontSize: fonts.heading.size,
        fontFace: fonts.heading.face,
        color: fonts.heading.color.replace("#", ""),
        bold: true,
        align: "left",
        valign: "middle",
      });
    }

    // 双栏容器: top=210px left=120px w=1680px h=800px gap=40px
    // 左面板宽度 = (1680 - 40 - 60) / 2 = 790px (60px = VS区域)
    // 右面板起始 = 120 + 790 + 40 + 60 + 40 = 1050px (左+gap+vs+gap)
    const panelWidth = 790;
    const leftPanelLeft = 120;
    const rightPanelLeft = 120 + panelWidth + 40 + 60 + 40; // 1050
    const panelTop = 210;

    // 左侧标签: 面板内 padding=40px, 标签区域
    if (data.leftLabel) {
      regions.push({
        key: "leftLabel",
        x: (leftPanelLeft + 40 + 10 + 12) / 192,  // padding + dot + gap
        y: (panelTop + 45) / 192,
        w: (panelWidth - 80 - 22) / 192,
        h: 40 / 192,
        fontSize: 22,
        fontFace: fonts.heading.face,
        color: theme.colors.primary.replace("#", ""),
        bold: true,
        align: "left",
        valign: "middle",
      });
    }

    // 右侧标签
    if (data.rightLabel) {
      regions.push({
        key: "rightLabel",
        x: (rightPanelLeft + 40 + 10 + 12) / 192,
        y: (panelTop + 45) / 192,
        w: (panelWidth - 80 - 22) / 192,
        h: 40 / 192,
        fontSize: 22,
        fontFace: fonts.heading.face,
        color: theme.colors.accent.replace("#", ""),
        bold: true,
        align: "left",
        valign: "middle",
      });
    }

    // 左侧要点: 标签下方 32px margin + 40px top padding = 从面板顶部约 117px 开始
    const pointsStartY = panelTop + 40 + 40 + 32; // panel top + top pad + label height + margin
    const pointGap = 20;
    const maxPoints = Math.max(leftPoints.length, rightPoints.length);
    const availableHeight = 800 - 40 - 40 - 32 - 40; // panel h - top pad - label - margin - bottom pad
    const pointHeight = maxPoints > 0 ? Math.min(70, (availableHeight - (maxPoints - 1) * pointGap) / maxPoints) : 70;

    // 左侧要点
    for (let i = 0; i < leftPoints.length; i++) {
      const pointTop = pointsStartY + i * (pointHeight + pointGap);
      regions.push({
        key: `leftPoints[${i}]`,
        x: (leftPanelLeft + 40 + 3 + 16 + 8 + 16) / 192, // pad + border + pad + dot + gap
        y: (pointTop + 16) / 192,
        w: (panelWidth - 40 - 3 - 16 - 8 - 16 - 40) / 192,
        h: (pointHeight - 32) / 192,
        fontSize: fonts.body.size,
        fontFace: fonts.body.face,
        color: fonts.body.color.replace("#", ""),
        bold: false,
        align: "left",
        valign: "middle",
      });
    }

    // 右侧要点
    for (let i = 0; i < rightPoints.length; i++) {
      const pointTop = pointsStartY + i * (pointHeight + pointGap);
      regions.push({
        key: `rightPoints[${i}]`,
        x: (rightPanelLeft + 40 + 3 + 16 + 8 + 16) / 192,
        y: (pointTop + 16) / 192,
        w: (panelWidth - 40 - 3 - 16 - 8 - 16 - 40) / 192,
        h: (pointHeight - 32) / 192,
        fontSize: fonts.body.size,
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

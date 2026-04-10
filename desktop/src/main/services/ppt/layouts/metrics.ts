import type { SlideLayout, EditableRegion, Theme } from "../types";

export const metricsLayout: SlideLayout = {
  type: "metrics",
  name: "数据大字报",
  description: "2-4 个 KPI 大数字卡片，适合数据概览、业绩汇报、运营指标",
  dataSchema: {
    title: "string (必填) — 页面标题",
    items: "array (必填) — KPI 项，每项 { label: string, value: string, change?: string, trend?: 'up'|'down' }，建议 2-4 个",
  },
  htmlTemplate: "metrics.html",
  resolveEditableRegions(data, theme): EditableRegion[] {
    const regions: EditableRegion[] = [];
    const fonts = theme.fonts;
    const items = (data.items as Array<{ label: string; value: string; change?: string; trend?: string }>) || [];
    const count = Math.min(items.length, 4);

    // 页面标题: HTML top=100px left=148px w=1600px h=60px
    if (data.title) {
      regions.push({
        key: "title",
        x: 148 / 192,    // 0.77
        y: 100 / 192,    // 0.52
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

    // KPI 卡片容器: top=260px left=120px w=1680px h=580px, gap=32px
    // 每张卡片宽度 = (1680 - (count-1)*32) / count
    const containerLeft = 120;
    const containerTop = 260;
    const containerWidth = 1680;
    const containerHeight = 580;
    const cardGap = 32;
    const cardWidth = (containerWidth - (count - 1) * cardGap) / count;

    for (let i = 0; i < count; i++) {
      const cardLeft = containerLeft + i * (cardWidth + cardGap);

      // 大数值区域: 卡片中心偏上
      // 趋势图标 64px + margin 28px = 92px from top
      // 数值在图标下方，大约从卡片 40px padding + 64px icon + 28px margin 开始
      const valueTop = containerTop + 160;
      const valueHeight = 80;

      regions.push({
        key: `items[${i}].value`,
        x: cardLeft / 192,
        y: valueTop / 192,
        w: cardWidth / 192,
        h: valueHeight / 192,
        fontSize: fonts.metric.size,
        fontFace: fonts.metric.face,
        color: fonts.metric.color.replace("#", ""),
        bold: true,
        align: "center",
        valign: "middle",
      });

      // 标签区域: 数值下方
      const labelTop = valueTop + valueHeight + 12;
      const labelHeight = 36;

      regions.push({
        key: `items[${i}].label`,
        x: cardLeft / 192,
        y: labelTop / 192,
        w: cardWidth / 192,
        h: labelHeight / 192,
        fontSize: fonts.body.size,
        fontFace: fonts.body.face,
        color: fonts.body.color.replace("#", ""),
        bold: false,
        align: "center",
        valign: "middle",
      });

      // 变化值区域: 标签下方
      if (items[i]?.change) {
        const changeTop = labelTop + labelHeight + 16;
        const changeHeight = 30;

        // 变化值颜色根据趋势
        let changeColor = theme.colors.textLight.replace("#", "");
        if (items[i]?.trend === "up") {
          changeColor = theme.colors.success.replace("#", "");
        } else if (items[i]?.trend === "down") {
          changeColor = theme.colors.danger.replace("#", "");
        }

        regions.push({
          key: `items[${i}].change`,
          x: (cardLeft + 32) / 192,
          y: changeTop / 192,
          w: (cardWidth - 64) / 192,
          h: changeHeight / 192,
          fontSize: fonts.caption.size + 2,
          fontFace: fonts.caption.face,
          color: changeColor,
          bold: true,
          align: "center",
          valign: "middle",
        });
      }
    }

    return regions;
  },
};

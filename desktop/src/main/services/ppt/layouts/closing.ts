import type { SlideLayout, EditableRegion, Theme } from "../types";

export const closingLayout: SlideLayout = {
  type: "closing",
  name: "结束页",
  description: "演示文稿结束页，感谢语和联系方式居中展示",
  dataSchema: {
    message: "string (必填) — 感谢语或结束语，如 '感谢聆听'、'谢谢大家'",
    contact: "string (可选) — 联系方式，如邮箱、电话",
  },
  htmlTemplate: "closing.html",
  resolveEditableRegions(data, theme): EditableRegion[] {
    const regions: EditableRegion[] = [];
    const fonts = theme.fonts;

    // 感谢语: 居中，HTML top=50%-60px → 约480px, w=1400px h=120px
    // 绝对定位: left=50%-700px=260px
    if (data.message) {
      regions.push({
        key: "message",
        x: 260 / 192,    // 1.35
        y: 480 / 192,    // 2.50
        w: 1400 / 192,   // 7.29
        h: 120 / 192,    // 0.63
        fontSize: 44,
        fontFace: fonts.title.face,
        color: fonts.title.color.replace("#", ""),
        bold: true,
        align: "center",
        valign: "middle",
      });
    }

    // 联系方式: 居中，HTML top=50%+80px → 约620px, w=800px h=50px
    // 绝对定位: left=50%-400px=560px
    if (data.contact) {
      regions.push({
        key: "contact",
        x: 560 / 192,    // 2.92
        y: 620 / 192,    // 3.23
        w: 800 / 192,    // 4.17
        h: 50 / 192,     // 0.26
        fontSize: fonts.body.size,
        fontFace: fonts.body.face,
        color: fonts.body.color.replace("#", ""),
        bold: false,
        align: "center",
        valign: "middle",
      });
    }

    return regions;
  },
};

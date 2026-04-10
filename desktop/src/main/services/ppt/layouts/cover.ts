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

    // 主标题: HTML top=250px left=190px w=1400px h=140px
    if (data.title) {
      regions.push({
        key: "title",
        x: 190 / 192,   // 0.99
        y: 250 / 192,   // 1.30
        w: 1400 / 192,  // 7.29
        h: 140 / 192,   // 0.73
        fontSize: fonts.title.size,
        fontFace: fonts.title.face,
        color: fonts.title.color.replace("#", ""),
        bold: true,
        align: "left",
        valign: "bottom",
      });
    }

    // 副标题: HTML top=420px left=190px w=1400px h=80px
    if (data.subtitle) {
      regions.push({
        key: "subtitle",
        x: 190 / 192,   // 0.99
        y: 420 / 192,   // 2.19
        w: 1400 / 192,  // 7.29
        h: 80 / 192,    // 0.42
        fontSize: fonts.subtitle.size,
        fontFace: fonts.subtitle.face,
        color: fonts.subtitle.color.replace("#", ""),
        bold: false,
        align: "left",
        valign: "middle",
      });
    }

    // 作者: HTML bottom=120px → top=1080-120-40=920px, left=160px w=600px h=40px
    if (data.author) {
      regions.push({
        key: "author",
        x: 160 / 192,   // 0.83
        y: 920 / 192,   // 4.79
        w: 600 / 192,   // 3.13
        h: 40 / 192,    // 0.21
        fontSize: fonts.body.size,
        fontFace: fonts.body.face,
        color: fonts.body.color.replace("#", ""),
        align: "left",
        valign: "middle",
      });
    }

    // 日期: HTML bottom=75px → top=1080-75-35=970px, left=160px w=600px h=35px
    if (data.date) {
      regions.push({
        key: "date",
        x: 160 / 192,   // 0.83
        y: 970 / 192,   // 5.05
        w: 600 / 192,   // 3.13
        h: 35 / 192,    // 0.18
        fontSize: fonts.caption.size,
        fontFace: fonts.caption.face,
        color: fonts.caption.color.replace("#", ""),
        align: "left",
        valign: "middle",
      });
    }

    return regions;
  },
};

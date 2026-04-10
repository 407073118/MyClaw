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
  color: string;       // hex color, e.g. "#1e3a5f" — layouts strip '#' for pptxgenjs
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
  color: string;        // 6-char hex without '#', for pptxgenjs
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
  /** HTML 模板文件名（相对于 layouts/ 目录），作为内联 htmlContent 不可用时的回退 */
  htmlTemplate: string;
  /** 内联 HTML 模板字符串（打包安全，优先使用） */
  htmlContent?: string;
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

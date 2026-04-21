/**
 * DocumentIR 契约：统一文档中间表示。
 *
 * 设计原则：
 * - 仅保留语义结构（标题层级 / 表格 / 列表 / 页码 / 幻灯片 / 备注 / 批注 / 脚注）
 * - 不保留表现层（字体字号等）
 * - type-only 模块，零运行时依赖
 *
 * 下游消费方：
 * - parser（xlsx / docx / pdf / pptx / md / txt / csv）统一产出 DocumentIR
 * - document.read 工具门面以 DocumentIR 为中枢
 * - IR→Markdown 渲染器、outline 导航、search 检索均基于同一结构
 */

/** 支持的文档格式。扩展格式时在此追加。 */
export type DocumentFormat =
  | "xlsx"
  | "xls"
  | "xlsm"
  | "docx"
  | "pdf"
  | "pptx"
  | "md"
  | "txt"
  | "csv";

/** 原始文件来源信息。用于缓存键与溯源审计。 */
export type DocumentSource = {
  /** 文件绝对路径 */
  path: string;
  /** 文件格式（小写扩展名） */
  format: DocumentFormat;
  /** 文件字节数 */
  bytes: number;
  /** 文件内容 sha256（小写 hex），作为缓存主键 */
  sha256: string;
};

/** 文档元信息（可选，由 parser 能拿就拿）。 */
export type DocumentMeta = {
  title?: string;
  author?: string;
  /** ISO8601 时间戳 */
  modifiedAt?: string;
  pages?: number;
  words?: number;
};

/** 节点位置定位。按格式差异使用不同字段。 */
export type Locator = {
  /** pdf：页码（1-based） */
  page?: number;
  /** pptx：幻灯片索引（1-based） */
  slide?: number;
  /** xlsx：sheet 名称 */
  sheet?: string;
  /** docx / md：最近的标题文本 */
  heading?: string;
  /** body 节点索引区间 [start, endExclusive]，用于 range 切片 */
  range?: [number, number];
};

/** 扁平大纲项。供 outline mode 与 heading 跳转使用。 */
export type OutlineItem = {
  /** 1..6 */
  level: number;
  title: string;
  locator: Locator;
};

/** 媒体引用（图片等）。实际字节落盘到 cachePath，不内联到 IR。 */
export type MediaRef = {
  id: string;
  mime: string;
  /** 落盘路径，一般位于 userData/docCache/<sha256>/media/ */
  cachePath: string;
  alt?: string;
  width?: number;
  height?: number;
};

/** 行内样式片段。bold/italic/code 可叠加。 */
export type InlineRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

// ─────────────────────────────────────────────────────────
// DocumentNode 判别联合：12 种 kind
// ─────────────────────────────────────────────────────────

export type HeadingNode = {
  kind: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  runs: InlineRun[];
  locator: Locator;
};

export type ParagraphNode = {
  kind: "paragraph";
  runs: InlineRun[];
  locator: Locator;
};

export type ListNode = {
  kind: "list";
  ordered: boolean;
  /** 每项为一串 InlineRun */
  items: InlineRun[][];
  locator: Locator;
};

export type TableNode = {
  kind: "table";
  /** rows[rowIdx][colIdx] = InlineRun[]（单元格内可含行内样式） */
  rows: InlineRun[][][];
  locator: Locator;
};

export type ImageNode = {
  kind: "image";
  /** 指向 DocumentIR.media 中的 MediaRef.id */
  mediaId: string;
  locator: Locator;
};

export type CodeNode = {
  kind: "code";
  lang?: string;
  text: string;
  locator: Locator;
};

export type QuoteNode = {
  kind: "quote";
  runs: InlineRun[];
  locator: Locator;
};

export type SlideNode = {
  kind: "slide";
  /** 1-based 幻灯片序号 */
  index: number;
  title?: string;
  body: DocumentNode[];
  /** 演讲者备注 */
  notes?: DocumentNode[];
  locator: Locator;
};

export type SheetNode = {
  kind: "sheet";
  name: string;
  dims: { rows: number; cols: number };
  table: TableNode;
  locator: Locator;
};

export type CommentNode = {
  kind: "comment";
  author?: string;
  runs: InlineRun[];
  locator: Locator;
};

export type FootnoteNode = {
  kind: "footnote";
  refId: string;
  runs: InlineRun[];
  locator: Locator;
};

export type PageBreakNode = {
  kind: "pageBreak";
  page: number;
  locator: Locator;
};

/** 文档节点判别联合。新增 kind 时务必同步更新 ir-to-markdown 渲染器的 switch 分支。 */
export type DocumentNode =
  | HeadingNode
  | ParagraphNode
  | ListNode
  | TableNode
  | ImageNode
  | CodeNode
  | QuoteNode
  | SlideNode
  | SheetNode
  | CommentNode
  | FootnoteNode
  | PageBreakNode;

/** DocumentIR 主体。所有 parser 的最终产物，所有下游消费方的输入。 */
export type DocumentIR = {
  source: DocumentSource;
  meta: DocumentMeta;
  outline: OutlineItem[];
  body: DocumentNode[];
  media: MediaRef[];
};

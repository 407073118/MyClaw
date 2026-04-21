/**
 * pdfParser：将 .pdf 解析为 DocumentIR。
 *
 * 设计要点：
 * - 每页产出一个 PageBreakNode + 至少一个 ParagraphNode，都挂 locator.page 便于
 *   后续 read/search/outline mode 按页切片
 * - 扫描页（getTextContent 返回空 items 或全部为空白）统一打一个中文标记：
 *   "(扫描页：未抽取到文字)"，诚实提示模型而不是默默返回空文本
 * - 每页同时在 outline 注册一条 level=1 / title="Page {N}" 的条目
 *
 * 安全约束（与其它 parser 一致，零 Python、零进程外溢）：
 * - isEvalSupported: false —— 禁止 PDF 内嵌 JS 执行（pdfjs 的默认是 true）
 * - disableStream: true —— 禁止 pdfjs 按 Range 分片读取
 * - disableAutoFetch: true —— 禁止 pdfjs 主动预取子资源
 * - disableFontFace: true —— 主进程中不注册 font-face（不渲染，无意义）
 * - 系统字体探测旋钮保留默认（false），避免主进程触及字体目录 I/O
 *
 * 运行时约束：
 * - 使用 await import("pdfjs-dist/legacy/build/pdf.js") 惰性加载：主进程启动不
 *   强制加载 pdfjs（~5MB），同时让 Vitest 3 的 vi.mock 能够正确拦截。
 *   （CJS require 在 Vite 环境下无法被 module-graph mock 截获。）
 * - legacy 构建是 CJS 友好的 UMD，支持 Node require / dynamic import；v3.x 是
 *   最后的 CJS 版本（v4+ 仅 ESM，路径命名也变更）
 */

import type {
  DocumentIR,
  InlineRun,
  OutlineItem,
  PageBreakNode,
  ParagraphNode,
} from "@shared/contracts";
import type { DocumentParser, ParseInput } from "../parser-registry";

/** 扫描页（无可抽取文字）时使用的中文标记，与项目其它状态提示保持一致。 */
const SCANNED_PAGE_MARKER = "(扫描页：未抽取到文字)";

/**
 * 将 PDF Buffer 解析为 DocumentIR。
 *
 * 纯函数语义：仅消费 input.buffer，不触发文件系统读取；零进程外溢。
 */
export async function parsePdfBuffer(input: ParseInput): Promise<DocumentIR> {
  let pdfjs: any;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
    // 兼容 default / namespace export：getDocument 可能挂在 .default 或 namespace 顶层。
    if (!pdfjs.getDocument && pdfjs.default?.getDocument) {
      pdfjs = pdfjs.default;
    }
  } catch {
    throw new Error(
      "[E_DOC_DEP_MISSING] pdfjs-dist 未安装。请在 desktop/ 目录执行 `pnpm install` 后重启桌面端。",
    );
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(input.buffer),
    // 关键安全旋钮：见模块头注释。
    isEvalSupported: false,
    disableFontFace: true,
    disableStream: true,
    disableAutoFetch: true,
  });
  const doc = await loadingTask.promise;
  const numPages: number = typeof doc.numPages === "number" ? doc.numPages : 0;

  const body: Array<PageBreakNode | ParagraphNode> = [];
  const outline: OutlineItem[] = [];

  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: Array<{ str?: string }> = Array.isArray(content?.items)
      ? content.items
      : [];

    // 每页先打一个 PageBreak，locator.page 指向当前页（1-based）。
    const pageBreak: PageBreakNode = {
      kind: "pageBreak",
      page: p,
      locator: { page: p },
    };
    body.push(pageBreak);

    // outline：一页一条，level=1，title=Page N。
    outline.push({
      level: 1,
      title: `Page ${p}`,
      locator: { page: p },
    });

    // 判断是否为扫描页：空 items 或全部 str 为空白。
    const isScanned =
      items.length === 0 ||
      items.every((it) => !it.str || it.str.trim() === "");

    if (isScanned) {
      const runs: InlineRun[] = [{ text: SCANNED_PAGE_MARKER }];
      const para: ParagraphNode = {
        kind: "paragraph",
        runs,
        locator: { page: p },
      };
      body.push(para);
      continue;
    }

    // 合并该页所有 text items：空格拼接后压缩连续空白。
    const text = items
      .map((it) => (typeof it.str === "string" ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const runs: InlineRun[] = [{ text }];
    const para: ParagraphNode = {
      kind: "paragraph",
      runs,
      locator: { page: p },
    };
    body.push(para);
  }

  return {
    source: {
      path: input.path,
      format: "pdf",
      bytes: input.buffer.length,
      sha256: input.sha256,
    },
    meta: { pages: numPages },
    outline,
    body,
    media: [],
  };
}

/** pdfParser 单例：供 parser-registry 按 format 注册。 */
export const pdfParser: DocumentParser = {
  format: "pdf",
  parse: parsePdfBuffer,
};

/**
 * pptxParser：将 .pptx 解析为 DocumentIR。
 *
 * 设计与 docx-parser（08-05）保持对称：
 *   - 同一 jszip 顶层依赖（08-05 已在 desktop/package.json 登记，本 plan 不动 package.json）
 *   - 同一 assertNoDoctype / readZipEntryCapped 防御模式（XXE + 16MiB 单 entry 上限）
 *   - 同一 extractAText 极简 XML 正则游走（不引入第二套 XML 解析器，减少攻击面）
 *
 * 语义重点：
 *   - 按 ppt/slides/slideN.xml 的 N 升序展开为 SlideNode，保证幻灯片原始顺序
 *   - 每张幻灯片额外尝试读取 ppt/notesSlides/notesSlideN.xml，取到内容则挂在 SlideNode.notes
 *   - SlideNode.notes 为 undefined 表示"没有备注"（不是"空的备注数组"）
 *   - 外链媒体（ppt/slides/_rels/slideN.xml.rels 中的外部 Target URL）不取回：parse-time 不联网
 *
 * 安全约束：
 *   - 零 Python
 *   - 零外发 HTTP / 子进程
 *   - 每个 zip entry 上限 16 MiB，超过则 [E_DOC_ZIP_ENTRY_TOO_LARGE]
 *   - 任何 XML 的 <!DOCTYPE 都触发 [E_DOC_XXE_BLOCKED]
 */

import type {
  DocumentIR,
  OutlineItem,
  ParagraphNode,
  SlideNode,
} from "@shared/contracts";
import type { DocumentParser, ParseInput } from "../parser-registry";

/** pptx 内部 XML 若出现 DOCTYPE，一律视为被篡改；直接拒绝。 */
const XXE_MARKER = "<!DOCTYPE";

/** 单个 ZIP entry 解压后最大允许字节数（zip-bomb 防御）。 */
const MAX_PPTX_ENTRY_BYTES = 16 * 1024 * 1024; // 16 MiB

/**
 * 守门：pptx 内部 XML 不得包含 DOCTYPE 声明。
 * 与 08-05 docx-parser 的 assertNoDoctype 语义一致，仅文本提示对应到 pptx 场景。
 */
function assertNoDoctype(xml: string): void {
  if (xml.includes(XXE_MARKER)) {
    throw new Error(
      "[E_DOC_XXE_BLOCKED] pptx 中检测到外部实体（DOCTYPE）声明。请确认文件未被篡改。",
    );
  }
}

/**
 * 带大小上限读取 ZIP entry：先拿字节，校验尺寸，再解码为 UTF-8 字符串。
 * - 缺失 entry 返回 null，不视为错误（上层自己判断语义）
 * - 尺寸超限直接抛 [E_DOC_ZIP_ENTRY_TOO_LARGE]，且发生在 TextDecoder 之前，避免大字符串浪费内存
 */
async function readPptxEntryCapped(zip: any, entryPath: string): Promise<string | null> {
  const entry = zip.file(entryPath);
  if (!entry) return null;
  const bytes: Uint8Array = await entry.async("uint8array");
  if (bytes.byteLength > MAX_PPTX_ENTRY_BYTES) {
    throw new Error(
      `[E_DOC_ZIP_ENTRY_TOO_LARGE] pptx 内部 ${entryPath} 超过 16MiB 上限（实际 ${bytes.byteLength} 字节）。请确认 pptx 未包含异常大的嵌入资源。`,
    );
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** 解码最小 XML 实体集合（pptx 文本通常只会出现这几个）。 */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * 从一段 pptx XML 中按 `<a:p>` 段落切分，每段拼接内部所有 `<a:t>` 文本。
 * 遇到 DOCTYPE 立刻抛 [E_DOC_XXE_BLOCKED]。
 * 返回的是"段落级"字符串数组，便于上层把每段落映射成一个 ParagraphNode。
 */
function extractPptxParagraphs(xml: string): string[] {
  assertNoDoctype(xml);
  const paragraphs: string[] = [];
  const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let m: RegExpExecArray | null;
  while ((m = pRegex.exec(xml)) !== null) {
    const inner = m[1];
    const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
    const parts: string[] = [];
    let tm: RegExpExecArray | null;
    while ((tm = tRegex.exec(inner)) !== null) {
      parts.push(decodeXmlEntities(tm[1]));
    }
    paragraphs.push(parts.join(""));
  }
  return paragraphs;
}

/** 解析 slide 编号（1-based）；不是合法名则返回 NaN。 */
function parseSlideIndex(entryPath: string): number {
  const m = entryPath.match(/^ppt\/slides\/slide(\d+)\.xml$/);
  return m ? parseInt(m[1], 10) : NaN;
}

/**
 * 将 .pptx Buffer 解析为 DocumentIR。
 *
 * 约束：不处理外链媒体（ppt/slides/_rels/slideN.xml.rels 中的外部 Target 一律忽略）。
 * 约束：media 字段始终为空数组——本 plan 只抽取文本与备注，不落盘图片。
 */
export async function parsePptxBuffer(input: ParseInput): Promise<DocumentIR> {
  let JSZip: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    JSZip = require("jszip");
  } catch {
    throw new Error(
      "[E_DOC_DEP_MISSING] jszip 未安装。请在 desktop/ 下执行 pnpm install（jszip 已在 08-05 作为显式顶层依赖声明）。",
    );
  }

  const zip = await JSZip.loadAsync(input.buffer);

  // 枚举所有 ppt/slides/slide<N>.xml，按 N 升序排，保证幻灯片原始顺序
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide(\d+)\.xml$/.test(p))
    .sort((a, b) => parseSlideIndex(a) - parseSlideIndex(b));

  const body: SlideNode[] = [];
  const outline: OutlineItem[] = [];

  for (const slidePath of slidePaths) {
    const slideIdx = parseSlideIndex(slidePath);
    // 先读字节并过 16MiB 闸门，再解码 —— 错误码必须在 TextDecoder 前抛出
    const slideXml = await readPptxEntryCapped(zip, slidePath);
    if (slideXml === null) continue; // 理论上过滤时已经确认存在；防御一下

    const slideParas = extractPptxParagraphs(slideXml);

    // Slide 正文：保留非空段落，locator.slide 指向当前幻灯片编号
    const slideBody: ParagraphNode[] = slideParas
      .filter((t) => t.trim().length > 0)
      .map<ParagraphNode>((t) => ({
        kind: "paragraph",
        runs: [{ text: t }],
        locator: { slide: slideIdx },
      }));

    // Notes：对应 ppt/notesSlides/notesSlideN.xml；
    // 没取到或全空 → notes 保持 undefined（不是空数组）
    const notesPath = `ppt/notesSlides/notesSlide${slideIdx}.xml`;
    const notesXml = await readPptxEntryCapped(zip, notesPath);
    let notes: ParagraphNode[] | undefined;
    if (notesXml) {
      const notesParas = extractPptxParagraphs(notesXml).filter(
        (t) => t.trim().length > 0,
      );
      if (notesParas.length > 0) {
        notes = notesParas.map<ParagraphNode>((t) => ({
          kind: "paragraph",
          runs: [{ text: t }],
          locator: { slide: slideIdx },
        }));
      }
    }

    // 标题：首个非空文本；都为空则回退到 "Slide N"
    const firstText = slideParas.find((t) => t.trim().length > 0)?.trim();
    const title = firstText && firstText.length > 0 ? firstText : `Slide ${slideIdx}`;

    const slideNode: SlideNode = {
      kind: "slide",
      index: slideIdx,
      title,
      body: slideBody,
      locator: { slide: slideIdx },
    };
    if (notes !== undefined) slideNode.notes = notes;
    body.push(slideNode);

    outline.push({
      level: 1,
      title,
      locator: { slide: slideIdx },
    });
  }

  return {
    source: {
      path: input.path,
      format: "pptx",
      bytes: input.buffer.length,
      sha256: input.sha256,
    },
    meta: { pages: slidePaths.length },
    outline,
    body,
    media: [],
  };
}

/** pptx parser 单例；由 executor.ensureParsersRegistered 注册。 */
export const pptxParser: DocumentParser = {
  format: "pptx",
  parse: parsePptxBuffer,
};

/**
 * xlsxParser：基于 SheetJS（xlsx 包）把 xlsx/xls/xlsm 工作簿解析为 DocumentIR。
 *
 * 设计要点：
 * - 仅消费 ParseInput.buffer，不触发任何文件系统读取（与其他 parser 保持一致的纯函数语义）
 * - 合并单元格（!merges）在 AoA 层展开：锚点值复制到所有被覆盖的 cell
 * - 每个 sheet 产出一个 SheetNode，并在 outline 注册一条 level=1 的条目（locator.sheet = name）
 * - 扩展名映射 xlsx / xls / xlsm 三种 DocumentFormat；其他扩展名回退到 xlsx（由上层门面负责校验格式）
 * - 动态 require("xlsx") 匹配既有 builtin-tool-executor 的 lazy-load 模式，避免 xlsx 缺失导致主进程启动失败
 */

import { extname } from "node:path";
import type { DocumentFormat, DocumentIR, InlineRun, OutlineItem, SheetNode, TableNode } from "@shared/contracts";
import type { DocumentParser, ParseInput } from "../parser-registry";

/**
 * 将 xlsx/xls/xlsm Buffer 解析为 DocumentIR。
 *
 * 不读取任何外部资源（XXE / external reference 由 SheetJS 默认关闭）。
 */
export async function parseXlsxBuffer(input: ParseInput): Promise<DocumentIR> {
  // 惰性 require：与 builtin-tool-executor 里 executeXlsxExtract 的模式保持一致。
  let xlsxMod: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    xlsxMod = require("xlsx");
  } catch {
    throw new Error(
      "[E_DOC_DEP_MISSING] xlsx 依赖未安装。请在 desktop/ 目录执行 `pnpm install` 后重启桌面端。",
    );
  }

  const wb = xlsxMod.read(input.buffer, { type: "buffer" });
  const sheetNames: string[] = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
  const body: SheetNode[] = [];
  const outline: OutlineItem[] = [];

  for (const name of sheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const aoaRaw: unknown[][] = xlsxMod.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    // sheet_to_json 可能返回稀疏数组；下面用可变副本方便展开合并区间。
    const aoa: unknown[][] = aoaRaw.map((r) => (Array.isArray(r) ? [...r] : []));

    // 展开合并单元格：锚点值填充整个矩形区间。
    const merges = sheet["!merges"] as
      | Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>
      | undefined;
    if (Array.isArray(merges)) {
      for (const m of merges) {
        const anchorRow = aoa[m.s.r];
        const anchor = anchorRow ? anchorRow[m.s.c] ?? "" : "";
        for (let r = m.s.r; r <= m.e.r; r++) {
          if (!aoa[r]) aoa[r] = [];
          for (let c = m.s.c; c <= m.e.c; c++) {
            aoa[r][c] = anchor;
          }
        }
      }
    }

    const rowCount = aoa.length;
    const colCount = aoa.reduce((acc, r) => Math.max(acc, r.length), 0);

    const tableRows: InlineRun[][][] = aoa.map((r) => {
      const padded: unknown[] = [...r];
      while (padded.length < colCount) padded.push("");
      return padded.map((cell) => [{ text: String(cell ?? "") } as InlineRun]);
    });

    const table: TableNode = {
      kind: "table",
      rows: tableRows,
      locator: { sheet: name },
    };
    body.push({
      kind: "sheet",
      name,
      dims: { rows: rowCount, cols: colCount },
      table,
      locator: { sheet: name },
    });
    outline.push({ level: 1, title: name, locator: { sheet: name } });
  }

  const ext = extname(input.path).toLowerCase().replace(".", "");
  const format: DocumentFormat =
    ext === "xlsx" || ext === "xls" || ext === "xlsm" ? (ext as DocumentFormat) : "xlsx";

  return {
    source: { path: input.path, format, bytes: input.buffer.length, sha256: input.sha256 },
    meta: {},
    outline,
    body,
    media: [],
  };
}

/** xlsx parser 单例。注册时 format 为 "xlsx"。 */
export const xlsxParser: DocumentParser = {
  format: "xlsx",
  parse: parseXlsxBuffer,
};

/** xls parser 单例。与 xlsx 共用实现，format 标签区分。 */
export const xlsParser: DocumentParser = {
  format: "xls",
  parse: parseXlsxBuffer,
};

/** xlsm parser 单例。与 xlsx 共用实现，format 标签区分。 */
export const xlsmParser: DocumentParser = {
  format: "xlsm",
  parse: parseXlsxBuffer,
};

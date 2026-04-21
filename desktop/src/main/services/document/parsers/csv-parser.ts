/**
 * csv-parser — CSV Parser（Phase 8 Plan 08 Task 2）。
 *
 * 职责：
 * - 剥离 UTF-8 BOM（EF BB BF）
 * - 在前 5 个非空行上从 "," / "\t" / ";" / "|" 候选集中探测分隔符：取所有行
 *   计数完全一致的候选中出现次数最多的一个；无一致者退回 ","
 * - 字符级 parser：支持 RFC4180 风格引号字段（含逗号 / 换行）与双引号转义 ""
 * - 产出单一 SheetNode(name="csv") + TableNode，rows 按实际列数补齐空字符串
 *
 * 纯计算，零 I/O，零外部依赖（不依赖 iconv-lite —— 编码退化不在本 plan 范围）。
 */

import type {
  DocumentIR,
  InlineRun,
  OutlineItem,
  SheetNode,
  TableNode,
} from "@shared/contracts";
import type { DocumentParser, ParseInput } from "../parser-registry";

const CANDIDATE_DELIMITERS = [",", "\t", ";", "|"] as const;

/**
 * 在文本前部探测分隔符。
 *
 * 策略：
 * - 取前 5 个非空行；
 * - 每个候选分隔符分别统计每行的出现次数；
 * - 仅当所有行的计数完全一致，且该计数 > 0 时认为"稳定"；
 * - 在所有稳定候选中挑选次数最大者（通常是真正的列分隔符）；
 * - 都不稳定则退回 ","。
 */
export function detectDelimiter(sample: string): string {
  const lines = sample.split(/\r?\n/).filter((l) => l.length > 0).slice(0, 5);
  if (lines.length === 0) return ",";
  let best = ",";
  let bestCount = -1;
  for (const d of CANDIDATE_DELIMITERS) {
    // 注意：逐字符计数而非用 new RegExp，避免 "|" 等正则元字符需要转义
    const counts = lines.map((l) => countChar(l, d));
    const first = counts[0];
    if (first === 0) continue;
    const consistent = counts.every((c) => c === first);
    if (consistent && first > bestCount) {
      bestCount = first;
      best = d;
    }
  }
  return best;
}

/** 数一个字符在字符串里出现的次数；比 RegExp 更省心（没有元字符转义问题）。 */
function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

/**
 * 按字符逐个扫描的 CSV 解析器。
 *
 * 支持：
 * - 引号字段 "..."：内部可以含有分隔符和换行
 * - 双引号转义 ""：解析为字面量 " 字符
 * - \r\n 与 \n 兼容：\r 被忽略，\n 作为行分隔
 * - 末行无尾随换行时也会产出最后一行
 */
export function parseCsvText(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"" && text[i + 1] === "\"") {
        field += "\"";
        i++;
        continue;
      }
      if (ch === "\"") {
        inQuotes = false;
        continue;
      }
      field += ch;
    } else {
      if (ch === "\"") {
        inQuotes = true;
        continue;
      }
      if (ch === delim) {
        cur.push(field);
        field = "";
        continue;
      }
      if (ch === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
        continue;
      }
      if (ch === "\r") {
        continue;
      }
      field += ch;
    }
  }
  // 收尾：末尾还有未提交的字段或行
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

/**
 * 解析 CSV buffer 为 DocumentIR。
 *
 * 产出形态：
 *   body: [SheetNode(name="csv", dims={rows,cols}, table: TableNode)]
 *   outline: [{ level: 1, title: "csv", locator: { sheet: "csv" } }]
 *
 * 当前 MVP 假设 UTF-8（含 BOM）；非 UTF-8 文件的编码回退不在本 plan 范围。
 */
export async function parseCsvBuffer(input: ParseInput): Promise<DocumentIR> {
  let text = input.buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const delim = detectDelimiter(text.slice(0, 4096));
  const rows = parseCsvText(text, delim);
  const cols = rows.reduce((acc, r) => Math.max(acc, r.length), 0);

  const tableRows: InlineRun[][][] = rows.map((r) => {
    const padded = r.slice();
    while (padded.length < cols) padded.push("");
    return padded.map((c) => [{ text: c }]);
  });

  const table: TableNode = {
    kind: "table",
    rows: tableRows,
    locator: { sheet: "csv" },
  };

  const sheet: SheetNode = {
    kind: "sheet",
    name: "csv",
    dims: { rows: rows.length, cols },
    table,
    locator: { sheet: "csv" },
  };

  const outline: OutlineItem[] = [
    { level: 1, title: "csv", locator: { sheet: "csv" } },
  ];

  return {
    source: {
      path: input.path,
      format: "csv",
      bytes: input.buffer.length,
      sha256: input.sha256,
    },
    meta: {},
    outline,
    body: [sheet],
    media: [],
  };
}

export const csvParser: DocumentParser = {
  format: "csv",
  parse: parseCsvBuffer,
};

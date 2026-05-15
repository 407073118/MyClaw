/**
 * json-parser — JSON 结构化 Parser。
 *
 * 职责：
 * - 将 JSON 文件转换成 DocumentIR，供 document_read 统一走 stats / outline / read / search。
 * - 用 JSON Pointer 标识每个可读子树，例如 `/scripts/build`。
 * - body 中每个节点都是一段 json code block，便于按 pointer 精确读取。
 */

import type {
  CodeNode,
  DocumentIR,
  DocumentNode,
  OutlineItem,
} from "@shared/contracts";
import type { DocumentParser, ParseInput } from "../parser-registry";

/** JSON outline / body 遍历最大深度，避免极深对象把上下文打爆。 */
const JSON_MAX_WALK_DEPTH = 8;

/** JSON outline / body 最大节点数，防止超大数组生成过多 IR 节点。 */
const JSON_MAX_NODES = 1000;

/** 将字符串片段转义成 JSON Pointer segment。 */
function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** 将路径片段转成 JSON Pointer；根节点用 `/`，便于模型直观调用。 */
function toPointer(path: string[]): string {
  if (path.length === 0) return "/";
  return "/" + path.map(escapePointerSegment).join("/");
}

/** 将路径片段转成类 JSONPath 标题，仅用于 outline 展示。 */
function toDisplayPath(path: string[]): string {
  if (path.length === 0) return "$";
  return "$." + path.join(".");
}

/** 判断值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 生成节点标题，包含路径与类型摘要。 */
function describeValue(path: string[], value: unknown): string {
  const prefix = toDisplayPath(path);
  if (Array.isArray(value)) return `${prefix} [array:${value.length}]`;
  if (isRecord(value)) return `${prefix} {object:${Object.keys(value).length}}`;
  if (value === null) return `${prefix} = null`;
  return `${prefix} = ${typeof value}`;
}

/** 将 JSON 值格式化为稳定可读的代码块文本。 */
function stringifyJsonValue(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "undefined";
}

/** 遍历 JSON 树，生成 outline 与可 pointer 读取的 code 节点。 */
function collectJsonNodes(
  value: unknown,
  path: string[],
  depth: number,
  outline: OutlineItem[],
  body: DocumentNode[],
  counter: { count: number },
): void {
  if (counter.count >= JSON_MAX_NODES || depth > JSON_MAX_WALK_DEPTH) return;
  counter.count += 1;

  const pointer = toPointer(path);
  const level = Math.min(6, depth + 1);
  outline.push({
    level,
    title: describeValue(path, value),
    locator: { pointer },
  });

  const node: CodeNode = {
    kind: "code",
    lang: "json",
    text: stringifyJsonValue(value),
    locator: { pointer },
  };
  body.push(node);

  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      collectJsonNodes(child, [...path, String(index)], depth + 1, outline, body, counter);
    });
    return;
  }

  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectJsonNodes(child, [...path, key], depth + 1, outline, body, counter);
      if (counter.count >= JSON_MAX_NODES) break;
    }
  }
}

/** 解析 JSON buffer 为 DocumentIR。 */
export async function parseJsonBuffer(input: ParseInput): Promise<DocumentIR> {
  let text = input.buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[E_DOC_PARSE_FAILED] JSON 解析失败：${message}`);
  }

  const outline: OutlineItem[] = [];
  const body: DocumentNode[] = [];
  collectJsonNodes(parsed, [], 0, outline, body, { count: 0 });

  return {
    source: {
      path: input.path,
      format: "json",
      bytes: input.buffer.length,
      sha256: input.sha256,
    },
    meta: { words: Math.round(text.length / 5) },
    outline,
    body,
    media: [],
  };
}

export const jsonParser: DocumentParser = {
  format: "json",
  parse: parseJsonBuffer,
};

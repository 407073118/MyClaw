/**
 * Parser 注册表：按文件格式索引 DocumentParser。
 *
 * 每种格式（xlsx / docx / pdf / pptx / md / txt / csv）只能注册一个实现。
 * 后注册覆盖先注册（方便测试替身）。
 *
 * 本模块为纯内存实现，零 I/O，零外部依赖。
 */

import type { DocumentFormat, DocumentIR } from "@shared/contracts";

/**
 * Parser 接收的输入：路径 + 已读取的 buffer + 预计算的 sha256 + 媒体落盘目录。
 *
 * 说明：
 * - path 已由 PathAccessPolicy 校验并解析为绝对路径
 * - buffer 由调用方一次性读入内存（50MB 硬顶在门面层处理）
 * - sha256 小写 hex；parser 可直接塞进 DocumentIR.source.sha256
 * - mediaDir 已创建；parser 若产生图片，直接写入即可
 */
export type ParseInput = {
  path: string;
  buffer: Buffer;
  sha256: string;
  mediaDir: string;
};

/** Parser 接口：一个 format 对应一个实例。 */
export interface DocumentParser {
  readonly format: DocumentFormat;
  parse(input: ParseInput): Promise<DocumentIR>;
}

const registry = new Map<DocumentFormat, DocumentParser>();

/** 注册 parser。已存在同 format 的注册会被覆盖。 */
export function registerParser(parser: DocumentParser): void {
  registry.set(parser.format, parser);
}

/** 按格式拿 parser；未注册返回 null。 */
export function getParser(format: DocumentFormat): DocumentParser | null {
  return registry.get(format) ?? null;
}

/** 列出已注册的格式。 */
export function listRegisteredFormats(): DocumentFormat[] {
  return Array.from(registry.keys());
}

/**
 * 仅测试用的清空函数。生产代码勿调用。
 * 单元测试互相之间不应共享注册状态。
 */
export function __resetParserRegistryForTests(): void {
  registry.clear();
}

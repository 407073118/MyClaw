/**
 * document 子系统对外总出口。
 *
 * 下游（builtin-tool-executor、ipc/sessions、测试）统一从这里引用，
 * 避免深 path 耦合到具体模块文件。
 */

export * from "./parser-registry";
export * from "./ir-to-markdown";
export * from "./doc-cache";
export * from "./document-read-facade";
export * from "./parsers/xlsx-parser";
export * from "./parsers/docx-parser";
export * from "./parsers/pdf-parser";
export * from "./parsers/pptx-parser";
export * from "./parsers/md-txt-parser";
export * from "./parsers/csv-parser";

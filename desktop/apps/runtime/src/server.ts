/**
 * 兼容入口：保持既有 `src/server.ts` 导出语义稳定。
 * 真实实现已迁移到 `src/server/create-runtime-app.ts`。
 */
export { createRuntimeApp } from "./server/create-runtime-app";

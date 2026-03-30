# AGENTS.md

本文件是 `apps/runtime/` 的入口。

## 职责

- 本地 API
- 状态存储
- 工具、审批、MCP、Skills、工作流

## 先看什么

1. `../../AGENTS.md`
2. `src/index.ts`
3. `src/server.ts`
4. 目标目录：`src/services` / `src/store`

## 改动规则

- 业务逻辑放 `services`
- 存储逻辑放 `store`
- 改接口前先看 `packages/shared`

## 验证

- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/runtime build`


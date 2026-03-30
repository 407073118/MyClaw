# AGENTS.md

本文件是 `apps/desktop/` 的入口。

## 职责

- 页面、路由、交互
- 通过 `src/services/*` 调用 runtime

## 先看什么

1. `../../AGENTS.md`
2. `src/main.ts`
3. `src/router/index.ts`
4. 目标目录：`src/views` / `src/components` / `src/stores`

## 改动规则

- 请求逻辑放 `src/services`
- 不直接依赖 runtime 内部实现
- 改路由时同步看 `src/tests/views`

## 验证

- `pnpm --dir apps/desktop test`
- `pnpm --dir apps/desktop build`


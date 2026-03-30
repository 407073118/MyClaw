# AGENTS.md

本文件是 `packages/shared/` 的入口。

## 职责

- 维护 `desktop` 与 `runtime` 共用契约

## 先看什么

1. `../../AGENTS.md`
2. `src/index.ts`
3. `src/contracts/*`

## 改动规则

- 优先兼容新增，不随意改语义
- 改后同步检查 `apps/runtime` 与 `apps/desktop`
- 不放运行时代码

## 验证

- `pnpm --dir packages/shared build`


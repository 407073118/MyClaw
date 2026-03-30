# AGENTS.md

本文件是 `packages/shared/` 的入口。

## 职责

- 维护 `cloud-api` 与 `cloud-web` 共用契约

## 先看什么

1. `../../AGENTS.md`
2. `src/index.ts`
3. `src/contracts/*`

## 改动规则

- 优先兼容新增
- 改后同步检查 API 与 Web 消费方
- 不放业务逻辑

## 验证

- `pnpm --dir packages/shared test`
- `pnpm --dir packages/shared build`


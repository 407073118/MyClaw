# AGENTS.md

本文件是 `apps/cloud-web/` 的入口。

## 职责

- 登录
- Hub/技能/MCP 管理台页面
- 通过 `server/api/*` 对接后端

## 先看什么

1. `../../AGENTS.md`
2. `pages/`
3. `server/api/`
4. 目标目录：`components` / `composables`

## 改动规则

- 页面请求优先走 `server/api`
- 不直接依赖 cloud-api 内部实现
- 改接口字段前先看 `packages/shared`

## 验证

- `pnpm --dir apps/cloud-web test`
- `pnpm --dir apps/cloud-web build`


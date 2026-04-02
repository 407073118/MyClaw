# AGENTS.md

本文件是 `cloud/` 的入口。

## 作用范围

- 作用于 `cloud/` 及其子目录。
- 更深层 `AGENTS.md` 优先。
- 未覆盖规则继承根 `AGENTS.md`。

## 先读什么

1. 本文件
2. `README.md`
3. `docs/project-overview.md`
4. 目标子目录 `AGENTS.md`

## 这里只管什么

- `apps/cloud-api`：云端 API
- `apps/cloud-web`：管理台
- `packages/shared`：共享契约
- `infra`：本地基础设施
- `tests`：workspace 检查

## 改动规则

- 一期目标只围绕登录、Hub、工件、安装留痕。
- 先改契约，再改 API 或页面。
- 不把底层存储细节泄漏到业务层。
- 不顺手扩成复杂平台能力。

## 验证命令

- `pnpm --dir packages/shared test`
- `pnpm --dir apps/cloud-api test`
- `pnpm --dir apps/cloud-web test`
- `pnpm test`
- `pnpm build`


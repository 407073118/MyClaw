# AGENTS.md

本文件是 `desktop/` 的入口。

## 作用范围

- 作用于 `desktop/` 及其子目录。
- 更深层 `AGENTS.md` 优先。
- 未覆盖规则继承根 `AGENTS.md`。

## 先读什么

1. 本文件
2. `docs/project-overview.md`
3. `docs/context-engineering.md`
4. 目标子目录 `AGENTS.md`

## 这里只管什么

- `apps/desktop`：桌面 UI
- `apps/runtime`：本地 runtime
- `packages/shared`：共享契约

## 改动规则

- 最小改动，不跨子项目顺手重构。
- 改契约时，同步 `shared / runtime / desktop`。
- 文档只记当前真实结构，不写空设计。

## 验证命令

- `pnpm --dir packages/shared build`
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/runtime build`
- `pnpm --dir apps/desktop test`
- `pnpm --dir apps/desktop build`


# AGENTS.md

本文件是 `apps/cloud-api/` 的入口。

## 职责

- `auth` — 登录认证、会话管理
- `hub` — Hub 浏览
- `skills` — 技能发布、版本管理
- `mcp` — MCP 服务管理
- `artifact` — 工件存储（FastDFS）
- `install` — 安装日志留痕

## 先看什么

1. `../../AGENTS.md`
2. `src/main.ts`
3. `src/app.module.ts`
4. 目标模块：`src/modules/*`

## 改动规则

- 契约先改 `packages/shared`
- 复杂逻辑放 service，不堆 controller
- 存储细节不要泄漏到上层

## 验证

- `pnpm --dir apps/cloud-api test`
- `pnpm --dir apps/cloud-api build`


# Cloud 概览

## 目标

`cloud/` 负责补齐云能力，不替代桌面端。

主链路：`登录 -> Hub 浏览 -> 下载/安装 -> 留痕`

## 结构

```
cloud/
  apps/
    cloud-api/        # NestJS 后端
    cloud-web/        # Nuxt 前端管理台
  packages/
    shared/           # API 与 Web 共享契约
  infra/              # 本地基础设施（MySQL）
  scripts/            # 部署打包脚本
```

## 业务模块

- `auth` — 登录认证、会话管理
- `hub` — Hub 浏览、搜索
- `skills` — 技能管理、发布、版本
- `mcp` — MCP 服务管理
- `artifact` — 工件存储（FastDFS）
- `install` — 安装/下载日志留痕

## 关键入口

- API：`apps/cloud-api/src/main.ts`
- 模块：`apps/cloud-api/src/modules/`
- Web 页面：`apps/cloud-web/pages/`
- BFF 层：`apps/cloud-web/server/api/`
- 契约：`packages/shared/src/`

## 数据库

- MySQL 8.0
- ORM：Prisma 6
- Schema：`apps/cloud-api/prisma/schema.prisma`
- 初始化：`pnpm setup:api`（generate + push + seed）

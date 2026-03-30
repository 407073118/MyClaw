# Cloud 概览

## 目标

`cloud/` 负责补齐云能力，不替代桌面端。

主链路：

`登录 -> Hub 浏览 -> 下载/安装 -> 留痕`

## 结构

```text
cloud/
  apps/
    cloud-api/
    cloud-web/
  packages/
    shared/
  infra/
  tests/
```

## 职责

- `apps/cloud-api`
  - `auth / hub / artifact / install`
- `apps/cloud-web`
  - 登录、管理台页面、发布入口
- `packages/shared`
  - API 与 Web 共享契约

## 关键入口

- API：`apps/cloud-api/src/main.ts`
- 模块：`apps/cloud-api/src/modules`
- Web：`apps/cloud-web/pages`
- Shared：`packages/shared/src/index.ts`


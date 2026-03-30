# Desktop 概览

## 结构

```text
desktop/
  apps/
    desktop/
    runtime/
  packages/
    shared/
```

## 职责

- `apps/desktop`
  - 页面、路由、交互、调用 runtime。
- `apps/runtime`
  - 本地 API、状态、工具、审批、工作流。
- `packages/shared`
  - 两端共享契约。

## 关键入口

- UI：`apps/desktop/src/main.ts`
- 路由：`apps/desktop/src/router/index.ts`
- Runtime：`apps/runtime/src/index.ts`
- 服务：`apps/runtime/src/server.ts`
- 契约：`packages/shared/src/index.ts`

## 常见落点

- 改页面：`apps/desktop/src/views`、`apps/desktop/src/components`
- 改 runtime：`apps/runtime/src/services`、`apps/runtime/src/store`
- 改协议：`packages/shared/src/contracts`


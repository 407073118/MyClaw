# MyClaw Desktop 启动

## 一键启动

```powershell
pnpm --dir apps/desktop tauri:dev
```

## 分开启动

Runtime：

```powershell
pnpm --dir apps/runtime dev
```

UI：

```powershell
pnpm --dir apps/desktop dev
```

## 常用验证

```powershell
pnpm --dir packages/shared build
pnpm --dir apps/runtime test
pnpm --dir apps/runtime build
pnpm --dir apps/desktop test
pnpm --dir apps/desktop build
```

## 常用打包

```powershell
pnpm build
pnpm --dir apps/runtime build:sidecar
pnpm --dir apps/desktop tauri:build
```


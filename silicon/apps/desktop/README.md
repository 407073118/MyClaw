# Silicon Desktop

Silicon Desktop 是 `silicon` 自带的新桌面壳，不依赖仓库根层 `desktop/**`。

启动方式：

```powershell
pnpm --dir silicon desktop
```

默认行为：

- 自动使用 Electron `userData/runtime` 作为 runtime root。
- 自动初始化 runtime。
- 自动启动内置 Silicon HTTP/UI server。
- 打开 Silicon Workbench 窗口。
- 如果 Electron 二进制尚未下载成功，会自动退回 Edge App Mode，仍然以桌面窗口形式打开。

高级参数：

```powershell
pnpm --dir silicon desktop -- --runtime-root F:\tmp\silicon-runtime --port 18001
```

强制 Electron 壳：

```powershell
pnpm --dir silicon desktop:electron
```

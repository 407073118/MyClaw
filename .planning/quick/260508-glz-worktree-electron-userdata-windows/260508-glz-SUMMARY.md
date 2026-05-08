---
phase: quick-260508-glz
plan: 01
status: completed
date: 2026-05-08
tasks_completed: 2
files_modified: 5
---

# Quick Task 260508-glz Summary

## Goal

永久修复 worktree 跑 Electron 时的两个开发体验问题：
1. worktree 与主仓库共用 Electron userData 触发 `Unable to move the cache: Access is denied (0x5)`
2. Windows PowerShell 控制台跑 desktop 时中文输出乱码

## What Changed

### Task 1: directory-service 自动检测 worktree 数据根

`desktop/src/main/services/directory-service.ts`
- 新增内部 helper `findWorktreeRootFromPath(startPath)`：纯字符串运算，从给定起点向上扫描路径段，命中 `.worktrees` 且其后存在下一段时返回 `<...>/.worktrees/<name>` 作为 worktree 根。用 `path.parse` 拿 `root` 段保证 Windows 盘符正确还原。
- 新增内部 helper `detectWorktreeDataRoot()`：dev 模式下依次用 `process.cwd()` 与 `__dirname` 试探，命中后数据根 = `<worktreeRoot>/.userdata`；`app.isPackaged` 时直接返回 null（防御性，打包路径里不会有 .worktrees 段）。
- 扩展 `resolveConfiguredDataRoot` 优先级链：`MYCLAW_DATA_ROOT > PORTABLE_EXECUTABLE_DIR > installer config > worktree 自动检测 > 默认 userData`。显式配置仍优先生效。

`desktop/tests/directory-service-paths.test.ts`
- 在 beforeEach/afterEach 加 `originalCwd` + `process.chdir(originalCwd)` 还原；新建 `worktreeBase` 临时目录用于构造 `.worktrees/<name>/desktop` 结构。
- 追加 4 个 case：worktree 命中（dev 模式自动重定向）、env 优先于 worktree 检测、packaged 跳过 worktree 检测、cwd 不含 `.worktrees` 段时回退默认 userData。原 5 个 case 不动。

### Task 2: Windows 启动前自动切换控制台 codepage 到 UTF-8

`desktop/scripts/start.js`（新文件）
- 新建 desktop 启动入口。Windows 平台下先 `spawnSync("chcp 65001", { shell: true, stdio: "ignore" })` 切控制台 codepage，再 spawn `electron.cmd dist/src/main/index.js` 继承当前控制台。子进程 stdout 不再被 PowerShell 按 GBK 解码，中文不乱码。
- 用 `"chcp 65001"` 单字符串 + `shell: true` 而非 `"chcp", ["65001"]` + `shell: true` 的组合，规避 Node 的 DEP0190 弃用警告。
- macOS / Linux 下 `ensureUtf8ConsoleOnWindows` 立即 return，行为不变。

`desktop/scripts/dev.js`
- 同样新增 `ensureUtf8ConsoleOnWindows`，在 `main()` 函数最早处调用。导出列表里加上该函数便于复用/测试。

`desktop/package.json`
- `start` 脚本由 `electron dist/src/main/index.js` 改为 `node scripts/start.js`，作为 codepage 切换的入口点。其他 script 保持不动。

## Verification

| 检查 | 命令 | 结果 |
|------|------|------|
| 单测（含新增 4 case） | `cd desktop && pnpm vitest run tests/directory-service-paths.test.ts` | ✅ 9/9 passed |
| 类型 | `cd desktop && pnpm typecheck` | ✅ no errors |
| 脚本语法 | `node --check scripts/start.js` 与 `scripts/dev.js` | ✅ syntax OK |

## Behavioral Outcome

- Worktree（`.worktrees/<name>/desktop`）下 dev/start 桌面端时，Electron userData 自动落在 `<worktreeRoot>/.userdata/electron`，不再与主仓库共用 `%APPDATA%\Electron`，0x5 Cache 拒绝访问错误消失。
- 主仓库行为不变：cwd 不含 `.worktrees` 段时仍走默认 userData。
- 显式 `MYCLAW_DATA_ROOT` 优先于自动检测，向后兼容。
- Windows PowerShell 跑 `pnpm start` / `pnpm dev` 时，控制台 codepage 自动切到 65001，Electron 主进程的 `[directory-service] / [main] / [startup]` 等中文日志不再乱码。
- macOS / Linux 启动行为完全不变（`ensureUtf8ConsoleOnWindows` 在非 Win32 平台立即 return）。
- 打包后产物路径不会出现 `.worktrees` 段，自动检测天然不会误命中；`app.isPackaged` 时也额外做了短路防御。

## Files Modified

- `desktop/src/main/services/directory-service.ts`
- `desktop/tests/directory-service-paths.test.ts`
- `desktop/scripts/start.js` (new)
- `desktop/scripts/dev.js`
- `desktop/package.json`

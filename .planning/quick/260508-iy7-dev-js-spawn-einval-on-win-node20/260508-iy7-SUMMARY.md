---
phase: quick-260508-iy7
plan: 01
status: completed
date: 2026-05-08
files_modified: 1
---

# Quick Task 260508-iy7 Summary

## Goal

修复 `pnpm dev` 在 Windows + Node 20+ 上抛 `spawn EINVAL` 启动失败。

## Root Cause

`desktop/scripts/dev.js` 的 `spawnPnpm` 没传 `shell: true`。Node 20+ 合并 CVE-2024-27980 修复后，禁止直接 `spawn` `.cmd` / `.bat` 文件 —— 必须走 shell。`resolvePnpmCommand()` 在 win32 返回 `"pnpm.cmd"`，因此第一个 `runPnpmOnce(["run", "build:main"], env)` 调用就直接 EINVAL。

## Fix

`spawnPnpm` 的 options 增加 `shell: process.platform === "win32"`，并补一段注释说明缘由。args 全是常量字符串，无 shell 注入风险。其他 spawn 调用（dev.js 里没有别处直接 spawn `.cmd`）不受影响。macOS / Linux 不命中条件，行为不变。

## Verification

| 检查 | 结果 |
|------|------|
| `node --check scripts/dev.js` | syntax OK |
| 用户实跑 `pnpm dev` | 待用户回归（应当不再 EINVAL，进入 build:main → 渲染层 dev server → 启动 Electron 流程） |

## Files Modified

- `desktop/scripts/dev.js`（spawnPnpm 加 `shell: process.platform === "win32"` + 注释）

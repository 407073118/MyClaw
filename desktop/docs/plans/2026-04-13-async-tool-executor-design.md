# builtin-tool-executor 异步化改造设计

> 日期: 2026-04-13
> 状态: 待实施
> 优先级: P0（用户可感知的 UI 卡死）

## 1. 问题描述

### 现象
Desktop 应用在 AI 模型调用工具时偶发"整个窗口无法点击、完全卡死"，持续数秒到数分钟不等。

### 根因
`builtin-tool-executor.ts` 中**所有外部命令和文件操作使用同步 API**（`execSync`、`readFileSync`、`writeFileSync`、`readdirSync` 等），直接在 Electron 主进程的事件循环上执行。

Electron 主进程 = Node.js 事件循环 = 窗口事件处理（点击、重绘、IPC）。当 `execSync()` 阻塞这个线程时：
- 窗口完全无法重绘
- 鼠标/键盘事件无法分发
- IPC 消息无法收发
- 所有 setTimeout/setInterval 停转

### 阻塞热点清单

| 工具 | 文件:行 | 同步 API | 最长阻塞时间 |
|------|---------|---------|:-----------:|
| `exec.command` | :683 | `execSync()` + 梯度重试 | **10 分钟** |
| `git.*` (全部) | :870 `runGit()` | `execSync()` | 15 秒 |
| `git.commit` 暂存 | :592 | `execSync("git add -A")` | 15 秒 |
| `fs.search` | :538 → `searchTextInDir()` | 递归 `readdirSync` + `readFileSync` | 数秒~数十秒 |
| `fs.find` | :546 → `findFilesInDir()` | 递归 `readdirSync` | 数秒 |
| `fs.read` | :508 | `readFileSync` | 取决于文件大小 |
| `fs.write` | :516-517 | `mkdirSync` + `writeFileSync` | 通常 < 100ms |
| `fs.edit` | :831, :852 | `readFileSync` + `writeFileSync` | 通常 < 200ms |
| `fs.list` | :527 | `readdirSync` | 通常 < 100ms |
| `skill_invoke__*` | :1019-1038 | 多处 `readFileSync` + `statSync` | 通常 < 200ms |

> 注: `dispatch()` 方法已标记 `async`，但内部未使用任何 `await`。`async` 只意味着返回 Promise，对 `execSync` 等同步阻塞无效。

## 2. 修复目标

1. **零阻塞**：所有工具执行不阻塞 Electron 主进程事件循环
2. **行为不变**：工具的输入输出格式、错误处理、超时重试逻辑完全保持一致
3. **最小改动面**：只替换同步 API 为异步等价物，不重构架构

## 3. 技术方案

### 3.1 import 替换

```typescript
// ── 替换前 ──
import { execSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync,
  readdirSync, statSync, writeFileSync,
} from "node:fs";

// ── 替换后 ──
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir, readFile, readdir, stat, writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";  // existsSync 保留（无异步等价物且无阻塞风险）

const execFileAsync = promisify(execFile);
```

### 3.2 各工具改造清单

#### 3.2.1 `fs.read` (行 506-511)

```typescript
// 替换前
const content = readFileSync(filePath, "utf8");

// 替换后
const content = await readFile(filePath, "utf8");
```

#### 3.2.2 `fs.write` (行 513-522)

```typescript
// 替换前
mkdirSync(dirname(resolved), { recursive: true });
writeFileSync(resolved, content, "utf8");

// 替换后
await mkdir(dirname(resolved), { recursive: true });
await writeFile(resolved, content, "utf8");
```

#### 3.2.3 `fs.list` (行 524-532)

```typescript
// 替换前
const entries = readdirSync(resolved, { withFileTypes: true });

// 替换后
const entries = await readdir(resolved, { withFileTypes: true });
```

#### 3.2.4 `fs.search` / `fs.find` (行 534-548)

递归函数 `searchTextInDir()` 和 `findFilesInDir()` 需要整体改为 async：

```typescript
// 替换前（同步递归）
function searchTextInDir(base, pattern, maxResults, results, scanned) {
  entries = readdirSync(base, { withFileTypes: true });
  // ... readFileSync 每个文件 ...
}

// 替换后（异步递归）
async function searchTextInDir(base, pattern, maxResults, results, scanned) {
  entries = await readdir(base, { withFileTypes: true });
  // ... await readFile 每个文件 ...
}
```

调用处改为 `await`：
```typescript
await searchTextInDir(resolved, pattern, 100, results);
await findFilesInDir(resolved, resolved, pattern, 200, results);
```

#### 3.2.5 `exec.command` — 梯度超时重试 (行 665-730)

**这是最关键的改造。** 需要将 `execSync` 替换为 `child_process.spawn` 或 `execFile` 的异步版本，并保留梯度超时重试。

```typescript
// 替换前
const stdout = execSync(buildExecCommand(activeCommand), {
  cwd: execCwd,
  timeout: timeoutMs,
  encoding: "buffer",
  env: buildExecEnvironment(),
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});

// 替换后 — 使用 spawn + Promise 包装
async function execCommandAsync(
  command: string,
  options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv; signal?: AbortSignal },
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32"
      ? ["/c", buildExecCommand(command)]
      : ["-c", command];

    const child = spawn(shell, shellArgs, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      signal: options.signal,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(Object.assign(new Error(`Command timed out after ${options.timeout}ms`), {
        code: "ETIMEDOUT",
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      }));
    }, options.timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks),
        });
      } else {
        reject(Object.assign(new Error(`Command failed with code ${code}`), {
          code,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks),
        }));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
```

`executeShellCommand` 方法签名改为 `async`：
```typescript
private async executeShellCommand(request, cwd): Promise<ToolExecutionResult> {
  // for 循环中的 execSync → await execCommandAsync(...)
}
```

#### 3.2.6 `runGit()` (行 867-895)

```typescript
// 替换前
private runGit(args: string[], cwd: string): ToolExecutionResult {
  const stdout = execSync(buildExecCommand(["git", ...args].join(" ")), { ... });

// 替换后
private async runGit(args: string[], cwd: string): Promise<ToolExecutionResult> {
  const { stdout } = await execCommandAsync(["git", ...args].join(" "), { ... });
```

所有调用 `runGit` 的地方加 `await`（git.status/diff/log/commit 等约 6 处）。

#### 3.2.7 `git.commit` 暂存 (行 591-602)

```typescript
// 替换前
execSync(buildExecCommand("git add -A"), { ... });

// 替换后
await execCommandAsync("git add -A", { ... });
```

#### 3.2.8 `fs.edit` → `executeFileEdit()` (行 ~820-865)

```typescript
// 替换前
const content = readFileSync(resolved, "utf8");
writeFileSync(resolved, newContent, "utf8");

// 替换后
const content = await readFile(resolved, "utf8");
await writeFile(resolved, newContent, "utf8");
```

#### 3.2.9 `skill_invoke__*` → `executeSkillInvoke()` (行 ~1010-1045)

多处 `readFileSync` 和 `statSync` 替换为 `await readFile` 和 `await stat`。

### 3.3 辅助函数签名变更

以下函数需要从同步改为 async，并在所有调用处加 `await`：

| 函数 | 当前签名 | 新签名 |
|------|---------|--------|
| `searchTextInDir()` | `void` | `Promise<void>` |
| `findFilesInDir()` | `void` | `Promise<void>` |
| `executeShellCommand()` | `ToolExecutionResult` | `Promise<ToolExecutionResult>` |
| `runGit()` | `ToolExecutionResult` | `Promise<ToolExecutionResult>` |
| `executeFileEdit()` | `ToolExecutionResult` | `Promise<ToolExecutionResult>` |
| `executeSkillInvoke()` | `ToolExecutionResult` | `Promise<ToolExecutionResult>` |

> `dispatch()` 已经是 `async`，无需变更签名。上层 `execute()` 也已 `async`。

### 3.4 保留 `existsSync`

`existsSync` 没有阻塞风险（只做 stat 系统调用，纳秒级），且 Node.js 没有提供等价的 `exists` 异步 API（已废弃）。保留使用。

### 3.5 错误处理兼容

`execSync` 的错误对象结构（`.code`, `.signal`, `.stdout`, `.stderr`）与 `spawn` 的不完全一致。需要在 `execCommandAsync` 的 reject 路径中构造兼容结构，确保以下函数继续工作：

- `isExecTimeoutError(err)` — 检查 `.code === "ETIMEDOUT"` 和 `.signal`
- `extractExecErrorOutput(err)` — 读取 `.stdout` 和 `.stderr`
- `isExecCommandMissingError(err, output)` — 检查 `.code === "ENOENT"`

## 4. 不在本次范围内

以下同步操作**不在本次改造范围**（启动时一次性执行，不影响运行时体验）：

| 文件 | 操作 | 原因 |
|------|------|------|
| `state-persistence.ts` `loadPersistedState()` | `readdirSync` + `readFileSync` | 仅在应用启动时调用，窗口尚未显示 |
| `skill-loader.ts` `seedBuiltinSkills()` | `mkdirSync` + `readFileSync` + `writeFileSync` | 仅在应用启动时调用 |
| `mcp-server-manager.ts` 配置加载 | `readFileSync` + `writeFileSync` | 启动时 + 手动触发，阻塞 < 50ms |

如后续启动速度成为问题，可作为独立优化项处理。

## 5. 测试策略

### 5.1 验证标准

1. **UI 不卡死**：工具执行期间窗口可正常拖动、点击、切换页面
2. **工具输出一致**：所有工具的 success/output/error 格式与改造前完全一致
3. **超时重试**：exec.command 梯度扩容逻辑正常工作
4. **中断传播**：用户点击"停止"时 AbortSignal 能终止正在执行的子进程

### 5.2 测试场景

| 场景 | 操作 | 预期 |
|------|------|------|
| 长命令 | 模型调用 `exec_command` 执行 `ping -n 10 127.0.0.1` | 执行期间 UI 可正常操作 |
| 大目录搜索 | 模型调用 `fs.search` 在项目根目录搜索 | 搜索期间 UI 可正常操作 |
| 大文件读取 | 模型调用 `fs.read` 读取 10MB 文件 | 读取期间 UI 可正常操作 |
| Git 操作 | 模型调用 `git.status` 在大仓库 | 执行期间 UI 可正常操作 |
| 命令超时 | 模型执行不存在的长命令 | 梯度重试正常，UI 不卡 |
| 中途停止 | 模型执行长命令时用户点击停止 | 子进程被终止，会话正常结束 |

## 6. 改动影响评估

| 维度 | 评估 |
|------|------|
| **改动文件** | 1 个（`builtin-tool-executor.ts`） |
| **改动量** | ~26 处同步调用替换 + 1 个新增 `execCommandAsync` 函数 |
| **风险等级** | 中（模式统一但覆盖面广，需要逐个验证） |
| **向后兼容** | 完全兼容（只改内部实现，不改外部接口） |
| **性能影响** | 单工具执行速度无变化，UI 响应性大幅提升 |

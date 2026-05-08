---
phase: quick-260508-glz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - desktop/src/main/services/directory-service.ts
  - desktop/tests/directory-service-paths.test.ts
  - desktop/scripts/start.js
  - desktop/scripts/dev.js
  - desktop/package.json
autonomous: true
requirements:
  - QUICK-260508-GLZ
must_haves:
  truths:
    - "在 worktree（路径含 .worktrees/<name>/desktop）下 dev/start 桌面端时，Electron userData 自动落在 worktree 根目录的 .userdata，不会再和主仓库共用 Cache 触发 0x5 拒绝访问"
    - "MYCLAW_DATA_ROOT 显式设置时仍优先生效，自动检测仅在未显式配置时兜底"
    - "Windows 下 pnpm start / pnpm dev 启动桌面端时，控制台 codepage 已切换到 65001，Electron 子进程中文输出不再乱码"
    - "macOS / Linux 启动行为不变，跳过 chcp 切换；打包后的 production 进程没有 .worktrees 段，自动检测不会误命中"
  artifacts:
    - path: "desktop/src/main/services/directory-service.ts"
      provides: "扩展 resolveConfiguredDataRoot，新增 worktree 路径自动检测分支与对应辅助函数"
      contains: "detectWorktreeDataRoot"
    - path: "desktop/scripts/start.js"
      provides: "Windows 下启动 electron 前先 chcp 65001，再 spawn electron dist/src/main/index.js"
      min_lines: 20
    - path: "desktop/scripts/dev.js"
      provides: "Windows 下在派生子进程之前确保控制台 codepage 切到 65001"
      contains: "chcp"
    - path: "desktop/package.json"
      provides: "start 脚本指向 node scripts/start.js"
      contains: "node scripts/start.js"
    - path: "desktop/tests/directory-service-paths.test.ts"
      provides: "覆盖 worktree 自动检测分支的单测"
      contains: ".worktrees"
  key_links:
    - from: "desktop/src/main/services/directory-service.ts#resolveConfiguredDataRoot"
      to: "desktop/src/main/services/directory-service.ts#detectWorktreeDataRoot"
      via: "在显式环境变量/便携目录/安装器配置都未命中时调用"
      pattern: "detectWorktreeDataRoot\\("
    - from: "desktop/package.json#scripts.start"
      to: "desktop/scripts/start.js"
      via: "node 入口启动 electron 前先切 codepage"
      pattern: "node scripts/start.js"
---

<objective>
永久修复在 git worktree 下跑 Electron 时的两个开发体验问题：
1. worktree 与主仓库共用 Electron userData 导致 Cache 拒绝访问 (errno 0x5)
2. Windows PowerShell 控制台跑 desktop 时中文输出乱码

Purpose: worktree 是日常并行开发的标配，当前每次启动都要手动 set MYCLAW_DATA_ROOT 并 chcp 65001，开发体感差且容易踩坑。把这两件事一次性在代码层永久收口。

Output:
- desktop/src/main/services/directory-service.ts：新增 worktree 自动检测兜底
- desktop/scripts/start.js：Windows 启动前自动 chcp 65001
- desktop/scripts/dev.js：dev 路径同样保证 codepage
- desktop/package.json：start 脚本切到 node scripts/start.js
- desktop/tests/directory-service-paths.test.ts：补 worktree 检测单测
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@desktop/src/main/services/directory-service.ts
@desktop/src/main/index.ts
@desktop/package.json
@desktop/scripts/dev.js
@desktop/scripts/set-env.js
@desktop/tests/directory-service-paths.test.ts

<background>
现状（已通过手动调试确认）：
- 主仓库 F:\MyClaw 与 worktree F:\MyClaw\.worktrees\silicon-person 共享同一份 Electron 默认 userData（%APPDATA%\Electron 或 %APPDATA%\MyClaw），二者同时启动时 Cache/Code Cache 出现锁冲突，日志层报 `Unable to move the cache: Access is denied. (0x5)` 与 `disk_cache: Unable to create cache`。
- 当前规避手段是手工 `set MYCLAW_DATA_ROOT=F:\MyClaw\.worktrees\silicon-person\.userdata`，每次开新终端都要重做。
- Windows PowerShell 默认 codepage 是 936（GBK）。Electron 主进程里大量 console.info("[xxx] 中文…") 通过 stdout 输出，被 PowerShell 按 GBK 解码后即乱码。手动 `chcp 65001` 可解决，但同样每次都要重做。

worktree 目录约定：仓库根 = `<repo>`，worktree 列表统一放在 `<repo>/.worktrees/<branch-or-name>/`。worktree 中 desktop 包等价于 `<repo>/.worktrees/<name>/desktop`。所以 process.cwd() 在 dev 启动里典型路径形如：
- 主仓库：`F:\MyClaw\desktop`
- worktree：`F:\MyClaw\.worktrees\silicon-person\desktop`

判别逻辑：从 cwd 起向上回溯，命中 `.worktrees` 段且其下一段就是 `<name>` 目录，则将 worktree 根定义为 `<...>/.worktrees/<name>`，自动数据根目录使用 `<worktree-root>/.userdata`。

打包/安装后路径绝不会出现 `.worktrees`，逻辑天然安全。
</background>

<interfaces>
<!-- directory-service.ts 现有契约（未变）-->
```typescript
export type MyClawPaths = {
  rootDir: string;
  myClawDir: string;
  skillsDir: string;
  workspaceDir: string;
  artifactsDir: string;
  cacheDir: string;
  sessionsDir: string;
  sessionsDbFile: string;
  timeDbFile: string;
  modelsDir: string;
  settingsFile: string;
};

export function derivePaths(rootDir: string): MyClawPaths;
export function redirectUserData(): void;
export function initializeDirectories(): Promise<MyClawPaths>;
```

<!-- 现有内部函数 resolveConfiguredDataRoot 优先级（本次扩展点）-->
现行：MYCLAW_DATA_ROOT > PORTABLE_EXECUTABLE_DIR > readInstallerSelectedDataRoot > null
扩展后：MYCLAW_DATA_ROOT > PORTABLE_EXECUTABLE_DIR > readInstallerSelectedDataRoot > detectWorktreeDataRoot > null
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: directory-service 自动检测 worktree 数据根</name>
  <files>desktop/src/main/services/directory-service.ts, desktop/tests/directory-service-paths.test.ts</files>
  <behavior>
    覆盖以下行为（在 desktop/tests/directory-service-paths.test.ts 中追加 case）：
    - cwd 形如 `<tmp>/.worktrees/<name>/desktop` 时，自动数据根 = `<tmp>/.worktrees/<name>/.userdata`，redirectUserData 会把 Electron userData 设到 `<...>/.userdata/electron`
    - cwd 不含 `.worktrees` 段时，回退默认 userData，行为与现有 packaged 默认 case 一致
    - MYCLAW_DATA_ROOT 显式设置时优先于 worktree 自动检测（设置 env 同时也在 .worktrees 下，结果应当用 env 值）
    - app.isPackaged === true 时跳过 worktree 自动检测，避免极端情况下打包产物被放进 worktree（防御性，单测里把 isPackaged 拨成 true + cwd 假装在 worktree，期望走默认 userData）

    既有 5 个 case 不动，仅追加新 case；测试需通过模拟 cwd（vitest 没有内建 chdir mock，建议直接 `process.chdir(path)` 在 beforeEach mkdtemp 出的临时 worktree 路径，afterEach 还原到 process.cwd 原值）。
  </behavior>
  <action>
    改造 desktop/src/main/services/directory-service.ts：

    1) 新增内部函数（不导出）：
    ```typescript
    /** 从给定起点向上查找 .worktrees 段，命中则返回 worktree 根目录，否则 null。 */
    function findWorktreeRootFromPath(startPath: string): string | null {
      // 规范化 + 切分。Windows 用 \，POSIX 用 /，使用 path.sep + path.parse 处理。
      // 从 startPath 向上 walk，寻找路径段 ".worktrees"，
      // 命中后 worktreeRoot = ".worktrees/<下一段>"（即 join(parent, ".worktrees", next)）。
      // 关键不变量：必须有"下一段"才算命中，纯 ".worktrees" 末尾不算。
    }

    /** 在未显式配置时，根据当前进程位置兜底定位 worktree 数据根目录。 */
    function detectWorktreeDataRoot(): string | null {
      // packaged 直接返回 null（防御性）
      if (app.isPackaged) return null;
      // 优先用 cwd，其次 __dirname
      const candidates = [process.cwd(), __dirname];
      for (const start of candidates) {
        const worktreeRoot = findWorktreeRootFromPath(start);
        if (worktreeRoot) {
          const dataRoot = join(worktreeRoot, ".userdata");
          console.info("[directory-service] 检测到 worktree 路径，自动指向 worktree 内独立数据目录", {
            startPath: start,
            worktreeRoot,
            dataRoot,
          });
          return dataRoot;
        }
      }
      return null;
    }
    ```

    2) 修改 resolveConfiguredDataRoot：在 readInstallerSelectedDataRoot() 返回 null 之前/之后追加 worktree 检测分支。要求：把现行 `return readInstallerSelectedDataRoot();` 一行改成：
    ```typescript
    const installerRoot = readInstallerSelectedDataRoot();
    if (installerRoot) return installerRoot;

    const worktreeRoot = detectWorktreeDataRoot();
    if (worktreeRoot) return worktreeRoot;

    return null;
    ```

    3) findWorktreeRootFromPath 实现要点：
    - 用 `resolve(startPath)` 规范化
    - 用 `split(/[\\/]/)` 切分（兼容 Win/POSIX），过滤空段
    - 从尾部向头部扫描，找到 ".worktrees" 段且其后存在下一段，构造 worktree 根
    - 返回时用 `join(...)` 重建路径，Windows 下注意保留 drive letter（resolve 输出已含）
    - 不依赖文件系统真实存在，纯字符串运算

    4) 在 desktop/tests/directory-service-paths.test.ts 末尾追加新 describe block 或 it case，覆盖上面 behavior 列出的 4 种情形。沿用现有测试风格：
    - electronAppMock.isPackaged 默认设 false 在新 case 内手动控制
    - 用 mkdtempSync 造出 `<tmp>/foo/.worktrees/<name>/desktop` 结构
    - 在 beforeEach 末尾或新 case 内 `process.chdir(...)`，afterEach 加 `process.chdir(originalCwd)` 还原（在最外 beforeEach 里 `originalCwd = process.cwd()`）

    遵守仓库约定：
    - 文件保留 semicolons + 双引号 + 2 space indent
    - 日志走 `console.info` 用 `[directory-service]` 前缀，结构化 context 对象，中文业务消息
    - 不引入新依赖

    引用现有代码模式：
    - 路径规范化参考已有 `normalizePathForComparison`
    - 解释性 JSDoc 用中文，参考 readInstallerSelectedDataRoot 的注释风格
  </action>
  <verify>
    <automated>cd desktop ; pnpm vitest run tests/directory-service-paths.test.ts</automated>
  </verify>
  <done>
    - directory-service.ts 新增 detectWorktreeDataRoot + findWorktreeRootFromPath，纳入 resolveConfiguredDataRoot 优先级链
    - 单测全绿（原 5 case + 新追加 worktree case 全部通过）
    - tsc --noEmit 通过：`pnpm typecheck`
    - 启动 worktree 下 `pnpm dev` 时主进程日志可见 "[directory-service] 检测到 worktree 路径"，userData 落到 worktree 内 .userdata/electron
  </done>
</task>

<task type="auto">
  <name>Task 2: Windows 启动前自动切换控制台 codepage 到 UTF-8</name>
  <files>desktop/scripts/start.js, desktop/scripts/dev.js, desktop/package.json</files>
  <action>
    采用启动脚本方案（推荐方案 b：在 Electron 子进程起来前就切 codepage，子进程继承）。

    1) 新建 desktop/scripts/start.js：
    ```javascript
    const { spawn, spawnSync } = require("node:child_process");
    const path = require("node:path");

    const PROJECT_ROOT = path.join(__dirname, "..");
    const MAIN_ENTRY = path.join(PROJECT_ROOT, "dist", "src", "main", "index.js");

    /** Windows 下把当前控制台 codepage 切到 UTF-8 (65001)，避免 Electron 中文 stdout 乱码。 */
    function ensureUtf8ConsoleOnWindows() {
      if (process.platform !== "win32") return;
      try {
        // chcp 是 cmd 内置命令，必须 shell:true。stdio:ignore 避免 "Active code page: 65001" 噪音。
        spawnSync("chcp", ["65001"], { stdio: "ignore", shell: true });
      } catch (error) {
        console.warn("[desktop-start] 切换控制台 codepage 到 65001 失败，可能出现中文乱码", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    /** 在当前进程内启动 electron dist/src/main/index.js。 */
    function startElectron() {
      const electronBin = process.platform === "win32" ? "electron.cmd" : "electron";
      const child = spawn(electronBin, [MAIN_ENTRY], {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
        shell: process.platform === "win32",
        env: process.env,
      });
      child.on("exit", (code, signal) => {
        process.exit(code ?? (signal ? 1 : 0));
      });
      child.on("error", (error) => {
        console.error("[desktop-start] Electron 启动失败", {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      });
    }

    ensureUtf8ConsoleOnWindows();
    startElectron();
    ```

    2) 修改 desktop/package.json：把 `"start": "electron dist/src/main/index.js"` 改成 `"start": "node scripts/start.js"`。其他 script 保持不动。

    3) 修改 desktop/scripts/dev.js：在 `main()` 函数最早处（紧跟 `const env = buildDevEnvironment();` 之后或 `console.info("[dev] 开始准备桌面端开发环境"` 之前）调用相同的 codepage 切换逻辑。可以把 ensureUtf8ConsoleOnWindows 的实现复制一份直接放在 dev.js（避免跨脚本 require 引发的相对路径问题），或者把 ensureUtf8ConsoleOnWindows 抽到 desktop/scripts/start.js 中作为 module.exports，然后 dev.js `require("./start")` 复用。优先选择简单复制策略，两份代码不到 10 行可控。

    在 dev.js 中加入：
    ```javascript
    function ensureUtf8ConsoleOnWindows() {
      if (process.platform !== "win32") return;
      try {
        require("node:child_process").spawnSync("chcp", ["65001"], { stdio: "ignore", shell: true });
      } catch (error) {
        console.warn("[dev] 切换控制台 codepage 到 65001 失败，可能出现中文乱码", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    ```
    然后在 main() 开头调用 `ensureUtf8ConsoleOnWindows();`。

    4) 不要修改 desktop/src/main/index.ts。Node 端做 chcp 时机晚（Electron 主进程已经起来了，stdout 已经被父 PowerShell 按旧 codepage 解码），不可靠。启动脚本侧才是正确的层。

    遵守仓库约定：
    - desktop/scripts 全部 CJS（require）；保留 semicolons + 双引号 + 2 space indent
    - 日志前缀 `[desktop-start]` / `[dev]`，中文业务消息
    - 不引入新依赖（chcp 是 cmd 内置）
  </action>
  <verify>
    <automated>cd desktop ; node -e "require('./scripts/start.js')" 2>&amp;1 | findstr /C:"desktop-start" || echo "脚本可加载且无语法错误（实际不会启动 electron 因为 dist 可能不存在，syntax-only 验证）"</automated>
  </verify>
  <done>
    - desktop/scripts/start.js 新文件已创建，Windows 下先 chcp 65001 再 spawn electron
    - desktop/package.json 的 start 脚本指向 node scripts/start.js
    - desktop/scripts/dev.js 在 main() 起点调用 ensureUtf8ConsoleOnWindows，Windows 下 dev 路径同样无乱码
    - macOS / Linux 调用时 ensureUtf8ConsoleOnWindows 立即 return，行为不变
    - 在 worktree 下 Windows PowerShell 跑 `pnpm dev`，Electron 主进程的 `[directory-service] / [main] / [startup]` 中文日志正常显示，无乱码
  </done>
</task>

</tasks>

<verification>
执行完两个 Task 后，整体回归：

1. 单测：`cd desktop && pnpm vitest run tests/directory-service-paths.test.ts` 全绿
2. 类型：`cd desktop && pnpm typecheck` 通过
3. 主仓库自测（F:\MyClaw 主分支）：`cd desktop && pnpm dev`，日志应能看到 `[directory-service] 未检测到自定义数据目录，继续使用 Electron 默认 userData`，且控制台中文不乱码
4. Worktree 自测（F:\MyClaw\.worktrees\silicon-person 同步本次改动后）：`cd desktop && pnpm dev`，日志应看到 `[directory-service] 检测到 worktree 路径，自动指向 worktree 内独立数据目录`，且 `dataRoot` 指向 `F:\MyClaw\.worktrees\silicon-person\.userdata`，无 0x5 Cache 错误，中文不乱码
5. 同时启动主仓库 + worktree 两份桌面，互不干扰，各自数据独立
</verification>

<success_criteria>
- worktree 下启动 desktop 不再出现 `Unable to move the cache: Access is denied. (0x5)`
- worktree 下 `pnpm dev` 时 Electron userData 自动落在 `<worktree-root>/.userdata/electron`，主仓库不受影响
- Windows PowerShell 跑 `pnpm dev` / `pnpm start` 时，Electron 主进程中文日志正常显示，无 GBK 乱码
- 显式 MYCLAW_DATA_ROOT 仍优先生效（向后兼容）
- 打包后产物（不在 .worktrees 下）行为完全不变
- 所有现有 vitest 用例 + 新增 worktree 检测用例通过
- pnpm typecheck 通过
</success_criteria>

<output>
After completion, create `.planning/quick/260508-glz-worktree-electron-userdata-windows/260508-glz-SUMMARY.md`
</output>

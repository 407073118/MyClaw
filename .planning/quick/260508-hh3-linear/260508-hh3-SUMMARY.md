---
phase: quick-260508-hh3-linear
plan: 01
status: completed
date: 2026-05-08
tasks_completed: 1
files_modified: 1
---

# Quick Task 260508-hh3 Summary

## Goal

桌面端登录页 Linear-style 极简单列重做。把"中间一张毛玻璃卡片 + 表单"的 web-style 登录改为 Linear / 1Password 8 / Raycast 风格的原生桌面入口屏。

## What Changed

### `desktop/src/renderer/pages/LoginPage.tsx`（全文重写）

**保留不动**
- 顶部 imports（useState/useMemo/router/store/TitleBar）
- `loginErrorMessageMap` 错误码字典
- `redirectTarget` useMemo 解析
- `handleLogin` async 流程：try/catch/auth.login 调用签名/redirect/console.info|warn 业务日志
- `useShellStore()` 调用（保 import 副作用，不引入回归）
- 5 个 `data-testid`：`desktop-login-view` / `desktop-login-account` / `desktop-login-password` / `desktop-login-submit` / `desktop-login-error`

**新增**
- `import { AlertCircle, ArrowRight, Eye, EyeOff } from "lucide-react"`（已在 dependencies，无新增）
- `APP_VERSION = "v0.1.0"` 常量（与 package.json 当前版本一致）
- `resolveEnvLabel()` helper：用 `import.meta.env.MODE` 映射 development→`DEV` / production→`PROD` / 其他原样大写
- `shakeNonce` state：登录失败时 `+1`，挂在 `.login-column` 的 `key` 上触发整列重挂 → 重新跑 in/shake 两个动画

**视觉规格**
| 元素 | 规格 |
|------|------|
| `.login-page` 背景 | `#08090A`（比 `--bg-base` 更深，呼应 Linear 的"黑黑黑"梯度） |
| `.login-glow` | 600×600 cyan 径向 blob，`top: 8% / left: 50%`、blur 40px、z-index 0 |
| `.login-column` | `min(400px, 100%)` 单列，gap 32px，相对定位 z-index 1 |
| Logo 框 | 56×56 圆角 14px，cyan 8% 背景 + cyan 20% 描边，logo SVG 32px 居中 |
| Eyebrow | 11/700 uppercase 0.12em letter-spacing |
| Title (h1) | 24/600 -0.01em letter-spacing |
| Subtitle | 13/400 line-height 1.6 |
| Field input | 42px 高、cyan focus 边框（无 glow）、placeholder 用 `--text-muted` |
| 密码 eye 按钮 | 32×32 absolute 右 8px，hover `--text-primary`，focus-visible cyan outline |
| Submit CTA | 44px 高 full-width 实心 cyan + ArrowRight，hover `#0e9270`，active 下沉 1px |
| Error banner | rgba(239,68,68,0.10) 背景 + 0.20 边框 + AlertCircle，位置：副标题下方、表单上方 |
| Footer | absolute bottom 16 left 24，10/600 uppercase，`v0.1.0 · DEV` 形式 |
| 入场动画 | `login-column-in` 400ms ease-out（fade + 8px 上飘） |
| 抖动动画 | `login-shake` 200ms ease（±4px X 偏移），shakeNonce key 重挂触发 |
| 按钮 spinner | 14px 圆环 0.8s linear infinite |

## Implementation Notes

### shake 动画的实现选择
使用 `key={shakeNonce}` 让 `.login-column` 在每次失败时被 React 重挂，借此重新触发 `animation: login-column-in 400ms ease-out both, login-shake 200ms ease`。两个动画并行：上飘是入场，shake 是水平抖动，视觉互不干扰。优点是实现简洁、无须 useEffect 开关 className；副作用是出错时整列会重新做一次入场 fade，目前接受这一行为（视觉上"页面被错误重新唤起"反而强化了反馈感）。

### 环境标签来源选择
原计划是从 `desktop/config -> APP_ENV_NAME` 直接 import，但 `desktop/tsconfig.renderer.json` 的 `include` 仅含 `src/renderer/**` + `shared/**`，`desktop/config/index.ts` 在 include 范围外，且其依赖 `process.env`，对 renderer contextIsolation 不友好。改为读 Vite 注入的 `import.meta.env.MODE`（`vite/client` 类型已在 renderer tsconfig types 中），映射到 DEV/PROD。pre 环境的展示需要后续在 vite.config 里补 `--mode pre` 或 `define`，本次留给后续。

### UI Style Guide deliberate exception
本页主 CTA 用了实心填充 cyan（`background: var(--accent-cyan); color: #fff`），违反 `desktop/docs/ui-style-guide.md` 第 555 行 "❌ 实心填充 CTA"。理由：登录页是 chrome-level entry（应用启动后第一屏），调研中 Linear / 1Password 8 / Raycast / Cursor 等专业桌面应用的登录主操作全部用实心填充——它具有 OS 级权重，与"应用内常规页面"的语境不同。其余页面继续遵守描边规则。

## Verification

| 检查 | 命令 | 结果 |
|------|------|------|
| Renderer typecheck | `cd desktop && npx tsc --noEmit -p tsconfig.renderer.json` | LoginPage 无报错（worktree 内 `workspace.ts:776 runScheduleJobNow` 为预存问题，与本任务无关） |
| 测试影响 | `grep -rln "LoginPage\|desktop-login" desktop/tests/` | 0 命中（无单测引用，5 个 data-testid 仍保留，未来若加 e2e/RTL 测试可平滑接） |

## Behavioral Outcome

- 首屏从"普通 Web 登录卡"升级到"原生桌面应用入口"观感：单列居中 400 宽、cyan 径向光晕、品牌方框 logo、Linear 风字体层级
- 密码可见性切换从 `<label> + <checkbox>显示密码</label>` 升级为右侧 lucide Eye/EyeOff 图标按钮（`tabIndex={-1}` 不抢 Tab 顺序）
- 错误展示：从底部"红字一行"升级为副标题下方 banner（AlertCircle 图标 + 整列横向抖动 200ms）
- 左下角 `v0.1.0 · DEV/PROD` 角标，传递"被维护的内部工具"信号
- TitleBar 不动，auth.login 调用零回归，5 个 data-testid 全部保留可被定位
- macOS / Windows / Linux 表现一致，无平台分支代码

## Files Modified

- `desktop/src/renderer/pages/LoginPage.tsx`（重写，261→未统计行）

无新增依赖，无新增测试，无 global.css 改动，无 TitleBar 改动。

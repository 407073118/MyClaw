---
phase: quick-260508-iju
plan: 01
status: completed
date: 2026-05-08
tasks_completed: 1
files_modified: 2
---

# Quick Task 260508-iju Summary

## Goal

dev 模式下登录跳过 cloud-api 校验。本地开发时 cloud-api 未启动也能进入桌面端主界面，且页面刷新后 mock 会话仍生效，token 续期与 logout 也不会调真实 cloud-api。

## What Changed

### `desktop/src/renderer/stores/auth.ts`

**新增（顶部，AUTH_STORAGE_KEY 旁）：**
- 常量 `DEV_BYPASS_TOKEN_PREFIX = "dev-bypass-"`、`DEV_BYPASS_EXPIRES_IN_SECONDS = 24 * 60 * 60`
- `export function isDevAuthBypassEnabled()`：返回 `import.meta.env.MODE === "development"`，供 LoginPage 复用
- 私有 `isDevBypassToken(token)`：前缀匹配判断
- 私有 `buildDevBypassSession(account)`：构造 mock `AuthLoginResponse`，accessToken/refreshToken 都带 `dev-bypass-` 前缀，user.roles 含 `"dev-bypass"` 标记，displayName=account（空时回落 `dev-user`）

**短路改造四处：**

| 入口 | 短路条件 | 行为 |
|------|---------|------|
| `login` | `isDevAuthBypassEnabled()` | 不调 IPC，直接 `applyLoginSession(buildDevBypassSession(payload.account))`，console.warn 标记 DEV mock |
| `introspectSession` | `isDevBypassToken(session.accessToken)` | `set({ validationChecked: true })` + `return true`，console.info 提示 |
| `refreshSession` | `isDevBypassToken(session.refreshToken)` | `applyRefreshSession({ 新 dev-bypass accessToken, expiresIn })` + `return true` |
| `logout` | `isDevBypassToken(session.refreshToken)` | 跳过 `window.myClawAPI.auth.logout` IPC 调用，仅 `clearSession()` |

### `desktop/src/renderer/pages/LoginPage.tsx`

- import 增加 `Info` (lucide) 与 `isDevAuthBypassEnabled` (auth store)
- 副标题下方、错误 banner 上方新增 `.dev-bypass-banner`（cyan 描边、Info 图标 + 文案 "DEV 模式 · 登录将跳过 cloud-api 校验，账号密码可任填"），仅 dev 显示
- 配套 CSS：`background: rgba(16, 163, 127, 0.08)`、`border: 1px solid rgba(16, 163, 127, 0.25)`、`color: var(--accent-cyan)`、12px 字号

## Behavioral Outcome

- `pnpm dev` 启动后登录页副标题下方显示 cyan 提示条；填任意账号密码点登录 → 不调 IPC，立即进入主界面
- 刷新页面：hydrateFromStorage 恢复 mock session，introspectSession 看到 `dev-bypass-` 前缀立刻返回 true，不打 cloud-api
- access token 过期触发 refresh：dev-bypass 短路签发新 accessToken（同样 `dev-bypass-` 前缀），不打 cloud-api
- logout：dev-bypass session 仅清本地，不发 cloud logout IPC
- production / pre 构建：`import.meta.env.MODE !== "development"`，`isDevAuthBypassEnabled` 返回 false，所有 IPC / cloud 调用链路与原先完全一致
- 真实 cloud 登录依然可用：若用户在 dev 之外（pre/prod）登录得到的真 token 不带前缀，introspect/refresh 走真实 IPC

## Verification

| 检查 | 结果 |
|------|------|
| `npx tsc --noEmit -p tsconfig.renderer.json` 关于 auth.ts / LoginPage.tsx 的报错 | 0（worktree 内 `workspace.ts:776 runScheduleJobNow` 是预存问题，与本次无关） |
| 无新增依赖 | ✓ Info 已属于 lucide-react，已在 dependencies |
| 无新增测试 | 本次为 dev-only 行为旁路，原 5 个 data-testid 不变；后续若加 e2e 可基于 `isDevAuthBypassEnabled` 注入 |

## Risk Notes

- **production 安全性**：bypass 完全由 `import.meta.env.MODE` 门控；Vite 构建 production 时该值为 `"production"`，bypass 函数返回 false，整个分支不会被运行时触发。但仍建议在 `pnpm build:prod` 后人工抽测一次确认 banner 不出现、登录走真实 IPC。
- **token 持久化**：dev-bypass token 写到 localStorage，意味着同一 worktree 下次启动仍恢复 mock session；切到 pre/prod build 后，第一次启动会触发 introspect 调用 cloud-api 失败 → clearSession，回到登录页。这是预期行为。
- **cloud 调用其它链路**：本次只截短路径上 4 个入口；其他业务 IPC（`session.send-message`、`employees.list` 等）依然真实调用，dev mock 用户拿不到真实数据，但能进入 UI。

## Files Modified

- `desktop/src/renderer/stores/auth.ts`（顶部新增 +4 入口短路）
- `desktop/src/renderer/pages/LoginPage.tsx`（import + JSX banner + CSS 三处插入）

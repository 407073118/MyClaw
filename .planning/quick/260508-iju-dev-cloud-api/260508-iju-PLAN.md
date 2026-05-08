---
phase: quick-260508-iju
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - desktop/src/renderer/stores/auth.ts
  - desktop/src/renderer/pages/LoginPage.tsx
autonomous: true
requirements:
  - QUICK-260508-IJU
must_haves:
  truths:
    - "dev (Vite MODE === 'development') 启动桌面端时，登录页提交账号密码 → 不再调 window.myClawAPI.auth.login → 直接进入主界面"
    - "dev mock 会话的 accessToken / refreshToken 都带 'dev-bypass-' 前缀，可以被后续逻辑识别"
    - "刷新页面后 hydrateFromStorage 恢复 dev mock session，introspectSession 看到 dev-bypass 前缀立刻短路返回 true，不调 cloud-api"
    - "access token 过期触发 refreshSession 时，dev-bypass session 也短路成功，签发新 dev-bypass accessToken"
    - "logout 对 dev-bypass session 跳过 cloud-api 调用，仅清本地"
    - "LoginPage 在 dev 模式下副标题下方显示一行 cyan 描边 banner 提示『DEV 模式 · 登录将跳过 cloud-api 校验』"
    - "production / pre 构建时 isDevAuthBypassEnabled 返回 false，所有原有 cloud 调用链路完全不变"
  artifacts:
    - path: "desktop/src/renderer/stores/auth.ts"
      provides: "在 login / introspectSession / refreshSession / logout 入口加 dev-bypass 短路；新增 isDevAuthBypassEnabled / DEV_BYPASS_TOKEN_PREFIX / buildDevBypassSession 工具"
      contains: "dev-bypass-"
    - path: "desktop/src/renderer/pages/LoginPage.tsx"
      provides: "dev banner 提示 + import isDevAuthBypassEnabled"
      contains: "DEV 模式"
  key_links:
    - from: "desktop/src/renderer/pages/LoginPage.tsx"
      to: "desktop/src/renderer/stores/auth.ts -> isDevAuthBypassEnabled"
      via: "import { isDevAuthBypassEnabled, useAuthStore } from \"@/stores/auth\""
---

# Plan 260508-iju: dev 模式登录跳过 cloud-api 校验

## Task 1: auth store 加 dev bypass 短路

文件：`desktop/src/renderer/stores/auth.ts`

在文件顶部（`AUTH_STORAGE_KEY` 常量旁边）新增：

```ts
const DEV_BYPASS_TOKEN_PREFIX = "dev-bypass-";
const DEV_BYPASS_EXPIRES_IN_SECONDS = 24 * 60 * 60;

/** dev 模式是否启用 cloud-api 校验跳过（仅 Vite MODE === "development" 生效）。 */
export function isDevAuthBypassEnabled(): boolean {
  return import.meta.env.MODE === "development";
}

/** 判断给定 token 是否为 dev bypass mock token（前缀匹配）。 */
function isDevBypassToken(token: string | undefined | null): boolean {
  return Boolean(token && token.startsWith(DEV_BYPASS_TOKEN_PREFIX));
}

/** 构造 dev mock 登录响应；不调用 IPC，纯本地生成。 */
function buildDevBypassSession(account: string): AuthLoginResponse {
  const safeAccount = account.trim() || "dev-user";
  const stamp = Date.now().toString(36);
  return {
    accessToken: `${DEV_BYPASS_TOKEN_PREFIX}access-${stamp}`,
    refreshToken: `${DEV_BYPASS_TOKEN_PREFIX}refresh-${stamp}`,
    expiresIn: DEV_BYPASS_EXPIRES_IN_SECONDS,
    user: {
      account: safeAccount,
      displayName: safeAccount,
      roles: ["dev-bypass"],
    },
  };
}
```

修改四个动作：

**login**：在调 `window.myClawAPI.auth.login(payload)` 之前判断 `isDevAuthBypassEnabled()`，是 → 直接 `buildDevBypassSession + applyLoginSession + return`；否则保持原 IPC 流程。`console.warn` 一条 [desktop-auth] DEV 跳过提示。

**introspectSession**：在 `if (!session.accessToken)` 检查之后、try 之前，加 `if (isDevBypassToken(session.accessToken)) { set({ validationChecked: true }); return true; }` 短路；console.info 提示。

**refreshSession**：在 `if (!session.refreshToken)` 检查之后、try 之前，加 `if (isDevBypassToken(session.refreshToken)) { applyRefreshSession({ accessToken: 新前缀 token, expiresIn: DEV_BYPASS_EXPIRES_IN_SECONDS }); return true; }` 短路。

**logout**：把 `if (session.refreshToken)` 改成 `if (session.refreshToken && !isDevBypassToken(session.refreshToken))`，避免对 mock token 调真实 cloud logout。

## Task 2: LoginPage 副标题下加 dev banner

文件：`desktop/src/renderer/pages/LoginPage.tsx`

import：`import { useAuthStore, isDevAuthBypassEnabled } from "@/stores/auth"`（保留原有 useAuthStore import）。

在 `.login-copy` 下面、`{errorMessage && (...)}` 上面，加：

```tsx
{isDevAuthBypassEnabled() && (
  <div className="dev-bypass-banner" role="note">
    <Info size={14} aria-hidden="true" />
    <span>DEV 模式 · 登录将跳过 cloud-api 校验，账号密码可任填</span>
  </div>
)}
```

需要从 lucide-react 加 `Info` import。

CSS（加在现有 `<style>` 块的 `.error-banner` 附近）：

```css
.dev-bypass-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: rgba(16, 163, 127, 0.08);
  border: 1px solid rgba(16, 163, 127, 0.25);
  color: var(--accent-cyan);
  font-size: 12px;
  line-height: 1.5;
}

.dev-bypass-banner svg {
  margin-top: 2px;
  flex-shrink: 0;
}
```

## Verify

- `cd desktop && npx tsc --noEmit -p tsconfig.renderer.json` 关于 auth.ts / LoginPage.tsx 不应有新增报错
- `pnpm dev` 启动后：登录页副标题下方出现 cyan 提示条；填任意账号密码 → 进入主界面，main 进程 cloud IPC 看不到 auth.login 请求
- 重启应用：恢复 dev mock 会话不调 cloud-api；引发 token 过期后 refresh 也不调
- 改 vite.config 为 production build 后，banner 不显示，所有 cloud 调用恢复

## Done

- auth.ts 4 个入口加 dev-bypass 短路
- LoginPage 加 cyan dev banner（仅 dev）
- typecheck 关于本次改动 0 error
- worktree 内 commit + STATE 记录

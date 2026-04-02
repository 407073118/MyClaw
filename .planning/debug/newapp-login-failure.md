---
status: awaiting_human_verify
trigger: "newApp login fails with cloud_api_request_failed despite cloud-api running at localhost:43210"
created: 2026-03-31T00:00:00Z
updated: 2026-03-31T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - Preload bridge API shape mismatch with auth store expectations
test: Verified preload exposes flat cloudLogin/cloudLogout/etc but auth store calls window.myClawAPI.auth.login/logout/etc
expecting: Fix preload to use nested auth object matching type declaration
next_action: Await human verification of fix

## Symptoms

expected: Login should succeed when cloud-api is running at localhost:43210
actual: Login fails with message "登录失败，请确认 cloud-api 已启动。"
errors: Error code "cloud_api_request_failed" in LoginPage.tsx (also the fallback for unrecognized errors)
reproduction: npm run build:main && npm start in F:/MyClaw/newApp, then try to login
started: New app, never worked. Two issues already fixed (IS_DEV, CLOUD_API_BASE)

## Eliminated

- hypothesis: IS_DEV always true due to !app.isPackaged
  evidence: Fixed in index.ts line 16
  timestamp: prior

- hypothesis: CLOUD_API_BASE pointing to https://api.myclaw.com instead of localhost
  evidence: Fixed to http://localhost:43210/api
  timestamp: prior

## Evidence

- timestamp: 2026-03-31T00:01:00Z
  checked: preload/index.ts vs renderer/stores/auth.ts vs renderer/types/electron.d.ts
  found: |
    Auth store calls window.myClawAPI.auth.login(), .auth.logout(), .auth.refresh(), .auth.introspect()
    Type declaration (electron.d.ts) declares auth as nested object on myClawAPI
    BUT preload/index.ts exposed them as flat: cloudLogin, cloudLogout, cloudRefresh, cloudIntrospect
    Result: window.myClawAPI.auth is undefined -> TypeError on .login() call
    LoginPage catches error, can't match error code, falls back to "cloud_api_request_failed" message
  implication: This is the root cause - preload API shape doesn't match what consumers expect

- timestamp: 2026-03-31T00:02:00Z
  checked: cloud.ts logout IPC handler vs cloud-api auth.controller.ts logout endpoint
  found: |
    IPC handler sent accessToken as Bearer header for logout
    cloud-api expects { refreshToken } in POST body
    Auth store passes refreshToken to preload, but IPC handler named it accessToken and sent as header
  implication: Secondary bug - logout would silently fail even after login fix

## Resolution

root_cause: |
  Preload bridge (preload/index.ts) exposed auth methods as flat properties (cloudLogin, cloudLogout,
  cloudRefresh, cloudIntrospect) but the auth store and type declaration expect a nested
  window.myClawAPI.auth object with login/logout/refresh/introspect methods.
  Accessing window.myClawAPI.auth returned undefined, causing TypeError on .login() call.
  The LoginPage error handler couldn't match the TypeError message to any known error code,
  so it fell through to the default "cloud_api_request_failed" message.
fix: |
  1. Restructured preload/index.ts to expose auth as nested object matching type declaration:
     auth: { login, logout, refresh, introspect }
  2. Fixed logout IPC handler in cloud.ts to send refreshToken in POST body
     (matching what cloud-api expects) instead of as Bearer header
verification: Awaiting human verification
files_changed:
  - newApp/src/preload/index.ts
  - newApp/src/main/ipc/cloud.ts

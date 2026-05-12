import React, { useState, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AlertCircle, ArrowRight, Eye, EyeOff, Info, UserRound } from "lucide-react";
import { useShellStore } from "@/stores/shell";
import { isDevAuthBypassEnabled, useAuthStore } from "@/stores/auth";
import TitleBar from "../components/TitleBar";

const loginErrorMessageMap: Record<string, string> = {
  account_or_password_required: "请输入账号和密码后再登录。",
  account_or_password_invalid: "账号或密码错误，请重新确认。",
  account_forbidden: "当前账号没有访问权限，请联系管理员。",
  cloud_api_request_failed: "登录失败，请确认 cloud-api 已启动。",
  internal_auth_provider_failed: "登录服务暂时不可用，请稍后重试。",
};

const APP_VERSION = "v0.1.0";

/** 把 Vite mode 映射到登录页左下角显示的环境角标。 */
function resolveEnvLabel(): string {
  const mode = import.meta.env.MODE;
  if (mode === "development") return "DEV";
  if (mode === "production") return "PROD";
  return mode.toUpperCase();
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const shell = useShellStore();
  const auth = useAuthStore();

  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  /** 失败计数器：变化时给 .login-column 重挂 key，触发一次抖动动画。 */
  const [shakeNonce, setShakeNonce] = useState(0);

  /** 归一化登录完成后的跳转地址，避免把非法外链透传给桌面路由。 */
  const redirectTarget = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const target = params.get("redirect");
    if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) {
      return "/";
    }
    return target;
  }, [location.search]);

  const envLabel = useMemo(() => resolveEnvLabel(), []);

  /** 处理桌面端登录提交，成功后回到用户原本要访问的页面。 */
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setErrorMessage("");
    console.info("[desktop-login] 开始提交桌面端登录表单", {
      account,
      redirect: redirectTarget,
    });

    try {
      await auth.login({ account, password });
      console.info("[desktop-login] 桌面端登录成功，准备跳转", {
        account,
        redirect: redirectTarget,
      });
      navigate(redirectTarget, { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败，请确认 cloud-api 已启动。";
      const code = message.split(":").at(-1)?.trim() ?? "";
      setErrorMessage(loginErrorMessageMap[code] || "登录失败，请确认 cloud-api 已启动。");
      setShakeNonce((n) => n + 1);
      console.warn("[desktop-login] 桌面端登录失败", { account, error: message });
    } finally {
      setPending(false);
    }
  }

  /** 处理游客登录入口，创建本地会话后直接进入桌面主界面。 */
  async function handleGuestLogin() {
    setPending(true);
    setErrorMessage("");
    console.info("[desktop-login] 开始游客登录", {
      redirect: redirectTarget,
    });

    try {
      await auth.loginAsGuest();
      console.info("[desktop-login] 游客登录成功，准备跳转", {
        redirect: redirectTarget,
      });
      navigate(redirectTarget, { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "游客登录失败，请稍后重试。";
      setErrorMessage("游客登录失败，请稍后重试。");
      setShakeNonce((n) => n + 1);
      console.warn("[desktop-login] 游客登录失败", { error: message });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="app-root-wrapper">
      <TitleBar />
      <main data-testid="desktop-login-view" className="login-page">
        {/* cyan 径向光晕 */}
        <div className="login-glow" aria-hidden="true" />

        {/* 居中单列；shakeNonce 变化时整列重挂触发抖动 */}
        <section className="login-column" key={shakeNonce}>
          {/* 1. 品牌 logo（带框） */}
          <div className="login-brand">
            <div className="login-brand__frame">
              <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12.06 2.75 6.18 20h2.36l1.32-4.01h4.27L15.47 20h2.35L12.06 2.75Zm0 5.41 1.37 4.18h-2.76l1.39-4.18Z"
                />
                <path fill="currentColor" opacity="0.34" d="m12.08 9.84 2.05 6.15H9.86z" />
              </svg>
            </div>
          </div>

          {/* 2. 三层文字 */}
          <div className="login-copy">
            <span className="login-eyebrow">MYCLAW DESKTOP</span>
            <h1 className="login-title">登录你的企业工作空间</h1>
            <p className="login-subtitle">使用企业账号登录，或以游客身份先进入本地工作区</p>
          </div>

          {/* 3a. dev 模式提示（仅 development 构建显示） */}
          {isDevAuthBypassEnabled() && (
            <div className="dev-bypass-banner" role="note">
              <Info size={14} aria-hidden="true" />
              <span>DEV 模式 · 登录将跳过 cloud-api 校验，账号密码可任填</span>
            </div>
          )}

          {/* 3b. 错误 banner（在表单上方） */}
          {errorMessage && (
            <div data-testid="desktop-login-error" className="error-banner" role="alert">
              <AlertCircle size={14} aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 4. 表单 */}
          <form className="login-form" onSubmit={handleLogin}>
            <label className="field">
              <span className="field__label">企业账号</span>
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value.trim())}
                data-testid="desktop-login-account"
                type="text"
                autoComplete="username"
                placeholder="请输入企业账号"
                required
              />
            </label>

            <label className="field">
              <span className="field__label">登录密码</span>
              <div className="field__password-wrap">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="desktop-login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="请输入登录密码"
                  required
                />
                <button
                  type="button"
                  className="field__eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <button
              data-testid="desktop-login-submit"
              type="submit"
              className="submit-button"
              disabled={pending}
            >
              {pending ? (
                <>
                  <span className="submit-button__spinner" aria-hidden="true" />
                  <span>正在登录...</span>
                </>
              ) : (
                <>
                  <span>登录</span>
                  <ArrowRight size={16} aria-hidden="true" />
                </>
              )}
            </button>

            <button
              data-testid="desktop-login-guest"
              type="button"
              className="guest-button"
              disabled={pending}
              onClick={handleGuestLogin}
            >
              <UserRound size={16} aria-hidden="true" />
              <span>{pending ? "正在进入..." : "游客登录"}</span>
            </button>
          </form>
        </section>

        {/* 5. 左下角版本/环境角标 */}
        <div className="login-footer" aria-hidden="true">
          <span>{APP_VERSION}</span>
          <span className="login-footer__sep"> · </span>
          <span>{envLabel}</span>
        </div>

        <style>{`
          .app-root-wrapper {
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
          }

          .login-page {
            position: relative;
            flex: 1;
            display: grid;
            place-items: center;
            padding: 32px;
            overflow: hidden;
            background: #08090A;
          }

          /* cyan 径向光晕 */
          .login-glow {
            position: absolute;
            top: 8%;
            left: 50%;
            transform: translateX(-50%);
            width: 600px;
            height: 600px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(16, 163, 127, 0.18) 0%, rgba(16, 163, 127, 0) 60%);
            filter: blur(40px);
            pointer-events: none;
            z-index: 0;
          }

          /* 居中单列 */
          .login-column {
            position: relative;
            z-index: 1;
            width: min(400px, 100%);
            display: flex;
            flex-direction: column;
            gap: 32px;
            align-items: stretch;
            animation: login-column-in 400ms ease-out both, login-shake 200ms ease;
          }

          @keyframes login-column-in {
            0% { opacity: 0; transform: translateY(8px); }
            100% { opacity: 1; transform: translateY(0); }
          }

          @keyframes login-shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-4px); }
            75% { transform: translateX(4px); }
          }

          /* 品牌 logo 带框 */
          .login-brand {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 24px;
          }

          .login-brand__frame {
            width: 56px;
            height: 56px;
            padding: 12px;
            display: grid;
            place-items: center;
            border-radius: 14px;
            background: rgba(16, 163, 127, 0.08);
            border: 1px solid rgba(16, 163, 127, 0.2);
            color: var(--accent-cyan);
            box-sizing: border-box;
          }

          /* 三层文字 */
          .login-copy {
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: center;
            text-align: center;
          }

          .login-eyebrow {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: var(--text-muted);
          }

          .login-title {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
            letter-spacing: -0.01em;
            color: var(--text-primary);
            line-height: 1.25;
          }

          .login-subtitle {
            margin: 0;
            font-size: 13px;
            font-weight: 400;
            line-height: 1.6;
            color: var(--text-secondary);
          }

          /* DEV 模式提示 banner（cyan 描边） */
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

          /* 错误 banner */
          .error-banner {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 10px 12px;
            border-radius: var(--radius-md);
            background: rgba(239, 68, 68, 0.10);
            border: 1px solid rgba(239, 68, 68, 0.20);
            color: #fca5a5;
            font-size: 13px;
            line-height: 1.5;
          }

          .error-banner svg {
            margin-top: 2px;
            flex-shrink: 0;
          }

          /* 表单 */
          .login-form {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }

          .field {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .field__label {
            font-size: 13px;
            font-weight: 500;
            color: var(--text-secondary);
          }

          .field input {
            height: 42px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: var(--radius-md);
            padding: 0 14px;
            font-size: 14px;
            color: var(--text-primary);
            transition: border-color 0.15s ease, background 0.15s ease;
            width: 100%;
            box-sizing: border-box;
          }

          .field input::placeholder {
            color: var(--text-muted);
          }

          .field input:hover:not(:focus) {
            border-color: rgba(255, 255, 255, 0.15);
          }

          .field input:focus {
            outline: none;
            border-color: var(--accent-cyan);
          }

          .field__password-wrap {
            position: relative;
          }

          .field__password-wrap input {
            padding-right: 44px;
          }

          .field__eye {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            width: 32px;
            height: 32px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            transition: color 0.15s ease;
          }

          .field__eye:hover {
            color: var(--text-primary);
          }

          .field__eye:focus-visible {
            outline: 2px solid var(--accent-cyan);
            outline-offset: -2px;
            border-radius: var(--radius-md);
          }

          /* 主 CTA —— 登录是 chrome-level 入口，例外允许实心填充（见 SUMMARY） */
          .submit-button {
            height: 44px;
            width: 100%;
            border: none;
            border-radius: var(--radius-md);
            background: var(--accent-cyan);
            color: #ffffff;
            font-size: 14px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            cursor: pointer;
            transition: background 0.15s ease, transform 0.1s ease;
          }

          .submit-button:hover:not(:disabled) {
            background: #0e9270;
          }

          .submit-button:active:not(:disabled) {
            transform: translateY(1px);
          }

          .submit-button:disabled {
            opacity: 0.6;
            cursor: wait;
          }

          .submit-button__spinner {
            width: 14px;
            height: 14px;
            border-radius: 50%;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-top-color: #ffffff;
            animation: login-spin 0.8s linear infinite;
          }

          .guest-button {
            height: 42px;
            width: 100%;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: var(--radius-md);
            background: rgba(255, 255, 255, 0.03);
            color: var(--text-secondary);
            font-size: 14px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            cursor: pointer;
            transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease, transform 0.1s ease;
          }

          .guest-button svg {
            flex-shrink: 0;
          }

          .guest-button:hover:not(:disabled) {
            border-color: rgba(16, 163, 127, 0.45);
            background: rgba(16, 163, 127, 0.08);
            color: var(--text-primary);
          }

          .guest-button:active:not(:disabled) {
            transform: translateY(1px);
          }

          .guest-button:disabled {
            opacity: 0.6;
            cursor: wait;
          }

          @keyframes login-spin {
            to { transform: rotate(360deg); }
          }

          /* 左下角版本 / 环境 */
          .login-footer {
            position: absolute;
            bottom: 16px;
            left: 24px;
            z-index: 1;
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--text-muted);
            user-select: none;
          }

          .login-footer__sep {
            margin: 0 2px;
          }
        `}</style>
      </main>
    </div>
  );
}

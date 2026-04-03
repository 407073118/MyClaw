import React, { useState, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useShellStore } from "@/stores/shell";
import { useAuthStore } from "@/stores/auth";
import TitleBar from "../components/TitleBar";

const loginErrorMessageMap: Record<string, string> = {
  account_or_password_required: "请输入账号和密码后再登录。",
  account_or_password_invalid: "账号或密码错误，请重新确认。",
  account_forbidden: "当前账号没有访问权限，请联系管理员。",
  cloud_api_request_failed: "登录失败，请确认 cloud-api 已启动。",
  internal_auth_provider_failed: "登录服务暂时不可用，请稍后重试。",
};

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

  /** 归一化登录完成后的跳转地址，避免把非法外链透传给桌面路由。 */
  const redirectTarget = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const target = params.get("redirect");
    if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) {
      return "/";
    }
    return target;
  }, [location.search]);

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
      console.warn("[desktop-login] 桌面端登录失败", { account, error: message });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="app-root-wrapper">
      <TitleBar />
      <main data-testid="desktop-login-view" className="login-page">
      <section className="login-panel">
        <div className="login-copy">
          <span className="eyebrow">MyClaw Desktop</span>
          <h1>登录后才能使用桌面端</h1>
          <p>
            使用和 Cloud 一致的企业账号密码登录。桌面端会在本地安全保存登录态，并在 access token 过期后自动尝试续期。
          </p>
        </div>

        <form className="login-form" onSubmit={handleLogin}>
          <label className="field">
            <span>企业账号</span>
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
            <span>登录密码</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="desktop-login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="请输入登录密码"
              required
            />
          </label>

          <label className="toggle-line">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
            />
            <span>显示密码</span>
          </label>

          <button data-testid="desktop-login-submit" type="submit" className="submit-button" disabled={pending}>
            {pending ? "正在登录..." : "登录 Desktop"}
          </button>

          {errorMessage && (
            <p data-testid="desktop-login-error" className="status error">
              {errorMessage}
            </p>
          )}
        </form>
      </section>

      <style>{`
        .app-root-wrapper {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
        }

        .login-page {
          flex: 1;
          display: grid;
          place-items: center;
          padding: 32px;
          overflow: hidden;
          background: var(--bg-base);
        }

        .login-panel {
          width: min(440px, 100%);
          padding: 40px;
          border-radius: var(--radius-xl);
          background: var(--bg-card);
          border: 1px solid var(--glass-border);
          box-shadow: var(--shadow-main);
          display: grid;
          gap: 32px;
        }

        .login-copy {
          display: grid;
          gap: 8px;
        }

        .login-copy .eyebrow {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .login-copy h1 {
          margin: 0;
          font-size: 24px;
          line-height: 1.2;
          font-weight: 600;
          color: var(--text-primary);
        }

        .login-copy p {
          margin: 0;
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.6;
        }

        .login-form {
          display: grid;
          gap: 20px;
        }

        .login-form .field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .login-form .field span {
          font-size: 13px;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .login-form .field input {
          height: 40px;
          border-radius: var(--radius-md);
          border: 1px solid var(--glass-border);
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 0 12px;
          font-size: 14px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .login-form .field input:focus {
          outline: none;
          border-color: var(--accent-cyan);
          box-shadow: 0 0 0 1px var(--accent-cyan);
        }

        .toggle-line {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--text-secondary);
          font-size: 13px;
          cursor: pointer;
        }

        .toggle-line input[type="checkbox"] {
          accent-color: var(--accent-cyan);
        }

        .submit-button {
          height: 40px;
          border: none;
          border-radius: var(--radius-md);
          background: var(--accent-cyan);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          width: 100%;
          transition: opacity 0.2s;
        }

        .submit-button:hover:not(:disabled) {
          opacity: 0.9;
        }

        .submit-button:disabled {
          cursor: wait;
          opacity: 0.5;
        }

        .status {
          margin: 0;
          padding: 12px;
          border-radius: var(--radius-md);
          font-size: 13px;
        }

        .status.error {
          color: #fca5a5;
          background: rgba(153, 27, 27, 0.2);
          border: 1px solid rgba(248, 113, 113, 0.2);
        }
      `}</style>
      </main>
    </div>
  );
}

import React, { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import TitleBar from "../components/TitleBar";
import WebPanel from "../components/WebPanel";

import { useAuthStore } from "../stores/auth";
import { useWorkspaceStore } from "../stores/workspace";

// ---------------------------------------------------------------------------
// Inline SVG icon components
// ---------------------------------------------------------------------------

const IconChat = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
    <path fill="currentColor" d="M12 7v5l3 3" />
  </svg>
);

const IconHub = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    <path fill="currentColor" d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm0 2.3L6 8.4v6.2l6 3.1 6-3.1V8.4l-6-3.1z" />
  </svg>
);

const IconMcp = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    <path
      fill="currentColor"
      d="M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.09-.36.14-.57.14s-.41-.05-.57-.14l-7.9-4.44c-.31-.17-.53-.5-.53-.88V7.5c0-.38.21-.71.53-.88l7.9-4.44c.16-.09.36-.14.57-.14s.41.05.57.14l7.9 4.44c.31.17.53.5.53.88v9z"
    />
  </svg>
);

const IconSkills = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    <path
      fill="currentColor"
      d="M13 13h-2v-2h2v2zm0 4h-2v-2h2v2zm0-8h-2V7h2v2zm4 4h-2v-2h2v2zm0 4h-2v-2h2v2zm0-8h-2V7h2v2zM9 13H7v-2h2v2zm0 4H7v-2h2v2zm0-8H7V7h2v2z"
    />
  </svg>
);

const IconEmployees = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    <path
      fill="currentColor"
      d="M16 11c1.66 0 2.99-1.79 2.99-4S17.66 3 16 3s-3 1.79-3 4 1.34 4 3 4zm-8 0c1.66 0 2.99-1.79 2.99-4S9.66 3 8 3 5 4.79 5 7s1.34 4 3 4zm0 2c-2.33 0-7 1.17-7 3.5V21h14v-4.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.94 1.97 3.45V21h6v-4.5c0-2.33-4.67-3.5-7-3.5z"
    />
  </svg>
);

const IconWorkflows = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    <path
      fill="currentColor"
      d="M7 3a4 4 0 0 1 3.87 3H20v2h-9.13A4.002 4.002 0 0 1 7 11a4 4 0 1 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 8a4 4 0 0 1 3.87 3H22v2h-1.13A4.002 4.002 0 0 1 17 21a4 4 0 1 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM2 6h2v12H2zm3 11h9v2H5zm5-5h9v2h-9z"
    />
  </svg>
);

const IconPublish = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    <path
      fill="currentColor"
      d="M5 20h14v-2H5zm7-18l-5.5 5.5 1.41 1.41L11 5.83V16h2V5.83l3.09 3.08 1.41-1.41z"
    />
  </svg>
);

const IconSettings = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <path
      fill="currentColor"
      d="M12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5zm7-2.12c.06-.44.1-.88.1-1.38s-.04-.94-.1-1.38l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.01 2.19 13.8 2 13.56 2h-3.12c-.24 0-.45.19-.48.43l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.12.22-.07.49.12.64l2.11 1.65c-.06.44-.1.88-.1 1.38s.04.94.1 1.38l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.31.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.43.48.43h3.12c.24 0 .45-.19.48-.43l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.22.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65z"
    />
  </svg>
);

const IconBrand = () => (
  <svg viewBox="0 0 24 24" width="24" height="24">
    <path fill="currentColor" d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
  </svg>
);

const IconBrandBootstrap = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
    <path fill="currentColor" d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
  </svg>
);

// ---------------------------------------------------------------------------
// Nav items config
// ---------------------------------------------------------------------------

type NavItem = {
  to: string;
  label: string;
  icon: React.FC;
  testId: string;
};

const navItems: NavItem[] = [
  { to: "/", label: "Chat", icon: IconChat, testId: "nav-chat" },
  { to: "/hub", label: "Hub", icon: IconHub, testId: "nav-hub" },
  { to: "/tools", label: "Tools", icon: IconSkills, testId: "nav-tools" },
  { to: "/mcp", label: "MCP", icon: IconMcp, testId: "nav-mcp" },
  { to: "/skills", label: "Skills", icon: IconSkills, testId: "nav-skills" },
  { to: "/employees", label: "Employees", icon: IconEmployees, testId: "nav-employees" },
  { to: "/workflows", label: "Workflows", icon: IconWorkflows, testId: "nav-workflows" },
  // { to: "/publish-drafts", label: "Publish", icon: IconPublish, testId: "nav-publish-drafts" },
];

// ---------------------------------------------------------------------------
// Bootstrap splash screen
// ---------------------------------------------------------------------------

function BootstrapSplash({
  error,
  message,
  title,
  onRetry,
}: {
  error: boolean;
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="app-root-wrapper">
      <TitleBar />
      <main data-testid="app-bootstrap-splash" className="bootstrap-shell">
        <section className="bootstrap-card">
          <div className="bootstrap-brand">
            <div className="bootstrap-logo">
              <IconBrandBootstrap />
            </div>
            <div className="bootstrap-copy">
              <span className="bootstrap-eyebrow">MyClaw Desktop</span>
              <h1>{title}</h1>
              <p>{message}</p>
            </div>
          </div>

          {error ? (
            <div className="bootstrap-error-block">
              <button
                data-testid="app-bootstrap-retry"
                type="button"
                className="bootstrap-retry-button"
                onClick={onRetry}
              >
                Retry startup
              </button>
            </div>
          ) : (
            <div className="bootstrap-progress" aria-hidden="true">
              <span className="bootstrap-progress-bar" />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppShell
// ---------------------------------------------------------------------------

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();

  const auth = useAuthStore();
  const workspace = useWorkspaceStore();

  const isAuthenticated = auth.isAuthenticated;
  const ready = workspace.ready;
  const loading = workspace.loading;
  const error = workspace.error;

  const showBootstrapError = !ready && Boolean(error);
  const showBootstrapSplash = loading || (!ready && !error);
  const showBootstrapScreen = showBootstrapSplash || showBootstrapError;

  const bootstrapTitle = showBootstrapError ? "Workspace startup failed" : "Starting workspace";
  const bootstrapMessage = showBootstrapError
    ? (error ?? "Unable to load startup data from the local runtime.")
    : "Preparing the local runtime, restoring workspace state, and opening your last session.";

  const defaultModelName =
    workspace.models.find((m) => m.id === workspace.defaultModelProfileId)?.name ?? "Offline";

  const currentUserDisplayName = auth.session.user?.displayName ?? "未登录用户";
  const currentUserAccount = auth.session.user?.account ?? "未绑定账号";

  // Load bootstrap when authenticated and not yet ready
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    if (ready || loading) {
      return;
    }
    console.info("[app-shell] 开始加载桌面端启动引导数据", { routePath: location.pathname });
    void workspace.loadBootstrap();
  }, [isAuthenticated, ready, loading, location.pathname]);

  // After bootstrap, redirect to /settings on first launch with no model config
  useEffect(() => {
    if (!ready || !isAuthenticated) {
      return;
    }
    if (workspace.requiresInitialSetup && !location.pathname.startsWith("/setup")) {
      console.info("[app-shell] 缺少模型配置，跳转初始设置页");
      void navigate("/setup", { replace: true });
    }
  }, [ready, isAuthenticated, workspace.requiresInitialSetup, location.pathname]);

  async function handleLogout() {
    console.info("[app-shell] 用户请求退出当前账号", {
      account: auth.session.user?.account ?? null,
    });
    await auth.logout();
    void navigate("/login", { replace: true });
  }

  function handleBootstrapRetry() {
    console.info("[app-shell] 用户请求重新加载桌面端启动引导数据");
    void workspace.loadBootstrap();
  }

  function isNavItemActive(targetPath: string): boolean {
    if (targetPath === "/") {
      return location.pathname === targetPath;
    }
    return location.pathname === targetPath || location.pathname.startsWith(`${targetPath}/`);
  }

  // Show bootstrap screen while loading workspace
  if (showBootstrapScreen) {
    return (
      <BootstrapSplash
        error={showBootstrapError}
        title={bootstrapTitle}
        message={bootstrapMessage}
        onRetry={handleBootstrapRetry}
      />
    );
  }

  return (
    <div className="app-root-wrapper">
      <TitleBar />
      <main className="shell">
      <aside data-testid="app-sidebar" className="app-sidebar">
        <div className="sidebar-content">
          <header className="sidebar-header">
            <div className="brand">
              <div className="brand-logo">
                <IconBrand />
              </div>
              <div className="brand-meta">
                <h2>MyClaw</h2>
                <span className="version">v0.1.0</span>
              </div>
            </div>
          </header>

          <nav data-testid="app-nav" className="app-nav">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                data-testid={item.testId}
                to={item.to}
                end={item.to === "/"}
                className={["nav-link", isNavItemActive(item.to) ? "active" : ""].filter(Boolean).join(" ")}
              >
                <div className="nav-icon-box">
                  <item.icon />
                </div>
                <span className="nav-label">{item.label}</span>
                {isNavItemActive(item.to) && <div className="active-glow" />}
              </NavLink>
            ))}
          </nav>
        </div>

        <footer className="sidebar-footer">
          <div className="user-card">
            <div className="user-card-top">
              <div className="user-avatar">
                {currentUserDisplayName.charAt(0).toUpperCase()}
              </div>
              <div className="user-info">
                <strong className="user-name">{currentUserDisplayName}</strong>
                <span className="user-model">
                  <span className={["model-dot", ready ? "active" : ""].filter(Boolean).join(" ")} />
                  {defaultModelName}
                </span>
              </div>
            </div>
            <div className="user-card-actions">
              <NavLink
                data-testid="nav-settings"
                to="/settings"
                className={["user-action-btn", location.pathname.startsWith("/settings") ? "active" : ""]
                  .filter(Boolean)
                  .join(" ")}
                title="Settings"
              >
                <IconSettings />
                <span>设置</span>
              </NavLink>
              <button
                data-testid="auth-logout"
                type="button"
                className="user-action-btn logout"
                onClick={() => void handleLogout()}
                title="退出登录"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>退出</span>
              </button>
            </div>
          </div>
        </footer>
      </aside>

      <section className="shell-content">
        <Outlet />
      </section>

      <WebPanel />

      <style>{`
        .shell {
          display: flex;
          flex: 1;
          padding: 0;
          background: var(--bg-base);
          overflow: hidden;
        }

        .app-sidebar {
          width: 240px;
          background: var(--bg-sidebar);
          border-right: 1px solid var(--glass-border);
          display: flex;
          flex-direction: column;
          padding: 20px 16px 32px;
          z-index: 100;
        }

        .sidebar-content {
          flex: 1;
        }

        .sidebar-header {
          margin-bottom: 40px;
          padding: 0 8px;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .brand-logo {
          width: 32px;
          height: 32px;
          background: var(--text-primary);
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--bg-base);
        }

        .brand-meta h2 {
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--text-primary);
          margin: 0;
        }

        .version {
          font-size: 10px;
          font-weight: 500;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .app-nav {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .nav-link {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          text-decoration: none;
          transition: all 0.2s ease;
          border: 1px solid transparent;
        }

        .nav-link:hover {
          background: var(--glass-reflection);
          color: var(--text-primary);
        }

        .nav-link.active {
          background: var(--bg-card);
          color: var(--text-primary);
          border-color: var(--glass-border);
        }

        .nav-icon-box {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
        }

        .nav-label {
          font-size: 14px;
          font-weight: 500;
        }

        .sidebar-footer {
          display: flex;
          flex-direction: column;
        }

        .user-card {
          background: var(--bg-card);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }

        .user-card-top {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
        }

        .user-avatar {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: linear-gradient(135deg, var(--accent-cyan), #0d9668);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 700;
          flex-shrink: 0;
        }

        .user-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .user-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .user-model {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 500;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .model-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--text-muted);
          flex-shrink: 0;
        }

        .model-dot.active {
          background: var(--accent-cyan);
          box-shadow: 0 0 6px var(--accent-cyan);
        }

        .user-card-actions {
          display: flex;
          border-top: 1px solid var(--glass-border);
        }

        .user-action-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 0;
          background: none;
          border: none;
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          text-decoration: none;
          transition: all 0.15s ease;
        }

        .user-action-btn:hover {
          color: var(--text-primary);
          background: var(--glass-reflection);
        }

        .user-action-btn.active {
          color: var(--accent-cyan);
        }

        .user-action-btn.logout:hover {
          color: #f87171;
          background: rgba(239, 68, 68, 0.08);
        }

        .user-action-btn + .user-action-btn {
          border-left: 1px solid var(--glass-border);
        }

        .shell-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          height: 100%;
        }

        @media (max-width: 1024px) {
          .app-sidebar {
            width: 64px;
            padding: 16px 8px;
          }

          .brand-meta,
          .nav-label,
          .model-name {
            display: none;
          }

          .sidebar-header {
            justify-content: center;
            padding: 0;
          }
        }
      `}</style>
      </main>
    </div>
  );
}

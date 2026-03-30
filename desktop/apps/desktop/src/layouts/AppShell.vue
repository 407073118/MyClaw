<template>
  <main v-if="showBootstrapScreen" data-testid="app-bootstrap-splash" class="bootstrap-shell">
    <section class="bootstrap-card">
      <div class="bootstrap-brand">
        <div class="bootstrap-logo">
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
            <path fill="currentColor" d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
          </svg>
        </div>
        <div class="bootstrap-copy">
          <span class="bootstrap-eyebrow">MyClaw Desktop</span>
          <h1>{{ bootstrapTitle }}</h1>
          <p>{{ bootstrapMessage }}</p>
        </div>
      </div>

      <div v-if="showBootstrapError" class="bootstrap-error-block">
        <button
          data-testid="app-bootstrap-retry"
          type="button"
          class="bootstrap-retry-button"
          @click="handleBootstrapRetry"
        >
          Retry startup
        </button>
      </div>
      <div v-else class="bootstrap-progress" aria-hidden="true">
        <span class="bootstrap-progress-bar"></span>
      </div>
    </section>
  </main>

  <main v-else class="shell">
    <aside data-testid="app-sidebar" class="app-sidebar">
      <div class="sidebar-content">
        <header class="sidebar-header">
          <div class="brand">
            <div class="brand-logo">
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path fill="currentColor" d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
              </svg>
            </div>
            <div class="brand-meta">
              <h2>MyClaw</h2>
              <span class="version">v0.1.0</span>
            </div>
          </div>
        </header>

        <nav data-testid="app-nav" class="app-nav">
          <RouterLink
            v-for="item in navItems"
            :key="item.to"
            :data-testid="item.testId"
            :to="item.to"
            :class="['nav-link', { active: isNavItemActive(item.to) }]"
          >
            <div class="nav-icon-box">
              <component :is="item.icon" />
            </div>
            <span class="nav-label">{{ item.label }}</span>
            <div v-if="isNavItemActive(item.to)" class="active-glow"></div>
          </RouterLink>
        </nav>
      </div>

      <footer class="sidebar-footer">
        <div class="system-monitor">
          <div class="status-indicator">
            <span class="pulse-dot" :class="{ active: workspace.ready }"></span>
            <span class="model-name">{{ defaultModelName }}</span>
          </div>
        </div>
        <RouterLink
          data-testid="nav-settings"
          to="/settings"
          class="nav-link settings-link"
          :class="{ active: route.path === '/settings' }"
        >
          <div class="nav-icon-box">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                fill="currentColor"
                d="M12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5zm7-2.12c.06-.44.1-.88.1-1.38s-.04-.94-.1-1.38l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.01 2.19 13.8 2 13.56 2h-3.12c-.24 0-.45.19-.48.43l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.12.22-.07.49.12.64l2.11 1.65c-.06.44-.1.88-.1 1.38s.04.94.1 1.38l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.31.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.43.48.43h3.12c.24 0 .45-.19.48-.43l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.22.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65z"
              />
            </svg>
          </div>
          <span class="nav-label">Settings</span>
        </RouterLink>
      </footer>
    </aside>

    <section class="shell-content">
      <RouterView v-slot="{ Component, route: slotRoute }">
        <KeepAlive>
          <component :is="Component" v-if="slotRoute.name === 'chat'" />
        </KeepAlive>
        <component :is="Component" v-if="slotRoute.name !== 'chat'" />
      </RouterView>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, h, onMounted } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";

import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const showBootstrapSplash = computed(() => workspace.loading || (!workspace.ready && !workspace.error));
const showBootstrapError = computed(() => !workspace.ready && Boolean(workspace.error));
const showBootstrapScreen = computed(() => showBootstrapSplash.value || showBootstrapError.value);
const bootstrapTitle = computed(() => (
  showBootstrapError.value
    ? "Workspace startup failed"
    : "Starting workspace"
));
const bootstrapMessage = computed(() => (
  showBootstrapError.value
    ? workspace.error ?? "Unable to load startup data from the local runtime."
    : "Preparing the local runtime, restoring workspace state, and opening your last session."
));

const IconChat = () =>
  h("svg", { viewBox: "0 0 24 24", width: "20", height: "20" }, [
    h("circle", { cx: "12", cy: "12", r: "10", fill: "none", stroke: "currentColor", "stroke-width": "2" }),
    h("path", { fill: "currentColor", d: "M12 7v5l3 3" })
  ]);

const IconHub = () =>
  h("svg", { viewBox: "0 0 24 24", width: "20", height: "20" }, [
    h("path", { fill: "currentColor", d: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm0 2.3L6 8.4v6.2l6 3.1 6-3.1V8.4l-6-3.1z" })
  ]);

const IconMcp = () =>
  h("svg", { viewBox: "0 0 24 24", width: "20", height: "20" }, [
    h("path", {
      fill: "currentColor",
      d: "M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.09-.36.14-.57.14s-.41-.05-.57-.14l-7.9-4.44c-.31-.17-.53-.5-.53-.88V7.5c0-.38.21-.71.53-.88l7.9-4.44c.16-.09.36-.14.57-.14s.41.05.57.14l7.9 4.44c.31.17.53.5.53.88v9z"
    })
  ]);

const IconSkills = () =>
  h("svg", { viewBox: "0 0 24 24", width: "20", height: "20" }, [
    h("path", {
      fill: "currentColor",
      d: "M13 13h-2v-2h2v2zm0 4h-2v-2h2v2zm0-8h-2V7h2v2zm4 4h-2v-2h2v2zm0 4h-2v-2h2v2zm0-8h-2V7h2v2zM9 13H7v-2h2v2zm0 4H7v-2h2v2zm0-8H7V7h2v2z"
    })
  ]);

const IconEmployees = () =>
  h("svg", { viewBox: "0 0 24 24", width: "20", height: "20" }, [
    h("path", {
      fill: "currentColor",
      d: "M16 11c1.66 0 2.99-1.79 2.99-4S17.66 3 16 3s-3 1.79-3 4 1.34 4 3 4zm-8 0c1.66 0 2.99-1.79 2.99-4S9.66 3 8 3 5 4.79 5 7s1.34 4 3 4zm0 2c-2.33 0-7 1.17-7 3.5V21h14v-4.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.94 1.97 3.45V21h6v-4.5c0-2.33-4.67-3.5-7-3.5z"
    })
  ]);

const IconWorkflows = () =>
  h("svg", { viewBox: "0 0 24 24", width: "20", height: "20" }, [
    h("path", {
      fill: "currentColor",
      d: "M7 3a4 4 0 0 1 3.87 3H20v2h-9.13A4.002 4.002 0 0 1 7 11a4 4 0 1 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 8a4 4 0 0 1 3.87 3H22v2h-1.13A4.002 4.002 0 0 1 17 21a4 4 0 1 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM2 6h2v12H2zm3 11h9v2H5zm5-5h9v2h-9z"
    })
  ]);

const IconPublish = () =>
  h("svg", { viewBox: "0 0 24 24", width: "20", height: "20" }, [
    h("path", {
      fill: "currentColor",
      d: "M5 20h14v-2H5zm7-18l-5.5 5.5 1.41 1.41L11 5.83V16h2V5.83l3.09 3.08 1.41-1.41z"
    })
  ]);

const navItems = [
  { to: "/", label: "Chat", icon: IconChat, testId: "nav-chat" },
  { to: "/hub", label: "Hub", icon: IconHub, testId: "nav-hub" },
  { to: "/tools", label: "Tools", icon: IconSkills, testId: "nav-tools" },
  { to: "/mcp", label: "MCP", icon: IconMcp, testId: "nav-mcp" },
  { to: "/skills", label: "Skills", icon: IconSkills, testId: "nav-skills" },
  { to: "/employees", label: "Employees", icon: IconEmployees, testId: "nav-employees" },
  { to: "/workflows", label: "Workflows", icon: IconWorkflows, testId: "nav-workflows" },
  { to: "/publish-drafts", label: "Publish", icon: IconPublish, testId: "nav-publish-drafts" }
];

const defaultModelName = computed(() => {
  const profileId = workspace.defaultModelProfileId;
  return workspace.models.find((model) => model.id === profileId)?.name ?? "Offline";
});

function isNavItemActive(targetPath: string): boolean {
  if (targetPath === "/") {
    return route.path === targetPath;
  }

  return route.path === targetPath || route.path.startsWith(`${targetPath}/`);
}

/** 加载桌面端启动引导数据，并在首次启动缺少配置时跳转到设置页。 */
async function loadWorkspaceBootstrap() {
  if (workspace.ready) {
    if (workspace.requiresInitialSetup && workspace.isFirstLaunch && route.path !== "/settings") {
      console.info("[app-shell] 使用现有工作区状态命中首次启动条件，跳转设置页");
      await router.push("/settings");
    }
    return;
  }

  if (workspace.loading) {
    return;
  }

  console.info("[app-shell] 开始加载桌面端启动引导数据", {
    routePath: route.fullPath,
  });
  await workspace.loadBootstrap();

  if (workspace.error) {
    console.error("[app-shell] 桌面端启动引导数据加载失败", {
      error: workspace.error,
    });
    return;
  }

  console.info("[app-shell] 桌面端启动引导数据加载完成", {
    requiresInitialSetup: workspace.requiresInitialSetup,
    isFirstLaunch: workspace.isFirstLaunch,
  });
  if (workspace.requiresInitialSetup && workspace.isFirstLaunch && route.path !== "/settings") {
    console.info("[app-shell] 首次启动缺少模型配置，跳转设置页");
    await router.push("/settings");
  }
}

/** 在启动失败后重新触发 bootstrap，避免用户必须重启桌面应用。 */
function handleBootstrapRetry() {
  console.info("[app-shell] 用户请求重新加载桌面端启动引导数据");
  void loadWorkspaceBootstrap();
}

onMounted(() => {
  void loadWorkspaceBootstrap();
});
</script>

<style scoped>
.bootstrap-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
  background:
    radial-gradient(circle at top, rgba(59, 130, 246, 0.22), transparent 42%),
    linear-gradient(160deg, #05070b 0%, #0b0f17 38%, #090909 100%);
}

.bootstrap-card {
  width: min(560px, 100%);
  padding: 32px;
  border-radius: 24px;
  background: rgba(10, 13, 18, 0.88);
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(18px);
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.bootstrap-brand {
  display: flex;
  align-items: flex-start;
  gap: 18px;
}

.bootstrap-logo {
  width: 56px;
  height: 56px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(14, 165, 233, 0.78));
  color: #f8fafc;
  display: grid;
  place-items: center;
  box-shadow: 0 16px 40px rgba(37, 99, 235, 0.35);
  flex-shrink: 0;
}

.bootstrap-copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bootstrap-eyebrow {
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(148, 163, 184, 0.9);
}

.bootstrap-copy h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.05;
  letter-spacing: -0.04em;
  color: #f8fafc;
}

.bootstrap-copy p {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: rgba(226, 232, 240, 0.78);
}

.bootstrap-progress {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(148, 163, 184, 0.14);
}

.bootstrap-progress-bar {
  display: block;
  width: 38%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(56, 189, 248, 0.6), rgba(59, 130, 246, 0.95));
  animation: bootstrap-progress-slide 1.4s ease-in-out infinite;
}

.bootstrap-error-block {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.bootstrap-retry-button {
  min-width: 148px;
  height: 40px;
  border-radius: 999px;
  border: 1px solid rgba(96, 165, 250, 0.42);
  background: rgba(37, 99, 235, 0.14);
  color: #dbeafe;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}

.bootstrap-retry-button:hover {
  transform: translateY(-1px);
  background: rgba(37, 99, 235, 0.22);
  border-color: rgba(96, 165, 250, 0.6);
}

@keyframes bootstrap-progress-slide {
  0% {
    transform: translateX(-120%);
  }

  100% {
    transform: translateX(320%);
  }
}

.shell {
  display: flex;
  height: 100vh;
  padding: 0;
  background: var(--bg-base);
}

.app-sidebar {
  width: 240px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--glass-border);
  display: flex;
  flex-direction: column;
  padding: 32px 16px;
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
  gap: 16px;
}

.system-monitor {
  padding: 12px;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  background: var(--text-muted);
  border-radius: 50%;
}

.pulse-dot.active {
  background: var(--accent-cyan);
}

.model-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  .bootstrap-card {
    padding: 28px 24px;
  }

  .bootstrap-brand {
    flex-direction: column;
  }

  .app-sidebar {
    width: 64px;
    padding: 24px 8px;
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
</style>

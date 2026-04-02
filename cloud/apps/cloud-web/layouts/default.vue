<script setup lang="ts">
const route = useRoute();
const router = useRouter();
const { user, isSessionValid, clearSession } = useCloudSession();

const navigation = [
  { label: "Hub", to: "/hub" },
  { label: "Skills 市场", to: "/skills" },
  { label: "MCP", to: "/mcp" }
];

const isLoginRoute = computed(() => route.path === "/login");
const isNavVisible = computed(() => !isLoginRoute.value && isSessionValid.value);

const colorMode = ref<'dark' | 'light'>('dark');
const isMounted = ref(false);

onMounted(() => {
  isMounted.value = true;
  const savedTheme = localStorage.getItem('cloud_theme') as 'dark' | 'light';
  if (savedTheme) {
    colorMode.value = savedTheme;
  } else if (window.matchMedia('(prefers-color-mode: light)').matches) {
    colorMode.value = 'light';
  }
});

function toggleTheme() {
  colorMode.value = colorMode.value === 'dark' ? 'light' : 'dark';
  localStorage.setItem('cloud_theme', colorMode.value);
}

async function handleLogout() {
  clearSession();
  await router.push({
    path: "/login",
    query: {
      redirect: "/hub"
    }
  });
}

useHead({
  htmlAttrs: {
    class: computed(() => colorMode.value === 'light' ? 'light-mode' : '')
  }
});

const themeClass = computed(() => [
  colorMode.value === 'light' ? 'light-mode' : 'dark-mode',
  { 'auth-layout': isLoginRoute.value }
]);
</script>

<template>
  <div class="nuxt-app" :class="themeClass">
    <div v-show="!isLoginRoute" class="nuxt-bg">
      <div class="nuxt-bg-grid"></div>
      <div class="nuxt-bg-glow glow-1"></div>
      <div class="nuxt-bg-glow glow-2"></div>
    </div>

    <header v-show="!isLoginRoute" class="nuxt-header">
      <div class="header-container">
        <NuxtLink class="brand" to="/hub">
          <div class="brand-logo">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="3 17 9 21 21 13 21 3 15 7 3 15"></polyline>
              <line x1="9" y1="21" x2="9" y2="11"></line>
              <line x1="15" y1="17" x2="15" y2="7"></line>
            </svg>
          </div>
          <span class="brand-name">MyClaw Cloud</span>
        </NuxtLink>

        <nav v-if="isMounted && isNavVisible" class="nav-links">
          <NuxtLink
            v-for="item in navigation"
            :key="item.to"
            :to="item.to"
            class="nav-link"
            :class="{ active: route.path === item.to }"
          >
            {{ item.label }}
          </NuxtLink>
        </nav>

        <div class="header-actions">
          <button v-if="isMounted" class="theme-toggle" @click="toggleTheme" title="切换配色风格">
            <svg v-if="colorMode === 'dark'" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
            <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          </button>

          <template v-if="isMounted && isSessionValid">
            <div class="user-chip-nx">
              <span class="u-name">{{ user?.displayName }}</span>
            </div>
            <button class="logout-btn-nx" @click="handleLogout">退出</button>
          </template>
        </div>
      </div>
    </header>

    <div class="main-content">
      <slot />
    </div>

    <footer v-show="!isLoginRoute" class="nuxt-footer">
      <div class="footer-container">
        <div class="footer-left">
          <p>© 2026 MyClaw Cloud. Enterprise Skill Platform.</p>
        </div>
        <div class="footer-right">
          <span class="status-indicator">
            <span class="dot"></span>
            Cloud Operational
          </span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style>
:root {
  --nuxt-green: #00DC82;
  --nuxt-green-rgb: 0, 220, 130;
  --nuxt-emerald: #10b981;
  --nuxt-emerald-rgb: 16, 185, 129;
  --bg-main: #020420;
  --bg-elevated: rgba(15, 23, 42, 0.7);
  --bg-input: rgba(2, 4, 32, 0.8);
  --text-main: #ffffff;
  --text-muted: #94a3b8;
  --text-dim: #64748b;
  --border-main: rgba(255, 255, 255, 0.08);
  --border-muted: rgba(255, 255, 255, 0.05);
  --grid-color: rgba(var(--nuxt-green-rgb), 0.05);
  --glow-opacity: 0.15;
  --selection-bg: rgba(var(--nuxt-green-rgb), 0.2);
  --btn-text: #020420;
}

.light-mode {
  --nuxt-green: #10b981;
  --nuxt-green-rgb: 16, 185, 129;
  --nuxt-emerald: #059669;
  --nuxt-emerald-rgb: 5, 150, 105;
  --bg-main: #ffffff;
  --bg-elevated: #ffffff;
  --bg-input: #f8fafc;
  --text-main: #0f172a;
  --text-muted: #64748b;
  --text-dim: #94a3b8;
  --border-main: #e2e8f0;
  --border-muted: #f1f5f9;
  --grid-color: rgba(var(--nuxt-green-rgb), 0.04);
  --glow-opacity: 0.08;
  --selection-bg: rgba(var(--nuxt-green-rgb), 0.1);
  --btn-text: #ffffff;
}

body {
  background-color: var(--bg-main);
  transition: background-color 0.3s ease, color 0.3s ease;
  margin: 0;
  color: var(--text-main);
  font-family: 'Inter', -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: var(--bg-main); }
::-webkit-scrollbar-thumb { background: var(--border-main); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

.glass-card-nx {
  background: var(--bg-elevated);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-main);
  border-radius: 16px;
}

.nuxt-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
.nuxt-bg-grid {
  position: absolute; inset: 0; background-image: 
    linear-gradient(to right, var(--grid-color) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-color) 1px, transparent 1px);
  background-size: 80px 80px; mask-image: radial-gradient(circle at center, black 30%, transparent 100%);
}
.nuxt-bg-glow { position: absolute; border-radius: 50%; filter: blur(120px); opacity: var(--glow-opacity); pointer-events: none; }
.glow-1 { top: -10%; left: -10%; width: 50vw; height: 50vw; background: var(--nuxt-green); }
.glow-2 { bottom: -20%; right: -10%; width: 60vw; height: 60vw; background: var(--nuxt-emerald); }
</style>

<style scoped>
.nuxt-app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.nuxt-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg-main);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-main);
}

.header-container {
  max-width: 1440px;
  margin: 0 auto;
  height: 64px;
  padding: 0 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: var(--text-main);
}

.brand-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: rgba(var(--nuxt-green-rgb), 0.1);
  color: var(--nuxt-green);
  border-radius: 8px;
}

.brand-name { font-weight: 800; font-size: 1.125rem; }

.nav-links { display: flex; gap: 32px; }
.nav-link {
  text-decoration: none; color: var(--text-muted); font-weight: 600; font-size: 0.9375rem;
  transition: color 0.2s;
}
.nav-link:hover, .nav-link.active { color: var(--nuxt-green); }

.header-actions { display: flex; align-items: center; gap: 16px; }

.theme-toggle {
  width: 36px; height: 36px; border-radius: 10px;
  background: var(--border-main); border: none; color: var(--text-main);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.theme-toggle:hover { background: rgba(var(--nuxt-green-rgb), 0.1); color: var(--nuxt-green); }

.user-chip-nx {
  display: flex; flex-direction: column; align-items: flex-end;
}
.u-name { font-weight: 700; font-size: 0.875rem; color: var(--text-main); }

.logout-btn-nx {
  background: var(--border-muted); border: 1px solid var(--border-main);
  color: var(--text-muted); padding: 6px 14px; border-radius: 8px;
  cursor: pointer; font-weight: 600; font-size: 0.8125rem;
}
.logout-btn-nx:hover { color: #ef4444; border-color: rgba(239, 68, 68, 0.2); }

.nuxt-footer { border-top: 1px solid var(--border-main); padding: 40px 0; background: var(--bg-main); }
.footer-container {
  max-width: 1440px; margin: 0 auto; padding: 0 40px;
  display: flex; justify-content: space-between; align-items: center;
}
.footer-left p { color: var(--text-dim); font-size: 0.8125rem; margin: 0; }

.status-indicator {
  display: flex; align-items: center; gap: 8px;
  background: rgba(var(--nuxt-green-rgb), 0.05); border: 1px solid rgba(var(--nuxt-green-rgb), 0.1);
  padding: 6px 12px; border-radius: 20px; color: var(--nuxt-green);
  font-size: 0.75rem; font-weight: 700;
}
.dot { width: 6px; height: 6px; background: var(--nuxt-green); border-radius: 50%; box-shadow: 0 0 6px var(--nuxt-green); }

@media (max-width: 768px) {
  .header-container { padding: 0 20px; }
  .nav-links { display: none; }
}
</style>

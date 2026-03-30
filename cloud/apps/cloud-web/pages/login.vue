<script setup lang="ts">
import type { AuthLoginResponse } from "@myclaw-cloud/shared";

const route = useRoute();
const { setSession } = useCloudSession();

definePageMeta({
  layout: false
});

const form = reactive({
  account: "",
  password: ""
});

const pending = ref(false);
const errorMessage = ref("");
const successMessage = ref("");
const showPassword = ref(false);

// Theme Support for Login (standalone layout)
const colorMode = ref<'dark' | 'light'>('dark');
onMounted(() => {
  const savedTheme = localStorage.getItem('cloud_theme') as 'dark' | 'light' || 'dark';
  colorMode.value = savedTheme;
});

function toggleTheme() {
  colorMode.value = colorMode.value === 'dark' ? 'light' : 'dark';
  localStorage.setItem('cloud_theme', colorMode.value);
}

const loginErrorMessageMap: Record<string, string> = {
  account_or_password_required: "请输入账号和密码后再登录。",
  account_or_password_invalid: "账号或密码错误，请重新确认。",
  cloud_api_request_failed: "登录失败，请确认 cloud-api 已启动。"
};

const redirectTarget = computed(() => {
  const target = Array.isArray(route.query.redirect) ? route.query.redirect[0] : route.query.redirect;
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) {
    return "/hub";
  }
  return target;
});

async function handleLogin() {
  pending.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const response = await $fetch<AuthLoginResponse>("/api/auth/login", {
      method: "POST",
      body: form
    });

    setSession(response);
    successMessage.value = `登录成功，正在进入 Hub...`;
    await navigateTo(redirectTarget.value);
  } catch (error: any) {
    const code = error?.data?.message || "";
    errorMessage.value = loginErrorMessageMap[code] || "登录失败，请确认 cloud-api 已启动。";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="nuxt-login" :class="colorMode">
    <!-- Nuxt-style Background -->
    <div class="nuxt-bg">
      <div class="nuxt-bg-grid"></div>
      <div class="nuxt-bg-glow glow-primary"></div>
      <div class="nuxt-bg-glow glow-secondary"></div>
    </div>

    <div class="login-container">
      <div class="login-brand">
        <div class="logo-wrapper">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 17 9 21 21 13 21 3 15 7 3 15"></polyline>
            <line x1="9" y1="21" x2="9" y2="11"></line>
            <line x1="15" y1="17" x2="15" y2="7"></line>
          </svg>
        </div>
        <h1>MyClaw Cloud</h1>
        <p class="subtitle">能力中心统一管理平台</p>
      </div>

      <div class="login-card glass-card-nx">
        <div class="card-head-nx">
          <h2>账号登录</h2>
          <button class="theme-switch-btn" @click="toggleTheme" title="切换配色">
            <svg v-if="colorMode === 'dark'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path></svg>
            <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
          </button>
        </div>

        <form class="login-form-nx" @submit.prevent="handleLogin">
          <div class="form-group-nx">
            <label>企业账号</label>
            <div class="input-nx">
              <svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              <input v-model="form.account" type="text" placeholder="Account" required autocomplete="username" />
            </div>
          </div>

          <div class="form-group-nx">
            <label>登录密码</label>
            <div class="input-nx">
              <svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <input v-model="form.password" :type="showPassword ? 'text' : 'password'" placeholder="Password" required autocomplete="current-password" />
              <button type="button" class="eye" @click="showPassword = !showPassword">
                <svg v-if="showPassword" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
              </button>
            </div>
          </div>

          <button type="submit" class="submit-btn-nx" :disabled="pending">
            {{ pending ? '正在验证...' : '登录 MyClaw Cloud' }}
            <div class="btn-shine"></div>
          </button>

          <transition name="fade">
            <div v-if="errorMessage" class="status-tip-nx error">{{ errorMessage }}</div>
            <div v-else-if="successMessage" class="status-tip-nx success">{{ successMessage }}</div>
          </transition>
        </form>

        <p class="login-legal">仅受授权企业账号访问。未授权访问将被追究责任。</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.nuxt-login {
  --nuxt-green: #00DC82;
  --nuxt-green-rgb: 0, 220, 130;
  --btn-text: #020420;
  --bg-nx: #020420;
  --text-nx: #ffffff;
  --text-sc-nx: #94a3b8;
  --card-nx: rgba(15, 23, 42, 0.6);
  --input-nx: rgba(2, 4, 32, 0.6);
  --border-nx: rgba(255, 255, 255, 0.1);
  --grid-nx: rgba(var(--nuxt-green-rgb), 0.05);

  position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden;
  background-color: var(--bg-nx); color: var(--text-nx); font-family: 'Inter', sans-serif; transition: background-color 0.3s, color 0.3s;
}

.nuxt-login.light {
  --nuxt-green: #10b981;
  --nuxt-green-rgb: 16, 185, 129;
  --btn-text: #ffffff;
  --bg-nx: #ffffff;
  --text-nx: #0f172a;
  --text-sc-nx: #64748b;
  --card-nx: #ffffff;
  --input-nx: #f1f5f9;
  --border-nx: rgba(15, 23, 42, 0.08);
  --grid-nx: rgba(var(--nuxt-green-rgb), 0.03);
}

.nuxt-bg { position: absolute; inset: 0; z-index: 0; }
.nuxt-bg-grid {
  position: absolute; inset: 0; background-image: 
    linear-gradient(to right, var(--grid-nx) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-nx) 1px, transparent 1px);
  background-size: 80px 80px; mask-image: radial-gradient(circle at center, black 30%, transparent 100%);
}
.nuxt-bg-glow { position: absolute; width: 600px; height: 600px; border-radius: 50%; filter: blur(120px); opacity: 0.1; }
.glow-primary { top: -100px; right: -100px; background: var(--nuxt-green); }
.glow-secondary { bottom: -150px; left: -150px; background: #10b981; }

.login-container { position: relative; z-index: 10; width: 100%; max-width: 440px; padding: 20px; }
.login-brand { text-align: center; margin-bottom: 48px; }
.logo-wrapper { margin-bottom: 24px; display: inline-block; padding: 16px; background: rgba(var(--nuxt-green-rgb), 0.05); border-radius: 20px; border: 1px solid rgba(var(--nuxt-green-rgb), 0.1); color: var(--nuxt-green); }
.login-brand h1 { font-size: 2.25rem; font-weight: 900; margin: 0 0 8px; color: var(--text-nx); letter-spacing: -0.05em; }
.subtitle { color: var(--text-sc-nx); font-size: 1.1rem; }

.glass-card-nx { background: var(--card-nx); backdrop-filter: blur(20px); border: 1px solid var(--border-nx); border-radius: 24px; padding: 48px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.2); }
.card-head-nx { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
.card-head-nx h2 { font-size: 1.5rem; font-weight: 800; margin: 0; }

.theme-switch-btn { width: 32px; height: 32px; border-radius: 8px; background: var(--input-nx); border: 1px solid var(--border-nx); color: var(--text-dim); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
.theme-switch-btn:hover { color: var(--nuxt-green); border-color: var(--nuxt-green); }

.login-form-nx { display: flex; flex-direction: column; gap: 24px; }
.form-group-nx label { display: block; font-size: 0.875rem; font-weight: 800; color: var(--text-sc-nx); margin-bottom: 12px; }
.input-nx { position: relative; display: flex; align-items: center; }
.input-nx .ico { position: absolute; left: 16px; color: var(--text-sc-nx); transition: color 0.3s; }
.input-nx input { width: 100%; height: 52px; padding: 0 48px; background: var(--input-nx); border: 1px solid var(--border-nx); border-radius: 12px; color: var(--text-nx); font-size: 1rem; transition: all 0.3s; }
.input-nx input:focus { outline: none; border-color: var(--nuxt-green); background: var(--card-nx); }
.input-nx input:focus + .ico { color: var(--nuxt-green); }
.eye { position: absolute; right: 16px; background: none; border: none; color: var(--text-sc-nx); cursor: pointer; padding: 4px; display: flex; align-items: center; }
.eye:hover { color: var(--text-nx); }

.submit-btn-nx { position: relative; height: 54px; background: var(--nuxt-green); color: var(--btn-text); border: none; border-radius: 12px; font-size: 1rem; font-weight: 800; cursor: pointer; overflow: hidden; transition: all 0.3s; margin-top: 12px; }
.submit-btn-nx:hover { transform: translateY(-2px); box-shadow: 0 10px 20px -5px rgba(var(--nuxt-green-rgb), 0.4); }
.btn-shine { position: absolute; top: 0; left: -100%; width: 100%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent); animation: shine 4s infinite; }
@keyframes shine { 0% { left: -100%; } 20% { left: 100%; } 100% { left: 100%; } }

.status-tip-nx { padding: 12px 16px; border-radius: 12px; font-size: 0.875rem; font-weight: 700; display: flex; align-items: center; gap: 10px; margin-top: 16px; }
.status-tip-nx.error { background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); }
.status-tip-nx.success { background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2); }

.login-legal { margin-top: 32px; color: var(--text-sc-nx); font-size: 0.8125rem; text-align: center; line-height: 1.6; }
.fade-enter-active, .fade-leave-active { transition: all 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-10px); }
</style>

<template>
  <main data-testid="desktop-login-view" class="login-page">
    <section class="login-panel">
      <div class="login-copy">
        <span class="eyebrow">MyClaw Desktop</span>
        <h1>登录后才能使用桌面端</h1>
        <p>
          使用和 Cloud 一致的企业账号密码登录。桌面端会在本地安全保存登录态，并在 access token 过期后自动尝试续期。
        </p>
      </div>

      <form class="login-form" @submit.prevent="handleLogin">
        <label class="field">
          <span>企业账号</span>
          <input
            v-model.trim="form.account"
            data-testid="desktop-login-account"
            type="text"
            autocomplete="username"
            placeholder="请输入企业账号"
            required
          />
        </label>

        <label class="field">
          <span>登录密码</span>
          <input
            v-model="form.password"
            data-testid="desktop-login-password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            placeholder="请输入登录密码"
            required
          />
        </label>

        <label class="toggle-line">
          <input v-model="showPassword" type="checkbox" />
          <span>显示密码</span>
        </label>

        <button data-testid="desktop-login-submit" type="submit" class="submit-button" :disabled="pending">
          {{ pending ? "正在登录..." : "登录 Desktop" }}
        </button>

        <p v-if="errorMessage" data-testid="desktop-login-error" class="status error">{{ errorMessage }}</p>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useShellStore } from "@/stores/shell";
import { useDesktopAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const shell = useShellStore();
const auth = useDesktopAuthStore();

const form = reactive({
  account: "",
  password: "",
});
const pending = ref(false);
const showPassword = ref(false);
const errorMessage = ref("");

const loginErrorMessageMap: Record<string, string> = {
  account_or_password_required: "请输入账号和密码后再登录。",
  account_or_password_invalid: "账号或密码错误，请重新确认。",
  cloud_api_request_failed: "登录失败，请确认 cloud-api 已启动。",
  internal_auth_provider_failed: "登录服务暂时不可用，请稍后重试。",
};

/** 归一化登录完成后的跳转地址，避免把非法外链透传给桌面路由。 */
const redirectTarget = computed(() => {
  const target = Array.isArray(route.query.redirect) ? route.query.redirect[0] : route.query.redirect;
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) {
    return "/";
  }

  return target;
});

/** 处理桌面端登录提交，成功后回到用户原本要访问的页面。 */
async function handleLogin() {
  pending.value = true;
  errorMessage.value = "";
  console.info("[desktop-login] 开始提交桌面端登录表单", {
    account: form.account,
    redirect: redirectTarget.value,
  });

  try {
    await auth.login(shell.runtimeBaseUrl, {
      account: form.account,
      password: form.password,
    });
    console.info("[desktop-login] 桌面端登录成功，准备跳转", {
      account: form.account,
      redirect: redirectTarget.value,
    });
    await router.replace(redirectTarget.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败，请确认 cloud-api 已启动。";
    const code = message.split(":").at(-1)?.trim() ?? "";
    errorMessage.value = loginErrorMessageMap[code] || "登录失败，请确认 cloud-api 已启动。";
    console.warn("[desktop-login] 桌面端登录失败", {
      account: form.account,
      error: message,
    });
  } finally {
    pending.value = false;
  }
}
</script>

<style scoped>
.login-page {
  height: 100vh;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(14, 165, 233, 0.18), transparent 34%),
    radial-gradient(circle at bottom right, rgba(34, 197, 94, 0.16), transparent 28%),
    linear-gradient(160deg, #071018 0%, #0d1724 42%, #0b1016 100%);
}

.login-panel {
  width: min(480px, 100%);
  padding: 32px;
  border-radius: 28px;
  background: rgba(10, 15, 25, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
  display: grid;
  gap: 28px;
}

.login-copy {
  display: grid;
  gap: 10px;
}

.eyebrow {
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(148, 163, 184, 0.9);
}

.login-copy h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.08;
  color: #f8fafc;
}

.login-copy p {
  margin: 0;
  color: rgba(226, 232, 240, 0.78);
  line-height: 1.7;
}

.login-form {
  display: grid;
  gap: 18px;
}

.field {
  display: grid;
  gap: 8px;
}

.field span {
  font-size: 13px;
  color: #cbd5e1;
}

.field input {
  height: 48px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.8);
  color: #f8fafc;
  padding: 0 14px;
  font-size: 14px;
}

.field input:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.8);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14);
}

.toggle-line {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: rgba(226, 232, 240, 0.82);
  font-size: 13px;
}

.submit-button {
  height: 48px;
  border: none;
  border-radius: 14px;
  background: linear-gradient(135deg, #38bdf8, #22c55e);
  color: #04111b;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.submit-button:disabled {
  cursor: wait;
  opacity: 0.72;
}

.status {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  font-size: 13px;
}

.status.error {
  color: #fecaca;
  background: rgba(127, 29, 29, 0.4);
  border: 1px solid rgba(248, 113, 113, 0.24);
}
</style>

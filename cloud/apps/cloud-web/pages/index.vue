<script setup lang="ts">
await navigateTo("/login", {
  replace: true
});
</script>

<template>
  <div class="auth-redirect-fallback">
    正在跳转到登录页...
  </div>
</template>

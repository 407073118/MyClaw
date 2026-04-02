<script setup lang="ts">
await navigateTo("/hub", {
  replace: true
});
</script>

<template>
  <main class="page-stack">
    <section class="panel panel--light">
      <header class="section-heading">
        <div>
          <p class="eyebrow">控制台已合并</p>
          <h1>后台操作已迁移到 Hub</h1>
          <p class="section-copy">Skills 发布、版本管理和下载已迁移到 Skills 市场和 Hub，这里会自动跳转。</p>
        </div>
      </header>
      <NuxtLink class="button button--primary" to="/hub">进入 Hub</NuxtLink>
    </section>
  </main>
</template>

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
          <p class="section-copy">新技能上传、已有技能发版和版本下载都已收口到 Hub，这里会自动跳转。</p>
        </div>
      </header>
      <NuxtLink class="button button--primary" to="/hub">进入 Hub</NuxtLink>
    </section>
  </main>
</template>

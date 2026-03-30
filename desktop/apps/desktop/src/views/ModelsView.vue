<template>
  <main class="page-container">
    <header class="page-header">
      <div class="header-text">
        <span class="eyebrow">Model Profiles</span>
        <h2 class="page-title">Provider configuration</h2>
        <p class="page-subtitle">Store model name, URL, and token settings separately from chat and runtime modules.</p>
      </div>
    </header>

    <div class="models-content">
      <section class="card">
        <p>This is where you manage your model connections.</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.models-content {
  width: 100%;
}

.card {
  padding: 32px;
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  max-width: 860px;
}

.card p {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
  margin: 0;
}
</style>


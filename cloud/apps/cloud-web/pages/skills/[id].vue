<script setup lang="ts">
import type { SkillDetail } from "~/types/skills";

const route = useRoute();

const skillId = computed(() => String(route.params.id ?? ""));
const { data: selectedSkill, pending } = await useAsyncData<SkillDetail | null>(
  () => `skill:${skillId.value}`,
  () => (skillId.value ? $fetch<SkillDetail>(`/api/skills/${skillId.value}`) : Promise.resolve(null)),
  {
    default: () => null,
    watch: [skillId]
  }
);

useHead(() => ({
  title: selectedSkill.value ? `${selectedSkill.value.name} | Skills` : "Skill Detail"
}));
</script>

<template>
  <main class="nuxt-skill-page">
    <div class="content-container">
      <div class="skill-header-nx">
        <NuxtLink class="back-link-nx" to="/skills">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back to Skills
        </NuxtLink>
      </div>

      <div v-if="pending" class="state-container">
        <div class="pulse-loader-nx"></div>
        <p>Loading skill...</p>
      </div>

      <template v-else-if="selectedSkill">
        <header class="skill-hero-nx glass-card-nx">
          <div class="hero-left">
            <span class="skill-owner-nx">myclaw / {{ selectedSkill.id }}</span>
            <h1>{{ selectedSkill.name }}</h1>
            <p class="skill-description-nx">{{ selectedSkill.description }}</p>
            <div class="hero-actions">
               <button class="action-btn-primary">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
                 Run with Claw
               </button>
               <NuxtLink :to="`/skills/publish?id=${selectedSkill.id}`" class="action-btn-secondary">Publish Release</NuxtLink>
            </div>
          </div>
          <div class="skill-meta-nx">
            <div class="meta-box-nx">
              <span class="l">Latest Version</span>
              <span class="v nx-green">{{ selectedSkill.latestVersion ? `v${selectedSkill.latestVersion}` : "Draft" }}</span>
            </div>
            <div class="meta-box-nx">
              <span class="l">Skill ID</span>
              <span class="v">{{ selectedSkill.id }}</span>
            </div>
            <div class="meta-box-nx">
              <span class="l">Releases</span>
              <span class="v">{{ selectedSkill.releases.length }}</span>
            </div>
          </div>
        </header>

        <section class="content-grid-nx">
          <div class="overview-panel-nx glass-card-nx">
            <div class="panel-head-nx">
              <h2>Overview</h2>
            </div>
            <p class="summary-text-nx">{{ selectedSkill.summary }}</p>
            
            <div class="code-viewport-nx">
              <div class="code-header-nx">
                <span class="fn">usage</span>
              </div>
              <pre><code>claw run {{ selectedSkill.id }} --prompt "Hello World"</code></pre>
            </div>
          </div>

          <div class="release-section-nx glass-card-nx">
            <div class="panel-head-nx">
              <h2>Releases <span class="badge">{{ selectedSkill.releases.length }}</span></h2>
            </div>

            <div v-if="selectedSkill.releases.length" class="release-list-nx">
              <article v-for="release in selectedSkill.releases" :key="release.id" class="release-card-nx">
                <div class="rel-info">
                  <span class="v-badge">v{{ release.version }}</span>
                  <p>{{ release.releaseNotes }}</p>
                </div>
                <div class="rel-meta">
                  <span>{{ new Date(release.createdAt).toLocaleString() }}</span>
                </div>
              </article>
            </div>
            <div v-else class="viewport-empty-nx">
              <p>This skill has no published releases yet.</p>
            </div>
          </div>
        </section>
      </template>
      <div v-else class="viewport-empty-nx glass-card-nx">
        <p>The requested skill was not found.</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.nuxt-skill-page { position: relative; min-height: calc(100vh - 64px); background: var(--bg-main); width: 100%; }
.content-container { position: relative; z-index: 10; max-width: 1200px; margin: 0 auto; padding: 40px; }

.skill-header-nx { margin-bottom: 24px; }
.back-link-nx { display: inline-flex; align-items: center; gap: 8px; color: var(--text-dim); text-decoration: none; font-weight: 800; font-size: 0.85rem; transition: 0.2s; padding: 6px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; width: max-content; }
.back-link-nx:hover { color: var(--text-main); background: rgba(255,255,255,0.08); }
.back-link-nx svg { width: 16px; height: 16px; }

.skill-hero-nx { padding: 48px; border-radius: 24px; background: var(--bg-main); border: 1px solid var(--border-muted); display: grid; grid-template-columns: 1.5fr 1fr; gap: 48px; margin-bottom: 32px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
@media (max-width: 960px) { .skill-hero-nx { grid-template-columns: 1fr; gap: 32px; padding: 32px; } }

.hero-left { display: flex; flex-direction: column; gap: 16px; justify-content: center; }
.skill-owner-nx { font-family: 'Fira Code', monospace; font-size: 0.8rem; color: var(--nuxt-green); letter-spacing: 0.05em; text-transform: uppercase; }
.hero-left h1 { margin: 0; font-size: 2.5rem; font-weight: 900; color: var(--text-main); letter-spacing: -0.02em; line-height: 1.1; }
.skill-description-nx { margin: 0; font-size: 1.1rem; color: var(--text-muted); line-height: 1.6; }

.hero-actions { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
.action-btn-primary { height: 44px; display: inline-flex; align-items: center; gap: 8px; background: var(--nuxt-green); color: var(--btn-text); border: none; border-radius: 12px; padding: 0 24px; font-weight: 900; font-size: 0.95rem; cursor: pointer; transition: 0.2s; text-decoration: none; }
.action-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(var(--nuxt-green-rgb), 0.3); }
.action-btn-primary svg { width: 18px; height: 18px; }
.action-btn-secondary { height: 44px; display: inline-flex; align-items: center; gap: 8px; background: var(--bg-input); color: var(--text-main); border: 1px solid var(--border-main); border-radius: 12px; padding: 0 24px; font-weight: 800; font-size: 0.95rem; cursor: pointer; transition: 0.2s; text-decoration: none; }
.action-btn-secondary:hover { border-color: var(--text-dim); background: rgba(255,255,255,0.05); }

.skill-meta-nx { display: grid; gap: 16px; align-content: center; }
.meta-box-nx { padding: 20px 24px; background: var(--bg-input); border: 1px solid var(--border-main); border-radius: 16px; display: flex; flex-direction: column; gap: 8px; transition: 0.2s; }
.meta-box-nx:hover { border-color: var(--border-muted); }
.meta-box-nx .l { font-size: 0.75rem; font-weight: 900; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
.meta-box-nx .v { font-size: 1.25rem; font-weight: 900; color: var(--text-main); font-family: 'Fira Code', monospace; }
.nx-green { color: var(--nuxt-green) !important; }

.content-grid-nx { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 960px) { .content-grid-nx { grid-template-columns: 1fr; } }

.overview-panel-nx, .release-section-nx { padding: 32px; border-radius: 20px; background: var(--bg-main); border: 1px solid var(--border-muted); display: flex; flex-direction: column; gap: 24px; }
.panel-head-nx h2 { margin: 0; font-size: 1.25rem; font-weight: 900; color: var(--text-main); display: flex; align-items: center; gap: 12px; }
.panel-head-nx .badge { background: rgba(var(--nuxt-green-rgb), 0.1); color: var(--nuxt-green); padding: 2px 8px; border-radius: 10px; font-size: 0.85rem; }
.summary-text-nx { margin: 0; color: var(--text-muted); line-height: 1.6; font-size: 1rem; }

.code-viewport-nx { background: rgba(0,0,0,0.2); border: 1px solid var(--border-main); border-radius: 12px; overflow: hidden; }
.code-header-nx { padding: 8px 16px; background: rgba(255,255,255,0.02); border-bottom: 1px solid var(--border-main); }
.code-header-nx .fn { font-size: 0.75rem; font-weight: 850; color: var(--text-dim); }
pre { margin: 0; padding: 20px; overflow-x: auto; }
code { color: var(--text-main); font-family: 'Fira Code', monospace; line-height: 1.6; font-size: 0.9rem; }

.release-list-nx { display: flex; flex-direction: column; gap: 16px; }
.release-card-nx { padding: 20px; background: var(--bg-input); border: 1px solid var(--border-main); border-radius: 16px; display: flex; flex-direction: column; gap: 12px; transition: 0.2s; }
.release-card-nx:hover { border-color: rgba(var(--nuxt-green-rgb), 0.3); background: rgba(var(--nuxt-green-rgb), 0.02); }
.rel-info { display: flex; flex-direction: column; gap: 6px; }
.v-badge { align-self: flex-start; background: var(--nuxt-green); color: var(--btn-text); padding: 4px 10px; border-radius: 6px; font-weight: 900; font-size: 0.8rem; letter-spacing: 0.02em; }
.rel-info p { margin: 0; color: var(--text-main); font-size: 0.95rem; line-height: 1.5; font-weight: 500; }
.rel-meta { border-top: 1px dashed var(--border-main); padding-top: 12px; font-size: 0.75rem; font-weight: 800; color: var(--text-dim); }

.state-container { padding: 120px 0; display: flex; flex-direction: column; align-items: center; gap: 24px; color: var(--text-dim); }
.pulse-loader-nx { width: 44px; height: 44px; border: 4px solid var(--border-muted); border-top-color: var(--nuxt-green); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.viewport-empty-nx { padding: 40px; text-align: center; color: var(--text-dim); font-size: 1rem; border: 1px dashed var(--border-muted); border-radius: 16px; margin-top: auto; }
</style>

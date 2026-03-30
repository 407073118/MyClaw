<script setup lang="ts">
import type { SkillSummary } from "~/types/skills";

const { data, pending } = await useFetch<{ skills: SkillSummary[] }>("/api/skills", {
  default: () => ({ skills: [] })
});

const viewMode = ref<"grid" | "list">("grid");
const keyword = ref("");

const filteredSkills = computed(() => {
  const list = data.value.skills;
  if (!keyword.value.trim()) return list;
  const value = keyword.value.toLowerCase();
  return list.filter(
    (skill) =>
      skill.name.toLowerCase().includes(value) ||
      skill.id.toLowerCase().includes(value) ||
      skill.summary.toLowerCase().includes(value)
  );
});

useHead({
  title: "Skills 管理 | MyClaw Cloud"
});
</script>

<template>
  <main class="nuxt-skills-page">
    <div class="content-container">
      <section class="compact-header-nx">
        <div class="header-main">
          <h2>云端 <span class="dim">Skills</span></h2>
        </div>
        <div class="header-right">
          <div class="search-bar-nx">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
            <input v-model="keyword" type="text" placeholder="搜索云端 Skills..." />
          </div>
          <div class="view-toggle-nx">
            <button :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'">网格</button>
            <button :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'">列表</button>
          </div>
          <NuxtLink class="action-btn-primary" to="/skills/publish">发布 Skill</NuxtLink>
        </div>
      </section>

      <div class="stats-row-nx">
        <span class="status-nx">{{ filteredSkills.length }} 个有效 Skills</span>
      </div>

      <div v-if="pending" class="state-container">
        <div class="pulse-loader-nx"></div>
        <p>正在加载 Skills 列表...</p>
      </div>

      <div v-else-if="viewMode === 'grid'" class="skills-grid-nx">
        <NuxtLink
          v-for="skill in filteredSkills"
          :key="skill.id"
          :to="`/skills/${skill.id}`"
          class="skill-card-nx glass-card-nx"
        >
          <div class="skill-card-head-nx">
            <span class="type-nx">SKILL</span>
            <span class="v-nx">{{ skill.latestVersion ? `v${skill.latestVersion}` : "草稿" }}</span>
          </div>
          <div class="skill-card-body-nx">
            <h4>{{ skill.name }}</h4>
            <span class="id-tag-nx">@myclaw/{{ skill.id }}</span>
            <p class="text-truncate-multi">{{ skill.summary || skill.description || "暂无说明。" }}</p>
          </div>
          <div class="skill-card-foot-nx">
            <span>{{ new Date(skill.updatedAt).toLocaleDateString() }}</span>
          </div>
        </NuxtLink>
      </div>

      <div v-else class="skills-list-nx glass-card-nx">
        <NuxtLink
          v-for="skill in filteredSkills"
          :key="skill.id"
          :to="`/skills/${skill.id}`"
          class="list-row-nx"
        >
          <div class="list-left-nx">
            <div class="list-title-nx">
              <span class="type-nx">SKILL</span>
              <h4>{{ skill.name }}</h4>
            </div>
            <span class="list-id-nx">@myclaw/{{ skill.id }}</span>
          </div>
          <div class="list-right-nx">
            <span class="v-nx">{{ skill.latestVersion ? `v${skill.latestVersion}` : "草稿" }}</span>
            <span class="date-nx">{{ new Date(skill.updatedAt).toLocaleDateString() }}</span>
          </div>
        </NuxtLink>
      </div>

      <div v-if="!pending && !filteredSkills.length" class="viewport-empty-nx glass-card-nx">
        <p>没有找到匹配的 Skills。</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.nuxt-skills-page { position: relative; min-height: calc(100vh - 64px); background: var(--bg-main); width: 100%; }
.content-container { position: relative; z-index: 10; max-width: 1440px; margin: 0 auto; padding: 40px; }
.compact-header-nx { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; gap: 24px; flex-wrap: wrap; }
.header-main h2 { font-size: 1.75rem; font-weight: 900; color: var(--text-main); letter-spacing: -0.01em; margin: 0; }
.header-main h2 .dim { color: var(--text-dim); }
.header-right { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.search-bar-nx { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: 14px; width: 16px; height: 16px; color: var(--text-dim); }
.search-bar-nx input { width: 280px; height: 40px; padding: 0 16px 0 40px; background: var(--bg-input); border: 1px solid var(--border-main); border-radius: 10px; color: var(--text-main); font-family: inherit; font-size: 0.875rem; transition: 0.2s; }
.search-bar-nx input:focus { outline: none; border-color: var(--nuxt-green); background: rgba(var(--nuxt-green-rgb), 0.02); }
.view-toggle-nx { display: flex; background: var(--bg-input); border: 1px solid var(--border-main); border-radius: 10px; overflow: hidden; height: 40px; }
.view-toggle-nx button { padding: 0 16px; background: transparent; border: none; color: var(--text-dim); font-size: 0.8rem; font-weight: 800; cursor: pointer; transition: 0.2s; }
.view-toggle-nx button.active { background: rgba(var(--nuxt-green-rgb), 0.1); color: var(--nuxt-green); }
.action-btn-primary { height: 40px; background: var(--nuxt-green); color: var(--btn-text); border: none; border-radius: 10px; padding: 0 20px; font-weight: 850; font-size: 0.875rem; display: flex; align-items: center; justify-content: center; text-decoration: none; transition: 0.2s; }
.action-btn-primary:hover { transform: translateY(-1px); filter: brightness(1.1); box-shadow: 0 4px 12px rgba(var(--nuxt-green-rgb), 0.2); }
.stats-row-nx { display: flex; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 1px solid var(--border-muted); }
.status-nx { color: var(--nuxt-green); font-size: 0.8rem; font-weight: 850; text-transform: uppercase; letter-spacing: 0.05em; }

.skills-grid-nx { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; }
.skill-card-nx { text-decoration: none; padding: 24px; border-radius: 16px; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; gap: 16px; background: var(--bg-main); border: 1px solid var(--border-muted); position: relative; overflow: hidden; }
.skill-card-nx::before { content: ""; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(var(--nuxt-green-rgb), 0.1) 0%, transparent 100%); opacity: 0; transition: 0.3s; }
.skill-card-nx:hover { transform: translateY(-4px); border-color: rgba(var(--nuxt-green-rgb), 0.4); box-shadow: 0 12px 30px rgba(0,0,0,0.2); }
.skill-card-nx:hover::before { opacity: 1; }
.skill-card-head-nx { display: flex; justify-content: space-between; align-items: center; position: relative; z-index: 2; }
.type-nx { font-size: 0.65rem; font-weight: 900; background: var(--nuxt-green); color: var(--btn-text); padding: 4px 8px; border-radius: 4px; letter-spacing: 0.05em; }
.v-nx { font-size: 0.75rem; font-weight: 800; color: var(--text-dim); background: var(--bg-input); padding: 4px 8px; border-radius: 6px; }
.skill-card-body-nx { flex: 1; display: flex; flex-direction: column; gap: 8px; position: relative; z-index: 2; }
.skill-card-body-nx h4 { margin: 0; font-size: 1.25rem; font-weight: 900; color: var(--text-main); letter-spacing: -0.01em; }
.id-tag-nx { font-family: 'Fira Code', monospace; font-size: 0.75rem; color: var(--nuxt-green); opacity: 0.8; }
.text-truncate-multi { margin: 0; font-size: 0.875rem; color: var(--text-muted); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.skill-card-foot-nx { display: flex; justify-content: space-between; border-top: 1px solid var(--border-muted); padding-top: 16px; margin-top: 8px; font-size: 0.75rem; font-weight: 800; color: var(--text-dim); position: relative; z-index: 2; }

.skills-list-nx { display: flex; flex-direction: column; gap: 0; border: 1px solid var(--border-muted); border-radius: 16px; overflow: hidden; }
.list-row-nx { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; text-decoration: none; border-bottom: 1px solid var(--border-muted); transition: 0.2s; background: var(--bg-main); }
.list-row-nx:last-child { border-bottom: none; }
.list-row-nx:hover { background: rgba(var(--nuxt-green-rgb), 0.03); padding-left: 32px; }
.list-left-nx { display: flex; flex-direction: column; gap: 6px; }
.list-title-nx { display: flex; align-items: center; gap: 12px; }
.list-title-nx h4 { margin: 0; font-size: 1.1rem; font-weight: 900; color: var(--text-main); }
.list-id-nx { font-family: 'Fira Code', monospace; font-size: 0.75rem; color: var(--text-muted); }
.list-right-nx { display: flex; align-items: center; gap: 24px; text-align: right; }
.date-nx { font-size: 0.8rem; font-weight: 800; color: var(--text-dim); min-width: 80px; }

.state-container { padding: 80px 0; display: flex; flex-direction: column; align-items: center; gap: 24px; color: var(--text-dim); }
.pulse-loader-nx { width: 44px; height: 44px; border: 4px solid var(--border-muted); border-top-color: var(--nuxt-green); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.viewport-empty-nx { padding: 60px; text-align: center; color: var(--text-dim); font-size: 1rem; border: 1px dashed var(--border-muted); border-radius: 16px; }

@media (max-width: 768px) {
  .compact-header-nx { flex-direction: column; align-items: flex-start; gap: 16px; }
  .header-right { width: 100%; justify-content: space-between; }
  .search-bar-nx input { width: 100%; }
}
</style>

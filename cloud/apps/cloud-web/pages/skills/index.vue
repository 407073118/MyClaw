<script setup lang="ts">
import type { SkillSummary, SkillCategory, SkillListQuery } from "@myclaw-cloud/shared";

const SKILL_CATEGORIES: { value: SkillCategory; label: string }[] = [
  { value: "ai-assistant", label: "AI 助手" },
  { value: "data-analysis", label: "数据分析" },
  { value: "dev-tools", label: "开发工具" },
  { value: "writing", label: "文档写作" },
  { value: "productivity", label: "效率工具" },
  { value: "design", label: "设计创意" },
  { value: "education", label: "教育学习" },
  { value: "other", label: "其他" },
];

const keyword = ref("");
const selectedCategory = ref<SkillCategory | "">("");
const selectedTag = ref("");
const sortBy = ref<"latest" | "downloads" | "name">("latest");
const viewMode = ref<"grid" | "list">("grid");

const queryParams = computed(() => ({
  ...(selectedCategory.value ? { category: selectedCategory.value } : {}),
  ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
  ...(sortBy.value !== "latest" ? { sort: sortBy.value } : {}),
  ...(selectedTag.value ? { tag: selectedTag.value } : {}),
}));

const { data, pending } = useLazyFetch<{ skills: SkillSummary[] }>("/api/skills", {
  query: queryParams,
  default: () => ({ skills: [] }),
  watch: [queryParams]
});

const skills = computed(() => data.value.skills);

const allTags = computed(() => {
  const tagSet = new Set<string>();
  for (const skill of skills.value) {
    if (skill.tags) {
      for (const tag of skill.tags) {
        tagSet.add(tag);
      }
    }
  }
  return Array.from(tagSet).sort();
});

const sortOptions = [
  { value: "latest", label: "最新更新" },
  { value: "downloads", label: "最多下载" },
  { value: "name", label: "名称排序" }
] as const;

function selectCategory(cat: SkillCategory | "") {
  selectedCategory.value = cat;
  selectedTag.value = "";
}

function toggleTag(tag: string) {
  selectedTag.value = selectedTag.value === tag ? "" : tag;
}

function formatDownloads(count: number): string {
  if (count >= 10000) return (count / 10000).toFixed(1) + "w";
  if (count >= 1000) return (count / 1000).toFixed(1) + "k";
  return String(count);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function getCategoryLabel(cat: SkillCategory): string {
  const found = SKILL_CATEGORIES.find((c) => c.value === cat);
  return found ? found.label : cat;
}

function getAvatarColor(name: string): string {
  const colors = [
    "#10b981", "#3b82f6", "#8b5cf6", "#f59e0b",
    "#ef4444", "#ec4899", "#06b6d4", "#84cc16"
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

useHead({
  title: "Skills 市场 | MyClaw Cloud"
});
</script>

<template>
  <main class="nuxt-skills-page">
    <div class="content-container">
      <!-- Header -->
      <section class="page-header">
        <div class="header-main">
          <h2>Skills <span class="dim">市场</span></h2>
          <p class="header-desc">发现、安装和分享强大的 MyClaw Skills</p>
        </div>
        <NuxtLink class="action-btn-primary" to="/skills/publish">发布 Skill</NuxtLink>
      </section>

      <!-- Category tabs -->
      <div class="category-tabs">
        <button
          :class="['tab-item', { active: selectedCategory === '' }]"
          @click="selectCategory('')"
        >
          全部
        </button>
        <button
          v-for="cat in SKILL_CATEGORIES"
          :key="cat.value"
          :class="['tab-item', { active: selectedCategory === cat.value }]"
          @click="selectCategory(cat.value)"
        >
          {{ cat.label }}
        </button>
      </div>

      <!-- Toolbar: search + sort + view toggle -->
      <div class="toolbar">
        <div class="search-bar-nx">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input v-model="keyword" type="text" placeholder="搜索 Skills..." />
        </div>
        <div class="toolbar-right">
          <select v-model="sortBy" class="sort-select">
            <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <div class="view-toggle-nx">
            <button :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'" title="网格视图">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
            <button :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'" title="列表视图">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Tag cloud -->
      <div v-if="allTags.length" class="tag-cloud">
        <button
          v-for="tag in allTags"
          :key="tag"
          :class="['tag-chip', { active: selectedTag === tag }]"
          @click="toggleTag(tag)"
        >
          #{{ tag }}
        </button>
      </div>

      <!-- Stats row -->
      <div class="stats-row-nx">
        <span class="status-nx">{{ skills.length }} 个 Skills</span>
        <span v-if="selectedCategory || selectedTag || keyword" class="filter-hint">
          (已筛选)
        </span>
      </div>

      <!-- Loading -->
      <div v-if="pending" class="state-container">
        <div class="pulse-loader-nx"></div>
        <p>正在加载 Skills 列表...</p>
      </div>

      <!-- Grid view -->
      <div v-else-if="viewMode === 'grid'" class="skills-grid-nx">
        <NuxtLink
          v-for="skill in skills"
          :key="skill.id"
          :to="`/skills/${skill.id}`"
          class="skill-card-nx"
        >
          <div class="card-top">
            <div class="skill-avatar" :style="{ background: getAvatarColor(skill.name) }">
              <span>{{ skill.name.charAt(0).toUpperCase() }}</span>
            </div>
            <div class="card-title-block">
              <h4>{{ skill.name }}</h4>
              <span class="author-nx">{{ skill.author || "anonymous" }}</span>
            </div>
          </div>
          <p class="text-truncate-multi">{{ skill.summary || skill.description || "暂无说明。" }}</p>
          <div class="card-tags-row">
            <span v-if="skill.category" class="category-badge">{{ getCategoryLabel(skill.category) }}</span>
            <span
              v-for="tag in (skill.tags || []).slice(0, 3)"
              :key="tag"
              class="mini-tag"
            >
              {{ tag }}
            </span>
          </div>
          <div class="skill-card-foot-nx">
            <span class="foot-item">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              {{ formatDownloads(skill.downloadCount || 0) }}
            </span>
            <span class="foot-item">{{ skill.latestVersion ? `v${skill.latestVersion}` : "草稿" }}</span>
            <span class="foot-item">{{ formatDate(skill.updatedAt) }}</span>
          </div>
        </NuxtLink>
      </div>

      <!-- List view -->
      <div v-else class="skills-list-nx">
        <NuxtLink
          v-for="skill in skills"
          :key="skill.id"
          :to="`/skills/${skill.id}`"
          class="list-row-nx"
        >
          <div class="list-left-nx">
            <div class="skill-avatar sm" :style="skill.icon ? {} : { background: getAvatarColor(skill.name) }">
              <img v-if="skill.icon" :src="skill.icon" :alt="skill.name" />
              <span v-else>{{ skill.name.charAt(0).toUpperCase() }}</span>
            </div>
            <div class="list-info">
              <h4>{{ skill.name }}</h4>
              <p>{{ skill.summary || skill.description || "暂无说明。" }}</p>
            </div>
          </div>
          <div class="list-right-nx">
            <span v-if="skill.category" class="category-badge sm">{{ getCategoryLabel(skill.category) }}</span>
            <span class="foot-item">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              {{ formatDownloads(skill.downloadCount || 0) }}
            </span>
            <span class="v-nx">{{ skill.latestVersion ? `v${skill.latestVersion}` : "草稿" }}</span>
            <span class="date-nx">{{ formatDate(skill.updatedAt) }}</span>
          </div>
        </NuxtLink>
      </div>

      <!-- Empty state -->
      <div v-if="!pending && !skills.length" class="viewport-empty-nx">
        <p>没有找到匹配的 Skills。</p>
        <button v-if="selectedCategory || selectedTag || keyword" class="reset-btn" @click="keyword = ''; selectedCategory = ''; selectedTag = ''">
          清除筛选
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.nuxt-skills-page {
  position: relative;
  min-height: calc(100vh - 64px);
  background: var(--bg-main);
  width: 100%;
}

.content-container {
  position: relative;
  z-index: 10;
  max-width: 1440px;
  margin: 0 auto;
  padding: 40px;
}

/* Header */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
  gap: 24px;
  flex-wrap: wrap;
}

.header-main h2 {
  font-size: 1.75rem;
  font-weight: 900;
  color: var(--text-main);
  letter-spacing: -0.01em;
  margin: 0;
}

.header-main h2 .dim {
  color: var(--text-dim);
}

.header-desc {
  margin: 6px 0 0;
  font-size: 0.9rem;
  color: var(--text-muted);
}

.action-btn-primary {
  height: 40px;
  background: var(--nuxt-green);
  color: var(--btn-text);
  border: none;
  border-radius: 10px;
  padding: 0 20px;
  font-weight: 850;
  font-size: 0.875rem;
  display: flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  transition: 0.2s;
  white-space: nowrap;
}

.action-btn-primary:hover {
  transform: translateY(-1px);
  filter: brightness(1.1);
  box-shadow: 0 4px 12px rgba(var(--nuxt-green-rgb), 0.2);
}

/* Category tabs */
.category-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  overflow-x: auto;
  padding-bottom: 4px;
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.category-tabs::-webkit-scrollbar {
  display: none;
}

.tab-item {
  padding: 8px 16px;
  background: transparent;
  border: 1px solid var(--border-muted);
  border-radius: 20px;
  color: var(--text-dim);
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: 0.2s;
  white-space: nowrap;
}

.tab-item:hover {
  border-color: rgba(var(--nuxt-green-rgb), 0.3);
  color: var(--text-main);
}

.tab-item.active {
  background: rgba(var(--nuxt-green-rgb), 0.12);
  border-color: var(--nuxt-green);
  color: var(--nuxt-green);
}

/* Toolbar */
.toolbar {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.toolbar-right {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-left: auto;
}

.search-bar-nx {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 400px;
  min-width: 200px;
}

.search-icon {
  position: absolute;
  left: 14px;
  width: 16px;
  height: 16px;
  color: var(--text-dim);
}

.search-bar-nx input {
  width: 100%;
  height: 40px;
  padding: 0 16px 0 40px;
  background: var(--bg-input);
  border: 1px solid var(--border-main);
  border-radius: 10px;
  color: var(--text-main);
  font-family: inherit;
  font-size: 0.875rem;
  transition: 0.2s;
}

.search-bar-nx input:focus {
  outline: none;
  border-color: var(--nuxt-green);
  background: rgba(var(--nuxt-green-rgb), 0.02);
}

.sort-select {
  height: 40px;
  padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-main);
  border-radius: 10px;
  color: var(--text-main);
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: 0.2s;
  appearance: auto;
}

.sort-select:focus {
  outline: none;
  border-color: var(--nuxt-green);
}

.view-toggle-nx {
  display: flex;
  background: var(--bg-input);
  border: 1px solid var(--border-main);
  border-radius: 10px;
  overflow: hidden;
  height: 40px;
}

.view-toggle-nx button {
  padding: 0 12px;
  background: transparent;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  transition: 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.view-toggle-nx button.active {
  background: rgba(var(--nuxt-green-rgb), 0.1);
  color: var(--nuxt-green);
}

/* Tag cloud */
.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.tag-chip {
  padding: 4px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-muted);
  border-radius: 14px;
  color: var(--text-dim);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: 0.2s;
}

.tag-chip:hover {
  border-color: rgba(var(--nuxt-green-rgb), 0.3);
  color: var(--text-main);
}

.tag-chip.active {
  background: rgba(var(--nuxt-green-rgb), 0.1);
  border-color: var(--nuxt-green);
  color: var(--nuxt-green);
}

/* Stats */
.stats-row-nx {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-muted);
}

.status-nx {
  color: var(--nuxt-green);
  font-size: 0.8rem;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.filter-hint {
  color: var(--text-dim);
  font-size: 0.75rem;
  font-weight: 600;
}

/* Grid */
.skills-grid-nx {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
}

.skill-card-nx {
  text-decoration: none;
  padding: 24px;
  border-radius: 16px;
  transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--bg-main);
  border: 1px solid var(--border-muted);
  position: relative;
  overflow: hidden;
}

.skill-card-nx::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(var(--nuxt-green-rgb), 0.08) 0%, transparent 100%);
  opacity: 0;
  transition: 0.3s;
}

.skill-card-nx:hover {
  transform: translateY(-4px);
  border-color: rgba(var(--nuxt-green-rgb), 0.4);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.15);
}

.skill-card-nx:hover::before {
  opacity: 1;
}

.card-top {
  display: flex;
  align-items: center;
  gap: 14px;
  position: relative;
  z-index: 2;
}

.skill-avatar {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  background: rgba(var(--nuxt-green-rgb), 0.15);
}

.skill-avatar span {
  font-size: 1.2rem;
  font-weight: 900;
  color: #fff;
}

.skill-avatar.sm {
  width: 36px;
  height: 36px;
  border-radius: 8px;
}

.skill-avatar.sm span {
  font-size: 0.9rem;
}

.card-title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.card-title-block h4 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 900;
  color: var(--text-main);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.author-nx {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
}

.text-truncate-multi {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-muted);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  position: relative;
  z-index: 2;
}

.card-tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  position: relative;
  z-index: 2;
}

.category-badge {
  font-size: 0.65rem;
  font-weight: 800;
  background: rgba(var(--nuxt-green-rgb), 0.12);
  color: var(--nuxt-green);
  padding: 3px 8px;
  border-radius: 4px;
  letter-spacing: 0.02em;
}

.category-badge.sm {
  font-size: 0.6rem;
  padding: 2px 6px;
}

.mini-tag {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--bg-input);
  padding: 3px 8px;
  border-radius: 4px;
}

.skill-card-foot-nx {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--border-muted);
  padding-top: 14px;
  margin-top: auto;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-dim);
  position: relative;
  z-index: 2;
}

.foot-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* List view */
.skills-list-nx {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-muted);
  border-radius: 16px;
  overflow: hidden;
}

.list-row-nx {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  text-decoration: none;
  border-bottom: 1px solid var(--border-muted);
  transition: 0.2s;
  background: var(--bg-main);
  gap: 16px;
}

.list-row-nx:last-child {
  border-bottom: none;
}

.list-row-nx:hover {
  background: rgba(var(--nuxt-green-rgb), 0.03);
}

.list-left-nx {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  flex: 1;
}

.list-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.list-info h4 {
  margin: 0;
  font-size: 1rem;
  font-weight: 900;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-info p {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-right-nx {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-shrink: 0;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-dim);
}

.v-nx {
  font-size: 0.75rem;
  font-weight: 800;
  color: var(--text-dim);
  background: var(--bg-input);
  padding: 4px 8px;
  border-radius: 6px;
}

.date-nx {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-dim);
  min-width: 80px;
  text-align: right;
}

/* States */
.state-container {
  padding: 80px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  color: var(--text-dim);
}

.pulse-loader-nx {
  width: 44px;
  height: 44px;
  border: 4px solid var(--border-muted);
  border-top-color: var(--nuxt-green);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.viewport-empty-nx {
  padding: 60px;
  text-align: center;
  color: var(--text-dim);
  font-size: 1rem;
  border: 1px dashed var(--border-muted);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.reset-btn {
  padding: 8px 20px;
  background: var(--bg-input);
  border: 1px solid var(--border-main);
  border-radius: 8px;
  color: var(--text-main);
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: 0.2s;
}

.reset-btn:hover {
  border-color: var(--nuxt-green);
  color: var(--nuxt-green);
}

/* Responsive */
@media (max-width: 768px) {
  .content-container {
    padding: 24px 16px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-right {
    margin-left: 0;
    justify-content: space-between;
  }

  .search-bar-nx {
    max-width: 100%;
  }

  .skills-grid-nx {
    grid-template-columns: 1fr;
  }

  .list-right-nx {
    flex-direction: column;
    gap: 4px;
    align-items: flex-end;
  }
}
</style>

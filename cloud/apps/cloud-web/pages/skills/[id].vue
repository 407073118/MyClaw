<script setup lang="ts">
import type { SkillDetail, SkillCategory, DownloadTokenResponse } from "@myclaw-cloud/shared";
import { renderSafeMarkdown } from "~/utils/render-safe-markdown";

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

const categoryLabel = computed(() => {
  if (!selectedSkill.value) return "";
  const found = SKILL_CATEGORIES.find((c) => c.value === selectedSkill.value!.category);
  return found?.label ?? selectedSkill.value.category;
});

/** 把日期格式化为技能详情页使用的中文短日期。 */
const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
};

/** 把日期格式化为包含时间的中文展示文案。 */
const formatDateTime = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

/** 将说明文档 Markdown 渲染成详情页可直接展示的 HTML。 */
const renderedReadme = computed(() => {
  const skill = selectedSkill.value;
  if (!skill) return "";
  let md = skill.readme?.trim();
  if (!md) {
    md = `# ${skill.name}\n\n${skill.description || ""}\n\n${skill.summary || ""}`;
  }
  return renderSafeMarkdown(md);
});

/** 从技能名称生成头像首字母。 */
const iconLetter = computed(() => {
  if (!selectedSkill.value) return "?";
  return selectedSkill.value.name?.charAt(0)?.toUpperCase() || "?";
});

/** 按名称哈希生成稳定的头像背景色。 */
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

const downloadPendingId = ref("");

const latestReleaseId = computed(() => {
  const releases = selectedSkill.value?.releases;
  return releases?.length ? releases[0].id : "";
});

/** 为指定版本申请下载令牌，并在浏览器中打开下载地址。 */
async function handleDownload(releaseId: string) {
  if (!releaseId) return;
  downloadPendingId.value = releaseId;
  try {
    const token = await $fetch<DownloadTokenResponse>(`/api/hub/releases/${releaseId}/download-token`);
    if (import.meta.client) {
      window.open(token.downloadUrl, "_blank", "noopener,noreferrer");
    }
  } catch {
    console.warn("[Skills] 下载失败", { releaseId });
  } finally {
    downloadPendingId.value = "";
  }
}
</script>

<template>
  <main class="skill-detail-page">
    <div class="detail-container">
      <!-- 返回链接 -->
      <div class="nav-bar">
        <NuxtLink class="back-link" to="/skills">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          返回技能市场
        </NuxtLink>
      </div>

      <!-- 加载状态 -->
      <div v-if="pending" class="state-container">
        <div class="pulse-loader"></div>
        <p>加载中...</p>
      </div>

      <template v-else-if="selectedSkill">
        <!-- Hero 区域 -->
        <header class="hero-section glass-card">
          <div class="hero-top">
            <div class="hero-icon-area">
              <div class="skill-icon-lg icon-fallback" :style="{ background: getAvatarColor(selectedSkill.name) }">
                {{ iconLetter }}
              </div>
            </div>
            <div class="hero-info">
              <h1>{{ selectedSkill.name }}</h1>
              <span class="hero-author">by {{ selectedSkill.author || "Anonymous" }}</span>
              <div class="hero-badges">
                <span class="category-badge">{{ categoryLabel }}</span>
                <span v-for="tag in selectedSkill.tags" :key="tag" class="tag-chip">{{ tag }}</span>
              </div>
              <p class="hero-description">{{ selectedSkill.description }}</p>
            </div>
          </div>

          <div class="hero-actions">
            <button
              class="action-btn-primary"
              :disabled="!latestReleaseId || downloadPendingId === latestReleaseId"
              @click="handleDownload(latestReleaseId)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              {{ downloadPendingId === latestReleaseId ? "下载中..." : "下载 ZIP" }}
            </button>
            <NuxtLink :to="`/skills/publish?id=${selectedSkill.id}`" class="action-btn-secondary">
              发布新版本
            </NuxtLink>
          </div>

          <div class="hero-stats">
            <div class="stat-item">
              <span class="stat-value">{{ selectedSkill.downloadCount.toLocaleString() }}</span>
              <span class="stat-label">下载量</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ selectedSkill.releases.length }}</span>
              <span class="stat-label">版本数</span>
            </div>
            <div class="stat-item">
              <span class="stat-value nx-green">{{ selectedSkill.latestVersion ? `v${selectedSkill.latestVersion}` : "Draft" }}</span>
              <span class="stat-label">最新版本</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ formatDate(selectedSkill.createdAt) }}</span>
              <span class="stat-label">创建时间</span>
            </div>
          </div>
        </header>

        <!-- Two-column content -->
        <section class="content-columns">
          <!-- Left: README -->
          <div class="left-column">
            <div class="readme-panel glass-card">
              <div class="panel-header">
                <h2>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                  README
                </h2>
              </div>
              <div class="readme-content" v-html="renderedReadme"></div>
            </div>
          </div>

          <!-- Right: Meta sidebar -->
          <div class="right-column">
            <!-- About -->
            <div class="sidebar-card glass-card">
              <h3>关于</h3>
              <div class="sidebar-section">
                <span class="sidebar-label">分类</span>
                <span class="category-badge">{{ categoryLabel }}</span>
              </div>
              <div v-if="selectedSkill.tags.length" class="sidebar-section">
                <span class="sidebar-label">标签</span>
                <div class="tags-row">
                  <span v-for="tag in selectedSkill.tags" :key="tag" class="tag-chip">{{ tag }}</span>
                </div>
              </div>
              <div class="sidebar-section">
                <span class="sidebar-label">作者</span>
                <span class="sidebar-value">{{ selectedSkill.author || "Anonymous" }}</span>
              </div>
            </div>

            <!-- Install -->
            <div class="sidebar-card glass-card">
              <h3>安装</h3>
              <div class="install-code">
                <code>claw install @myclaw/{{ selectedSkill.id }}</code>
              </div>
            </div>

            <!-- Version History -->
            <div class="sidebar-card glass-card">
              <h3>版本历史 <span class="badge">{{ selectedSkill.releases.length }}</span></h3>
              <div v-if="selectedSkill.releases.length" class="release-timeline">
                <div v-for="release in selectedSkill.releases" :key="release.id" class="timeline-item">
                  <div class="timeline-dot"></div>
                  <div class="timeline-content">
                    <span class="version-badge">v{{ release.version }}</span>
                    <p v-if="release.releaseNotes" class="release-notes">{{ release.releaseNotes }}</p>
                    <span class="release-date">{{ formatDateTime(release.createdAt) }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="empty-hint">
                暂无发布版本
              </div>
            </div>
          </div>
        </section>
      </template>

      <!-- 未找到状态 -->
      <div v-else class="empty-state glass-card">
        <p>未找到该技能</p>
        <NuxtLink to="/skills" class="action-btn-secondary">返回技能市场</NuxtLink>
      </div>
    </div>
  </main>
</template>

<style scoped>
.skill-detail-page {
  position: relative;
  min-height: calc(100vh - 64px);
  background: var(--bg-main);
  width: 100%;
}

.detail-container {
  position: relative;
  z-index: 10;
  max-width: 1200px;
  margin: 0 auto;
  padding: 40px;
}

/* 玻璃卡片基础样式 */
.glass-card {
  background: var(--bg-main);
  border: 1px solid var(--border-muted);
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
}

/* 导航区 */
.nav-bar {
  margin-bottom: 24px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
  text-decoration: none;
  font-weight: 800;
  font-size: 0.85rem;
  transition: 0.2s;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  width: max-content;
}

.back-link:hover {
  color: var(--text-main);
  background: rgba(255, 255, 255, 0.08);
}

.back-link svg {
  width: 16px;
  height: 16px;
}

/* 首屏区域 */
.hero-section {
  padding: 40px;
  margin-bottom: 32px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.hero-top {
  display: flex;
  gap: 28px;
  align-items: flex-start;
}

.skill-icon-lg {
  width: 80px;
  height: 80px;
  border-radius: 20px;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid var(--border-main);
  background: rgba(255, 255, 255, 0.04);
}

.skill-icon-lg.icon-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 2rem;
  font-weight: 900;
}

.hero-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.hero-info h1 {
  margin: 0;
  font-size: 2.2rem;
  font-weight: 900;
  color: var(--text-main);
  letter-spacing: -0.02em;
  line-height: 1.15;
}

.hero-author {
  font-size: 0.9rem;
  color: var(--text-dim);
  font-weight: 600;
}

.hero-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.category-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  background: rgba(var(--nuxt-green-rgb), 0.12);
  color: var(--nuxt-green);
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 800;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-dim);
  border: 1px solid var(--border-main);
  border-radius: 8px;
  font-size: 0.78rem;
  font-weight: 600;
}

.hero-description {
  margin: 4px 0 0;
  font-size: 1.05rem;
  color: var(--text-muted);
  line-height: 1.6;
}

.hero-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.action-btn-primary {
  height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--nuxt-green);
  color: var(--btn-text);
  border: none;
  border-radius: 12px;
  padding: 0 24px;
  font-weight: 900;
  font-size: 0.95rem;
  cursor: pointer;
  transition: 0.2s;
  text-decoration: none;
}

.action-btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(var(--nuxt-green-rgb), 0.3);
}

.action-btn-primary:disabled {
  opacity: 0.6;
  cursor: wait;
}

.action-btn-primary svg {
  width: 18px;
  height: 18px;
}

.action-btn-secondary {
  height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-input);
  color: var(--text-main);
  border: 1px solid var(--border-main);
  border-radius: 12px;
  padding: 0 24px;
  font-weight: 800;
  font-size: 0.95rem;
  cursor: pointer;
  transition: 0.2s;
  text-decoration: none;
}

.action-btn-secondary:hover {
  border-color: var(--text-dim);
  background: rgba(255, 255, 255, 0.05);
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  padding-top: 24px;
  border-top: 1px solid var(--border-main);
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: center;
}

.stat-value {
  font-size: 1.2rem;
  font-weight: 900;
  color: var(--text-main);
  font-family: "Fira Code", monospace;
}

.stat-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.nx-green {
  color: var(--nuxt-green) !important;
}

/* 双栏布局 */
.content-columns {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 24px;
  align-items: start;
}

.left-column {
  min-width: 0;
}

.right-column {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 说明文档面板 */
.readme-panel {
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.panel-header h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 900;
  color: var(--text-main);
  display: flex;
  align-items: center;
  gap: 10px;
}

.panel-header svg {
  width: 20px;
  height: 20px;
  color: var(--text-dim);
}

/* 说明文档内容样式 */
.readme-content {
  color: var(--text-main);
  line-height: 1.7;
  font-size: 0.95rem;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.readme-content :deep(h1) {
  font-size: 1.6rem;
  font-weight: 900;
  margin: 24px 0 12px;
  color: var(--text-main);
  border-bottom: 1px solid var(--border-main);
  padding-bottom: 8px;
}

.readme-content :deep(h2) {
  font-size: 1.3rem;
  font-weight: 800;
  margin: 20px 0 10px;
  color: var(--text-main);
}

.readme-content :deep(h3) {
  font-size: 1.1rem;
  font-weight: 700;
  margin: 16px 0 8px;
  color: var(--text-main);
}

.readme-content :deep(p) {
  margin: 8px 0;
  color: var(--text-muted);
}

.readme-content :deep(strong) {
  color: var(--text-main);
  font-weight: 700;
}

.readme-content :deep(code) {
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: "Fira Code", monospace;
  font-size: 0.88em;
  color: var(--nuxt-green);
}

.readme-content :deep(pre) {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border-main);
  border-radius: 10px;
  padding: 16px 20px;
  overflow-x: auto;
  margin: 12px 0;
}

.readme-content :deep(pre code) {
  background: none;
  padding: 0;
  color: var(--text-main);
  font-size: 0.88rem;
  line-height: 1.6;
}

.readme-content :deep(ul) {
  list-style: none;
  padding: 0;
  margin: 8px 0;
}

.readme-content :deep(li) {
  position: relative;
  padding-left: 20px;
  margin: 4px 0;
  color: var(--text-muted);
}

.readme-content :deep(li)::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 10px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--nuxt-green);
}

/* 侧栏卡片 */
.sidebar-card {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sidebar-card h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 900;
  color: var(--text-main);
  display: flex;
  align-items: center;
  gap: 10px;
}

.sidebar-card .badge {
  background: rgba(var(--nuxt-green-rgb), 0.1);
  color: var(--nuxt-green);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.8rem;
  font-weight: 800;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sidebar-label {
  font-size: 0.75rem;
  font-weight: 800;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sidebar-value {
  font-size: 0.9rem;
  color: var(--text-main);
  font-weight: 600;
}

.tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 安装命令代码块 */
.install-code {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border-main);
  border-radius: 10px;
  padding: 14px 16px;
  overflow-x: auto;
}

.install-code code {
  color: var(--nuxt-green);
  font-family: "Fira Code", monospace;
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
}

/* 发布时间线 */
.release-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  max-height: 400px;
  overflow-y: auto;
  padding-right: 4px;
}

.release-timeline::-webkit-scrollbar {
  width: 4px;
}

.release-timeline::-webkit-scrollbar-track {
  background: transparent;
}

.release-timeline::-webkit-scrollbar-thumb {
  background: var(--border-main);
  border-radius: 4px;
}

.timeline-item {
  display: flex;
  gap: 14px;
  padding: 12px 0;
  position: relative;
}

.timeline-item:not(:last-child) {
  border-left: 2px solid var(--border-main);
  margin-left: 5px;
  padding-left: 18px;
}

.timeline-item:last-child {
  border-left: 2px solid transparent;
  margin-left: 5px;
  padding-left: 18px;
}

.timeline-dot {
  position: absolute;
  left: -1px;
  top: 16px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--nuxt-green);
  border: 2px solid var(--bg-main);
  flex-shrink: 0;
}

.timeline-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.version-badge {
  align-self: flex-start;
  background: var(--nuxt-green);
  color: var(--btn-text);
  padding: 3px 10px;
  border-radius: 6px;
  font-weight: 900;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  font-family: "Fira Code", monospace;
}

.release-notes {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.5;
}

.release-date {
  font-size: 0.75rem;
  color: var(--text-dim);
  font-weight: 600;
}

.empty-hint {
  color: var(--text-dim);
  font-size: 0.88rem;
  text-align: center;
  padding: 12px 0;
}

/* 状态区域 */
.state-container {
  padding: 120px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  color: var(--text-dim);
}

.pulse-loader {
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

.empty-state {
  padding: 60px 40px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: var(--text-dim);
  font-size: 1rem;
}

/* 响应式布局 */
@media (max-width: 960px) {
  .detail-container {
    padding: 24px 16px;
  }

  .hero-section {
    padding: 28px;
  }

  .hero-top {
    flex-direction: column;
    gap: 16px;
  }

  .hero-info h1 {
    font-size: 1.6rem;
  }

  .hero-stats {
    grid-template-columns: repeat(2, 1fr);
  }

  .content-columns {
    grid-template-columns: 1fr;
  }

  .readme-panel {
    padding: 24px;
  }
}
</style>

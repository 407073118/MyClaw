<template>
  <main class="page-container">
    <header class="page-header">
      <div class="header-text">
        <h2 class="page-title">云端 Hub <span class="dim">市场</span></h2>
        <p class="page-subtitle">发现、安装和管理云端 Skills 和 MCP 资源</p>
      </div>
    </header>

    <!-- Tab bar -->
    <div class="hub-tabs">
      <button
        data-testid="hub-tab-skills"
        :class="['tab-item', { active: activeTab === 'skill' }]"
        @click="switchTab('skill')"
      >技能</button>
      <button
        data-testid="hub-tab-mcp"
        :class="['tab-item', { active: activeTab === 'mcp' }]"
        @click="switchTab('mcp')"
      >MCP</button>
      <button
        data-testid="hub-tab-employee-packages"
        :class="['tab-item', { active: activeTab === 'employee-package' }]"
        @click="switchTab('employee-package')"
      >员工包</button>
      <button
        data-testid="hub-tab-workflow-packages"
        :class="['tab-item', { active: activeTab === 'workflow-package' }]"
        @click="switchTab('workflow-package')"
      >工作流包</button>
    </div>

    <!-- Error state -->
    <div v-if="cloudError && !loading" class="state-container error-state">
      <p>云端Hub暂时不可用</p>
      <p class="error-detail">{{ shell.runtimeBaseUrl }}/api/cloud-hub/items</p>
      <button class="secondary" @click="loadData">重试</button>
    </div>

    <!-- Skills tab: category filter + search + grid -->
    <template v-else-if="activeTab === 'skill'">
      <div class="category-tabs">
        <button
          :class="['cat-item', { active: selectedCategory === '' }]"
          @click="selectedCategory = ''"
        >全部</button>
        <button
          v-for="cat in SKILL_CATEGORIES"
          :key="cat.value"
          :class="['cat-item', { active: selectedCategory === cat.value }]"
          @click="selectedCategory = cat.value"
        >{{ cat.label }}</button>
      </div>

      <div class="toolbar">
        <div class="search-bar">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
          <input v-model="keyword" type="text" placeholder="搜索 Skills..." />
        </div>
        <select v-model="sortBy" class="sort-select">
          <option value="latest">最新更新</option>
          <option value="downloads">最多下载</option>
          <option value="name">名称排序</option>
        </select>
      </div>

      <!-- Tag cloud -->
      <div v-if="allTags.length" class="tag-cloud">
        <button
          v-for="tag in allTags"
          :key="tag"
          :class="['tag-chip', { active: selectedTag === tag }]"
          @click="selectedTag = selectedTag === tag ? '' : tag"
        >#{{ tag }}</button>
      </div>

      <div class="stats-row">
        <span class="stats-count">{{ displayedSkills.length }} 个 Skills</span>
        <span v-if="selectedCategory || selectedTag || keyword" class="filter-hint">(已筛选)</span>
      </div>

      <div v-if="loading" class="state-container">
        <div class="pulse-loader"></div>
        <p>正在加载 Skills 列表...</p>
      </div>

      <div v-else-if="displayedSkills.length === 0" class="state-container">
        <p>没有找到匹配的 Skills。</p>
        <button v-if="selectedCategory || selectedTag || keyword" class="secondary" @click="keyword = ''; selectedCategory = ''; selectedTag = ''">清除筛选</button>
      </div>

      <div v-else class="skills-grid">
        <button
          v-for="skill in displayedSkills"
          :key="skill.id"
          :data-testid="'hub-item-' + skill.id"
          class="skill-card"
          @click="openSkillDetail(skill.id)"
        >
          <div class="card-top">
            <div class="skill-avatar" :style="skill.icon ? {} : { background: getAvatarColor(skill.name) }">
              <img v-if="skill.icon" :src="skill.icon" :alt="skill.name" @error="($event.target as HTMLImageElement).style.display='none'" />
              <span v-else>{{ skill.name.charAt(0).toUpperCase() }}</span>
            </div>
            <div class="card-title-block">
              <h4>{{ skill.name }}</h4>
              <span class="author">{{ skill.author || "anonymous" }}</span>
            </div>
          </div>
          <p class="text-clamp">{{ skill.summary || skill.description || "暂无说明。" }}</p>
          <div class="card-tags">
            <span v-if="skill.category" class="category-badge">{{ getCategoryLabel(skill.category) }}</span>
            <span v-for="tag in (skill.tags || []).slice(0, 3)" :key="tag" class="mini-tag">{{ tag }}</span>
          </div>
          <div class="card-foot">
            <span class="foot-item">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              {{ formatDownloads(skill.downloadCount || 0) }}
            </span>
            <span class="foot-item">{{ skill.latestVersion ? `v${skill.latestVersion}` : "草稿" }}</span>
            <span class="foot-item">{{ formatDate(skill.updatedAt) }}</span>
          </div>
        </button>
      </div>
    </template>

    <!-- MCP / Employee / Workflow tabs: hub items grid -->
    <template v-else-if="!cloudError">
      <div v-if="loading" class="state-container">
        <div class="pulse-loader"></div>
        <p>正在加载...</p>
      </div>

      <div v-else-if="filteredHubItems.length === 0" class="state-container">
        <p>当前分类暂无资源。</p>
      </div>

      <div v-else class="skills-grid">
        <button
          v-for="item in filteredHubItems"
          :key="item.id"
          :data-testid="'hub-item-' + item.id"
          class="skill-card"
          @click="openHubItemDetail(item.id)"
        >
          <div class="card-top">
            <div v-if="item.iconUrl" class="skill-avatar">
              <img :src="item.iconUrl" :alt="item.name" @error="($event.target as HTMLImageElement).style.display='none'" />
            </div>
            <div v-else class="skill-avatar" :style="{ background: getAvatarColor(item.name) }">
              <span>{{ item.name.charAt(0).toUpperCase() }}</span>
            </div>
            <div class="card-title-block">
              <h4>{{ item.name }}</h4>
              <span class="author">{{ hubTypeLabel(item.type) }}</span>
            </div>
          </div>
          <p class="text-clamp">{{ item.summary || "暂无说明。" }}</p>
          <div class="card-foot">
            <span class="foot-item">{{ item.latestVersion ? `v${item.latestVersion}` : "—" }}</span>
          </div>
        </button>
      </div>
    </template>

    <!-- Detail overlay -->
    <Teleport to="body">
      <div v-if="detailVisible" class="detail-overlay" @click.self="closeDetail">
        <article class="detail-panel">
          <!-- Skill detail -->
          <template v-if="workspace.cloudSkillDetail && activeTab === 'skill'">
            <div class="detail-header">
              <div class="skill-avatar lg" :style="workspace.cloudSkillDetail.icon ? {} : { background: getAvatarColor(workspace.cloudSkillDetail.name) }">
                <img v-if="workspace.cloudSkillDetail.icon" :src="workspace.cloudSkillDetail.icon" :alt="workspace.cloudSkillDetail.name" />
                <span v-else>{{ workspace.cloudSkillDetail.name.charAt(0).toUpperCase() }}</span>
              </div>
              <div>
                <h3>{{ workspace.cloudSkillDetail.name }}</h3>
                <p class="detail-author">{{ workspace.cloudSkillDetail.author || "anonymous" }} · {{ getCategoryLabel(workspace.cloudSkillDetail.category) }}</p>
              </div>
              <button class="close-btn" @click="closeDetail">&times;</button>
            </div>
            <p class="detail-desc">{{ workspace.cloudSkillDetail.description }}</p>

            <div class="detail-info-grid">
              <div class="info-item"><span class="info-label">最新版本</span><span class="info-value">{{ workspace.cloudSkillDetail.latestVersion || "草稿" }}</span></div>
              <div class="info-item"><span class="info-label">下载量</span><span class="info-value">{{ formatDownloads(workspace.cloudSkillDetail.downloadCount || 0) }}</span></div>
              <div class="info-item"><span class="info-label">版本数</span><span class="info-value">{{ workspace.cloudSkillDetail.releases?.length || 0 }}</span></div>
            </div>

            <div v-if="workspace.cloudSkillDetail.releases?.length" class="detail-releases">
              <p class="section-title">版本历史</p>
              <div v-for="release in workspace.cloudSkillDetail.releases.slice(0, 5)" :key="release.id" class="release-item">
                <span class="release-version">{{ release.version }}</span>
                <span class="release-notes">{{ release.releaseNotes || "无说明" }}</span>
              </div>
            </div>

            <div class="detail-actions">
              <button
                data-testid="hub-action-import"
                class="primary"
                :disabled="isImporting"
                @click="installSkill"
              >{{ isImporting ? '安装中...' : '安装到本地技能目录' }}</button>
            </div>
            <p v-if="importFeedback" data-testid="hub-import-feedback" class="feedback success">{{ importFeedback }}</p>
            <p v-if="importError" class="feedback error">{{ importError }}</p>
          </template>

          <!-- Hub item detail -->
          <template v-else-if="workspace.cloudHubDetail">
            <div class="detail-header">
              <div class="skill-avatar lg" :style="{ background: getAvatarColor(workspace.cloudHubDetail.name) }">
                <span>{{ workspace.cloudHubDetail.name.charAt(0).toUpperCase() }}</span>
              </div>
              <div>
                <h3>{{ workspace.cloudHubDetail.name }}</h3>
                <p class="detail-author">{{ hubTypeLabel(workspace.cloudHubDetail.type) }}</p>
              </div>
              <button class="close-btn" @click="closeDetail">&times;</button>
            </div>
            <p class="detail-desc">{{ workspace.cloudHubDetail.description }}</p>

            <div class="detail-info-grid">
              <div class="info-item"><span class="info-label">最新版本</span><span class="info-value">{{ workspace.cloudHubDetail.latestVersion }}</span></div>
              <div class="info-item"><span class="info-label">版本数</span><span class="info-value">{{ workspace.cloudHubDetail.releases.length }}</span></div>
              <div class="info-item"><span class="info-label">清单类型</span><span class="info-value">{{ cloudManifest ? hubTypeLabel(cloudManifest.kind) : "加载中..." }}</span></div>
            </div>

            <div v-if="workspace.cloudHubDetail.releases.length" class="detail-releases">
              <p class="section-title">版本历史</p>
              <div v-for="release in workspace.cloudHubDetail.releases.slice(0, 5)" :key="release.id" class="release-item">
                <span class="release-version">{{ release.version }}</span>
                <span class="release-notes">{{ release.releaseNotes || "无说明" }}</span>
              </div>
            </div>

            <div class="detail-actions">
              <button
                data-testid="hub-action-import"
                class="primary"
                :disabled="isImporting || !cloudManifest"
                @click="installHubItem"
              >{{ isImporting ? '导入中...' : installActionLabel(workspace.cloudHubDetail.type) }}</button>
            </div>
            <p v-if="importFeedback" data-testid="hub-import-feedback" class="feedback success">{{ importFeedback }}</p>
            <p v-if="importError" class="feedback error">{{ importError }}</p>
          </template>

          <template v-else>
            <div class="state-container"><div class="pulse-loader"></div><p>加载详情中...</p></div>
          </template>
        </article>
      </div>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import type { CloudHubItemType, CloudSkillCategory } from "@/services/cloud-hub-client";
import { useShellStore } from "@/stores/shell";
import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const shell = useShellStore();

const activeTab = ref<CloudHubItemType>("skill");
const selectedCategory = ref<CloudSkillCategory | "">("");
const selectedTag = ref("");
const keyword = ref("");
const sortBy = ref<"latest" | "downloads" | "name">("latest");
const loading = ref(false);
const detailVisible = ref(false);
const isImporting = ref(false);
const importFeedback = ref("");
const importError = ref("");
const cloudError = ref(false);
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const SKILL_CATEGORIES: { value: CloudSkillCategory; label: string }[] = [
  { value: "ai-assistant", label: "AI 助手" },
  { value: "data-analysis", label: "数据分析" },
  { value: "dev-tools", label: "开发工具" },
  { value: "writing", label: "文档写作" },
  { value: "productivity", label: "效率工具" },
  { value: "design", label: "设计创意" },
  { value: "education", label: "教育学习" },
  { value: "other", label: "其他" },
];

const displayedSkills = computed(() => {
  let items = workspace.cloudSkills;
  if (selectedCategory.value) {
    items = items.filter((s) => s.category === selectedCategory.value);
  }
  if (selectedTag.value) {
    items = items.filter((s) => s.tags?.includes(selectedTag.value));
  }
  return items;
});

const allTags = computed(() => {
  const tagSet = new Set<string>();
  for (const skill of workspace.cloudSkills) {
    if (skill.tags) {
      for (const tag of skill.tags) tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
});

const filteredHubItems = computed(() =>
  workspace.cloudHubItems.filter((item) => item.type === activeTab.value)
);

const cloudManifest = computed(() => workspace.cloudHubManifest);

onMounted(() => loadData());

watch([keyword, sortBy], () => {
  if (activeTab.value === "skill") loadSkills();
});

watch(selectedCategory, () => {
  selectedTag.value = "";
  loadSkills();
});

async function switchTab(tab: CloudHubItemType) {
  activeTab.value = tab;
  closeDetail();
  await loadData();
}

async function loadData() {
  if (activeTab.value === "skill") {
    await loadSkills();
  } else {
    loading.value = true;
    cloudError.value = false;
    try {
      await workspace.loadCloudHubItems(activeTab.value);
    } catch {
      cloudError.value = true;
      scheduleRetry();
    } finally {
      loading.value = false;
    }
  }
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => loadData(), 3000);
}

function onWindowFocus() {
  if (cloudError.value) loadData();
}

window.addEventListener("focus", onWindowFocus);

onUnmounted(() => {
  if (retryTimer) clearTimeout(retryTimer);
  window.removeEventListener("focus", onWindowFocus);
});

async function loadSkills() {
  loading.value = true;
  try {
    await workspace.loadCloudSkills({
      ...(selectedCategory.value ? { category: selectedCategory.value } : {}),
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      ...(sortBy.value !== "latest" ? { sort: sortBy.value } : {}),
      ...(selectedTag.value ? { tag: selectedTag.value } : {}),
    });
    cloudError.value = false;
  } catch (e) {
    cloudError.value = true;
    scheduleRetry();
  } finally {
    loading.value = false;
  }
}

async function openSkillDetail(skillId: string) {
  detailVisible.value = true;
  importFeedback.value = "";
  importError.value = "";
  workspace.cloudSkillDetail = null;
  try {
    await workspace.loadCloudSkillDetail(skillId);
  } catch {
    // handled by template
  }
}

async function openHubItemDetail(itemId: string) {
  detailVisible.value = true;
  importFeedback.value = "";
  importError.value = "";
  workspace.cloudHubDetail = null;
  workspace.cloudHubManifest = null;
  try {
    const detail = await workspace.loadCloudHubDetail(itemId);
    const releaseId = detail.releases[0]?.id;
    if (releaseId) {
      await workspace.loadCloudHubManifest(releaseId);
    }
  } catch {
    // handled by template
  }
}

function closeDetail() {
  detailVisible.value = false;
  importFeedback.value = "";
  importError.value = "";
}

async function installSkill() {
  const detail = workspace.cloudSkillDetail;
  if (!detail || isImporting.value) return;
  const releaseId = detail.releases?.[0]?.id;
  if (!releaseId) { importError.value = "无可用版本。"; return; }

  isImporting.value = true;
  importFeedback.value = "";
  importError.value = "";
  try {
    await workspace.importCloudSkill({ releaseId, skillName: detail.name });
    importFeedback.value = "已安装到本地技能目录。";
  } catch (e) {
    importError.value = e instanceof Error ? e.message : "安装失败。";
  } finally {
    isImporting.value = false;
  }
}

async function installHubItem() {
  const detail = workspace.cloudHubDetail;
  const manifest = cloudManifest.value;
  if (!detail || !manifest || isImporting.value) return;

  isImporting.value = true;
  importFeedback.value = "";
  importError.value = "";
  try {
    if (detail.type === "mcp") {
      await workspace.importCloudMcp(manifest);
      importFeedback.value = "已安装到本地 MCP 配置。";
    } else {
      const releaseId = detail.releases[0]?.id;
      if (!releaseId) throw new Error("无可用版本。");
      if (detail.type === "employee-package") {
        await workspace.importCloudEmployeePackage({ itemId: detail.id, releaseId, name: detail.name, summary: detail.summary, manifest });
        importFeedback.value = "已导入到本地员工列表。";
      } else {
        await workspace.importCloudWorkflowPackage({ itemId: detail.id, releaseId, name: detail.name, summary: detail.summary, manifest });
        importFeedback.value = "已导入到本地工作流列表。";
      }
    }
  } catch (e) {
    importError.value = e instanceof Error ? e.message : "导入失败。";
  } finally {
    isImporting.value = false;
  }
}

function hubTypeLabel(type: string) {
  if (type === "skill") return "技能";
  if (type === "mcp") return "MCP";
  if (type === "employee-package") return "员工包";
  return "工作流包";
}

function installActionLabel(type: CloudHubItemType) {
  if (type === "mcp") return "安装到本地 MCP 配置";
  if (type === "employee-package") return "导入到本地员工列表";
  return "导入到本地工作流列表";
}

function getCategoryLabel(cat: string): string {
  return SKILL_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;
}

function getAvatarColor(name: string): string {
  const colors = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#84cc16"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatDownloads(count: number): string {
  if (count >= 10000) return (count / 10000).toFixed(1) + "w";
  if (count >= 1000) return (count / 1000).toFixed(1) + "k";
  return String(count);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}
</script>

<style scoped>
.page-container {
  overflow-y: auto;
  padding: 32px;
}

.page-header {
  margin-bottom: 28px;
}

.page-title {
  font-size: 1.75rem;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  margin: 0;
}

.page-title .dim {
  color: var(--text-muted);
}

.page-subtitle {
  margin: 6px 0 0;
  font-size: 0.9rem;
  color: var(--text-muted);
}

/* Tabs */
.hub-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
}

.tab-item {
  padding: 8px 18px;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: 0.2s;
}

.tab-item:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}

.tab-item.active {
  background: var(--accent-primary);
  color: var(--accent-text, var(--text-primary));
  border-color: transparent;
}

/* Category tabs */
.category-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  overflow-x: auto;
  scrollbar-width: none;
}

.category-tabs::-webkit-scrollbar { display: none; }

.cat-item {
  padding: 6px 14px;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition: 0.2s;
  white-space: nowrap;
}

.cat-item:hover {
  border-color: rgba(45, 212, 191, 0.3);
  color: var(--text-primary);
}

.cat-item.active {
  background: rgba(45, 212, 191, 0.12);
  border-color: var(--accent-cyan, #2dd4bf);
  color: var(--accent-cyan, #2dd4bf);
}

/* Toolbar */
.toolbar {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 18px;
}

.search-bar {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 400px;
}

.search-icon {
  position: absolute;
  left: 14px;
  width: 16px;
  height: 16px;
  color: var(--text-muted);
}

.search-bar input {
  width: 100%;
  height: 38px;
  padding: 0 16px 0 40px;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.85rem;
  transition: 0.2s;
}

.search-bar input:focus {
  outline: none;
  border-color: var(--accent-cyan, #2dd4bf);
}

.sort-select {
  height: 38px;
  padding: 0 12px;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.sort-select:focus {
  outline: none;
  border-color: var(--accent-cyan, #2dd4bf);
}

/* Tag cloud */
.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}

.tag-chip {
  padding: 4px 12px;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: 0.2s;
}

.tag-chip:hover {
  border-color: rgba(45, 212, 191, 0.3);
  color: var(--text-primary);
}

.tag-chip.active {
  background: rgba(45, 212, 191, 0.1);
  border-color: var(--accent-cyan, #2dd4bf);
  color: var(--accent-cyan, #2dd4bf);
}

/* Stats */
.stats-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--glass-border);
}

.stats-count {
  color: var(--accent-cyan, #2dd4bf);
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.filter-hint {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 600;
}

/* State containers */
.state-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 60px 20px;
  color: var(--text-muted);
  text-align: center;
}

.pulse-loader {
  width: 32px;
  height: 32px;
  border: 3px solid var(--glass-border);
  border-top-color: var(--accent-cyan, #2dd4bf);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Skills grid */
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.skill-card {
  text-align: left;
  padding: 22px;
  border-radius: 14px;
  transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  color: var(--text-primary);
}

.skill-card::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(45, 212, 191, 0.08) 0%, transparent 100%);
  opacity: 0;
  transition: 0.3s;
}

.skill-card:hover {
  transform: translateY(-3px);
  border-color: rgba(45, 212, 191, 0.4);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.12);
}

.skill-card:hover::before { opacity: 1; }

.card-top {
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
  z-index: 2;
}

.skill-avatar {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  background: rgba(45, 212, 191, 0.15);
}

.skill-avatar img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 5px;
}

.skill-avatar span {
  font-size: 1.1rem;
  font-weight: 900;
  color: #fff;
}

.skill-avatar.lg {
  width: 56px;
  height: 56px;
  border-radius: 14px;
}

.skill-avatar.lg span { font-size: 1.4rem; }

.card-title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.card-title-block h4 {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.author {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-weight: 600;
}

.text-clamp {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  position: relative;
  z-index: 2;
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  position: relative;
  z-index: 2;
}

.category-badge {
  font-size: 0.65rem;
  font-weight: 800;
  background: rgba(45, 212, 191, 0.12);
  color: var(--accent-cyan, #2dd4bf);
  padding: 3px 8px;
  border-radius: 4px;
}

.mini-tag {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-base, var(--glass-reflection));
  padding: 3px 8px;
  border-radius: 4px;
}

.card-foot {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--glass-border);
  padding-top: 12px;
  margin-top: auto;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-muted);
  position: relative;
  z-index: 2;
}

.foot-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Detail overlay */
.detail-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.detail-panel {
  background: var(--bg-card, #1a1a2e);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  padding: 28px;
  max-width: 600px;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.detail-header h3 {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 800;
}

.detail-author {
  margin: 4px 0 0;
  font-size: 0.8rem;
  color: var(--text-muted);
  font-weight: 600;
}

.close-btn {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0 8px;
  line-height: 1;
}

.close-btn:hover { color: var(--text-primary); }

.detail-desc {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.6;
}

.detail-info-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  background: var(--bg-base, rgba(0,0,0,0.2));
  border-radius: 8px;
  border: 1px solid var(--glass-border);
}

.info-label {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.03em;
}

.info-value {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text-primary);
}

.section-title {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.03em;
  margin: 0 0 8px;
}

.detail-releases {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.release-item {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-base, rgba(0,0,0,0.2));
  border-radius: 6px;
  border: 1px solid var(--glass-border);
  font-size: 0.82rem;
}

.release-version {
  font-family: monospace;
  font-weight: 700;
  color: var(--accent-cyan, #2dd4bf);
  white-space: nowrap;
}

.release-notes {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-actions {
  display: flex;
  gap: 12px;
}

.primary, .secondary {
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 10px 20px;
  background: var(--bg-base);
  color: var(--text-primary);
  cursor: pointer;
  font-weight: 700;
  font-size: 0.85rem;
  transition: 0.2s;
}

.primary {
  background: var(--accent-primary, var(--accent-cyan, #2dd4bf));
  color: var(--accent-text, #000);
  border-color: transparent;
}

.primary:hover:not(:disabled) { filter: brightness(1.1); }
.primary:disabled { opacity: 0.6; cursor: not-allowed; }

.feedback {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
}
.feedback.success { color: #10b981; }
.feedback.error { color: #ef4444; }
</style>

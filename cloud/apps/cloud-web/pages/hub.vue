<script setup lang="ts">
import type { DownloadTokenResponse, HubItem, HubItemDetail, HubItemType } from "@myclaw-cloud/shared";

type HubFilterType = "all" | HubItemType;

const selectedType = ref<HubFilterType>("all");
const keyword = ref("");
const selectedItemId = ref("");

const query = computed(() => ({
  ...(selectedType.value === "all" ? {} : { type: selectedType.value }),
  ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {})
}));

const { data, pending } = useLazyFetch<{ items: HubItem[] }>("/api/hub/items", {
  query,
  default: () => ({ items: [] }),
  watch: [query]
});

const items = computed(() => data.value.items);

watchEffect(() => {
  if (!items.value.some((item) => item.id === selectedItemId.value)) {
    selectedItemId.value = items.value[0]?.id ?? "";
  }
});

const { data: selectedItem, pending: selectedItemPending } = await useAsyncData<HubItemDetail | null>(
  () => `hub-item:${selectedItemId.value}`,
  () => (selectedItemId.value ? $fetch<HubItemDetail>(`/api/hub/items/${selectedItemId.value}`) : Promise.resolve(null)),
  {
    default: () => null,
    watch: [selectedItemId]
  }
);

const mcpCount = computed(() => items.value.filter((item) => item.type === "mcp").length);
const employeePackageCount = computed(() => items.value.filter((item) => item.type === "employee-package").length);
const workflowPackageCount = computed(() => items.value.filter((item) => item.type === "workflow-package").length);

const downloadPendingId = ref("");
const downloadError = ref("");

function hubTypeLabel(type: HubFilterType): string {
  if (type === "all") return "All";
  if (type === "mcp") return "MCP";
  if (type === "employee-package") return "Employee Package";
  return "Workflow Package";
}

async function handleDownloadRelease(releaseId: string) {
  downloadError.value = "";
  downloadPendingId.value = releaseId;

  try {
    const token = await $fetch<DownloadTokenResponse>(`/api/hub/releases/${releaseId}/download-token`);
    if (import.meta.client) {
      window.open(token.downloadUrl, "_blank", "noopener,noreferrer");
    }
  } catch {
    downloadError.value = "Download failed. Please try again later.";
  } finally {
    downloadPendingId.value = "";
  }
}

useHead({
  title: "Hub | MyClaw Cloud"
});
</script>

<template>
  <main class="hub-page">
    <div class="hub-shell">
      <header class="hub-header glass-card-nx">
        <div>
          <p class="eyebrow">Hub</p>
          <h1>Cloud Assets</h1>
          <p class="summary">Browse MCP connectors, employee packages, and workflow packages from one shared registry view.</p>
        </div>
        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-label">MCP</span>
            <strong>{{ mcpCount }}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-label">Employee</span>
            <strong>{{ employeePackageCount }}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-label">Workflow</span>
            <strong>{{ workflowPackageCount }}</strong>
          </div>
        </div>
      </header>

      <section class="hub-body">
        <aside class="hub-sidebar glass-card-nx">
          <div class="toolbar">
            <input v-model="keyword" type="text" placeholder="Search hub assets" />
            <div class="filter-row">
              <button
                v-for="type in ['all', 'mcp', 'employee-package', 'workflow-package'] as const"
                :key="type"
                class="filter-pill"
                :class="{ active: selectedType === type }"
                @click="selectedType = type"
              >
                {{ hubTypeLabel(type) }}
              </button>
            </div>
          </div>

          <div v-if="pending" class="empty-state">Loading assets…</div>
          <div v-else class="item-list">
            <button
              v-for="item in items"
              :key="item.id"
              class="item-card"
              :class="{ active: item.id === selectedItemId }"
              @click="selectedItemId = item.id"
            >
              <span class="item-type">{{ hubTypeLabel(item.type) }}</span>
              <strong>{{ item.name }}</strong>
              <span class="item-id">{{ item.id }}</span>
              <span class="item-version">v{{ item.latestVersion }}</span>
            </button>
          </div>
        </aside>

        <section class="hub-detail glass-card-nx">
          <div v-if="selectedItemPending && selectedItemId" class="empty-state">Loading details…</div>
          <template v-else-if="selectedItem">
            <header class="detail-header">
              <span class="detail-type">{{ hubTypeLabel(selectedItem.type) }}</span>
              <h2>{{ selectedItem.name }}</h2>
              <p>{{ selectedItem.description }}</p>
            </header>

            <div class="detail-meta">
              <div>
                <span class="meta-label">ID</span>
                <strong>{{ selectedItem.id }}</strong>
              </div>
              <div>
                <span class="meta-label">Latest</span>
                <strong>v{{ selectedItem.latestVersion }}</strong>
              </div>
            </div>

            <p v-if="downloadError" class="error-text">{{ downloadError }}</p>

            <div class="release-list">
              <article v-for="release in selectedItem.releases" :key="release.id" class="release-card">
                <div>
                  <strong>v{{ release.version }}</strong>
                  <p>{{ release.releaseNotes }}</p>
                </div>
                <button class="download-btn" :disabled="downloadPendingId === release.id" @click="handleDownloadRelease(release.id)">
                  {{ downloadPendingId === release.id ? "Loading…" : "Download" }}
                </button>
              </article>
            </div>
          </template>
          <div v-else class="empty-state">Select an asset from the left to view its details.</div>
        </section>
      </section>
    </div>
  </main>
</template>

<style scoped>
.hub-page {
  min-height: calc(100vh - 64px);
}

.hub-shell {
  max-width: 1440px;
  margin: 0 auto;
  padding: 40px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.hub-header {
  padding: 32px;
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 24px;
}

.eyebrow,
.meta-label,
.stat-label,
.item-type,
.detail-type {
  text-transform: uppercase;
  font-size: 0.75rem;
  font-weight: 800;
  color: var(--text-dim);
}

.hub-header h1,
.detail-header h2 {
  margin: 8px 0 12px;
  color: var(--text-main);
}

.summary,
.detail-header p,
.release-card p,
.item-id {
  color: var(--text-muted);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.stat-card,
.detail-meta,
.release-card,
.item-card {
  border: 1px solid var(--border-main);
  border-radius: 16px;
  background: var(--bg-input);
}

.stat-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hub-body {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 24px;
}

.hub-sidebar,
.hub-detail {
  padding: 24px;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar input {
  width: 100%;
  height: 44px;
  border-radius: 12px;
  border: 1px solid var(--border-main);
  background: var(--bg-input);
  color: var(--text-main);
  padding: 0 14px;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.filter-pill,
.download-btn,
.item-card {
  border: 1px solid var(--border-main);
  cursor: pointer;
}

.filter-pill {
  background: transparent;
  color: var(--text-dim);
  border-radius: 999px;
  padding: 8px 12px;
}

.filter-pill.active,
.item-card.active {
  border-color: var(--nuxt-green);
  color: var(--text-main);
  background: rgba(var(--nuxt-green-rgb), 0.08);
}

.item-list,
.release-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 20px;
}

.item-card {
  width: 100%;
  padding: 16px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item-version {
  color: var(--nuxt-green);
  font-weight: 800;
}

.detail-header,
.detail-meta {
  margin-bottom: 20px;
}

.detail-meta {
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.release-card {
  padding: 16px;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.download-btn {
  min-width: 120px;
  height: 40px;
  border-radius: 10px;
  background: var(--nuxt-green);
  color: var(--btn-text);
}

.download-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.empty-state,
.error-text {
  color: var(--text-dim);
}

.error-text {
  margin-bottom: 16px;
}

@media (max-width: 960px) {
  .hub-header,
  .hub-body {
    grid-template-columns: 1fr;
  }

  .stats-grid,
  .detail-meta {
    grid-template-columns: 1fr;
  }
}
</style>

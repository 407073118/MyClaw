<template>
  <main class="page-container">
    <header class="page-header">
      <div class="header-text">
        <span class="eyebrow">云端资源</span>
        <h2 class="page-title">云端Hub</h2>
        <p class="page-subtitle">
          这里展示云端技能和 MCP 目录。查看详情后，可以分别导入到本地技能目录或本地 MCP 配置。
        </p>
      </div>
    </header>

    <section class="hub-toolbar">
      <button
        data-testid="hub-tab-skills"
        type="button"
        :class="['hub-tab', { active: selectedType === 'skill' }]"
        @click="switchType('skill')"
      >
        技能
      </button>
      <button
        data-testid="hub-tab-mcp"
        type="button"
        :class="['hub-tab', { active: selectedType === 'mcp' }]"
        @click="switchType('mcp')"
      >
        MCP
      </button>
      <button
        data-testid="hub-tab-employee-packages"
        type="button"
        :class="['hub-tab', { active: selectedType === 'employee-package' }]"
        @click="switchType('employee-package')"
      >
        员工包
      </button>
      <button
        data-testid="hub-tab-workflow-packages"
        type="button"
        :class="['hub-tab', { active: selectedType === 'workflow-package' }]"
        @click="switchType('workflow-package')"
      >
        工作流包
      </button>
    </section>

    <section v-if="showLoadErrorState" class="hub-layout">
      <article class="hub-state hub-state--error" data-testid="hub-load-feedback">
        <p class="eyebrow">云端状态</p>
        <h3>云端Hub暂时不可用</h3>
        <p class="subtitle">
          当前还没有连上云端服务，所以列表和详情都加载不出来。这不是本地技能或 MCP 页面的问题。
        </p>
        <ul class="detail-list">
          <li>当前访问入口：{{ cloudHubAccessPath }}</li>
          <li>当前错误：{{ loadError }}</li>
        </ul>
        <div class="detail-actions">
          <button type="button" class="secondary" @click="retryLoad">重新加载</button>
        </div>
      </article>
    </section>

    <section v-else class="hub-layout">
      <article class="hub-list">
        <button
          v-for="item in filteredItems"
          :key="item.id"
          :data-testid="`hub-item-${item.id}`"
          type="button"
          :class="['hub-item', { active: item.id === selectedItemId }]"
          @click="selectItem(item.id)"
        >
          <div class="hub-item__meta">
            <span class="status-badge">{{ hubTypeLabel(item.type) }}</span>
            <span>{{ item.latestVersion }}</span>
          </div>
          <strong>{{ item.name }}</strong>
          <p>{{ item.summary }}</p>
        </button>
      </article>

      <article class="hub-detail">
        <template v-if="selectedDetail">
          <p class="eyebrow">当前条目</p>
          <h3>{{ selectedDetail.name }}</h3>
          <p class="subtitle">{{ selectedDetail.description }}</p>
          <ul class="detail-list">
            <li>最新版本：{{ selectedDetail.latestVersion }}</li>
            <li>发布记录：{{ selectedDetail.releases.length }}</li>
            <li>清单类型：{{ cloudManifest ? hubTypeLabel(cloudManifest.kind) : "待加载" }}</li>
          </ul>

          <div class="detail-actions">
            <button
              data-testid="hub-action-view-detail"
              type="button"
              class="secondary"
              @click="viewSelectedDetail"
            >
              查看详情
            </button>
            <button
              data-testid="hub-action-import"
              type="button"
              class="primary"
              :disabled="isImporting || !cloudManifest"
              @click="installSelectedItem"
            >
              {{ installActionLabel(selectedDetail.type) }}
            </button>
          </div>
          <p v-if="detailFeedback" class="subtitle" data-testid="hub-detail-feedback">{{ detailFeedback }}</p>
          <p v-if="importFeedback" class="import-feedback success" data-testid="hub-import-feedback">
            {{ importFeedback }}
          </p>
          <p v-else-if="importError" class="import-feedback error" data-testid="hub-import-feedback">
            {{ importError }}
          </p>
        </template>
        <template v-else>
          <p class="subtitle">选择一个云端条目后，可以查看详情并导入到本地。</p>
        </template>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import type { CloudHubItemType } from "@/services/cloud-hub-client";
import { useShellStore } from "@/stores/shell";
import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const shell = useShellStore();
const selectedType = ref<CloudHubItemType>("skill");
const selectedItemId = ref("");
const isImporting = ref(false);
const detailFeedback = ref("");
const importFeedback = ref("");
const importError = ref("");
const loadError = ref("");
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const AUTO_RETRY_DELAY_MS = 3000;

const filteredItems = computed(() =>
  workspace.cloudHubItems.filter((item) => item.type === selectedType.value)
);
const selectedDetail = computed(() =>
  workspace.cloudHubDetail && workspace.cloudHubDetail.id === selectedItemId.value ? workspace.cloudHubDetail : null
);
const cloudManifest = computed(() => workspace.cloudHubManifest);
const cloudHubAccessPath = computed(() => `${shell.runtimeBaseUrl}/api/cloud-hub/items`);
const showLoadErrorState = computed(() => Boolean(loadError.value) && filteredItems.value.length === 0 && !selectedDetail.value);

onMounted(async () => {
  window.addEventListener("focus", handleWindowFocus);
  await loadItemsForType(selectedType.value);
});

onBeforeUnmount(() => {
  window.removeEventListener("focus", handleWindowFocus);
  clearRetryTimer();
});

/** 切换云端资源分类，并清空上一个分类的反馈信息。 */
async function switchType(type: CloudHubItemType) {
  clearFeedback();
  selectedType.value = type;
  await loadItemsForType(type);
}

/** 拉取指定分类的云端条目，并默认载入第一项详情。 */
async function loadItemsForType(type: CloudHubItemType) {
  try {
    clearRetryTimer();
    loadError.value = "";
    const items = await workspace.loadCloudHubItems(type);
    selectedItemId.value = items[0]?.id ?? "";
    if (selectedItemId.value) {
      await selectItem(selectedItemId.value);
    }
  } catch (error) {
    selectedItemId.value = "";
    workspace.cloudHubItems = [];
    workspace.cloudHubDetail = null;
    workspace.cloudHubManifest = null;
    loadError.value = normalizeLoadError(error);
    scheduleRetry();
  }
}

/** 根据条目 ID 拉取详情与对应 release manifest。 */
async function selectItem(itemId: string) {
  try {
    clearFeedback();
    loadError.value = "";
    selectedItemId.value = itemId;
    const detail = await workspace.loadCloudHubDetail(itemId);
    const releaseId = detail.releases[0]?.id;
    if (releaseId) {
      await workspace.loadCloudHubManifest(releaseId);
    }
  } catch (error) {
    selectedItemId.value = "";
    workspace.cloudHubDetail = null;
    workspace.cloudHubManifest = null;
    loadError.value = normalizeLoadError(error);
    scheduleRetry();
  }
}

async function retryLoad() {
  await loadItemsForType(selectedType.value);
}

function scheduleRetry() {
  clearRetryTimer();
  retryTimer = setTimeout(() => {
    void retryLoad();
  }, AUTO_RETRY_DELAY_MS);
}

function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function handleWindowFocus() {
  if (!loadError.value) {
    return;
  }
  void retryLoad();
}

function clearFeedback() {
  detailFeedback.value = "";
  importFeedback.value = "";
  importError.value = "";
}

function normalizeLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : "云端Hub加载失败。";
  if (/failed to fetch|fetch failed|econnrefused/i.test(message)) {
    return "未连接到云端服务，请确认 cloud-api 已启动。";
  }
  return message;
}

/** 返回 Hub 资源类型的中文标签，供列表徽标和详情信息复用。 */
function hubTypeLabel(type: CloudHubItemType) {
  if (type === "skill") {
    return "技能";
  }
  if (type === "mcp") {
    return "MCP";
  }
  if (type === "employee-package") {
    return "员工包";
  }
  return "工作流包";
}

function viewSelectedDetail() {
  if (!selectedDetail.value) {
    return;
  }
  detailFeedback.value = `正在查看 ${selectedDetail.value.name} ${selectedDetail.value.latestVersion} 的详情`;
}

/** 为不同类型的 Hub 资源返回对应的安装按钮文案。 */
function installActionLabel(type: CloudHubItemType) {
  if (type === "skill") {
    return "安装到本地技能目录";
  }
  if (type === "mcp") {
    return "安装到本地 MCP 配置";
  }
  if (type === "employee-package") {
    return "导入到本地员工列表";
  }
  return "导入到本地工作流列表";
}

/** 将当前选中的云端资源导入到本地对应模块。 */
async function installSelectedItem() {
  const detail = selectedDetail.value;
  const manifest = cloudManifest.value;
  if (!detail || !manifest || isImporting.value) {
    return;
  }

  importFeedback.value = "";
  importError.value = "";
  isImporting.value = true;
  try {
    if (detail.type === "skill") {
      if (manifest.kind !== "skill") {
        throw new Error("Cloud manifest does not match selected skill.");
      }
      const releaseId = detail.releases[0]?.id;
      if (!releaseId) {
        throw new Error("No cloud release found for this skill.");
      }

      await workspace.importCloudSkill({
        releaseId,
        skillName: manifest.name,
      });
      importFeedback.value = "已安装到本地技能目录。";
      return;
    }
    if (detail.type === "mcp") {
      await workspace.importCloudMcp(manifest);
      importFeedback.value = "已安装到本地 MCP 配置。";
      return;
    }
    const releaseId = detail.releases[0]?.id;
    if (!releaseId) {
      throw new Error("No cloud release found for this package.");
    }
    if (detail.type === "employee-package") {
      await workspace.importCloudEmployeePackage({
        itemId: detail.id,
        releaseId,
        name: detail.name,
        summary: detail.summary,
        manifest,
      });
      importFeedback.value = "已导入到本地员工列表。";
      return;
    }
    await workspace.importCloudWorkflowPackage({
      itemId: detail.id,
      releaseId,
      name: detail.name,
      summary: detail.summary,
      manifest,
    });
    importFeedback.value = "已导入到本地工作流列表。";
  } catch (error) {
    importError.value = error instanceof Error ? error.message : "云端导入失败。";
  } finally {
    isImporting.value = false;
  }
}
</script>

<style scoped>
.page-container {
  overflow-y: auto;
}

.hub-toolbar {
  display: flex;
  gap: 12px;
}

.hub-tab {
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  padding: 10px 18px;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
}

.hub-tab.active {
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.hub-layout {
  display: grid;
  grid-template-columns: minmax(320px, 360px) minmax(0, 1fr);
  gap: 24px;
}

.hub-list,
.hub-detail,
.hub-state {
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  padding: 24px;
}

.hub-state {
  grid-column: 1 / -1;
  min-height: 280px;
  justify-content: center;
}

.hub-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--bg-base);
  color: var(--text-primary);
  padding: 16px;
  cursor: pointer;
}

.hub-item.active {
  border-color: var(--text-muted);
}

.hub-item__meta,
.detail-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.detail-list {
  margin: 0;
  padding-left: 20px;
  color: var(--text-secondary);
}

.primary,
.secondary {
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  padding: 10px 16px;
  background: var(--bg-base);
  color: var(--text-primary);
  cursor: pointer;
}

.primary {
  background: var(--accent-primary);
  color: var(--accent-text);
  border-color: transparent;
}

.primary:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.import-feedback {
  margin: 0;
  font-size: 14px;
}

.import-feedback.success {
  color: #1f7a35;
}

.import-feedback.error {
  color: #b83333;
}

@media (max-width: 960px) {
  .hub-layout {
    grid-template-columns: 1fr;
  }
}
</style>

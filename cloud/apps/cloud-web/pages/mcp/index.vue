<script setup lang="ts">
import type {
  McpItemDetail,
  McpItemSummary,
  McpManifest,
  McpReleaseUploadResponse
} from "@myclaw-cloud/shared";

const { data, pending, refresh } = await useFetch<{ items: McpItemSummary[] }>("/api/mcp/items", {
  default: () => ({ items: [] })
});

const connectors = computed(() => data.value.items);
const selectedConnectorId = ref("");

watchEffect(() => {
  if (!connectors.value.some((item) => item.id === selectedConnectorId.value)) {
    selectedConnectorId.value = connectors.value[0]?.id ?? "";
  }
});

const { data: selectedConnector, pending: connectorPending, refresh: refreshDetail } = await useAsyncData<McpItemDetail | null>(
  () => `mcp-item:${selectedConnectorId.value}`,
  () => (selectedConnectorId.value ? $fetch<McpItemDetail>(`/api/mcp/items/${selectedConnectorId.value}`) : Promise.resolve(null)),
  {
    default: () => null,
    watch: [selectedConnectorId]
  }
);

const activeReleaseId = computed(() => selectedConnector.value?.releases[0]?.id ?? "");
const { data: selectedManifest } = await useAsyncData<McpManifest | null>(
  () => `mcp-manifest:${activeReleaseId.value}`,
  async () => {
    if (!activeReleaseId.value) return null;
    const manifest = await $fetch<McpManifest>(`/api/mcp/releases/${activeReleaseId.value}/manifest`);
    return manifest.kind === "mcp" ? manifest : null;
  },
  {
    default: () => null,
    watch: [activeReleaseId]
  }
);

const showPublishModal = ref(false);
const publishForm = reactive({
  id: "",
  name: "",
  summary: "",
  description: "",
  version: "",
  releaseNotes: ""
});
const publishFile = ref<File | null>(null);
const publishPending = ref(false);
const publishStatus = ref({ type: "" as "success" | "error" | "", message: "" });

function handleFileChange(event: Event) {
  // 中文日志：记录 MCP 版本包文件选择结果。
  const input = event.target as HTMLInputElement;
  publishFile.value = input.files?.[0] ?? null;
  console.info("[MCP 发布版本] 已选择版本包文件", { fileName: publishFile.value?.name ?? null });
}

function openPublish() {
  // 中文日志：记录打开 MCP 新版本发布弹窗。
  if (!selectedConnector.value) {
    console.warn("[MCP 发布版本] 当前没有可发布的 MCP");
    publishStatus.value = { type: "error", message: "当前没有可发布版本的 MCP。" };
    return;
  }
  publishForm.id = selectedConnector.value.id;
  publishForm.name = selectedConnector.value.name;
  publishForm.summary = selectedConnector.value.summary;
  publishForm.description = selectedConnector.value.description;
  publishForm.version = "";
  publishForm.releaseNotes = "";
  publishFile.value = null;
  publishStatus.value = { type: "", message: "" };
  showPublishModal.value = true;
  console.info("[MCP 发布版本] 已打开版本发布弹窗", { id: publishForm.id });
}

async function handlePublish() {
  // 中文日志：记录 MCP 新版本发布流程开始。
  if (!publishFile.value) {
    publishStatus.value = { type: "error", message: "请先选择 ZIP 包。" };
    console.warn("[MCP 发布版本] 缺少 ZIP 包，无法提交");
    return;
  }

  const formData = new FormData();
  formData.append("version", publishForm.version);
  formData.append("releaseNotes", publishForm.releaseNotes);
  formData.append("file", publishFile.value);

  publishPending.value = true;
  try {
    const result = await $fetch<McpReleaseUploadResponse>(`/api/mcp/items/${publishForm.id}/releases`, {
      method: "POST",
      body: formData
    });

    publishStatus.value = {
      type: "success",
      message: `新版本发布成功：${result.releaseId}`
    };
    console.info("[MCP 发布版本] 新版本发布成功", { id: publishForm.id, releaseId: result.releaseId });
    await refresh();
    await refreshDetail();
    setTimeout(() => {
      showPublishModal.value = false;
    }, 900);
  } catch (error: any) {
    publishStatus.value = { type: "error", message: error?.data?.statusMessage || error?.statusMessage || "发布新版本失败。" };
    console.error("[MCP 发布版本] 新版本发布失败", error);
  } finally {
    publishPending.value = false;
    console.info("[MCP 发布版本] 版本发布流程结束", { id: publishForm.id, pending: false });
  }
}

useHead({
  title: "MCP 管理 | MyClaw Cloud"
});
</script>

<template>
  <main class="nuxt-mcp-page">
    <div class="content-container">
      <section class="compact-header-nx">
        <div class="header-main">
          <h2>MCP <span class="dim">管理</span></h2>
        </div>

        <div class="header-right">
          <NuxtLink class="action-btn-primary" to="/mcp/publish">创建 MCP</NuxtLink>
        </div>
      </section>

      <div v-if="pending" class="state-container">
        <div class="pulse-loader-nx"></div>
        <p>正在加载 MCP 列表...</p>
      </div>

      <div v-else class="master-detail-nx">
        <aside class="sidebar-nx glass-card-nx">
          <div class="sidebar-head-nx">
            <h3>连接器</h3>
            <span class="status-nx">{{ connectors.length }} 个有效 MCP</span>
          </div>
          <div class="catalog-list-nx">
            <button
              v-for="connector in connectors"
              :key="connector.id"
              class="mcp-card-nx"
              :class="{ active: selectedConnectorId === connector.id }"
              @click="selectedConnectorId = connector.id"
            >
              <div class="mcp-card-head-nx">
                <span class="type-nx">MCP</span>
                <span class="v-nx">{{ connector.latestVersion ? `v${connector.latestVersion}` : "草稿" }}</span>
              </div>
              <h4>{{ connector.name }}</h4>
              <p class="text-truncate">{{ connector.summary }}</p>
            </button>
          </div>
        </aside>

        <article class="detail-viewer-nx glass-card-nx">
          <div v-if="connectorPending" class="viewport-loader-nx">
            <div class="pulse-loader-nx"></div>
          </div>
          <template v-else-if="selectedConnector">
            <div class="viewport-content-nx">
              <header class="connector-header-nx">
                <div class="head-top">
                  <span class="id-tag-nx">ID: {{ selectedConnector.id }}</span>
                  <button class="update-btn-nx" @click="openPublish">发布新版本</button>
                </div>
                <h2>{{ selectedConnector.name }}</h2>
                <p class="description">{{ selectedConnector.description }}</p>
              </header>

              <div class="spec-grid-nx">
                <div class="spec-box-nx">
                  <span class="l">传输方式</span>
                  <span class="v nx-green">{{ selectedManifest?.transport ?? "stdio" }}</span>
                </div>
                <div class="spec-box-nx">
                  <span class="l">最新版本</span>
                  <span class="v">v{{ selectedConnector.latestVersion }}</span>
                </div>
                <div class="spec-box-nx">
                  <span class="l">版本数</span>
                  <span class="v">{{ selectedConnector.releases.length }}</span>
                </div>
              </div>

              <div class="manifest-nx">
                <div class="title-nx">
                  <span>连接配置清单</span>
                  <div class="dot-nx"></div>
                </div>
                <div class="code-viewport-nx">
                  <div class="code-header-nx">
                    <span class="fn">manifest.json</span>
                    <span class="st">就绪</span>
                  </div>
                  <pre><code>{{
JSON.stringify(selectedManifest ?? { status: "loading" }, null, 2)
                  }}</code></pre>
                </div>
              </div>
            </div>
          </template>
          <div v-else class="viewport-empty-nx">
            <p>请选择左侧 MCP 查看配置。</p>
          </div>
        </article>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showPublishModal" class="modal-overlay">
        <div class="modal-content glass-card-nx">
          <header class="modal-header">
            <h3>发布新版本</h3>
            <button class="close-btn" @click="showPublishModal = false">&times;</button>
          </header>

          <form class="publication-form" @submit.prevent="handlePublish">
            <div class="form-row">
              <div class="form-group flex-1">
                <label>版本</label>
                <input v-model="publishForm.version" type="text" placeholder="1.0.0" required />
              </div>
              <div class="form-group flex-2">
                <label>发布说明</label>
                <input v-model="publishForm.releaseNotes" type="text" placeholder="说明这个版本的更新内容" required />
              </div>
            </div>

            <div class="form-group">
              <label>版本包（ZIP）</label>
              <div class="drop-zone-nx" :class="{ active: publishFile }">
                <input type="file" accept=".zip" @change="handleFileChange" />
                <span>{{ publishFile ? publishFile.name : "选择 ZIP 包" }}</span>
              </div>
            </div>

            <div v-if="publishStatus.message" class="status-msg" :class="publishStatus.type">
              {{ publishStatus.message }}
            </div>

            <button type="submit" class="submit-modal-btn" :disabled="publishPending">
              {{ publishPending ? "正在提交..." : "提交发布" }}
            </button>
          </form>
        </div>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.nuxt-mcp-page { position: relative; min-height: calc(100vh - 64px); background: var(--bg-main); width: 100%; }
.content-container { position: relative; z-index: 10; max-width: 1440px; margin: 0 auto; padding: 40px; }
.compact-header-nx { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
.header-main { display: flex; align-items: center; gap: 40px; }
.header-main h2 { font-size: 1.75rem; font-weight: 900; color: var(--text-main); letter-spacing: -0.01em; margin: 0; }
.header-main h2 .dim { color: var(--text-dim); }
.action-btn-primary { height: 40px; background: var(--nuxt-green); color: var(--btn-text); border: none; border-radius: 10px; padding: 0 20px; font-weight: 850; font-size: 0.875rem; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: 0.2s; }
.action-btn-primary:hover { transform: translateY(-1px); filter: brightness(1.1); }
.master-detail-nx { display: grid; grid-template-columns: 360px 1fr; gap: 32px; height: calc(100vh - 200px); min-height: 600px; }
.sidebar-head-nx { padding: 20px 24px; border-bottom: 1px solid var(--border-muted); display: flex; justify-content: space-between; align-items: center; }
.sidebar-head-nx h3 { font-size: 0.75rem; font-weight: 850; color: var(--text-dim); text-transform: uppercase; margin: 0; }
.status-nx { color: var(--nuxt-green); font-size: 0.75rem; font-weight: 800; }
.catalog-list-nx { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.mcp-card-nx { text-align: left; background: transparent; border: 1px solid transparent; padding: 20px; border-radius: 16px; cursor: pointer; transition: 0.2s; }
.mcp-card-nx:hover { background: var(--selection-bg); }
.mcp-card-nx.active { background: var(--selection-bg); border-color: var(--nuxt-green); }
.mcp-card-head-nx { display: flex; justify-content: space-between; margin-bottom: 12px; }
.type-nx { font-size: 0.65rem; font-weight: 900; background: var(--nuxt-green); color: var(--btn-text); padding: 2px 8px; border-radius: 4px; }
.v-nx { font-size: 0.75rem; font-weight: 800; color: var(--text-dim); }
.mcp-card-nx h4 { margin: 0 0 4px; color: var(--text-main); font-size: 1rem; font-weight: 850; }
.mcp-card-nx p { margin: 0; font-size: 0.825rem; color: var(--text-muted); line-height: 1.5; }
.viewport-content-nx { padding: 48px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 40px; }
.head-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
.id-tag-nx { font-family: monospace; font-size: 0.75rem; color: var(--nuxt-green); border-bottom: 1px solid var(--selection-bg); padding-bottom: 4px; }
.update-btn-nx { background: rgba(var(--nuxt-green-rgb), 0.1); color: var(--nuxt-green); border: 1px solid rgba(var(--nuxt-green-rgb), 0.2); border-radius: 6px; padding: 4px 12px; font-size: 0.75rem; font-weight: 800; cursor: pointer; }
.connector-header-nx h2 { font-size: 2.75rem; font-weight: 950; margin: 4px 0 12px; color: var(--text-main); letter-spacing: -0.01em; }
.connector-header-nx .description { font-size: 1.15rem; color: var(--text-muted); line-height: 1.625; }
.spec-grid-nx { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.spec-box-nx { padding: 24px; background: var(--bg-input); border: 1px solid var(--border-muted); border-radius: 16px; display: flex; flex-direction: column; gap: 8px; }
.spec-box-nx .l { font-size: 0.7rem; font-weight: 850; color: var(--text-dim); text-transform: uppercase; }
.spec-box-nx .v { font-size: 1.25rem; font-weight: 900; color: var(--text-main); }
.nx-green { color: var(--nuxt-green) !important; }
.manifest-nx { display: flex; flex-direction: column; gap: 24px; }
.title-nx { display: flex; align-items: center; gap: 12px; font-weight: 900; color: var(--text-main); font-size: 1rem; }
.dot-nx { width: 8px; height: 8px; background: var(--nuxt-green); border-radius: 50%; box-shadow: 0 0 10px var(--nuxt-green); }
.code-viewport-nx { background: var(--bg-main); border: 1px solid var(--border-main); border-radius: 16px; overflow: hidden; }
.code-header-nx { padding: 12px 20px; background: var(--border-muted); border-bottom: 1px solid var(--border-main); display: flex; justify-content: space-between; }
.fn { font-size: 0.75rem; font-weight: 850; color: var(--nuxt-green); }
.st { font-size: 0.7rem; font-weight: 750; color: var(--text-dim); }
pre { margin: 0; padding: 24px; overflow-x: auto; }
code { color: var(--text-main); font-family: 'Fira Code', monospace; line-height: 1.6; font-size: 0.9375rem; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; }
.modal-content { width: 100%; max-width: 600px; padding: 40px; position: relative; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
.modal-header h3 { font-size: 1.5rem; font-weight: 900; color: var(--text-main); margin: 0; }
.close-btn { background: none; border: none; color: var(--text-dim); font-size: 1.5rem; cursor: pointer; }
.publication-form { display: flex; flex-direction: column; gap: 24px; }
.form-section { display: flex; flex-direction: column; gap: 20px; }
.form-row { display: flex; gap: 16px; }
.flex-1 { flex: 1; }
.flex-2 { flex: 2; }
.form-group label { display: block; font-size: 0.75rem; font-weight: 900; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; }
.form-group input, .form-group textarea { width: 100%; padding: 12px 16px; background: var(--bg-input); border: 1px solid var(--border-main); border-radius: 10px; color: var(--text-main); font-family: inherit; }
.form-group input:focus, .form-group textarea:focus { outline: none; border-color: var(--nuxt-green); }
.drop-zone-nx { height: 100px; border: 2px dashed var(--border-main); border-radius: 12px; display: flex; align-items: center; justify-content: center; position: relative; color: var(--text-dim); transition: 0.2s; }
.drop-zone-nx input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.drop-zone-nx.active { border-color: var(--nuxt-green); background: rgba(var(--nuxt-green-rgb), 0.05); color: var(--nuxt-green); }
.submit-modal-btn { height: 50px; background: var(--nuxt-green); color: var(--btn-text); border: none; border-radius: 12px; font-weight: 900; font-size: 1rem; cursor: pointer; transition: 0.3s; }
.submit-modal-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(var(--nuxt-green-rgb), 0.3); }
.submit-modal-btn:disabled { opacity: 0.5; filter: grayscale(1); }
.status-msg { padding: 12px; border-radius: 8px; font-size: 0.875rem; font-weight: 700; text-align: center; }
.status-msg.success { background: rgba(var(--nuxt-green-rgb), 0.1); color: var(--nuxt-green); }
.status-msg.error { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
.viewport-loader-nx, .viewport-empty-nx { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-dim); }
.state-container { padding: 120px 0; display: flex; flex-direction: column; align-items: center; gap: 24px; color: var(--text-dim); }
.pulse-loader-nx { width: 44px; height: 44px; border: 4px solid var(--border-muted); border-top-color: var(--nuxt-green); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1024px) { .master-detail-nx { grid-template-columns: 1fr; height: auto; } .sidebar-nx { height: 320px; } }
</style>

<template>
  <main data-testid="mcp-detail-view" class="page-container">
    <header class="page-header">
      <div class="header-text">
        <span class="eyebrow">MCP 详情</span>
        <h2 class="page-title">{{ pageTitle }}</h2>
        <p class="page-subtitle">{{ pageSubtitle }}</p>
      </div>
      <div class="header-actions">
        <RouterLink to="/mcp" class="secondary-link">返回列表</RouterLink>
        <template v-if="currentServer && !isEditing">
          <button
            type="button"
            class="secondary-button"
            data-testid="mcp-detail-refresh"
            @click="handleRefresh"
          >
            刷新
          </button>
          <button
            type="button"
            class="secondary-button"
            data-testid="mcp-detail-toggle"
            @click="handleToggle"
          >
            {{ currentServer.enabled ? "停用" : "启用" }}
          </button>
          <button
            type="button"
            class="primary-button"
            data-testid="mcp-detail-edit"
            @click="enterEditMode"
          >
            编辑
          </button>
        </template>
      </div>
    </header>

    <p v-if="saveError" class="error-copy">{{ saveError }}</p>

    <section v-if="isCreate || isEditing" class="detail-card">
      <h3 class="section-title">{{ isCreate ? "新建 MCP 服务" : "编辑 MCP 服务" }}</h3>
      <McpServerForm
        :initial-value="formValue"
        :is-create="isCreate"
        :submit-label="isCreate ? '创建服务' : '保存修改'"
        @submit="handleSave"
        @cancel="handleCancelEdit"
      />
    </section>

    <section v-else-if="!currentServer" class="empty-state">
      <h3>未找到 MCP 服务</h3>
      <p>请返回列表检查所选服务 ID 是否正确。</p>
    </section>

    <template v-else>
      <section class="detail-grid">
        <article class="detail-card">
          <h3 class="section-title">概览</h3>
          <dl class="info-grid">
            <div>
              <dt>服务 ID</dt>
              <dd>{{ currentServer.id }}</dd>
            </div>
            <div>
              <dt>名称</dt>
              <dd>{{ currentServer.name }}</dd>
            </div>
            <div>
              <dt>健康状态</dt>
              <dd>{{ healthLabel }}</dd>
            </div>
            <div>
              <dt>启用状态</dt>
              <dd>{{ currentServer.enabled ? "已启用" : "已停用" }}</dd>
            </div>
          </dl>
        </article>

        <article class="detail-card">
          <h3 class="section-title">连接配置</h3>
          <dl class="info-grid">
            <div>
              <dt>传输方式</dt>
              <dd>{{ currentServer.transport === "http" ? "HTTP" : "STDIO" }}</dd>
            </div>
            <template v-if="currentServer.transport === 'stdio'">
              <div>
                <dt>命令</dt>
                <dd>{{ currentServer.command }}</dd>
              </div>
              <div>
                <dt>参数</dt>
                <dd>{{ (currentServer.args ?? []).join(" ") || "暂无记录" }}</dd>
              </div>
            </template>
            <template v-else>
              <div>
                <dt>URL</dt>
                <dd>{{ currentServer.url }}</dd>
              </div>
              <div>
                <dt>请求头</dt>
                <dd>{{ currentServer.headers ? JSON.stringify(currentServer.headers) : "暂无记录" }}</dd>
              </div>
            </template>
          </dl>
        </article>
      </section>

      <section class="detail-grid">
        <article class="detail-card">
          <h3 class="section-title">工具列表</h3>
          <ul v-if="currentServer.tools.length > 0" class="tool-list">
            <li v-for="tool in currentServer.tools" :key="tool.id" class="tool-item">
              <strong>{{ tool.name }}</strong>
              <p>{{ tool.description }}</p>
            </li>
          </ul>
          <p v-else class="placeholder-copy">暂未发现工具。</p>
        </article>

        <article class="detail-card">
          <h3 class="section-title">运行状态</h3>
          <dl class="info-grid">
            <div>
              <dt>连接状态</dt>
              <dd>{{ currentServer.state?.connected ? "已连接" : "未连接" }}</dd>
            </div>
            <div>
              <dt>工具数量</dt>
              <dd>{{ currentServer.state?.toolCount ?? currentServer.tools.length }}</dd>
            </div>
            <div>
              <dt>最近检查时间</dt>
              <dd>{{ lastCheckedLabel }}</dd>
            </div>
            <div>
              <dt>最近错误</dt>
              <dd>{{ recentErrorLabel }}</dd>
            </div>
          </dl>
        </article>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import type { McpServer, McpServerConfig } from "@myclaw-desktop/shared";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import McpServerForm from "@/components/mcp/McpServerForm.vue";
import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const route = useRoute();
const router = useRouter();

const isEditing = ref(false);
const saveError = ref("");

const serverId = computed(() => String(route.params.id ?? ""));
const isCreate = computed(() => route.name === "mcp-create" || route.path === "/mcp/new");
const currentServer = computed(() => {
  if (isCreate.value) {
    return null;
  }
  return workspace.mcpServers.find((item) => item.id === serverId.value) ?? null;
});
const formValue = computed<McpServerConfig | null>(() => {
  if (!currentServer.value) {
    return null;
  }
  return toServerConfig(currentServer.value);
});
const pageTitle = computed(() => (isCreate.value ? "新建 MCP 服务" : "MCP 服务详情"));
const pageSubtitle = computed(() => (
  isCreate.value
    ? "填写连接方式与基础信息，创建一个新的 MCP 服务。"
    : "查看服务状态、连接配置与已发现工具。"
));
const healthLabel = computed(() => {
  const health = currentServer.value?.state?.health ?? currentServer.value?.health ?? "unknown";
  if (health === "healthy") {
    return "正常";
  }
  if (health === "error") {
    return "异常";
  }
  return "未知";
});
const lastCheckedLabel = computed(() => {
  const value = currentServer.value?.state?.lastCheckedAt ?? currentServer.value?.lastCheckedAt ?? null;
  if (!isValidTimestamp(value)) {
    return "暂无记录";
  }
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
});
const recentErrorLabel = computed(() => {
  const value = currentServer.value?.state?.recentError ?? currentServer.value?.recentError ?? "";
  return safeString(value, "暂无记录");
});

watch(
  () => route.fullPath,
  () => {
    isEditing.value = isCreate.value;
    saveError.value = "";
  },
  { immediate: true },
);

onMounted(() => {
  if (workspace.mcpServers.length > 0) {
    return;
  }

  console.info("[mcp-detail] MCP 服务列表为空，开始加载", {
    serverId: serverId.value,
    isCreate: isCreate.value,
  });
  void workspace.loadMcpServers().catch((error: unknown) => {
    saveError.value = error instanceof Error ? error.message : "加载 MCP 服务失败。";
    console.error("[mcp-detail] 加载 MCP 服务失败", {
      serverId: serverId.value,
      detail: saveError.value,
    });
  });
});

/** 归一化普通字符串。 */
function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

/** 判断时间字符串是否可被安全格式化。 */
function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

/** 把服务快照转换成可提交的 MCP 配置。 */
function toServerConfig(server: McpServer, enabled = server.enabled): McpServerConfig {
  if (server.transport === "http") {
    return {
      id: server.id,
      name: server.name,
      source: server.source,
      enabled,
      transport: "http",
      url: server.url,
      ...(server.headers ? { headers: server.headers } : {}),
    };
  }

  return {
    id: server.id,
    name: server.name,
    source: server.source,
    enabled,
    transport: "stdio",
    command: server.command,
    ...(server.args ? { args: server.args } : {}),
    ...(server.cwd ? { cwd: server.cwd } : {}),
    ...(server.env ? { env: server.env } : {}),
  };
}

/** 进入编辑态。 */
function enterEditMode() {
  console.info("[mcp-detail] 进入 MCP 编辑态", {
    serverId: currentServer.value?.id ?? null,
  });
  isEditing.value = true;
  saveError.value = "";
}

/** 刷新当前 MCP 服务。 */
async function handleRefresh() {
  if (!currentServer.value) {
    return;
  }

  console.info("[mcp-detail] 刷新 MCP 服务", {
    serverId: currentServer.value.id,
  });
  try {
    await workspace.refreshMcpServer(currentServer.value.id);
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "刷新 MCP 服务失败。";
    console.error("[mcp-detail] 刷新 MCP 服务失败", {
      serverId: currentServer.value.id,
      detail: saveError.value,
    });
  }
}

/** 切换当前 MCP 服务启用状态。 */
async function handleToggle() {
  if (!currentServer.value) {
    return;
  }

  console.info("[mcp-detail] 切换 MCP 服务启用状态", {
    serverId: currentServer.value.id,
    enabled: currentServer.value.enabled,
  });
  try {
    await workspace.updateMcpServer(
      currentServer.value.id,
      toServerConfig(currentServer.value, !currentServer.value.enabled),
    );
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "切换 MCP 服务状态失败。";
    console.error("[mcp-detail] 切换 MCP 服务状态失败", {
      serverId: currentServer.value.id,
      detail: saveError.value,
    });
  }
}

/** 取消编辑态，已有服务返回只读，新建页返回列表。 */
function handleCancelEdit() {
  console.info("[mcp-detail] 取消 MCP 编辑", {
    serverId: currentServer.value?.id ?? null,
    isCreate: isCreate.value,
  });
  saveError.value = "";
  if (isCreate.value) {
    void router.push("/mcp");
    return;
  }
  isEditing.value = false;
}

/** 保存 MCP 表单，分别处理新建与更新路径。 */
async function handleSave(config: McpServerConfig) {
  console.info("[mcp-detail] 保存 MCP 服务", {
    serverId: config.id,
    isCreate: isCreate.value,
    transport: config.transport,
  });
  try {
    if (isCreate.value) {
      await workspace.createMcpServer(config);
      await router.push(`/mcp/${encodeURIComponent(config.id)}`);
      return;
    }

    if (!currentServer.value) {
      throw new Error("未找到要更新的 MCP 服务。");
    }

    await workspace.updateMcpServer(currentServer.value.id, config);
    isEditing.value = false;
    saveError.value = "";
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "保存 MCP 服务失败。";
    console.error("[mcp-detail] 保存 MCP 服务失败", {
      serverId: config.id,
      detail: saveError.value,
    });
  }
}
</script>

<style scoped>
.page-container {
  height: 100%;
  overflow-y: auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 24px;
}

.header-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.eyebrow {
  display: inline-block;
  margin-bottom: 8px;
  color: var(--accent-cyan, #67e8f9);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.page-title {
  margin: 0;
  font-size: 28px;
  color: var(--text-primary, #fff);
}

.page-subtitle {
  margin: 10px 0 0;
  max-width: 620px;
  color: var(--text-secondary, #b0b0b8);
  line-height: 1.7;
}

.secondary-link,
.secondary-button,
.primary-button {
  height: 38px;
  border-radius: 10px;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 600;
}

.secondary-link,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  border: 1px solid var(--glass-border, #41414b);
  background: transparent;
  color: var(--text-primary, #fff);
}

.secondary-button {
  cursor: pointer;
}

.primary-button {
  border: none;
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #0891b2);
  cursor: pointer;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.detail-card,
.empty-state,
.error-copy {
  border-radius: 18px;
  border: 1px solid var(--glass-border, #30303a);
  background: var(--bg-card, #18181b);
}

.detail-card {
  padding: 22px;
}

.empty-state,
.error-copy {
  padding: 28px 24px;
}

.empty-state h3,
.section-title {
  margin: 0 0 16px;
  color: var(--text-primary, #fff);
}

.empty-state p,
.placeholder-copy {
  margin: 0;
  color: var(--text-secondary, #b0b0b8);
}

.error-copy {
  margin-bottom: 20px;
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.2);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin: 0;
}

.info-grid dt {
  font-size: 12px;
  color: var(--text-muted, #8d8d97);
  margin-bottom: 8px;
}

.info-grid dd {
  margin: 0;
  color: var(--text-primary, #fff);
  line-height: 1.6;
  word-break: break-word;
}

.tool-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}

.tool-item {
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--glass-border, #2f2f38);
  background: color-mix(in srgb, var(--bg-base, #121214) 88%, transparent);
}

.tool-item strong {
  color: var(--text-primary, #fff);
}

.tool-item p {
  margin: 8px 0 0;
  color: var(--text-secondary, #b0b0b8);
  line-height: 1.6;
}

@media (max-width: 860px) {
  .page-header {
    flex-direction: column;
  }

  .header-actions,
  .detail-grid,
  .info-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<template>
  <main data-testid="mcp-detail-view" class="page-container">
    <header class="page-header">
      <div class="header-text">
        <span class="eyebrow">MCP 详情</span>
        <h2 class="page-title">{{ pageTitle }}</h2>
        <p class="page-subtitle">{{ pageSubtitle }}</p>
      </div>
      <div class="header-actions">
        <RouterLink to="/mcp" class="secondary-link">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
          返回列表
        </RouterLink>
        <template v-if="currentServer && !isEditing">
          <button
            type="button"
            class="secondary-button"
            data-testid="mcp-detail-refresh"
            @click="handleRefresh"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
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

    <p v-if="saveError" class="error-banner">{{ saveError }}</p>

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
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" class="empty-icon"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4M12 16h.01"></path></svg>
      <h3>未找到 MCP 服务</h3>
      <p>请返回列表检查所选服务 ID 是否正确。</p>
    </section>

    <template v-else>
      <!-- 概览 + 连接配置 -->
      <section class="detail-grid">
        <article class="detail-card overview-card">
          <div class="card-head">
            <h3 class="section-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              概览
            </h3>
          </div>
          <dl class="info-grid">
            <div class="info-item">
              <dt>服务 ID</dt>
              <dd class="mono-text">{{ currentServer.id }}</dd>
            </div>
            <div class="info-item">
              <dt>名称</dt>
              <dd>{{ currentServer.name }}</dd>
            </div>
            <div class="info-item">
              <dt>健康状态</dt>
              <dd>
                <span class="inline-badge" :data-health="healthLabelKey">{{ healthLabel }}</span>
              </dd>
            </div>
            <div class="info-item">
              <dt>启用状态</dt>
              <dd>
                <span class="inline-badge" :data-enabled="String(currentServer.enabled)">{{ currentServer.enabled ? "已启用" : "已停用" }}</span>
              </dd>
            </div>
          </dl>
        </article>

        <article class="detail-card connection-card">
          <div class="card-head">
            <h3 class="section-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
              连接配置
            </h3>
          </div>
          <dl class="info-grid">
            <div class="info-item">
              <dt>传输方式</dt>
              <dd>
                <span class="transport-badge">{{ currentServer.transport === "http" ? "HTTP" : "STDIO" }}</span>
              </dd>
            </div>
            <template v-if="currentServer.transport === 'stdio'">
              <div class="info-item">
                <dt>命令</dt>
                <dd class="mono-text">{{ currentServer.command }}</dd>
              </div>
              <div class="info-item full-width">
                <dt>参数</dt>
                <dd class="mono-text">{{ (currentServer.args ?? []).join(" ") || "—" }}</dd>
              </div>
            </template>
            <template v-else>
              <div class="info-item full-width">
                <dt>URL</dt>
                <dd class="mono-text">{{ currentServer.url }}</dd>
              </div>
              <div class="info-item full-width">
                <dt>请求头</dt>
                <dd class="mono-text">{{ currentServer.headers ? JSON.stringify(currentServer.headers, null, 2) : "—" }}</dd>
              </div>
            </template>
          </dl>
        </article>
      </section>

      <!-- 工具列表 + 运行状态 -->
      <section class="detail-grid">
        <article class="detail-card tools-card">
          <div class="card-head">
            <h3 class="section-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
              工具列表
              <span class="tool-count-badge">{{ currentServer.tools.length }}</span>
            </h3>
            <button
              type="button"
              class="sync-button"
              data-testid="mcp-detail-sync-tools"
              :disabled="syncing"
              @click="handleSyncTools"
            >
              <svg :class="{ spinning: syncing }" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
              {{ syncing ? "同步中..." : "同步工具" }}
            </button>
          </div>

          <div v-if="currentServer.tools.length > 0" class="tool-grid">
            <div v-for="tool in currentServer.tools" :key="tool.id" class="tool-card">
              <div class="tool-header">
                <div class="tool-name">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 3h-8l-2 4h12z"></path></svg>
                  {{ tool.name }}
                </div>
                <span class="risk-badge" :data-risk="tool.risk ?? 'unknown'">{{ riskLabel(tool.risk) }}</span>
              </div>
              <p v-if="tool.description" class="tool-desc">{{ tool.description }}</p>
              <div v-if="tool.inputSchema && hasSchemaProperties(tool.inputSchema)" class="tool-schema">
                <div class="schema-header">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>
                  输入参数
                </div>
                <div class="schema-params">
                  <div
                    v-for="(paramDef, paramName) in getSchemaProperties(tool.inputSchema)"
                    :key="String(paramName)"
                    class="param-row"
                  >
                    <span class="param-name">{{ String(paramName) }}</span>
                    <span class="param-type">{{ resolveParamType(paramDef) }}</span>
                    <span v-if="isRequiredParam(tool.inputSchema, String(paramName))" class="param-required">required</span>
                    <span v-if="resolveParamDesc(paramDef)" class="param-desc">{{ resolveParamDesc(paramDef) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="placeholder-state">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" class="placeholder-icon"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
            <p>暂未发现工具，点击"同步工具"尝试重新拉取。</p>
          </div>
        </article>

        <article class="detail-card runtime-card">
          <div class="card-head">
            <h3 class="section-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
              运行状态
            </h3>
          </div>
          <dl class="info-grid">
            <div class="info-item">
              <dt>连接状态</dt>
              <dd>
                <span class="inline-badge" :data-connected="String(currentServer.state?.connected ?? false)">
                  {{ currentServer.state?.connected ? "已连接" : "未连接" }}
                </span>
              </dd>
            </div>
            <div class="info-item">
              <dt>工具数量</dt>
              <dd class="stat-value">{{ currentServer.state?.toolCount ?? currentServer.tools.length }}</dd>
            </div>
            <div class="info-item">
              <dt>最近检查时间</dt>
              <dd>{{ lastCheckedLabel }}</dd>
            </div>
            <div class="info-item full-width">
              <dt>最近错误</dt>
              <dd :class="{ 'error-text': recentErrorLabel !== '—' }">{{ recentErrorLabel }}</dd>
            </div>
          </dl>
        </article>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import type { McpServer, McpServerConfig, McpTool } from "@myclaw-desktop/shared";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import McpServerForm from "@/components/mcp/McpServerForm.vue";
import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const route = useRoute();
const router = useRouter();

const isEditing = ref(false);
const saveError = ref("");
const syncing = ref(false);

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
const healthLabelKey = computed(() => currentServer.value?.state?.health ?? currentServer.value?.health ?? "unknown");
const healthLabel = computed(() => {
  if (healthLabelKey.value === "healthy") {
    return "正常";
  }
  if (healthLabelKey.value === "error") {
    return "异常";
  }
  return "未知";
});
const lastCheckedLabel = computed(() => {
  const value = currentServer.value?.state?.lastCheckedAt ?? currentServer.value?.lastCheckedAt ?? null;
  if (!isValidTimestamp(value)) {
    return "—";
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
  return safeString(value, "—");
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

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function riskLabel(risk: McpTool["risk"]): string {
  if (risk === "low") return "低风险";
  if (risk === "medium") return "中风险";
  if (risk === "high") return "高风险";
  return "未知";
}

function hasSchemaProperties(schema: Record<string, unknown>): boolean {
  const props = schema.properties;
  return Boolean(props && typeof props === "object" && Object.keys(props).length > 0);
}

function getSchemaProperties(schema: Record<string, unknown>): Record<string, unknown> {
  const props = schema.properties;
  if (props && typeof props === "object") {
    return props as Record<string, unknown>;
  }
  return {};
}

function isRequiredParam(schema: Record<string, unknown>, name: string): boolean {
  const required = schema.required;
  return Array.isArray(required) && required.includes(name);
}

function resolveParamType(def: unknown): string {
  if (def && typeof def === "object") {
    const d = def as Record<string, unknown>;
    if (typeof d.type === "string") return d.type;
  }
  return "any";
}

function resolveParamDesc(def: unknown): string {
  if (def && typeof def === "object") {
    const d = def as Record<string, unknown>;
    if (typeof d.description === "string" && d.description.trim()) return d.description.trim();
  }
  return "";
}

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

function enterEditMode() {
  console.info("[mcp-detail] 进入 MCP 编辑态", {
    serverId: currentServer.value?.id ?? null,
  });
  isEditing.value = true;
  saveError.value = "";
}

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

async function handleSyncTools() {
  if (!currentServer.value || syncing.value) {
    return;
  }

  syncing.value = true;
  saveError.value = "";
  console.info("[mcp-detail] 同步 MCP 工具", {
    serverId: currentServer.value.id,
  });
  try {
    await workspace.refreshMcpServer(currentServer.value.id);
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "同步工具失败。";
    console.error("[mcp-detail] 同步工具失败", {
      serverId: currentServer.value.id,
      detail: saveError.value,
    });
  } finally {
    syncing.value = false;
  }
}

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
  padding-bottom: 40px;
}

/* ── Header ─────────────────────────── */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 28px;
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
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.page-title {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
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
  transition: all 0.2s ease;
}

.secondary-link,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-decoration: none;
  border: 1px solid var(--glass-border, #41414b);
  background: transparent;
  color: var(--text-primary, #fff);
}

.secondary-button {
  cursor: pointer;
}

.secondary-link:hover,
.secondary-button:hover {
  border-color: var(--accent-cyan, #67e8f9);
  color: var(--accent-cyan, #67e8f9);
}

.primary-button {
  border: none;
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #0891b2);
  cursor: pointer;
}

.primary-button:hover {
  filter: brightness(1.15);
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(37, 99, 235, 0.35);
}

/* ── Error Banner ───────────────────── */
.error-banner {
  margin: 0 0 20px;
  padding: 14px 18px;
  border-radius: 14px;
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  font-size: 13px;
  line-height: 1.6;
}

/* ── Empty State ────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 56px 24px;
  border-radius: 18px;
  border: 1px dashed var(--glass-border, #3f3f46);
  background: color-mix(in srgb, var(--bg-card, #1b1b20) 70%, transparent);
  text-align: center;
}

.empty-icon {
  color: var(--text-muted, #6b6b76);
}

.empty-state h3 {
  margin: 0;
  color: var(--text-primary, #fff);
}

.empty-state p {
  margin: 0;
  color: var(--text-secondary, #b0b0b8);
}

/* ── Grid Layout ────────────────────── */
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

/* ── Card Base ──────────────────────── */
.detail-card {
  padding: 24px;
  border-radius: 18px;
  border: 1px solid var(--glass-border, #30303a);
  background: var(--bg-card, #18181b);
  transition: border-color 0.2s ease;
}

.detail-card:hover {
  border-color: color-mix(in srgb, var(--accent-primary, #3b82f6) 30%, var(--glass-border, #30303a));
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary, #fff);
}

.section-title svg {
  color: var(--accent-cyan, #67e8f9);
  flex-shrink: 0;
}

/* ── Info Grid (概览/连接/运行) ─────── */
.info-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin: 0;
}

.info-item {
  padding: 12px 14px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-base, #121214) 80%, transparent);
  border: 1px solid var(--glass-border, #28282f);
}

.info-item.full-width {
  grid-column: 1 / -1;
}

.info-item dt {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #8d8d97);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}

.info-item dd {
  margin: 0;
  font-size: 13px;
  color: var(--text-primary, #fff);
  line-height: 1.6;
  word-break: break-word;
}

.mono-text {
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
}

.stat-value {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.error-text {
  color: #fca5a5;
}

/* ── Badges ─────────────────────────── */
.inline-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--glass-border, #3f3f46);
  background: color-mix(in srgb, var(--bg-base, #111214) 80%, transparent);
  color: var(--text-secondary, #b0b0b8);
}

.inline-badge[data-health="healthy"],
.inline-badge[data-connected="true"],
.inline-badge[data-enabled="true"] {
  color: #22c55e;
  border-color: rgba(34, 197, 94, 0.25);
  background: rgba(34, 197, 94, 0.1);
}

.inline-badge[data-health="error"] {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.1);
}

.inline-badge[data-connected="false"],
.inline-badge[data-enabled="false"] {
  color: var(--text-muted, #8d8d97);
}

.transport-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  letter-spacing: 0.04em;
  color: var(--accent-cyan, #67e8f9);
  background: rgba(103, 232, 249, 0.08);
  border: 1px solid rgba(103, 232, 249, 0.18);
}

/* ── Tools Card ─────────────────────── */
.tools-card {
  grid-column: 1 / -1;
}

.tool-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-cyan, #67e8f9);
  background: rgba(103, 232, 249, 0.12);
}

.sync-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--glass-border, #41414b);
  background: transparent;
  color: var(--text-primary, #fff);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.sync-button:hover:not(:disabled) {
  border-color: var(--accent-cyan, #67e8f9);
  color: var(--accent-cyan, #67e8f9);
  background: rgba(103, 232, 249, 0.06);
}

.sync-button:disabled {
  opacity: 0.6;
  cursor: wait;
}

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 14px;
}

.tool-card {
  padding: 18px;
  border-radius: 14px;
  border: 1px solid var(--glass-border, #2a2a32);
  background: color-mix(in srgb, var(--bg-base, #121214) 85%, transparent);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.tool-card:hover {
  border-color: rgba(103, 232, 249, 0.2);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.tool-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.tool-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  color: var(--text-primary, #fff);
}

.tool-name svg {
  color: var(--accent-cyan, #67e8f9);
  flex-shrink: 0;
}

.risk-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--glass-border, #3f3f46);
  background: color-mix(in srgb, var(--bg-base, #111214) 80%, transparent);
  color: var(--text-muted, #8d8d97);
}

.risk-badge[data-risk="low"] {
  color: #22c55e;
  border-color: rgba(34, 197, 94, 0.2);
  background: rgba(34, 197, 94, 0.08);
}

.risk-badge[data-risk="medium"] {
  color: #eab308;
  border-color: rgba(234, 179, 8, 0.2);
  background: rgba(234, 179, 8, 0.08);
}

.risk-badge[data-risk="high"] {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.08);
}

.tool-desc {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--text-secondary, #b0b0b8);
  line-height: 1.65;
}

/* ── Schema Section ─────────────────── */
.tool-schema {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--glass-border, #28282f);
}

.schema-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted, #8d8d97);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 10px;
}

.schema-header svg {
  color: var(--text-muted, #8d8d97);
}

.schema-params {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-base, #0e0e10) 90%, transparent);
}

.param-name {
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
  font-weight: 600;
  color: #93c5fd;
}

.param-type {
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 11px;
  color: #a78bfa;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(167, 139, 250, 0.1);
}

.param-required {
  font-size: 10px;
  font-weight: 700;
  color: #f97316;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.param-desc {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--text-muted, #8d8d97);
  line-height: 1.5;
}

/* ── Placeholder State ──────────────── */
.placeholder-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 36px 20px;
  text-align: center;
}

.placeholder-icon {
  color: var(--text-muted, #6b6b76);
}

.placeholder-state p {
  margin: 0;
  color: var(--text-secondary, #b0b0b8);
  font-size: 13px;
}

/* ── Runtime Card ───────────────────── */
.runtime-card {
  grid-column: 1 / -1;
}

/* ── Responsive ─────────────────────── */
@media (max-width: 860px) {
  .page-header {
    flex-direction: column;
  }

  .header-actions,
  .detail-grid,
  .info-grid {
    grid-template-columns: 1fr;
  }

  .tool-grid {
    grid-template-columns: 1fr;
  }
}
</style>

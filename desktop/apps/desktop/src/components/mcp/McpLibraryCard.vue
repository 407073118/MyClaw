<template>
  <article :data-testid="`mcp-library-card-${safeId}`" class="mcp-card">
    <header class="card-header">
      <div class="title-block">
        <strong class="card-title">{{ safeName }}</strong>
        <p class="card-subtitle">{{ transportLabel }}</p>
      </div>
      <div class="badge-row">
        <span class="status-badge" :data-health="healthLabelKey">{{ healthLabel }}</span>
        <span class="enabled-badge" :data-enabled="String(server.enabled)">{{ enabledLabel }}</span>
      </div>
    </header>

    <dl class="meta-grid">
      <div class="meta-item">
        <dt>工具数</dt>
        <dd :data-testid="`mcp-library-tools-${safeId}`">{{ toolCountLabel }}</dd>
      </div>
      <div class="meta-item">
        <dt>最近检查</dt>
        <dd :data-testid="`mcp-library-last-checked-${safeId}`">{{ lastCheckedLabel }}</dd>
      </div>
    </dl>

    <p v-if="recentErrorLabel" class="error-copy" :data-testid="`mcp-library-error-${safeId}`">
      {{ recentErrorLabel }}
    </p>

    <footer class="card-footer">
      <button
        type="button"
        class="ghost-button"
        :data-testid="`mcp-library-refresh-${safeId}`"
        @click="emitRefresh"
      >
        刷新
      </button>
      <button
        type="button"
        class="ghost-button"
        :data-testid="`mcp-library-toggle-${safeId}`"
        @click="emitToggle"
      >
        {{ toggleLabel }}
      </button>
      <RouterLink :to="detailPath" class="primary-link" :data-testid="`mcp-library-open-${safeId}`">
        查看详情
      </RouterLink>
    </footer>
  </article>
</template>

<script setup lang="ts">
import type { McpServer } from "@myclaw-desktop/shared";
import { computed } from "vue";

const props = defineProps<{
  server: McpServer;
}>();

const emit = defineEmits<{
  (e: "refresh", id: string): void;
  (e: "toggle", id: string): void;
}>();

/** 归一化字符串字段，避免空值直接进入 UI。 */
function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

/** 判断时间字符串是否可被安全格式化。 */
function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

/** 触发刷新事件，并记录当前卡片上下文。 */
function emitRefresh() {
  console.info("[mcp-library-card] 请求刷新 MCP 服务", {
    serverId: safeId.value,
    name: safeName.value,
  });
  emit("refresh", safeId.value);
}

/** 触发启停切换事件，并记录当前卡片状态。 */
function emitToggle() {
  console.info("[mcp-library-card] 请求切换 MCP 服务启用状态", {
    serverId: safeId.value,
    enabled: props.server.enabled,
  });
  emit("toggle", safeId.value);
}

const safeId = computed(() => safeString(props.server?.id, "unknown"));
const safeName = computed(() => safeString(props.server?.name, "未命名 MCP"));
const transportLabel = computed(() => (props.server.transport === "http" ? "HTTP 传输" : "STDIO 传输"));
const enabledLabel = computed(() => (props.server.enabled ? "已启用" : "已停用"));
const toggleLabel = computed(() => (props.server.enabled ? "停用" : "启用"));
const detailPath = computed(() => `/mcp/${encodeURIComponent(safeId.value)}`);
const healthLabelKey = computed(() => props.server.state?.health ?? props.server.health ?? "unknown");
const healthLabel = computed(() => {
  if (healthLabelKey.value === "healthy") {
    return "正常";
  }
  if (healthLabelKey.value === "error") {
    return "异常";
  }
  return "未知";
});
const toolCountLabel = computed(() => String(props.server.state?.toolCount ?? props.server.tools.length ?? 0));
const lastCheckedLabel = computed(() => {
  const value = props.server.state?.lastCheckedAt ?? props.server.lastCheckedAt ?? null;
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
const recentErrorLabel = computed(() => safeString(props.server.state?.recentError ?? props.server.recentError ?? "", ""));
</script>

<style scoped>
.mcp-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 240px;
  padding: 22px;
  border-radius: 18px;
  border: 1px solid var(--glass-border, #30303a);
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--accent-primary, #3b82f6) 12%, transparent), transparent 42%),
    var(--bg-card, #18181b);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.2);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.title-block {
  min-width: 0;
}

.card-title {
  display: block;
  font-size: 18px;
  color: var(--text-primary, #fff);
}

.card-subtitle {
  margin: 8px 0 0;
  color: var(--text-secondary, #b0b0b8);
  font-size: 13px;
}

.badge-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.status-badge,
.enabled-badge {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--glass-border, #3f3f46);
  background: color-mix(in srgb, var(--bg-base, #111214) 80%, transparent);
  color: var(--text-secondary, #b0b0b8);
}

.status-badge[data-health="healthy"] {
  color: #16a34a;
  border-color: rgba(22, 163, 74, 0.25);
  background: rgba(22, 163, 74, 0.12);
}

.status-badge[data-health="error"] {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.12);
}

.enabled-badge[data-enabled="true"] {
  color: var(--text-primary, #fff);
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin: 0;
}

.meta-item {
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--glass-border, #2f2f38);
  background: color-mix(in srgb, var(--bg-base, #121214) 88%, transparent);
}

.meta-item dt {
  font-size: 11px;
  color: var(--text-muted, #8d8d97);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.meta-item dd {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--text-primary, #fff);
}

.error-copy {
  margin: 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  font-size: 13px;
  line-height: 1.5;
}

.card-footer {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: auto;
}

.ghost-button,
.primary-link {
  height: 36px;
  border-radius: 10px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 600;
}

.ghost-button {
  border: 1px solid var(--glass-border, #42424c);
  background: transparent;
  color: var(--text-primary, #fff);
  cursor: pointer;
}

.primary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  color: var(--accent-text, #fff);
  background: linear-gradient(135deg, #2563eb, #0f766e);
}

@media (max-width: 720px) {
  .meta-grid {
    grid-template-columns: 1fr;
  }
}
</style>

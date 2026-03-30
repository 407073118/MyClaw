<template>
  <article :data-testid="`workflow-library-card-${safeId}`" class="workflow-library-card">
    <header class="card-header">
      <div class="title-block">
        <strong class="card-title">{{ safeName }}</strong>
        <p v-if="safeDescription" class="card-description">{{ safeDescription }}</p>
      </div>
      <div class="pill-row">
        <span class="pill status-pill" :data-status="safeStatus" :data-testid="`workflow-library-status-${safeId}`">
          {{ { active: '已启用', draft: '草稿', archived: '已归档' }[safeStatus] || safeStatus }}
        </span>
      </div>
    </header>

    <section class="card-badges" aria-label="Roots" v-if="normalizedRootBadges && normalizedRootBadges.length > 0">
      <span
        v-for="badge in normalizedRootBadges"
        :key="badge.id"
        class="root-badge"
        :data-testid="`workflow-library-root-${safeId}-${badge.id}`"
        :data-active="badge.active ? 'true' : 'false'"
      >
        {{ badge.label }}
      </span>
    </section>

    <footer class="card-footer">
      <dl class="stat-row" aria-label="图表统计">
        <div class="stat">
          <dt>节点数</dt>
          <dd :data-testid="`workflow-library-stat-nodes-${safeId}`">{{ nodeCountLabel }}</dd>
        </div>
        <div class="stat wide">
          <dt>最后更新</dt>
          <dd :data-testid="`workflow-library-stat-updated-${safeId}`">{{ updatedAtLabel }}</dd>
        </div>
      </dl>

      <div class="action-row">
        <button class="icon-btn execute-btn" title="执行工作流" @click="$emit('execute', safeId)" :data-testid="`workflow-library-execute-${safeId}`">
          <Play :size="16" />
        </button>
        <button class="icon-btn delete-btn" title="删除工作流" @click="$emit('delete', safeId)" :data-testid="`workflow-library-delete-${safeId}`">
          <Trash2 :size="16" />
        </button>
        <RouterLink
          :to="`/workflows/${encodeURIComponent(safeId)}`"
          class="open-button"
          :data-testid="`workflow-library-open-${safeId}`"
        >
          <Edit :size="14" />
          编辑
        </RouterLink>
      </div>
    </footer>
  </article>
</template>

<script setup lang="ts">
import type { WorkflowSummary } from "@myclaw-desktop/shared";
import { computed } from "vue";
import { Play, Trash2, Edit } from "lucide-vue-next";

export type WorkflowLibraryRootBadge = {
  id: string;
  label: string;
  active: boolean;
};

const props = defineProps<{
  summary: WorkflowSummary;
  rootBadges?: WorkflowLibraryRootBadge[];
}>();

defineEmits<{
  (e: "execute", id: string): void;
  (e: "delete", id: string): void;
}>();

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function safeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

const safeId = computed(() => safeString(props.summary?.id, "unknown"));
const safeName = computed(() => safeString(props.summary?.name, "未命名工作流"));
const safeDescription = computed(() => safeString(props.summary?.description, ""));
const safeStatus = computed(() => safeString(props.summary?.status, "未知状态"));

const nodeCountLabel = computed(() => {
  const value = safeCount((props.summary as unknown as { nodeCount?: unknown })?.nodeCount);
  return value === null ? "--" : String(value);
});

// Using a friendlier date format
const updatedAtLabel = computed(() => {
  const updatedAt = (props.summary as unknown as { updatedAt?: unknown })?.updatedAt;
  if (!isValidIsoTimestamp(updatedAt)) return "未知时间";
  const d = new Date(updatedAt);
  return d.toLocaleDateString("zh-CN", { month: 'short', day: 'numeric', year: 'numeric' });
});

const normalizedRootBadges = computed<WorkflowLibraryRootBadge[]>(() => {
  if (Array.isArray(props.rootBadges) && props.rootBadges.length > 0) {
    return props.rootBadges
      .filter((badge: WorkflowLibraryRootBadge) => badge && typeof badge.id === "string" && badge.id.trim().length > 0)
      .map((badge: WorkflowLibraryRootBadge) => ({
        id: badge.id,
        label: safeString(badge.label, badge.id),
        active: Boolean(badge.active),
      }));
  }

  const rootId = safeString((props.summary as unknown as { libraryRootId?: unknown })?.libraryRootId, "personal");
  return [{ id: rootId, label: rootId, active: true }];
});
</script>

<style scoped>
.workflow-library-card {
  border: 1px solid var(--glass-border, #27272a);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-card, #1e1e24) 80%, transparent);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(12px);
  position: relative;
  overflow: hidden;
}

.workflow-library-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent-primary, #3b82f6) 0%, transparent 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.workflow-library-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent-primary, #3b82f6) 30%, var(--glass-border, #27272a));
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
}

.workflow-library-card:hover::before {
  opacity: 1;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.title-block {
  min-width: 0;
}

.card-title {
  display: block;
  color: var(--text-primary, #ffffff);
  font-weight: 600;
  font-size: 16px;
  line-height: 1.3;
}

.card-description {
  margin: 6px 0 0;
  color: var(--text-secondary, #a1a1aa);
  font-size: 13px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.pill-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.status-pill {
  border: 1px solid var(--glass-border, #3f3f46);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-primary, #ffffff);
  background: color-mix(in srgb, var(--bg-base, #121214) 86%, transparent);
}

.status-pill[data-status="active"] {
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.2);
  background: rgba(16, 185, 129, 0.05);
}

.status-pill[data-status="draft"] {
  color: #f59e0b;
  border-color: rgba(245, 158, 11, 0.2);
  background: rgba(245, 158, 11, 0.05);
}

.card-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.root-badge {
  border: 1px solid var(--glass-border, #27272a);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary, #a1a1aa);
  background: var(--bg-base, #121214);
}

.root-badge[data-active="true"] {
  color: var(--text-primary, #ffffff);
  background: color-mix(in srgb, var(--accent-primary, #3b82f6) 15%, transparent);
  border-color: color-mix(in srgb, var(--accent-primary, #3b82f6) 30%, transparent);
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--glass-border, #27272a);
}

.stat-row {
  display: flex;
  gap: 18px;
  margin: 0;
  padding: 0;
}

.stat {
  display: grid;
  gap: 4px;
}

.stat dt {
  color: var(--text-muted, #71717a);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.stat dd {
  margin: 0;
  color: var(--text-primary, #ffffff);
  font-size: 13px;
  font-weight: 500;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--glass-border, #3f3f46);
  background: var(--bg-base, #121214);
  color: var(--text-secondary, #a1a1aa);
  cursor: pointer;
  transition: all 0.2s;
}

.icon-btn:hover {
  color: var(--text-primary, #ffffff);
  border-color: var(--text-primary, #ffffff);
}

.icon-btn.execute-btn:hover {
  color: #10b981;
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}

.icon-btn.delete-btn:hover {
  color: #ef4444;
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.open-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary, #ffffff);
  text-decoration: none;
  border: 1px solid var(--glass-border, #3f3f46);
  border-radius: 8px;
  padding: 0 14px;
  height: 32px;
  font-size: 13px;
  font-weight: 500;
  background: var(--bg-base, #121214);
  transition: all 0.2s;
}

.open-button:hover {
  background: color-mix(in srgb, var(--accent-primary, #3b82f6) 15%, var(--bg-base, #121214));
  border-color: color-mix(in srgb, var(--accent-primary, #3b82f6) 40%, var(--glass-border, #3f3f46));
  color: var(--accent-text, #ffffff);
}
</style>

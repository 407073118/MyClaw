<template>
  <section data-testid="workflow-run-panel" class="run-panel">
    <header class="panel-header">
      <div class="header-left">
        <h3 class="panel-title">运行调试</h3>
        <span class="panel-desc">查看运行记录、状态预览及 Checkpoints 时间轴</span>
      </div>
      <div class="header-right">
        <p v-if="panelError" class="error-toast">{{ panelError }}</p>
        <button
          data-testid="workflow-run-start"
          type="button"
          class="btn-primary-run"
          :disabled="isStarting"
          @click="handleStartRun"
        >
          <Play :size="14" />
          启动运行
        </button>
      </div>
    </header>

    <div class="panel-content">
      <aside class="runs-sidebar">
        <header class="sidebar-header">运行历史 ({{ runs.length }})</header>
        <div v-if="isLoadingRuns" class="empty-state">加载中...</div>
        <div v-else-if="runs.length === 0" class="empty-state">暂无记录</div>
        <div v-else class="run-scroll">
          <button
            v-for="run in runs"
            :key="run.id"
            class="run-item"
            :class="{ active: run.id === selectedRunId }"
            @click="selectRun(run.id)"
          >
            <div class="run-item-top">
              <span class="run-id-short">ID: {{ run.id.slice(0, 8) }}</span>
              <span class="run-status-dot" :data-status="run.status"></span>
            </div>
            <div class="run-item-meta">{{ run.updatedAt }}</div>
          </button>
        </div>
      </aside>

      <section class="run-detail">
        <template v-if="activeRunDetail">
          <header class="detail-header">
            <div class="detail-status">
              <span class="status-pill" :data-status="activeRunDetail.run.status">
                {{ activeRunDetail.run.status }}
              </span>
              <span class="detail-run-id">ID: {{ activeRunDetail.run.id }}</span>
            </div>
            <button
              v-if="canResume"
              class="btn-resume"
              :disabled="isResuming"
              @click="handleResumeRun"
            >
              继续执行
            </button>
          </header>

          <div class="detail-grid">
            <div v-if="currentNodeLabels.length" class="detail-card">
              <div class="card-title">当前活跃节点</div>
              <div class="card-body active-nodes">
                {{ currentNodeLabels.join(", ") }}
              </div>
            </div>

            <div v-if="lastError" class="detail-card error">
              <div class="card-title">错误信息</div>
              <div class="card-body">{{ lastError }}</div>
            </div>

            <div class="detail-card">
              <div class="card-title">状态预览 (State)</div>
              <div class="card-body state-grid">
                <div v-if="stateFields.length === 0" class="muted">无状态数据</div>
                <div v-else v-for="field in stateFields" :key="field.key" class="state-row">
                  <span class="field-key">{{ field.label }}:</span>
                  <span class="field-val">{{ field.value }}</span>
                </div>
              </div>
            </div>

            <div class="detail-card timeline">
              <div class="card-title">执行时间轴</div>
              <div class="card-body">
                <WorkflowCheckpointTimeline :definition="definition" :checkpoints="activeRunDetail.checkpoints" />
              </div>
            </div>
          </div>
        </template>
        <div v-else class="empty-detail">
          {{ isLoadingDetail ? '加载详情中...' : '选择一条运行记录查看详情' }}
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { WorkflowDefinition } from "@myclaw-desktop/shared";
import { computed, onMounted, ref, watch } from "vue";
import { Play } from "lucide-vue-next";

import WorkflowCheckpointTimeline from "@/components/workflow/WorkflowCheckpointTimeline.vue";
import { getWorkflowRun, type GetWorkflowRunPayload } from "@/services/runtime-client";
import { useShellStore } from "@/stores/shell";
import { useWorkspaceStore } from "@/stores/workspace";

const props = defineProps<{
  workflowId: string;
  definition: WorkflowDefinition;
}>();

const workspace = useWorkspaceStore();
const shell = useShellStore();
const selectedRunId = ref<string | null>(null);
const activeRunDetail = ref<GetWorkflowRunPayload | null>(null);
const isLoadingRuns = ref(false);
const isLoadingDetail = ref(false);
const isStarting = ref(false);
const isResuming = ref(false);
const panelError = ref("");

const nodeLabels = computed(() => new Map(props.definition.nodes.map((node) => [node.id, node.label] as const)));
const stateSchemaLabels = computed(
  () => new Map(props.definition.stateSchema.map((field) => [field.key, field.label || field.key] as const)),
);
const runs = computed(() => Object.values(workspace.workflowRuns)
  .filter((run) => run.workflowId === props.workflowId)
  .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
const latestCheckpoint = computed(() => {
  const checkpoints = activeRunDetail.value?.checkpoints ?? [];
  return checkpoints.length ? checkpoints[checkpoints.length - 1] : null;
});
const currentNodeLabels = computed(() => {
  const currentNodeIds = activeRunDetail.value?.run.currentNodeIds ?? [];
  return currentNodeIds.map((nodeId) => resolveNodeLabel(nodeId));
});
const lastError = computed(() => {
  const checkpoints = activeRunDetail.value?.checkpoints ?? [];
  return [...checkpoints].reverse().find((checkpoint) => checkpoint.error)?.error ?? "";
});
const stateFields = computed(() => {
  const state = activeRunDetail.value?.run.state ?? {};
  return Object.entries(state).map(([key, value]) => ({
    key,
    label: stateSchemaLabels.value.get(key) ?? key,
    value: formatValue(value),
  }));
});
const canResume = computed(() => {
  if (!activeRunDetail.value) return false;
  const latestStatus = latestCheckpoint.value?.status;
  return activeRunDetail.value.run.status === "waiting-input" || latestStatus === "waiting-human-input";
});

watch(runs, (nextRuns) => {
    if (nextRuns.length === 0) {
      selectedRunId.value = null;
      activeRunDetail.value = null;
      return;
    }
    if (!selectedRunId.value || !nextRuns.some((run) => run.id === selectedRunId.value)) {
      selectedRunId.value = nextRuns[0]!.id;
    }
  },
  { immediate: true },
);

watch(selectedRunId, async (runId) => {
    if (!runId) {
      activeRunDetail.value = null;
      return;
    }
    await loadRunDetail(runId);
  },
  { immediate: true },
);

onMounted(async () => {
  isLoadingRuns.value = true;
  try {
    await workspace.loadWorkflowRuns();
  } catch (error) {
    panelError.value = "加载运行记录失败";
  } finally {
    isLoadingRuns.value = false;
  }
});

function resolveNodeLabel(nodeId: string): string { return nodeLabels.value.get(nodeId) ?? nodeId; }
function formatValue(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value); }

async function loadRunDetail(runId: string) {
  isLoadingDetail.value = true;
  panelError.value = "";
  try {
    activeRunDetail.value = await getWorkflowRun(shell.runtimeBaseUrl, runId);
  } catch (error) {
    panelError.value = "详情加载失败";
    activeRunDetail.value = null;
  } finally {
    isLoadingDetail.value = false;
  }
}

function selectRun(runId: string) { selectedRunId.value = runId; }

async function handleStartRun() {
  isStarting.value = true;
  panelError.value = "";
  try {
    const run = await workspace.startWorkflowRun(props.workflowId);
    selectedRunId.value = run.id;
    await loadRunDetail(run.id);
  } catch (error) {
    panelError.value = "启动失败";
  } finally {
    isStarting.value = false;
  }
}

async function handleResumeRun() {
  const runId = selectedRunId.value ?? activeRunDetail.value?.run.id ?? null;
  if (!runId) return;
  isResuming.value = true;
  try {
    await workspace.resumeWorkflowRun(runId);
    await loadRunDetail(runId);
  } catch (error) {
    panelError.value = "恢复失败";
  } finally {
    isResuming.value = false;
  }
}
</script>

<style scoped>
.run-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0d0d0f;
  color: #a1a1aa;
}

.panel-header {
  height: 48px;
  min-height: 48px;
  border-bottom: 1px solid #27272a;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: #121214;
}

.header-left {
  display: flex;
  align-items: baseline;
  white-space: nowrap;
  overflow: hidden;
  flex: 1;
}

.panel-title {
  font-size: 13px;
  color: #f4f4f5;
  font-weight: 700;
  margin: 0;
  margin-right: 12px;
  flex-shrink: 0;
}

.panel-desc {
  font-size: 11px;
  color: #52525b;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-primary-run {
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-primary-run:hover:not(:disabled) { background: #3b82f6; }
.btn-primary-run:disabled { opacity: 0.5; }

.panel-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.runs-sidebar {
  width: 180px;
  border-right: 1px solid #27272a;
  display: flex;
  flex-direction: column;
  background: #0d0d0f;
}

.sidebar-header {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  color: #71717a;
  text-transform: uppercase;
}

.run-scroll {
  flex: 1;
  overflow-y: auto;
}

.run-item {
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  border-bottom: 1px solid #1c1c1f;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s;
}

.run-item:hover { background: #18181b; }
.run-item.active { background: #1e1e24; border-left: 2px solid #2563eb; }

.run-id-short { font-size: 11px; font-family: monospace; color: #a1a1aa; }
.run-item-top { display: flex; align-items: center; justify-content: space-between; }
.run-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #52525b; }
.run-status-dot[data-status="success"] { background: #10b981; }
.run-status-dot[data-status="running"] { background: #2563eb; }
.run-status-dot[data-status="failed"] { background: #ef4444; }

.run-item-meta { font-size: 10px; color: #52525b; margin-top: 4px; }

.run-detail {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid #27272a;
}

.status-pill {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: #27272a;
  color: #a1a1aa;
}
.status-pill[data-status="success"] { background: rgba(16, 185, 129, 0.1); color: #10b981; }
.status-pill[data-status="failed"] { background: rgba(239, 68, 68, 0.1); color: #f87171; }

.detail-run-id { font-size: 11px; color: #52525b; margin-left: 12px; font-family: monospace; }

.btn-resume { background: #10b981; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; }

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
}

.detail-card {
  background: #161618;
  border: 1px solid #27272a;
  border-radius: 8px;
  padding: 12px;
}

.detail-card.error { border-color: #ef4444; background: rgba(239, 68, 68, 0.05); }
.detail-card.timeline { grid-column: 1 / -1; }

.card-title { font-size: 11px; font-weight: 700; color: #71717a; text-transform: uppercase; margin-bottom: 8px; }
.card-body { font-size: 12px; color: #d4d4d8; }

.state-grid { display: flex; flex-direction: column; gap: 4px; }
.state-row { display: flex; gap: 8px; border-bottom: 1px solid #1c1c1f; padding-bottom: 4px; }
.field-key { color: #52525b; font-weight: 600; width: 100px; flex-shrink: 0; }
.field-val { color: #a1a1aa; word-break: break-all; }

.empty-detail { flex: 1; display: grid; place-items: center; font-size: 12px; color: #52525b; }
.error-toast { color: #ef4444; font-size: 11px; margin: 0; }
</style>

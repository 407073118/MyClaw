<template>
  <main data-testid="workflows-view" class="page-container">
    <header class="page-header">
      <div class="header-text">
        <span class="eyebrow">工作流</span>
        <h2 class="page-title">本地工作流库</h2>
        <p class="page-subtitle">
          在本地 Runtime 上设计、管理和执行可复用的 AI 代理与自动化流程。
        </p>
      </div>
      <div class="header-actions">
        <button class="btn-premium accent new-workflow-btn" @click="showCreateModal = true">
          <Plus class="icon-plus" :size="18" />
          <span>新建工作流</span>
        </button>
      </div>
    </header>

    <section class="library-content">
      <p v-if="loadError" class="error-copy">{{ loadError }}</p>
      <div v-else class="library-list">
        <WorkflowLibraryFilters v-model="filters" />
        <p v-if="filteredWorkflows.length === 0" class="empty-copy">
          当前空间内暂无工作流。创建一个新工作流来开始吧。
        </p>
        <ul v-else class="card-grid" aria-label="Workflow summaries">
          <li v-for="summary in filteredWorkflows" :key="summary.id" class="card-item">
            <WorkflowLibraryCard 
              :summary="summary" 
              @execute="handleExecute(summary.id)"
              @delete="handleDelete(summary.id)"
            />
          </li>
        </ul>
      </div>
    </section>

    <!-- Create Modal Overlay -->
    <Teleport to="body">
      <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
        <div class="modal-content">
          <header class="modal-header">
            <h3>新建工作流</h3>
            <button class="icon-button close-btn" @click="showCreateModal = false">
              <X :size="20" />
            </button>
          </header>
          <form data-testid="workflow-create-form" class="create-form" @submit.prevent="handleCreate">
            <label class="field">
              <span>代码 ID (可选)</span>
              <input
                v-model="draft.code"
                type="text"
                placeholder="weekly-review"
              />
            </label>
            <label class="field">
              <span>名称</span>
              <input
                v-model="draft.name"
                data-testid="workflow-create-name"
                type="text"
                placeholder="我的周报工作流"
              />
            </label>
            <label class="field">
              <span>描述</span>
              <textarea
                v-model="draft.description"
                data-testid="workflow-create-description"
                rows="3"
                placeholder="自动整理每周待办事项并检查状态。"
              />
            </label>
            <p v-if="createError" class="error-copy">{{ createError }}</p>
            <footer class="modal-actions">
              <button class="secondary" type="button" @click="showCreateModal = false">取消</button>
              <button class="primary" type="submit" :disabled="isCreating">确认创建</button>
            </footer>
          </form>
        </div>
      </div>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import type { WorkflowSummary } from "@myclaw-desktop/shared";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Plus, X } from "lucide-vue-next";

import WorkflowLibraryCard from "@/components/workflow/WorkflowLibraryCard.vue";
import WorkflowLibraryFilters, {
  type WorkflowLibraryFilterState,
} from "@/components/workflow/WorkflowLibraryFilters.vue";
import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const router = useRouter();

const isCreating = ref(false);
const showCreateModal = ref(false);
const createError = ref("");
const loadError = ref("");
const draft = reactive({
  code: "",
  name: "",
  description: "",
});

const filters = ref<WorkflowLibraryFilterState>({
  query: "",
  status: "all",
  sort: "updated-desc",
});

function normalizeSummaries(): WorkflowSummary[] {
  const values = Object.values(workspace.workflowSummaries ?? {}) as WorkflowSummary[];
  const cleaned = values.filter((item: WorkflowSummary) => item && typeof item.id === "string" && item.id.trim().length > 0);
  if (cleaned.length > 0) {
    return cleaned;
  }
  return (workspace.workflows as unknown as WorkflowSummary[]).filter(
    (item: WorkflowSummary) => item && typeof item.id === "string" && item.id.trim().length > 0,
  );
}

function safeComparableName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function safeComparableUpdatedAt(value: unknown): number {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : -1;
}

function safeComparableNodeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : -1;
}

const filteredWorkflows = computed(() => {
  const list = normalizeSummaries();
  const query = filters.value.query.trim().toLowerCase();
  const status = filters.value.status;
  const sort = filters.value.sort;

  const filtered = list.filter((summary) => {
    if (status !== "all" && summary.status !== status) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = `${summary.name ?? ""} ${summary.description ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "name-asc") {
      return safeComparableName(a.name).localeCompare(safeComparableName(b.name));
    }
    if (sort === "nodes-desc") {
      return safeComparableNodeCount(b.nodeCount) - safeComparableNodeCount(a.nodeCount);
    }
    return safeComparableUpdatedAt(b.updatedAt) - safeComparableUpdatedAt(a.updatedAt);
  });

  return sorted;
});

onMounted(() => {
  if (workspace.workflows.length > 0 || Object.keys(workspace.workflowSummaries ?? {}).length > 0) {
    return;
  }

  void workspace.loadWorkflows().catch((error: unknown) => {
    loadError.value = error instanceof Error ? error.message : "Load workflows failed.";
  });
});

async function handleExecute(workflowId: string) {
  try {
    const run = await workspace.startWorkflowRun(workflowId);
    console.info(`[workflows] Started workflow run ${run.id}`);
    alert(`Successfully started workflow run: ${run.id}\nYou can monitor it from runtime terminal or logs.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution failed.";
    alert(`Failed to execute workflow: ${message}`);
  }
}

async function handleDelete(workflowId: string) {
  if (!confirm("Are you sure you want to delete this workflow? (Not fully supported by runtime yet)")) return;
  alert(`Delete operation for ${workflowId} called. UI update only for now.`);
  // NOTE: Assuming no deleteWorkflow in workspace yet, so we just remove it locally if needed,
  // but to preserve data integrity, we won't mutate state falsely here.
}

async function handleCreate() {
  if (isCreating.value) return;

  const name = draft.name.trim();
  const description = draft.description.trim();

  if (!name || !description) {
    createError.value = "Name and description are required.";
    return;
  }

  createError.value = "";
  isCreating.value = true;
  let createdWorkflowId = "";
  try {
    console.info("[workflows] Creating workflow", { name });
    const created = await workspace.createWorkflow({ name, description });
    createdWorkflowId = created.id;
    console.info("[workflows] Workflow created, bootstrapping starter graph", { workflowId: created.id });

    // Starter graph with LangGraph style nodes
    await workspace.updateWorkflow(created.id, {
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [{ id: "edge-start-end", fromNodeId: "node-start", toNodeId: "node-end", kind: "normal" }],
    });

    draft.code = "";
    draft.name = "";
    draft.description = "";
    showCreateModal.value = false;
    
    // Auto-navigate to the new workflow studio
    router.push(`/workflows/${encodeURIComponent(createdWorkflowId)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Create workflow failed.";
    createError.value = createdWorkflowId
      ? `Workflow created but starter graph setup failed: ${message}`
      : message;
  } finally {
    isCreating.value = false;
  }
}
</script>

<style scoped>
.library-content {
  width: 100%;
}

.library-list {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.card-item {
  margin: 0;
}

.empty-copy {
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
  padding: 48px;
  background: color-mix(in srgb, var(--bg-card, #1e1e24) 40%, transparent);
  border: 1px dashed var(--glass-border, #333338);
  border-radius: 12px;
}

.error-copy {
  margin: 0;
  color: #ef4444;
  font-size: 14px;
}

/* Modal Styling */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: grid;
  place-items: center;
  padding: 24px;
}

.modal-content {
  background: var(--bg-card, #18181b);
  border: 1px solid var(--glass-border, #27272a);
  border-radius: 16px;
  width: 100%;
  max-width: 460px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  animation: modal-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes modal-pop {
  from { opacity: 0; transform: scale(0.95) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--glass-border, #27272a);
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #ffffff);
}

.icon-button {
  background: transparent;
  border: none;
  color: var(--text-secondary, #a1a1aa);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  transition: all 0.2s;
}

.icon-button:hover {
  background: color-mix(in srgb, var(--text-secondary) 15%, transparent);
  color: var(--text-primary);
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field span {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #a1a1aa);
}

input,
textarea {
  width: 100%;
  border: 1px solid var(--glass-border, #3f3f46);
  border-radius: 8px;
  background: var(--bg-base, #121214);
  color: var(--text-primary, #ffffff);
  padding: 12px 14px;
  font: inherit;
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

input:focus,
textarea:focus {
  outline: none;
  border-color: var(--accent-primary, #3b82f6);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

textarea {
  resize: vertical;
  min-height: 80px;
}

.modal-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 12px;
}

.secondary {
  border: 1px solid var(--glass-border, #3f3f46);
  background: transparent;
  color: var(--text-primary, #ffffff);
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.secondary:hover {
  background: color-mix(in srgb, var(--glass-border) 40%, transparent);
}

.primary {
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  background: var(--accent-primary, #3b82f6);
  color: var(--accent-text, #ffffff);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-primary, #3b82f6) 85%, white);
}

.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .library-page {
    padding: 24px;
  }
  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>

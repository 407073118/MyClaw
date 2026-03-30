<template>
  <main data-testid="publish-draft-view" class="page-container publish-draft-page">
    <header class="page-header">
      <p class="eyebrow">Publish Draft</p>
      <h2>Create a shareable package snapshot</h2>
      <p class="subtitle">
        Capture the manifest that powers your employee or workflow, then publish a lightweight draft that can be
        reviewed or uploaded to the cloud hub later.
      </p>
    </header>

    <section class="publish-card">
      <form data-testid="publish-draft-form" class="publish-form" @submit.prevent="handlePublish">
        <label class="field">
          <span>Package Target</span>
          <select
            data-testid="publish-draft-kind"
            v-model="kind"
            :disabled="isPublishing"
          >
            <option value="employee-package">Employee Package</option>
            <option value="workflow-package">Workflow Package</option>
          </select>
        </label>

        <label class="field">
          <span>Source</span>
          <select
            data-testid="publish-draft-source"
            v-model="sourceId"
            :disabled="isPublishing || sourceOptions.length === 0"
          >
            <option v-if="sourceOptions.length === 0" disabled value="">No items available</option>
            <option v-for="option in sourceOptions" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>Version</span>
          <input
            data-testid="publish-draft-version"
            type="text"
            placeholder="e.g. 1.0.0"
            v-model="version"
            :disabled="isPublishing"
          />
        </label>

        <button
          data-testid="publish-draft-submit"
          class="primary"
          type="submit"
          :disabled="isPublishing || !sourceId"
        >
          {{ isPublishing ? "Publishing…" : "Create publish draft" }}
        </button>
      </form>

      <div class="status-panel">
        <p
          v-if="draftFeedback"
          class="status success"
          data-testid="publish-draft-feedback"
        >
          {{ draftFeedback }}
        </p>
        <p v-else-if="submitError" class="status error" data-testid="publish-draft-error">
          {{ submitError }}
        </p>

        <ul v-if="lastDraft" class="draft-details">
          <li><strong>Id:</strong> {{ lastDraft.id }}</li>
          <li><strong>Kind:</strong> {{ lastDraft.kind }}</li>
          <li><strong>Source:</strong> {{ lastDraft.sourceId }}</li>
          <li><strong>Version:</strong> {{ lastDraft.manifest.version }}</li>
        </ul>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import type { PublishDraftRecord } from "@/services/runtime-client";
import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const kind = ref<"employee-package" | "workflow-package">("employee-package");
const sourceId = ref("");
const version = ref("");
const isPublishing = ref(false);
const submitError = ref("");
const draftFeedback = ref("");
const lastDraft = ref<PublishDraftRecord | null>(null);

const sourceOptions = computed(() => {
  if (kind.value === "employee-package") {
    return workspace.employees.map((item) => ({
      id: item.id,
      label: `${item.name} (${item.status})`,
    }));
  }

  return workspace.workflows.map((item) => ({
    id: item.id,
    label: `${item.name} (${item.status})`,
  }));
});

watch(sourceOptions, (options) => {
  if (!options.length) {
    sourceId.value = "";
    return;
  }

  if (!options.some((option) => option.id === sourceId.value)) {
    sourceId.value = options[0].id;
  }
}, { immediate: true });

watch(kind, () => {
  draftFeedback.value = "";
  submitError.value = "";
  lastDraft.value = null;
  version.value = "";
});

onMounted(() => {
  if (!workspace.employees.length) {
    void workspace.loadEmployees();
  }
  if (!workspace.workflows.length) {
    void workspace.loadWorkflows();
  }
});

/** 根据当前表单内容生成员工包或工作流包的发布草稿。 */
async function handlePublish() {
  if (!sourceId.value.trim() || !version.value.trim()) {
    submitError.value = "Please select a source and specify a version.";
    return;
  }

  isPublishing.value = true;
  submitError.value = "";
  draftFeedback.value = "";

  try {
    const payload = {
      kind: kind.value,
      sourceId: sourceId.value,
      version: version.value.trim(),
    } as const;

    console.info("[publish-draft-view] 开始创建发布草稿", payload);
    const { draft } = await workspace.createPublishDraft(payload);
    lastDraft.value = draft;
    draftFeedback.value = `Draft "${draft.id}" staged at ${draft.filePath}`;
    console.info("[publish-draft-view] 发布草稿创建完成", {
      id: draft.id,
      kind: draft.kind,
      sourceId: draft.sourceId,
      filePath: draft.filePath,
    });
    version.value = "";
  } catch (error) {
    console.error("[publish-draft-view] 发布草稿创建失败", error);
    submitError.value = error instanceof Error ? error.message : "Failed to create publish draft.";
  } finally {
    isPublishing.value = false;
  }
}
</script>

<style scoped>
.publish-draft-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 40px 48px;
}

.page-header {
  max-width: 720px;
}

.publish-card {
  border-radius: var(--radius-lg);
  padding: 32px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(14, 165, 233, 0.06));
  border: 1px solid var(--glass-border);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
}

.publish-form {
  display: grid;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text-secondary);
}

.field span {
  font-weight: 600;
}

select,
input {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  padding: 10px 12px;
  font: inherit;
  color: var(--text-primary);
}

button.primary {
  border: none;
  background: var(--accent-primary);
  color: var(--accent-text);
  padding: 12px 18px;
  border-radius: 999px;
  font-weight: 600;
  cursor: pointer;
}

button.primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.status-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.status {
  margin: 0;
  font-size: 0.95rem;
}

.status.success {
  color: #155724;
}

.status.error {
  color: #b83333;
}

.draft-details {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.draft-details strong {
  color: var(--text-primary);
}

@media (max-width: 768px) {
  .publish-draft-page {
    padding: 24px;
  }
}
</style>

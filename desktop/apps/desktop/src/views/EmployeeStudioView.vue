<template>
  <main data-testid="employee-studio-view" class="page-container studio-page">
    <header class="page-header">
      <p class="eyebrow">Employee Studio</p>
      <h2>{{ draft.name || employee?.name || "Employee Studio" }}</h2>
      <p class="subtitle">
        Role card, workflow bindings, SOP, memory, and pending work all stay attached to the same employee unit.
      </p>
    </header>

    <section class="studio-grid">
      <form data-testid="employee-studio-save" class="studio-card studio-form" @submit.prevent="handleSave">
        <h3>Role Card</h3>
        <label class="field">
          <span>Name</span>
          <input v-model="draft.name" data-testid="employee-studio-name" type="text" />
        </label>
        <label class="field">
          <span>Description</span>
          <textarea v-model="draft.description" data-testid="employee-studio-description" rows="4" />
        </label>
        <label class="field">
          <span>Status</span>
          <select v-model="draft.status" data-testid="employee-studio-status">
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="archived">archived</option>
          </select>
        </label>

        <div class="binding-row">
          <label class="field binding-field">
            <span>Bind Workflow</span>
            <select v-model="selectedWorkflowId" data-testid="employee-studio-workflow-select">
              <option value="">Select workflow</option>
              <option v-for="workflow in workspace.workflows" :key="workflow.id" :value="workflow.id">
                {{ workflow.name }}
              </option>
            </select>
          </label>
          <button
            data-testid="employee-studio-bind-workflow"
            class="secondary"
            type="button"
            @click="bindWorkflow"
          >
            Bind
          </button>
        </div>

        <ul v-if="draft.workflowIds.length > 0" class="binding-list">
          <li v-for="workflowId in draft.workflowIds" :key="workflowId">{{ workflowId }}</li>
        </ul>

        <p v-if="saveError" class="error-copy">{{ saveError }}</p>
        <button class="primary" type="submit" :disabled="isSaving">Save Employee</button>
      </form>

      <aside class="studio-sidebar">
        <section class="studio-card">
          <h3>SOP summary</h3>
          <p>Capture the role card and checklist here before expanding into full SOP editing.</p>
        </section>
        <section class="studio-card">
          <h3>Memory summary</h3>
          <p>Recent employee memory snapshots will appear here once runs begin writing back context.</p>
        </section>
        <section class="studio-card">
          <h3>Pending work summary</h3>
          <p>Future follow-ups and heartbeat-resumable commitments will be surfaced in this panel.</p>
        </section>
      </aside>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { useWorkspaceStore } from "@/stores/workspace";

const route = useRoute();
const workspace = useWorkspaceStore();
const isSaving = ref(false);
const saveError = ref("");
const selectedWorkflowId = ref("");
const draft = reactive({
  name: "",
  description: "",
  status: "draft" as "draft" | "active" | "archived",
  source: "personal" as "personal" | "enterprise" | "hub",
  workflowIds: [] as string[],
});

const employeeId = computed(() => String(route.params.id ?? ""));
const employee = computed(() => workspace.employees.find((item) => item.id === employeeId.value) ?? null);

function syncDraft() {
  if (!employee.value) {
    return;
  }

  draft.name = employee.value.name;
  draft.description = employee.value.description;
  draft.status = employee.value.status;
  draft.source = employee.value.source;
  draft.workflowIds = [...employee.value.workflowIds];
}

watch(employee, () => {
  syncDraft();
}, { immediate: true });

onMounted(async () => {
  if (!employee.value && employeeId.value) {
    await workspace.loadEmployeeById(employeeId.value);
  }
  if (workspace.workflows.length === 0) {
    await workspace.loadWorkflows();
  }
});

function bindWorkflow() {
  if (!selectedWorkflowId.value || draft.workflowIds.includes(selectedWorkflowId.value)) {
    return;
  }

  draft.workflowIds = [...draft.workflowIds, selectedWorkflowId.value];
}

async function handleSave() {
  if (!employeeId.value) {
    return;
  }

  saveError.value = "";
  isSaving.value = true;
  try {
    await workspace.updateEmployee(employeeId.value, {
      name: draft.name.trim(),
      description: draft.description.trim(),
      status: draft.status,
      source: draft.source,
      workflowIds: [...draft.workflowIds],
    });
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "Save employee failed.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<style scoped>
.studio-page {
  padding: 40px 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-header {
  max-width: 760px;
}

.eyebrow {
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 8px;
}

h2 {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
}

.studio-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
  gap: 20px;
}

.studio-form,
.studio-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.studio-card {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  padding: 20px;
}

h3 {
  margin: 0 0 12px;
  color: var(--text-primary);
  font-size: 17px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text-secondary);
}

input,
textarea,
select {
  width: 100%;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  color: var(--text-primary);
  padding: 10px 12px;
  font: inherit;
}

.binding-row {
  display: flex;
  gap: 12px;
  align-items: end;
}

.binding-field {
  flex: 1;
}

.binding-list {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
}

.primary,
.secondary {
  border-radius: 999px;
  padding: 10px 14px;
  font: inherit;
  cursor: pointer;
}

.primary {
  border: none;
  background: var(--accent-primary);
  color: var(--accent-text);
}

.secondary {
  border: 1px solid var(--glass-border);
  background: transparent;
  color: var(--text-primary);
}

.error-copy {
  margin: 0;
  color: #b83333;
}

@media (max-width: 960px) {
  .studio-page {
    padding: 24px;
  }

  .studio-grid {
    grid-template-columns: 1fr;
  }
}
</style>

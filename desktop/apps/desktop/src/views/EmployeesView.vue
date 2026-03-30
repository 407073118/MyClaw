<template>
  <main data-testid="employees-view" class="page-container">
    <header class="page-header">
      <div class="header-text">
        <span class="eyebrow">Employees</span>
        <h2 class="page-title">Employees</h2>
        <p class="page-subtitle">
          Platform library for silicon employees. This surface will host local instances, installs, and activation flows.
        </p>
      </div>
    </header>

    <section class="library-content">
      <article class="create-card">
        <h3>Create Employee</h3>
        <form data-testid="employee-create-form" class="create-form" @submit.prevent="handleCreate">
          <label class="field">
            <span>Name</span>
            <input
              v-model="draft.name"
              data-testid="employee-create-name"
              type="text"
              placeholder="Research Assistant"
            />
          </label>
          <label class="field">
            <span>Description</span>
            <textarea
              v-model="draft.description"
              data-testid="employee-create-description"
              rows="3"
              placeholder="Tracks recurring checks and summaries."
            />
          </label>
          <p v-if="createError" class="error-copy">{{ createError }}</p>
          <button class="primary" type="submit" :disabled="isCreating">Create Employee</button>
        </form>
      </article>

      <article class="list-card">
        <h3>Local Employees</h3>
        <p v-if="loadError" class="error-copy">{{ loadError }}</p>
        <p v-else-if="workspace.employees.length === 0" class="empty-copy">
          No employees yet. Create one to start role-based automation.
        </p>
        <ul v-else class="library-list">
          <li
            v-for="employee in workspace.employees"
            :key="employee.id"
            :data-testid="`employee-card-${employee.id}`"
            class="library-item"
          >
            <div class="item-header">
              <strong>{{ employee.name }}</strong>
              <span class="meta-pill">{{ employee.status }}</span>
            </div>
            <p class="item-summary">{{ employee.description }}</p>
            <div class="item-footer">
              <span class="meta-pill">{{ employee.source }}</span>
              <RouterLink
                :to="`/employees/${employee.id}`"
                :data-testid="`employee-open-${employee.id}`"
                class="open-link"
              >
                Open Studio
              </RouterLink>
            </div>
          </li>
        </ul>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";

import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const isCreating = ref(false);
const createError = ref("");
const loadError = ref("");
const draft = reactive({
  name: "",
  description: "",
});

onMounted(() => {
  if (workspace.employees.length > 0) {
    return;
  }

  void workspace.loadEmployees().catch((error: unknown) => {
    loadError.value = error instanceof Error ? error.message : "Load employees failed.";
  });
});

async function handleCreate() {
  const name = draft.name.trim();
  const description = draft.description.trim();

  if (!name || !description) {
    createError.value = "Name and description are required.";
    return;
  }

  createError.value = "";
  isCreating.value = true;
  try {
    await workspace.createEmployee({ name, description });
    draft.name = "";
    draft.description = "";
  } catch (error) {
    createError.value = error instanceof Error ? error.message : "Create employee failed.";
  } finally {
    isCreating.value = false;
  }
}
</script>

<style scoped>
.library-content {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 20px;
}

.create-card,
.list-card {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  padding: 20px;
}

h3 {
  margin: 0 0 14px;
  color: var(--text-primary);
  font-size: 17px;
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text-secondary);
}

input,
textarea {
  width: 100%;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  color: var(--text-primary);
  padding: 10px 12px;
  font: inherit;
}

.primary {
  border: none;
  border-radius: 999px;
  padding: 10px 14px;
  background: var(--accent-primary);
  color: var(--accent-text);
  font: inherit;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.library-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.library-item {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item-header,
.item-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.item-summary,
.empty-copy {
  color: var(--text-secondary);
  margin: 0;
}

.meta-pill {
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-primary);
}

.open-link {
  color: var(--text-primary);
  text-decoration: none;
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
}

.error-copy {
  margin: 0;
  color: #b83333;
}

@media (max-width: 900px) {
  .library-page {
    padding: 24px;
  }

  .library-content {
    grid-template-columns: 1fr;
  }
}
</style>

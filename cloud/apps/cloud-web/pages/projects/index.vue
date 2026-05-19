<script setup lang="ts">
import type {
  CreateProjectInput,
  ProjectDetail,
  ProjectSummary,
} from "@myclaw-cloud/shared";

type ProjectFormState = {
  code: string;
  description: string;
  name: string;
  ownerAccount: string;
  status: ProjectSummary["status"];
};

const STATUS_LABELS: Record<ProjectSummary["status"], string> = {
  active: "维护中",
  archived: "已归档"
};

const { user } = useCloudSession();
const keyword = ref("");
const isProjectModalOpen = ref(false);
const savePending = ref(false);
const formError = ref("");

const projectForm = reactive<ProjectFormState>(createEmptyProjectForm());

const { data, pending, refresh } = await useFetch<{ items: ProjectSummary[] }>("/api/projects", {
  default: () => ({ items: [] })
});

const projects = computed(() => data.value.items);
const filteredProjects = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  if (!value) {
    return projects.value;
  }

  return projects.value.filter((project) => {
    return [project.name, project.code, project.ownerAccount, project.description ?? ""]
      .some((text) => text.toLowerCase().includes(value));
    });
});

const activeProjectCount = computed(() => projects.value.filter((project) => project.status === "active").length);
const repositoryTotal = computed(() => projects.value.reduce((total, project) => total + project.repositoryCount, 0));
const apiTotal = computed(() => projects.value.reduce((total, project) => total + project.apiCount, 0));
const capabilityTotal = computed(() =>
  projects.value.reduce((total, project) => total + project.skillCount + project.mcpCount, 0)
);

/** 中文说明：创建空项目表单，保证新建入口使用稳定默认值。 */
function createEmptyProjectForm(): ProjectFormState {
  console.info("[项目维护] 创建空项目表单");
  return {
    code: "",
    description: "",
    name: "",
    ownerAccount: user.value?.account ?? "",
    status: "active"
  };
}

/** 中文说明：打开新建项目弹窗，并重置表单状态。 */
function openCreateProject() {
  console.info("[项目维护] 打开新建项目弹窗");
  formError.value = "";
  Object.assign(projectForm, createEmptyProjectForm());
  isProjectModalOpen.value = true;
}

/** 中文说明：关闭项目维护弹窗，并清理错误提示。 */
function closeProjectModal() {
  console.info("[项目维护] 关闭新建项目弹窗");
  isProjectModalOpen.value = false;
  formError.value = "";
}

/** 中文说明：提交项目新建表单，并在创建成功后进入项目详情页继续维护。 */
async function handleSaveProject() {
  console.info("[项目维护] 开始创建项目", { code: projectForm.code, name: projectForm.name });
  savePending.value = true;
  formError.value = "";

  try {
    const saved = await $fetch<ProjectDetail>("/api/projects", {
      method: "POST",
      body: buildCreateProjectPayload()
    });

    console.info("[项目维护] 项目创建成功，准备进入详情页", { projectId: saved.id, code: saved.code });
    await refresh();
    closeProjectModal();
    await navigateTo(`/projects/${saved.id}`);
  } catch (error: any) {
    formError.value = error?.data?.statusMessage || error?.statusMessage || error?.message || "项目创建失败，请检查表单内容。";
    console.error("[项目维护] 项目创建失败", { error });
  } finally {
    savePending.value = false;
    console.info("[项目维护] 创建项目流程结束");
  }
}

/** 中文说明：构建创建项目请求体，并做最小必填校验。 */
function buildCreateProjectPayload(): CreateProjectInput {
  console.info("[项目维护] 构建创建项目请求体", { code: projectForm.code, name: projectForm.name });
  return {
    code: requireText(projectForm.code, "项目代码"),
    name: requireText(projectForm.name, "项目名称"),
    description: requireText(projectForm.description, "项目说明"),
    ownerAccount: requireText(projectForm.ownerAccount, "负责人"),
    status: projectForm.status,
    createdBy: resolveOperatorAccount()
  };
}

/** 中文说明：校验必填文本字段，并返回裁剪后的值。 */
function requireText(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    console.warn("[项目维护] 必填字段为空", { label });
    throw new Error(`${label}不能为空。`);
  }
  return trimmed;
}

/** 中文说明：解析当前操作人账号，写入创建人与更新人字段。 */
function resolveOperatorAccount(): string {
  const account = user.value?.account || projectForm.ownerAccount.trim() || "cloud-admin";
  console.info("[项目维护] 解析当前操作人", { account });
  return account;
}

/** 中文说明：将后端时间字符串格式化为中文日期，便于列表和详情阅读。 */
function formatDate(dateStr: string): string {
  console.info("[项目维护] 格式化项目列表日期", { dateStr });
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return "未知";
  }
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

useHead({
  title: "项目维护 | MyClaw Cloud"
});
</script>

<template>
  <main class="nuxt-projects-page">
    <div class="content-container">
      <section class="page-header">
        <div class="header-main">
          <h2>项目 <span class="dim">维护</span></h2>
          <p class="header-desc">维护项目、仓库、融智链、接口和能力包接入关系</p>
        </div>
        <button class="action-btn-primary" type="button" @click="openCreateProject">新建项目</button>
      </section>

      <div class="toolbar">
        <div class="search-bar-nx">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input v-model="keyword" type="text" placeholder="搜索项目、代码或负责人" />
        </div>
        <div class="project-summary-row">
          <span>{{ projects.length }} 个项目</span>
          <span>{{ activeProjectCount }} 个维护中</span>
          <span>{{ repositoryTotal }} 个仓库</span>
          <span>{{ apiTotal }} 个接口</span>
          <span>{{ capabilityTotal }} 个能力挂载</span>
        </div>
      </div>

      <div v-if="pending" class="state-container">
        <div class="pulse-loader-nx"></div>
        <p>正在加载项目列表...</p>
      </div>

      <section v-else class="projects-layout">
        <div class="project-card-grid">
          <NuxtLink
            v-for="project in filteredProjects"
            :key="project.id"
            :to="`/projects/${project.id}`"
            class="project-card-nx glass-card-nx"
          >
            <div class="card-top">
              <span class="project-code">{{ project.code }}</span>
              <span class="status-pill" :class="project.status">{{ STATUS_LABELS[project.status] }}</span>
            </div>
            <h4>{{ project.name }}</h4>
            <p class="text-truncate-multi">{{ project.description || "暂无项目说明。" }}</p>
            <div class="metric-grid">
              <span>{{ project.repositoryCount }} 仓库</span>
              <span>{{ project.apiCount }} 接口</span>
              <span>{{ project.skillCount }} Skills</span>
              <span>{{ project.mcpCount }} MCP</span>
            </div>
            <div class="project-card-foot">
              <span>{{ project.ownerAccount }}</span>
              <span>{{ formatDate(project.updatedAt) }}</span>
            </div>
            <span class="card-action-nx">
              查看详情
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14" />
                <path d="m13 5 7 7-7 7" />
              </svg>
            </span>
          </NuxtLink>

          <div v-if="!filteredProjects.length" class="empty-card glass-card-nx">没有找到匹配的项目。</div>
        </div>

      </section>

      <Teleport to="body">
        <div v-if="isProjectModalOpen" class="modal-overlay">
          <div class="project-modal glass-card-nx" role="dialog" aria-modal="true" aria-labelledby="project-modal-title">
            <header class="modal-header">
              <h3 id="project-modal-title">新建项目</h3>
              <button type="button" class="close-btn" @click="closeProjectModal">&times;</button>
            </header>

            <form class="project-form" @submit.prevent="handleSaveProject">
              <p class="form-hint">新建后进入项目详情，再编辑仓库、接口、Skills 和 MCP。</p>

              <div class="form-grid">
                <div class="form-group">
                  <label>项目代码</label>
                  <input v-model="projectForm.code" type="text" required />
                </div>
                <div class="form-group">
                  <label>项目名称</label>
                  <input v-model="projectForm.name" type="text" required />
                </div>
                <div class="form-group">
                  <label>负责人</label>
                  <input v-model="projectForm.ownerAccount" type="text" required />
                </div>
                <div class="form-group">
                  <label>状态</label>
                  <select v-model="projectForm.status">
                    <option value="active">维护中</option>
                    <option value="archived">已归档</option>
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label>项目说明</label>
                <textarea v-model="projectForm.description" rows="2" required></textarea>
              </div>

              <p v-if="formError" class="status-msg error">{{ formError }}</p>

              <div class="modal-actions">
                <button type="button" class="ghost-btn" @click="closeProjectModal">取消</button>
                <button type="submit" class="action-btn-primary" :disabled="savePending">
                  {{ savePending ? "正在创建..." : "创建项目" }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Teleport>
    </div>
  </main>
</template>

<style scoped>
.nuxt-projects-page { position: relative; min-height: calc(100vh - 64px); background: var(--bg-main); width: 100%; }
.content-container { position: relative; z-index: 10; max-width: 1440px; margin: 0 auto; padding: 40px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; gap: 24px; }
.header-main { display: flex; flex-direction: column; gap: 6px; }
.header-main h2 { font-size: 1.75rem; font-weight: 900; color: var(--text-main); letter-spacing: 0; margin: 0; }
.header-main h2 .dim { color: var(--text-dim); }
.header-desc { margin: 0; color: var(--text-muted); font-size: 0.925rem; }
.action-btn-primary { height: 40px; background: var(--nuxt-green); color: var(--btn-text); border: none; border-radius: 10px; padding: 0 20px; font-weight: 850; font-size: 0.875rem; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: 0.2s; white-space: nowrap; text-decoration: none; }
.action-btn-primary:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.1); }
.action-btn-primary:disabled { opacity: 0.6; cursor: wait; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 20px; }
.search-bar-nx { position: relative; flex: 1; max-width: 480px; }
.search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--text-dim); pointer-events: none; }
.search-bar-nx input { width: 100%; height: 44px; border-radius: 12px; border: 1px solid var(--border-main); background: var(--bg-input); color: var(--text-main); padding: 0 14px 0 40px; box-sizing: border-box; }
.project-summary-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; color: var(--text-dim); font-size: 0.8125rem; font-weight: 800; }
.project-summary-row span { border: 1px solid var(--border-main); border-radius: 999px; padding: 6px 10px; background: var(--bg-input); }
.projects-layout { width: 100%; }
.project-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; }
.project-card-nx { padding: 22px; display: flex; flex-direction: column; gap: 14px; border-radius: 16px; color: inherit; text-decoration: none; transition: border-color 0.2s, background 0.2s, transform 0.2s; }
.project-card-nx:hover { border-color: rgba(var(--nuxt-green-rgb), 0.38); background: rgba(var(--nuxt-green-rgb), 0.07); transform: translateY(-1px); }
.card-top, .project-card-foot { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
.project-card-nx h4 { margin: 0; color: var(--text-main); font-size: 1rem; font-weight: 900; }
.text-truncate-multi { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 42px; margin: 0; color: var(--text-muted); font-size: 0.875rem; line-height: 1.55; }
.project-code { text-transform: uppercase; font-size: 0.72rem; font-weight: 850; color: var(--text-dim); }
.status-pill { display: inline-flex; align-items: center; width: fit-content; border: 1px solid rgba(var(--nuxt-green-rgb), 0.24); border-radius: 999px; color: var(--nuxt-green); background: rgba(var(--nuxt-green-rgb), 0.08); padding: 4px 10px; font-size: 0.72rem; font-weight: 850; white-space: nowrap; }
.status-pill.archived { color: var(--text-dim); border-color: var(--border-main); background: var(--bg-input); }
.metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.metric-grid span { border: 1px solid var(--border-muted); border-radius: 10px; background: var(--bg-input); padding: 8px 10px; color: var(--text-muted); font-size: 0.8125rem; font-weight: 800; }
.project-card-foot { color: var(--text-dim); font-size: 0.8125rem; }
.card-action-nx { display: inline-flex; align-items: center; gap: 8px; width: fit-content; min-height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(var(--nuxt-green-rgb), 0.24); background: rgba(var(--nuxt-green-rgb), 0.1); color: var(--nuxt-green); font-size: 0.78rem; font-weight: 850; transition: background 0.2s, border-color 0.2s, color 0.2s; }
.card-action-nx svg { width: 14px; height: 14px; }
.project-card-nx:hover .card-action-nx { background: rgba(var(--nuxt-green-rgb), 0.16); border-color: rgba(var(--nuxt-green-rgb), 0.35); color: var(--text-main); }
.ghost-btn { height: 34px; border-radius: 8px; padding: 0 14px; font-weight: 850; font-size: 0.8125rem; cursor: pointer; transition: 0.2s; }
.ghost-btn { border: 1px solid var(--border-main); background: transparent; color: var(--text-muted); }
.ghost-btn:hover { transform: translateY(-1px); }
.empty-card { padding: 28px; color: var(--text-muted); }
.empty-state { padding: 24px 0; }
.state-container { padding: 100px 0; display: flex; flex-direction: column; align-items: center; gap: 20px; color: var(--text-dim); }
.pulse-loader-nx { width: 40px; height: 40px; border: 4px solid var(--border-muted); border-top-color: var(--nuxt-green); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.78); backdrop-filter: blur(8px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; }
.project-modal { width: min(980px, 100%); max-height: calc(100vh - 40px); overflow-y: auto; padding: 32px; border-radius: 16px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.modal-header h3 { margin: 0; color: var(--text-main); font-size: 1.35rem; font-weight: 900; }
.close-btn { background: none; border: none; color: var(--text-dim); font-size: 1.5rem; cursor: pointer; }
.project-form { display: flex; flex-direction: column; gap: 18px; }
.form-hint { margin: 0; padding: 12px 14px; border: 1px solid rgba(var(--nuxt-green-rgb), 0.18); border-radius: 10px; background: rgba(var(--nuxt-green-rgb), 0.07); color: var(--text-muted); font-size: 0.875rem; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.form-group { display: flex; flex-direction: column; gap: 8px; }
.form-group.wide { grid-column: span 2; }
.form-group label { font-size: 0.75rem; font-weight: 900; color: var(--text-muted); text-transform: uppercase; }
.form-group input, .form-group textarea, .form-group select { width: 100%; border: 1px solid var(--border-main); border-radius: 10px; background: var(--bg-input); color: var(--text-main); padding: 12px 14px; font-family: inherit; box-sizing: border-box; }
.form-group input, .form-group select { height: 42px; }
.form-group input:disabled { opacity: 0.65; cursor: not-allowed; }
.form-group textarea { resize: vertical; line-height: 1.55; }
.form-group input:focus, .form-group textarea:focus, .form-group select:focus { outline: none; border-color: var(--nuxt-green); }
.form-section { border-top: 1px solid var(--border-muted); padding-top: 18px; display: flex; flex-direction: column; gap: 12px; }
.form-section.two-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.form-section.two-columns > div { display: flex; flex-direction: column; gap: 12px; }
.status-msg { padding: 12px; border-radius: 8px; font-size: 0.875rem; font-weight: 750; }
.status-msg.error { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
.modal-actions { display: flex; justify-content: flex-end; gap: 12px; padding-top: 6px; }
@media (max-width: 1180px) { .project-card-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); } }
@media (max-width: 780px) {
  .content-container { padding: 24px; }
  .page-header, .toolbar { flex-direction: column; align-items: stretch; }
  .project-summary-row { justify-content: flex-start; }
  .project-card-grid, .form-grid { grid-template-columns: 1fr; }
  .form-group.wide { grid-column: auto; }
}
</style>

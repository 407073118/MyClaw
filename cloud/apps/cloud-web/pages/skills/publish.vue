<script setup lang="ts">
import type { SkillDetail, SkillCategory, CreateSkillInput } from "@myclaw-cloud/shared";

const SKILL_CATEGORIES: { value: SkillCategory; label: string }[] = [
  { value: "ai-assistant", label: "AI 助手" },
  { value: "data-analysis", label: "数据分析" },
  { value: "dev-tools", label: "开发工具" },
  { value: "writing", label: "文档写作" },
  { value: "productivity", label: "效率工具" },
  { value: "design", label: "设计创意" },
  { value: "education", label: "教育学习" },
  { value: "other", label: "其他" },
];

const route = useRoute();
const { user: currentUser } = useCloudSession();

// ---------- 模式识别 ----------
const existingSkillId = computed(() => (route.query.id as string) || "");
const isEditMode = computed(() => !!existingSkillId.value);

// ---------- 表单状态 ----------
const form = reactive({
  id: "",
  name: "",
  summary: "",
  description: "",
  category: "other" as SkillCategory,
  tags: "",
  author: currentUser.value?.displayName || currentUser.value?.account || "",
  version: "0.1.0",
  entryFile: "SKILL.md",
  releaseNotes: "Initial release",
  readme: "",
});

const isPending = ref(false);
const errorMsg = ref("");
const successMsg = ref("");
const artifactFile = ref<File | null>(null);
const existingSkill = ref<SkillDetail | null>(null);
const isLoading = ref(false);

// ---------- 记录原始元数据，便于判断是否发生修改 ----------
const originalMeta = ref<Record<string, any>>({});

/** 记录技能原始元数据，便于后续判断是否发生编辑。 */
function captureOriginalMeta(skill: SkillDetail) {
  originalMeta.value = {
    name: skill.name,
    summary: skill.summary,
    description: skill.description,
    category: skill.category || "other",
    tags: (skill.tags || []).join(", "),
    author: skill.author || "",
  };
}

const metadataChanged = computed(() => {
  if (!isEditMode.value) return false;
  const fields = ["name", "summary", "description", "category", "tags", "author"] as const;
  return fields.some((f) => (form as any)[f] !== originalMeta.value[f]);
});

// ---------- 编辑模式下加载已有技能 ----------
watch(
  existingSkillId,
  async (id) => {
    if (!id) return;
    isLoading.value = true;
    errorMsg.value = "";
    try {
      const skill = await $fetch<SkillDetail>(`/api/skills/${id}`);
      existingSkill.value = skill;
      // 预填当前技能信息到表单。
      form.id = skill.id;
      form.name = skill.name;
      form.summary = skill.summary;
      form.description = skill.description;
      form.category = skill.category || "other";
      form.tags = (skill.tags || []).join(", ");
      form.author = skill.author || "";
      form.readme = skill.readme || "";
      // 为新版本发布重置版本相关字段。
      form.version = "";
      form.releaseNotes = "";
      form.entryFile = "SKILL.md";
      captureOriginalMeta(skill);
    } catch (e: any) {
      errorMsg.value = e?.data?.statusMessage || e?.message || "获取 Skill 信息失败。";
    } finally {
      isLoading.value = false;
    }
  },
  { immediate: true }
);

// ---------- 提交发布 ----------
/** 提交技能发布流程，按模式分别处理新建与已有技能。 */
async function handlePublish() {
  errorMsg.value = "";
  successMsg.value = "";
  isPending.value = true;

  try {
    if (!artifactFile.value) {
      throw new Error("请先选择 ZIP 包后再发布。");
    }

    let skillId = existingSkillId.value;

    if (isEditMode.value) {
      // 模式二：如有必要先更新元数据，再发布新版本。
      console.info("[Skills 发布] 开始为已有技能发布新版本", { id: skillId, version: form.version });

      if (metadataChanged.value) {
        console.info("[Skills 发布] 检测到元数据变更，正在更新技能信息", { id: skillId });
        await $fetch(`/api/skills/${skillId}`, {
          method: "PUT",
          body: {
            name: form.name,
            summary: form.summary,
            description: form.description,
            category: form.category,
            tags: parseTags(form.tags),
            author: form.author || undefined,
          },
        });
      }
    } else {
      // 模式一：先创建技能，再继续发布首个版本。
      console.info("[Skills 发布] 开始创建新技能", { id: form.id, version: form.version });

      const createBody: CreateSkillInput = {
        id: form.id,
        name: form.name,
        summary: form.summary,
        description: form.description,
        category: form.category,
        tags: parseTags(form.tags),
        author: form.author || undefined,
      };

      const result = await $fetch<{ skill: { id: string } }>("/api/skills", {
        method: "POST",
        body: createBody,
      });
      skillId = result.skill.id;
    }

    // 发布版本压缩包。
    const formData = new FormData();
    formData.append("version", form.version);
    formData.append("releaseNotes", form.releaseNotes);
    formData.append("entryFile", form.entryFile);
    formData.append("readme", form.readme || `# ${form.name}\n\n${form.description}`);
    formData.append("file", artifactFile.value);

    await $fetch(`/api/skills/${skillId}/releases`, {
      method: "POST",
      body: formData,
    });

    console.info("[Skills 发布] 技能发布成功，准备跳转详情页", { id: skillId, version: form.version });
    await navigateTo(`/skills/${skillId}`);
  } catch (error: any) {
    console.error("[Skills 发布] 技能发布失败", error);
    errorMsg.value = error?.data?.statusMessage || error?.statusMessage || error?.message || "发布技能失败。";
  } finally {
    isPending.value = false;
  }
}

// ---------- 辅助方法 ----------
/** 把逗号分隔的标签字符串解析为标签数组。 */
function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** 读取用户选择的压缩包文件并缓存到表单状态。 */
function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  artifactFile.value = input.files?.[0] ?? null;
}

useHead({
  title: computed(() => (isEditMode.value ? "发布新版本 | MyClaw Cloud" : "发布 Skill | MyClaw Cloud")),
});
</script>

<template>
  <main class="nuxt-publish-web-page">
    <div class="publish-container-nx">
      <div class="publish-header-nx">
        <NuxtLink class="back-link-nx" to="/skills">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          返回 Skills
        </NuxtLink>
        <div class="title-area">
          <template v-if="isEditMode && existingSkill">
            <h2>发布新版本 <span class="dim">{{ existingSkill.name }}</span></h2>
            <p class="subtitle">为 <code class="skill-id-tag">@myclaw/{{ existingSkill.id }}</code> 发布新版本。</p>
          </template>
          <template v-else-if="isEditMode && isLoading">
            <h2>加载中...</h2>
            <p class="subtitle">正在获取 Skill 信息。</p>
          </template>
          <template v-else>
            <h2>发布 <span class="dim">Skill</span></h2>
            <p class="subtitle">创建新的云端 Skill 并发布到平台仓库。</p>
          </template>
        </div>
      </div>

      <div v-if="isLoading" class="loading-state">
        <span class="spinner large"></span>
        <p>正在加载 Skill 信息...</p>
      </div>

      <form v-else class="desktop-form-layout" @submit.prevent="handlePublish">
        <!-- ====== LEFT: Main Content ====== -->
        <div class="layout-main form-card-nx glass-card-nx">
          <section class="inner-section">
            <header class="section-head">
              <h3>基础信息</h3>
              <p>{{ isEditMode ? '可选更新 Skill 的基础元数据。' : '填写 Skills 列表中展示的核心信息。' }}</p>
            </header>

            <div class="form-group mb-xl">
              <label>Skill 名称</label>
              <input v-model="form.name" type="text" placeholder="例如：Data Analyzer" required />
            </div>

            <div class="form-group mb-xl">
              <label>简短摘要</label>
              <input v-model="form.summary" type="text" placeholder="用于 Skills 列表的一句话摘要" required />
            </div>

            <div class="form-group mb-xl">
              <label>详细说明</label>
              <textarea v-model="form.description" rows="4" placeholder="这个 Skill 的用途、能力和适用场景..." required></textarea>
            </div>

            <div class="row-inputs mb-xl">
              <div class="form-group flex-1">
                <label>分类</label>
                <select v-model="form.category" class="native-select">
                  <option v-for="cat in SKILL_CATEGORIES" :key="cat.value" :value="cat.value">
                    {{ cat.label }}
                  </option>
                </select>
              </div>
              <div class="form-group flex-1">
                <label>作者</label>
                <input v-model="form.author" type="text" placeholder="作者名称" />
              </div>
            </div>

            <div class="form-group">
              <label>标签 <span class="optional-tag">逗号分隔</span></label>
              <input v-model="form.tags" type="text" placeholder="例如：数据, 分析, AI" />
            </div>
          </section>

          <section class="inner-section">
            <header class="section-head">
              <h3>文档与说明</h3>
              <p>补充发布说明和 README 内容。</p>
            </header>

            <div class="form-group mb-xl">
              <label>发布说明 <span class="req">*</span></label>
              <textarea v-model="form.releaseNotes" rows="3" placeholder="说明这个版本的更新内容" required></textarea>
            </div>

            <div class="form-group">
              <label>README (Markdown)</label>
              <textarea v-model="form.readme" rows="12" class="mono-font" placeholder="# Skill 名称&#10;&#10;使用说明..."></textarea>
            </div>
          </section>
        </div>

        <!-- ====== RIGHT: Sidebar ====== -->
        <aside class="layout-sidebar form-card-nx glass-card-nx">
          <section class="inner-section">
            <header class="section-head">
              <h3>配置项</h3>
            </header>

            <!-- Skill ID: only show in create mode -->
            <div v-if="!isEditMode" class="form-group mb-lg">
              <label>Skill ID <span class="req">*</span></label>
              <div class="input-wrapper">
                <span class="prefix">@myclaw/</span>
                <input v-model="form.id" type="text" placeholder="example-skill" required />
              </div>
            </div>

            <!-- Skill ID: read-only in edit mode -->
            <div v-else class="form-group mb-lg">
              <label>Skill ID</label>
              <div class="readonly-field">@myclaw/{{ existingSkill?.id }}</div>
            </div>

            <div class="row-inputs mb-lg">
              <div class="form-group flex-1">
                <label>版本 <span class="req">*</span></label>
                <input v-model="form.version" type="text" :placeholder="isEditMode ? '新版本号' : '0.1.0'" required />
              </div>
              <div class="form-group flex-1">
                <label>入口文件</label>
                <input v-model="form.entryFile" type="text" placeholder="SKILL.md" required />
              </div>
            </div>

            <!-- Metadata change indicator in edit mode -->
            <div v-if="isEditMode && metadataChanged" class="meta-change-hint">
              元数据已修改，发布时将同步更新 Skill 信息。
            </div>
          </section>

          <section class="inner-section">
            <header class="section-head">
              <h3>上传产物包</h3>
              <p>上传 Skill 的 ZIP 包。</p>
            </header>

            <div class="form-group">
              <div class="drop-zone-nx" :class="{ active: artifactFile }">
                <input type="file" accept=".zip" required @change="handleFileChange" />
                <div class="drop-content">
                  <svg v-if="!artifactFile" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="success-icon"><path d="M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3"/></svg>
                  <span>{{ artifactFile ? artifactFile.name : "选择 ZIP 文件" }}</span>
                </div>
              </div>
            </div>
          </section>

          <div v-if="errorMsg" class="status-msg error">
            {{ errorMsg }}
          </div>

          <div v-if="successMsg" class="status-msg success">
            {{ successMsg }}
          </div>

          <div class="publish-actions-flat">
            <button type="submit" class="submit-btn-nx" :disabled="isPending || !artifactFile">
              <span v-if="isPending" class="spinner"></span>
              {{ isPending ? "正在发布..." : (isEditMode ? "发布新版本" : "发布到仓库") }}
            </button>
          </div>
        </aside>
      </form>
    </div>
  </main>
</template>

<style scoped>
.nuxt-publish-web-page { position: relative; min-height: calc(100vh - 64px); background: var(--bg-main); width: 100%; padding-bottom: 80px; }
.publish-container-nx { max-width: 1440px; margin: 0 auto; padding: 40px; }

.publish-header-nx { margin-bottom: 40px; display: flex; flex-direction: column; gap: 16px; }
.back-link-nx { display: inline-flex; align-items: center; gap: 8px; color: var(--text-dim); text-decoration: none; font-weight: 800; font-size: 0.85rem; transition: 0.2s; align-self: flex-start; padding: 6px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; }
.back-link-nx:hover { color: var(--text-main); background: rgba(255,255,255,0.08); }
.back-link-nx svg { width: 16px; height: 16px; }
.title-area h2 { font-size: 2rem; font-weight: 900; color: var(--text-main); letter-spacing: -0.02em; margin: 0 0 4px; }
.title-area .dim { color: var(--text-dim); }
.subtitle { color: var(--text-muted); font-size: 1rem; margin: 0; }
.skill-id-tag { font-family: 'Fira Code', monospace; font-size: 0.9rem; color: var(--nuxt-green); background: rgba(var(--nuxt-green-rgb), 0.1); padding: 2px 8px; border-radius: 6px; }

.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 80px 0; color: var(--text-muted); font-size: 1rem; }

.desktop-form-layout { display: grid; grid-template-columns: 1fr 400px; gap: 32px; align-items: start; }
@media (max-width: 1024px) { .desktop-form-layout { grid-template-columns: 1fr; } }

.layout-main { display: flex; flex-direction: column; gap: 32px; }
.layout-sidebar { display: flex; flex-direction: column; gap: 32px; position: sticky; top: 40px; }

.form-card-nx { padding: 32px; border-radius: 20px; background: var(--bg-main); border: 1px solid var(--border-muted); box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
.section-head { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); }
.section-head h3 { margin: 0 0 6px; font-size: 1.25rem; font-weight: 900; color: var(--text-main); }
.section-head p { margin: 0; font-size: 0.9rem; color: var(--text-muted); }

.form-group { display: flex; flex-direction: column; gap: 10px; }
.mb-lg { margin-bottom: 20px; }
.mb-xl { margin-bottom: 28px; }
.row-inputs { display: flex; gap: 16px; }
.flex-1 { flex: 1; }

.form-group label { font-size: 0.8rem; font-weight: 900; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between; }
.req { color: #ef4444; }
.optional-tag { font-size: 0.7rem; font-weight: 600; color: var(--text-muted); text-transform: none; letter-spacing: 0; }

.form-group input, .form-group textarea { width: 100%; padding: 14px 18px; background-color: var(--bg-input); border: 1px solid var(--border-main); border-radius: 12px; color: var(--text-main); font-family: inherit; font-size: 0.95rem; transition: 0.2s; box-sizing: border-box; }
.form-group input:focus, .form-group textarea:focus { outline: none; border-color: var(--nuxt-green); box-shadow: 0 0 0 3px rgba(var(--nuxt-green-rgb), 0.1); background-color: rgba(var(--nuxt-green-rgb), 0.02); }
/* 自定义下拉选择器 */
.native-select { width: 100%; padding: 14px 18px; background-color: var(--bg-input); border: 1px solid var(--border-main); border-radius: 12px; color: var(--text-main); font-family: inherit; font-size: 0.95rem; transition: 0.2s; box-sizing: border-box; }
.native-select:hover { border-color: rgba(var(--nuxt-green-rgb), 0.4); }
.native-select:focus { outline: none; border-color: var(--nuxt-green); box-shadow: 0 0 0 3px rgba(var(--nuxt-green-rgb), 0.1); }
.mono-font { font-family: 'Fira Code', monospace !important; font-size: 0.85rem !important; line-height: 1.6; }

.readonly-field { padding: 14px 18px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-muted); border-radius: 12px; color: var(--text-dim); font-family: 'Fira Code', monospace; font-size: 0.9rem; user-select: all; }

.input-wrapper { display: flex; align-items: center; background: var(--bg-input); border: 1px solid var(--border-main); border-radius: 12px; overflow: hidden; transition: 0.2s; }
.input-wrapper:focus-within { border-color: var(--nuxt-green); box-shadow: 0 0 0 3px rgba(var(--nuxt-green-rgb), 0.1); background: rgba(var(--nuxt-green-rgb), 0.02); }
.input-wrapper .prefix { padding-left: 16px; color: var(--text-dim); font-family: 'Fira Code', monospace; font-size: 0.9rem; user-select: none; }
.input-wrapper input { border: none !important; background: transparent !important; box-shadow: none !important; padding-left: 8px; }

.meta-change-hint { font-size: 0.8rem; color: var(--nuxt-green); background: rgba(var(--nuxt-green-rgb), 0.08); border: 1px solid rgba(var(--nuxt-green-rgb), 0.15); border-radius: 10px; padding: 10px 14px; font-weight: 700; margin-top: -16px; }

.drop-zone-nx { height: 140px; border: 2px dashed var(--border-muted); border-radius: 16px; position: relative; transition: 0.2s; background: rgba(255,255,255,0.02); cursor: pointer; overflow: hidden; }
.drop-zone-nx:hover { border-color: var(--text-dim); background: rgba(255,255,255,0.04); }
.drop-zone-nx.active { border-color: var(--nuxt-green); background: rgba(var(--nuxt-green-rgb), 0.05); }
.drop-zone-nx input { position: absolute; inset: 0; opacity: 0; cursor: pointer; z-index: 10; width: 100%; height: 100%; }
.drop-content { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-dim); z-index: 5; pointer-events: none; }
.drop-content svg { width: 36px; height: 36px; opacity: 0.6; }
.success-icon { color: var(--nuxt-green); opacity: 1 !important; }
.drop-content span { font-size: 0.9rem; font-weight: 800; color: var(--text-muted); text-align: center; padding: 0 16px; }
.drop-zone-nx.active .drop-content span { color: var(--nuxt-green); }

.status-msg { padding: 16px; border-radius: 12px; font-size: 0.875rem; font-weight: 700; display: flex; align-items: center; gap: 8px; margin-top: -16px; }
.status-msg.error { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; }
.status-msg.success { background: rgba(var(--nuxt-green-rgb), 0.1); border: 1px solid rgba(var(--nuxt-green-rgb), 0.2); color: var(--nuxt-green); }

.publish-actions-flat { padding: 0; margin-top: -8px; }
.submit-btn-nx { width: 100%; height: 52px; background: var(--nuxt-green); color: var(--btn-text); border: none; border-radius: 12px; font-weight: 900; font-size: 1.05rem; cursor: pointer; transition: 0.3s; display: flex; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 4px 15px rgba(var(--nuxt-green-rgb), 0.2); letter-spacing: 0.02em; }
.submit-btn-nx:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(var(--nuxt-green-rgb), 0.4); }
.submit-btn-nx:disabled { opacity: 0.5; filter: grayscale(1); cursor: not-allowed; box-shadow: none; transform: none; }
.spinner { width: 18px; height: 18px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 1s linear infinite; }
.spinner.large { width: 32px; height: 32px; border-width: 4px; }
@keyframes spin { to { transform: rotate(360deg); } }

</style>

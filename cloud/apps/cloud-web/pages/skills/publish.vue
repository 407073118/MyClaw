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

// ---------- Mode detection ----------
const existingSkillId = computed(() => (route.query.id as string) || "");
const isEditMode = computed(() => !!existingSkillId.value);

// ---------- Form state ----------
const form = reactive({
  id: "",
  name: "",
  summary: "",
  description: "",
  icon: "",
  category: "other" as SkillCategory,
  tags: "",
  author: currentUser.value?.displayName || currentUser.value?.account || "",
  version: "0.1.0",
  entryFile: "SKILL.md",
  releaseNotes: "Initial release",
  readme: "",
});

const showIconPicker = ref(false);
const showCategoryPicker = ref(false);
const customIconUrl = ref("");
const selectedIconSvg = ref("");  // 原始 SVG，用于预览时 v-html 展示（自动继承主题颜色）

// ---------- Built-in icon library ----------
const PRESET_ICONS: { id: string; label: string; svg: string }[] = [
  { id: "robot", label: "机器人", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="8" width="18" height="12" rx="2"/><circle cx="9" cy="14" r="1.5"/><circle cx="15" cy="14" r="1.5"/><path d="M12 2v4M8 8V6a4 4 0 018 0v2"/><path d="M1 14h2M21 14h2"/></svg>` },
  { id: "brain", label: "大脑", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a5 5 0 00-4.78 3.56A4 4 0 004 9.5a4.5 4.5 0 00.69 7.41A3.5 3.5 0 008 22h1V12"/><path d="M12 2a5 5 0 014.78 3.56A4 4 0 0120 9.5a4.5 4.5 0 01-.69 7.41A3.5 3.5 0 0116 22h-1V12"/><path d="M12 2v20"/></svg>` },
  { id: "code", label: "代码", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><line x1="14" y1="4" x2="10" y2="20"/></svg>` },
  { id: "chart", label: "图表", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>` },
  { id: "search", label: "搜索", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>` },
  { id: "doc", label: "文档", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>` },
  { id: "pen", label: "写作", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>` },
  { id: "terminal", label: "终端", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>` },
  { id: "database", label: "数据库", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>` },
  { id: "globe", label: "网络", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>` },
  { id: "zap", label: "闪电", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>` },
  { id: "puzzle", label: "拼图", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 01-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 10-3.214 3.214c.446.166.855.497.925.968a.98.98 0 01-.276.837l-1.61 1.61a2.404 2.404 0 01-1.705.707 2.402 2.402 0 01-1.704-.706l-1.568-1.568a1.026 1.026 0 00-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 11-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 00-.289-.877l-1.568-1.568A2.402 2.402 0 011.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 01.837-.276c.47.07.802.48.968.925a2.501 2.501 0 103.214-3.214c-.446-.166-.855-.497-.925-.968a.98.98 0 01.276-.837l1.61-1.61A2.404 2.404 0 0112 2.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 113.237 3.237c-.464.18-.894.527-.967 1.02z"/></svg>` },
  { id: "palette", label: "调色板", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.04-.23-.29-.38-.63-.38-1.01 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.17-4.49-9-10-9z"/></svg>` },
  { id: "shield", label: "安全", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>` },
  { id: "book", label: "教育", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>` },
  { id: "image", label: "图像", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>` },
  { id: "mic", label: "语音", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>` },
  { id: "mail", label: "邮件", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>` },
  { id: "clock", label: "时间", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>` },
  { id: "git", label: "版本控制", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 009 9"/></svg>` },
];

function buildIconDataUri(svg: string): string {
  // 把 currentColor 替换为具体颜色，否则 <img> 标签中无法继承颜色
  const coloredSvg = svg
    .replace(/stroke="currentColor"/g, 'stroke="#6b7280"')
    .replace(/<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ');
  return `data:image/svg+xml,${encodeURIComponent(coloredSvg)}`;
}

function selectPresetIcon(icon: typeof PRESET_ICONS[number]) {
  form.icon = buildIconDataUri(icon.svg);
  selectedIconSvg.value = icon.svg;
  showIconPicker.value = false;
}

function applyCustomIconUrl() {
  if (customIconUrl.value.trim()) {
    form.icon = customIconUrl.value.trim();
    showIconPicker.value = false;
    customIconUrl.value = "";
  }
}

function clearIcon() {
  form.icon = "";
  selectedIconSvg.value = "";
  showIconPicker.value = false;
}

const isPending = ref(false);
const errorMsg = ref("");
const successMsg = ref("");
const artifactFile = ref<File | null>(null);
const existingSkill = ref<SkillDetail | null>(null);
const isLoading = ref(false);

// ---------- Track original metadata to detect changes ----------
const originalMeta = ref<Record<string, any>>({});

function captureOriginalMeta(skill: SkillDetail) {
  originalMeta.value = {
    name: skill.name,
    summary: skill.summary,
    description: skill.description,
    icon: skill.icon || "",
    category: skill.category || "other",
    tags: (skill.tags || []).join(", "),
    author: skill.author || "",
  };
}

const metadataChanged = computed(() => {
  if (!isEditMode.value) return false;
  const fields = ["name", "summary", "description", "icon", "category", "tags", "author"] as const;
  return fields.some((f) => (form as any)[f] !== originalMeta.value[f]);
});

// ---------- Fetch existing skill when in edit mode ----------
watch(
  existingSkillId,
  async (id) => {
    if (!id) return;
    isLoading.value = true;
    errorMsg.value = "";
    try {
      const skill = await $fetch<SkillDetail>(`/api/skills/${id}`);
      existingSkill.value = skill;
      // Pre-fill form
      form.id = skill.id;
      form.name = skill.name;
      form.summary = skill.summary;
      form.description = skill.description;
      form.icon = skill.icon || "";
      form.category = skill.category || "other";
      form.tags = (skill.tags || []).join(", ");
      form.author = skill.author || "";
      form.readme = skill.readme || "";
      // Reset release-specific fields for new version
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

// ---------- Submit ----------
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
      // Mode 2: optionally update metadata, then publish release
      console.info("[Skills 发布] 开始为已有 Skill 发布新版本", { id: skillId, version: form.version });

      if (metadataChanged.value) {
        console.info("[Skills 发布] 检测到元数据变更，正在更新 Skill 信息", { id: skillId });
        await $fetch(`/api/skills/${skillId}`, {
          method: "PUT",
          body: {
            name: form.name,
            summary: form.summary,
            description: form.description,
            icon: form.icon || undefined,
            category: form.category,
            tags: parseTags(form.tags),
            author: form.author || undefined,
          },
        });
      }
    } else {
      // Mode 1: create skill first
      console.info("[Skills 发布] 开始创建新 Skill", { id: form.id, version: form.version });

      const createBody: CreateSkillInput = {
        id: form.id,
        name: form.name,
        summary: form.summary,
        description: form.description,
        icon: form.icon || undefined,
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

    // Publish release
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

    console.info("[Skills 发布] Skill 发布成功，准备跳转详情页", { id: skillId, version: form.version });
    await navigateTo(`/skills/${skillId}`);
  } catch (error: any) {
    console.error("[Skills 发布] Skill 发布失败", error);
    errorMsg.value = error?.data?.statusMessage || error?.statusMessage || error?.message || "发布 Skill 失败。";
  } finally {
    isPending.value = false;
  }
}

// ---------- Helpers ----------
function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

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

            <div class="form-group mb-xl">
              <label>图标 <span class="optional-tag">可选</span></label>
              <div class="icon-picker-trigger" @click="showIconPicker = !showIconPicker">
                <div v-if="form.icon" class="icon-preview">
                  <span v-if="selectedIconSvg" class="icon-preview-svg" v-html="selectedIconSvg"></span>
                  <img v-else :src="form.icon" alt="icon" />
                  <button type="button" class="icon-clear-btn" @click.stop="clearIcon" title="清除图标">×</button>
                </div>
                <div v-else class="icon-placeholder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  <span>选择图标</span>
                </div>
              </div>
              <div v-if="showIconPicker" class="icon-picker-panel">
                <div class="icon-picker-header">
                  <span class="icon-picker-title">选择预设图标</span>
                </div>
                <div class="icon-preset-grid">
                  <button
                    v-for="icon in PRESET_ICONS"
                    :key="icon.id"
                    type="button"
                    class="icon-preset-item"
                    :title="icon.label"
                    @click="selectPresetIcon(icon)"
                  >
                    <span class="icon-preset-svg" v-html="icon.svg"></span>
                    <span class="icon-preset-label">{{ icon.label }}</span>
                  </button>
                </div>
                <div class="icon-custom-section">
                  <span class="icon-picker-title">或输入自定义 URL</span>
                  <div class="icon-custom-row">
                    <input v-model="customIconUrl" type="text" placeholder="https://example.com/icon.png" @keyup.enter="applyCustomIconUrl" />
                    <button type="button" class="icon-custom-apply" :disabled="!customIconUrl.trim()" @click="applyCustomIconUrl">确定</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="row-inputs mb-xl">
              <div class="form-group flex-1">
                <label>分类</label>
                <div class="custom-select" @click="showCategoryPicker = !showCategoryPicker" @blur="showCategoryPicker = false" tabindex="0">
                  <span class="custom-select-value">{{ SKILL_CATEGORIES.find(c => c.value === form.category)?.label || '选择分类' }}</span>
                  <svg class="custom-select-arrow" :class="{ open: showCategoryPicker }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
                  <div v-if="showCategoryPicker" class="custom-select-dropdown">
                    <div
                      v-for="cat in SKILL_CATEGORIES"
                      :key="cat.value"
                      class="custom-select-option"
                      :class="{ active: form.category === cat.value }"
                      @mousedown.prevent="form.category = cat.value; showCategoryPicker = false"
                    >{{ cat.label }}</div>
                  </div>
                </div>
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
/* Custom select dropdown */
.custom-select { position: relative; display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 14px 18px; background-color: var(--bg-input); border: 1px solid var(--border-main); border-radius: 12px; color: var(--text-main); font-family: inherit; font-size: 0.95rem; cursor: pointer; transition: 0.2s; box-sizing: border-box; user-select: none; outline: none; }
.custom-select:hover { border-color: rgba(var(--nuxt-green-rgb), 0.4); }
.custom-select:focus { border-color: var(--nuxt-green); box-shadow: 0 0 0 3px rgba(var(--nuxt-green-rgb), 0.1); }
.custom-select-value { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.custom-select-arrow { width: 16px; height: 16px; flex-shrink: 0; color: var(--text-dim); transition: transform 0.2s; }
.custom-select-arrow.open { transform: rotate(180deg); }
.custom-select-dropdown { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: var(--bg-main); border: 1px solid var(--border-muted); border-radius: 12px; padding: 6px; box-shadow: 0 12px 40px rgba(0,0,0,0.25); z-index: 50; max-height: 260px; overflow-y: auto; }
.custom-select-option { padding: 10px 14px; border-radius: 8px; font-size: 0.9rem; color: var(--text-main); cursor: pointer; transition: 0.15s; }
.custom-select-option:hover { background: rgba(var(--nuxt-green-rgb), 0.08); color: var(--nuxt-green); }
.custom-select-option.active { background: rgba(var(--nuxt-green-rgb), 0.12); color: var(--nuxt-green); font-weight: 700; }
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

/* Icon Picker */
.icon-picker-trigger { display: flex; align-items: center; padding: 12px 16px; background: var(--bg-input); border: 1px solid var(--border-main); border-radius: 12px; cursor: pointer; transition: 0.2s; min-height: 56px; }
.icon-picker-trigger:hover { border-color: rgba(var(--nuxt-green-rgb), 0.4); }

.icon-preview { display: flex; align-items: center; gap: 12px; width: 100%; position: relative; }
.icon-preview img, .icon-preview-svg { width: 40px; height: 40px; border-radius: 10px; object-fit: contain; background: rgba(255,255,255,0.06); padding: 4px; }
.icon-preview-svg { display: flex; align-items: center; justify-content: center; color: var(--text-main); }
.icon-preview-svg :deep(svg) { width: 100%; height: 100%; }
.icon-clear-btn { position: absolute; right: 0; top: 50%; transform: translateY(-50%); background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.25); color: #ef4444; width: 28px; height: 28px; border-radius: 8px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: 0.2s; }
.icon-clear-btn:hover { background: rgba(239,68,68,0.25); }

.icon-placeholder { display: flex; align-items: center; gap: 10px; color: var(--text-dim); }
.icon-placeholder svg { width: 24px; height: 24px; opacity: 0.5; }
.icon-placeholder span { font-size: 0.88rem; font-weight: 700; }

.icon-picker-panel { margin-top: 8px; background: var(--bg-main); border: 1px solid var(--border-muted); border-radius: 16px; padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.2); }
.icon-picker-header { margin-bottom: 14px; }
.icon-picker-title { font-size: 0.78rem; font-weight: 800; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }

.icon-preset-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 20px; }
.icon-preset-item { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 4px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-muted); border-radius: 10px; cursor: pointer; transition: 0.2s; }
.icon-preset-item:hover { border-color: var(--nuxt-green); background: rgba(var(--nuxt-green-rgb), 0.06); transform: translateY(-1px); }
.icon-preset-svg { width: 28px; height: 28px; color: var(--text-main); }
.icon-preset-svg :deep(svg) { width: 100%; height: 100%; }
.icon-preset-label { font-size: 0.65rem; font-weight: 700; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }

.icon-custom-section { padding-top: 16px; border-top: 1px solid var(--border-muted); display: flex; flex-direction: column; gap: 10px; }
.icon-custom-row { display: flex; gap: 8px; }
.icon-custom-row input { flex: 1; padding: 10px 14px; background: var(--bg-input); border: 1px solid var(--border-main); border-radius: 10px; color: var(--text-main); font-size: 0.85rem; font-family: inherit; }
.icon-custom-row input:focus { outline: none; border-color: var(--nuxt-green); }
.icon-custom-apply { padding: 10px 16px; background: var(--nuxt-green); color: var(--btn-text); border: none; border-radius: 10px; font-weight: 800; font-size: 0.8rem; cursor: pointer; transition: 0.2s; white-space: nowrap; }
.icon-custom-apply:disabled { opacity: 0.4; cursor: not-allowed; }
.icon-custom-apply:hover:not(:disabled) { filter: brightness(1.1); }
</style>

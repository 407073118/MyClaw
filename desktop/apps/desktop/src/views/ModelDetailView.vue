<template>
  <div class="model-detail-layout">
    <!-- Compact Top Bar -->
    <header class="detail-topbar">
      <div class="topbar-left">
        <button class="icon-back-btn" @click="handleBack" title="返回设置">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div class="divider"></div>
        <div class="title-group">
          <span class="eyebrow">{{ isNew ? '新增模型' : '编辑配置' }}</span>
          <h2 class="title">{{ profile.name || '未命名配置' }}</h2>
        </div>
      </div>

      <div class="topbar-right">
        <button v-if="!isNew" class="danger-ghost-btn" @click="handleDelete" :disabled="isBusy">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
          删除
        </button>
        <button class="primary-save-btn" @click="upsertProfile" :disabled="isBusy">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8"/>
          </svg>
          {{ isBusy ? '保存中...' : '保存配置' }}
        </button>
      </div>
    </header>

    <main class="detail-content">
      <div v-if="error" class="error-banner">
        <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        {{ error }}
      </div>

      <div class="main-form">
        <!-- Section: Basic Info -->
        <section class="form-section">
          <div class="section-header">
            <span class="dot-icon"></span>
            基础参数
          </div>
          <div class="field-grid">
            <label class="field">
              <span class="label">配置名称</span>
              <input v-model="profile.name" placeholder="例如：我的 GPT-4o" />
            </label>
            <label class="field">
              <span class="label">服务商预设</span>
              <div class="select-wrapper">
                <select v-model="selectedPresetId" data-testid="model-preset-select" @change="applyPreset">
                  <option v-for="preset in providerPresets" :key="preset.id" :value="preset.id">
                    {{ preset.label }}
                  </option>
                </select>
                <div class="select-arrow">
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/>
                  </svg>
                </div>
              </div>
            </label>
            <label class="field">
              <span class="label">模型 ID</span>
              <input
                v-model="profile.model"
                data-testid="model-id-input"
                placeholder="gpt-4o, claude-3-5-sonnet..."
              />
              <div v-if="availableModelIds.length > 0" class="field-inline">
                <div class="select-wrapper">
                  <select :value="profile.model" data-testid="model-id-select" @change="applySelectedModelId">
                    <option v-for="modelId in availableModelIds" :key="modelId" :value="modelId">
                      {{ modelId }}
                    </option>
                  </select>
                  <div class="select-arrow">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/>
                    </svg>
                  </div>
                </div>
              </div>
            </label>
            <label class="field">
              <span class="label">接口地址 (Base URL)</span>
              <input
                v-model="profile.baseUrl"
                data-testid="model-base-url-input"
                :placeholder="baseUrlPlaceholder"
              />
              <input type="hidden" :value="profile.baseUrlMode ?? 'manual'" data-testid="model-base-url-mode" />
              <div class="field-hint">{{ baseUrlHint }}</div>
            </label>
            <label class="field full-width">
              <span class="label">API Key / Token</span>
              <div class="password-input-wrapper">
                <input
                  :type="showPassword ? 'text' : 'password'"
                  v-model="profile.apiKey"
                  data-testid="model-api-key-input"
                  placeholder="sk-..."
                />
                <button type="button" class="toggle-password" @click="showPassword = !showPassword" :title="showPassword ? '隐藏' : '显示'">
                  <svg v-if="showPassword" viewBox="0 0 24 24" width="16" height="16">
                    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/>
                  </svg>
                  <svg v-else viewBox="0 0 24 24" width="16" height="16">
                    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
              </div>
              <div class="field-inline">
                <button
                  type="button"
                  class="secondary-action-btn"
                  data-testid="model-fetch-list"
                  :disabled="isFetchingModels"
                  @click="loadModelCatalog"
                >
                  {{ isFetchingModels ? "加载中..." : "获取模型列表" }}
                </button>
              </div>
              <div v-if="modelCatalogError" class="field-hint error-hint">{{ modelCatalogError }}</div>
            </label>
          </div>
        </section>

        <!-- Section: Advanced Parameters -->
        <section class="form-section flex-fill">
          <div class="section-header">
            <span class="dot-icon blue"></span>
            高级负载 (JSON)
          </div>
          <div class="editor-row">
            <div class="editor-col">
              <div class="field">
                <span class="label">自定义 Headers</span>
                <textarea 
                  v-model="headersText" 
                  placeholder='{"x-custom-header": "value"}'
                ></textarea>
                <div class="field-hint">附加到每个 HTTP 请求头的 JSON 对象。</div>
              </div>
            </div>
            <div class="editor-col">
              <div class="field">
                <span class="label">额外请求体 (RequestBody)</span>
                <textarea 
                  v-model="requestBodyText" 
                  placeholder='{"temperature": 0.7}'
                ></textarea>
                <div class="field-hint">合并到模型请求 payload 中的 JSON 参数。</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { providerPresets, resolveProviderPresetId } from "@/settings/provider-presets";
import { useWorkspaceStore } from "@/stores/workspace";
import type { ModelProfile } from "@myclaw-desktop/shared";

const route = useRoute();
const router = useRouter();
const workspace = useWorkspaceStore();

const profileId = computed(() => route.params.id as string);
const isNew = computed(() => route.name === "model-create" || route.path === "/settings/models/new");

const profile = reactive<ModelProfile>({
  id: "",
  name: "",
  provider: "openai-compatible",
  baseUrl: "https://api.openai.com",
  baseUrlMode: "provider-root",
  apiKey: "",
  model: "",
  headers: {},
  requestBody: {}
});

const selectedPresetId = ref("openai");
const headersText = ref("");
const requestBodyText = ref("");
const isBusy = ref(false);
const error = ref("");
const showPassword = ref(false);
const isFetchingModels = ref(false);
const modelCatalogError = ref("");
const availableModelIds = ref<string[]>([]);

const baseUrlPlaceholder = computed(() =>
  profile.baseUrlMode === "provider-root" ? "https://platform.minimaxi.com" : "https://gateway.example.com/v1",
);

const baseUrlHint = computed(() =>
  profile.baseUrlMode === "provider-root"
    ? "当前预设只需填写服务根地址，系统会自动补全对应厂商接口路径。"
    : "Custom 模式需要填写完整兼容地址，例如 https://gateway.example.com/v1。",
);

onMounted(() => {
  if (!isNew.value) {
    const existing = workspace.models.find(m => m.id === profileId.value);
    if (existing) {
      Object.assign(profile, existing);
      headersText.value = existing.headers ? JSON.stringify(existing.headers, null, 2) : "";
      requestBodyText.value = existing.requestBody ? JSON.stringify(existing.requestBody, null, 2) : "";

      selectedPresetId.value = resolveProviderPresetId(existing);
    } else {
      router.push("/settings");
    }
  } else {
    applyPreset();
  }
});

function applyPreset() {
  const preset = providerPresets.find(p => p.id === selectedPresetId.value);
  if (preset) {
    profile.provider = preset.provider;
    profile.baseUrl = preset.baseUrl;
    profile.baseUrlMode = preset.baseUrlMode;
    availableModelIds.value = [];
    modelCatalogError.value = "";
    if (isNew.value) {
       profile.name = `New ${preset.label} Config`;
    }
  }
}

/** 将候选下拉中的模型 id 同步回输入框，便于继续手工调整。 */
function applySelectedModelId(event: Event) {
  const target = event.target as HTMLSelectElement | null;
  profile.model = target?.value ?? "";
}

function handleBack() {
  router.push("/settings");
}

async function handleDelete() {
  if (!window.confirm("确定要删除此模型配置吗？")) return;
  isBusy.value = true;
  try {
    await workspace.deleteModelProfile(profile.id);
    router.push("/settings");
  } catch (e: any) {
    error.value = e.message;
  } finally {
    isBusy.value = false;
  }
}

async function upsertProfile() {
  error.value = "";
  let parsedHeaders = {};
  let parsedBody = {};

  try {
    if (headersText.value.trim()) parsedHeaders = JSON.parse(headersText.value);
    if (requestBodyText.value.trim()) parsedBody = JSON.parse(requestBodyText.value);
  } catch (e) {
    error.value = "JSON 格式不正确，请检阅 Headers 或 RequestBody 字段。";
    return;
  }

  isBusy.value = true;
  try {
    const data = {
      ...profile,
      name: profile.name.trim() || "未命名配置",
      baseUrl: profile.baseUrl.trim(),
      baseUrlMode: profile.baseUrlMode,
      apiKey: profile.apiKey.trim(),
      model: profile.model.trim(),
      headers: parsedHeaders,
      requestBody: parsedBody
    };

    if (isNew.value) {
      const newProfile = await workspace.createModelProfile(data);
      await workspace.setDefaultModelProfile(newProfile.id);
    } else {
      await workspace.updateModelProfile(profile.id, data);
    }
    router.push("/settings");
  } catch (e: any) {
    error.value = e.message;
  } finally {
    isBusy.value = false;
  }
}

/** 基于当前表单配置拉取模型目录，并将首个结果回填到模型输入框。 */
async function loadModelCatalog() {
  modelCatalogError.value = "";
  availableModelIds.value = [];
  isFetchingModels.value = true;

  try {
    const parsedHeaders = headersText.value.trim() ? JSON.parse(headersText.value) : {};
    const parsedBody = requestBodyText.value.trim() ? JSON.parse(requestBodyText.value) : {};
    const modelIds = await workspace.fetchAvailableModelIds({
      provider: profile.provider,
      baseUrl: profile.baseUrl.trim(),
      baseUrlMode: profile.baseUrlMode,
      apiKey: profile.apiKey.trim(),
      model: profile.model.trim(),
      headers: parsedHeaders,
      requestBody: parsedBody
    });

    availableModelIds.value = modelIds;
    if (!profile.model && modelIds.length > 0) {
      profile.model = modelIds[0]!;
    }
    if (modelIds.length === 0) {
      modelCatalogError.value = "当前服务未返回可用模型，请确认接口地址、权限与服务商兼容性。";
    }
  } catch (e: any) {
    modelCatalogError.value = e?.message ?? "模型列表获取失败";
  } finally {
    isFetchingModels.value = false;
  }
}
</script>

<style scoped>
.model-detail-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0d0d0f;
  color: #fff;
  overflow: hidden;
}

.detail-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 24px;
  background: #161618;
  border-bottom: 1px solid #27272a;
  flex-shrink: 0;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.icon-back-btn {
  background: transparent;
  border: 0;
  color: #a1a1aa;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  transition: all 0.2s;
}

.icon-back-btn:hover {
  background: #27272a;
  color: #fff;
}

.divider {
  width: 1px;
  height: 20px;
  background: #3f3f46;
}

.eyebrow {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: #71717a;
  letter-spacing: 0.05em;
  display: block;
}

.title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: #f4f4f5;
}

.topbar-right {
  display: flex;
  gap: 12px;
}

.primary-save-btn, .danger-ghost-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  height: 32px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.primary-save-btn {
  background: #fff;
  color: #000;
  border: 0;
}

.primary-save-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.primary-save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.danger-ghost-btn {
  background: transparent;
  border: 1px solid #451a1a;
  color: #f87171;
}

.danger-ghost-btn:hover {
  background: #451a1a;
}

.detail-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.main-form {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #a1a1aa;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dot-icon {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #eab308;
}

.dot-icon.blue { background: #3b82f6; }

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field.full-width {
  grid-column: span 2;
}

.label {
  font-size: 12px;
  color: #71717a;
  font-weight: 500;
}

input, select, textarea {
  background: #161618;
  border: 1px solid #27272a;
  border-radius: 6px;
  color: #f4f4f5;
  padding: 8px 12px;
  font-size: 14px;
  outline: none;
  transition: all 0.2s;
  width: 100%;
}

select {
  appearance: none;
  cursor: pointer;
  padding-right: 32px;
}

.select-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.select-arrow {
  position: absolute;
  right: 12px;
  pointer-events: none;
  color: #71717a;
  display: flex;
  align-items: center;
}

input:focus, select:focus, textarea:focus {
  border-color: #3f3f46;
  background: #09090b;
}

.editor-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.editor-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.password-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.password-input-wrapper input {
  padding-right: 40px;
}

.toggle-password {
  position: absolute;
  right: 8px;
  background: transparent;
  border: 0;
  color: #71717a;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
}

.toggle-password:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.05);
}

textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  min-height: 180px;
  line-height: 1.5;
  resize: none;
}

.field-hint {
  font-size: 11px;
  color: #52525b;
  margin-top: 4px;
}

.field-inline {
  margin-top: 10px;
}

.secondary-action-btn {
  height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid #303038;
  background: #1b1b1f;
  color: #f4f4f5;
  cursor: pointer;
}

.secondary-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.error-hint {
  color: #fca5a5;
}

.flex-fill {
  flex: 1;
}

/* Hide scrollbar for cleaner look if content fits */
.detail-content::-webkit-scrollbar {
  width: 6px;
}
.detail-content::-webkit-scrollbar-thumb {
  background: #27272a;
  border-radius: 10px;
}
</style>

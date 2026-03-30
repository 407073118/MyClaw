<template>
  <main class="page-container">
    <header class="page-header">
      <div class="header-text">
        <span class="eyebrow">Settings</span>
        <h2 class="page-title">个人设置</h2>
        <p class="page-subtitle">管理您的模型、运行时、审批策略以及应用偏好。</p>
      </div>

      <div class="header-actions">
        <div class="tabs">
          <button
            v-for="tab in tabs"
            :key="tab"
            :data-testid="`settings-tab-${tab}`"
            :class="['tab', { active: activeTab === tab }]"
            @click="activeTab = tab"
          >
            {{ tab }}
          </button>
        </div>
      </div>
    </header>

    <article v-if="activeTab === '模型'" class="card no-padding">
      <div class="section-header-row">
        <div class="header-content">
          <p class="eyebrow">模型列表</p>
          <h3>已配置模型</h3>
          <p class="description">管理您的 AI 模型提供商配置。默认模型将用于智能助手回复和工具分析。</p>
        </div>
        <button class="primary add-btn" @click="router.push('/settings/models/new')">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14"/>
          </svg>
          添加模型配置
        </button>
      </div>

      <div class="model-cards-container">
        <div 
          v-for="profile in workspace.models" 
          :key="profile.id" 
          :class="['model-card', { 'is-active': workspace.defaultModelProfileId === profile.id }]"
        >
          <div class="card-status-bar">
            <span v-if="workspace.defaultModelProfileId === profile.id" class="status-badge active">
              <span class="dot"></span>
              当前默认模型
            </span>
            <span v-else class="status-badge inactive">未启用</span>
            <div class="card-actions-mini">
               <button 
                class="icon-btn" 
                @click="testModelProfile(profile.id)"
                :disabled="modelConnectivityLoading[profile.id]"
                title="测试连通性"
              >
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                </svg>
              </button>
              <button class="icon-btn" @click="router.push(`/settings/models/${profile.id}`)" title="编辑">
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="card-body">
            <div class="model-info">
              <div class="model-name-row">
                <span class="provider-tag">{{ getProviderLabel(profile) }}</span>
                <strong>{{ profile.name }}</strong>
              </div>
              <p class="model-id"><span>ID:</span> {{ profile.model }}</p>
              <p class="model-url"><span>URL:</span> {{ profile.baseUrl }}</p>
            </div>

            <div v-if="modelConnectivityStatus[profile.id]" class="connectivity-info">
               <span :class="['status-text', { ok: modelConnectivityStatus[profile.id].includes('可用') }]">
                 {{ modelConnectivityStatus[profile.id] }}
               </span>
            </div>
          </div>

          <div class="card-footer-actions">
            <button 
              v-if="workspace.defaultModelProfileId !== profile.id"
              class="primary-ghost" 
              @click="workspace.setDefaultModelProfile(profile.id)"
            >
              设为默认
            </button>
            <button v-else class="primary-ghost disabled" disabled>
               已设为默认
            </button>
          </div>
        </div>
      </div>

      <section class="storage-section card">
        <p class="eyebrow">存储资源</p>
        <h4>MyClaw 数据目录</h4>
        <div class="storage-path-list">
          <div class="storage-path-item">
            <span class="storage-path-label">根目录</span>
            <p data-testid="myclaw-root-path" class="path-text">{{ myClawRootPath }}</p>
          </div>
          <div class="storage-path-item">
            <span class="storage-path-label">Skills</span>
            <p data-testid="skills-root-path" class="path-text">{{ skillsRootPath }}</p>
          </div>
          <div class="storage-path-item">
            <span class="storage-path-label">Sessions</span>
            <p data-testid="sessions-root-path" class="path-text">{{ sessionsRootPath }}</p>
          </div>
          <div class="storage-path-item">
            <span class="storage-path-label">Runtime 状态库</span>
            <p data-testid="runtime-state-path" class="path-text">{{ runtimeStatePath }}</p>
          </div>
        </div>
        <p v-if="workspace.requiresInitialSetup" data-testid="initial-setup-hint" class="setup-hint">
          首次使用请先添加有效模型 Token 并设为默认。
        </p>
      </section>
    </article>

    <article v-else-if="activeTab === '通用'" class="card">
      <p class="eyebrow">通用</p>
      <h3>应用默认项</h3>
      <p>运行时地址、启动行为和工作区级展示设置会在这里统一管理。</p>
    </article>

    <article v-else class="card">
      <p class="eyebrow">审批</p>
      <h3>执行策略</h3>

      <div class="approval-controls">
        <label class="field">
          <span>全局审批模式</span>
          <select data-testid="approval-mode-select" v-model="approvalDraft.mode">
            <option value="prompt">全部询问</option>
            <option value="auto-read-only">仅高风险询问</option>
            <option value="auto-allow-all">全部自动允许</option>
          </select>
        </label>

        <label class="switch-row">
          <input
            data-testid="approval-readonly-toggle"
            v-model="approvalDraft.autoApproveReadOnly"
            type="checkbox"
          />
          <span>只读操作默认自动允许</span>
        </label>

        <label class="switch-row">
          <input
            data-testid="approval-skills-toggle"
            v-model="approvalDraft.autoApproveSkills"
            type="checkbox"
          />
          <span>Skills 调用默认直接放行</span>
        </label>

        <button data-testid="approval-save" class="primary" @click="saveApprovalPolicy">保存审批策略</button>
      </div>

      <div class="approval-summary">
        <p>Skills 调用默认直接放行，不单独弹出审批。</p>
        <p>{{ approvalDraft.autoApproveReadOnly ? "只读操作默认自动允许。" : "只读操作当前也需要审批。" }}</p>
        <p>写入、执行、安装和外部网络访问会进入审批。</p>
        <p>已设为始终允许的工具：{{ alwaysAllowedToolsLabel }}</p>
      </div>
    </article>
  </main>
</template>

<script setup lang="ts">
import type { ApprovalMode, ModelProfile } from "@myclaw-desktop/shared";
import { createDefaultApprovalPolicy } from "@myclaw-desktop/shared";
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { resolveProviderPreset } from "@/settings/provider-presets";
import { useWorkspaceStore } from "@/stores/workspace";

const tabs = ["模型", "通用", "审批"] as const;
const activeTab = ref<(typeof tabs)[number]>("模型");
const router = useRouter();
const workspace = useWorkspaceStore();
const defaultApprovalPolicy = createDefaultApprovalPolicy();
const modelConnectivityStatus = reactive<Record<string, string>>({});
const modelConnectivityLoading = reactive<Record<string, boolean>>({});
const approvalDraft = reactive<{
  mode: ApprovalMode;
  autoApproveReadOnly: boolean;
  autoApproveSkills: boolean;
}>({
  mode: workspace.approvals?.mode ?? defaultApprovalPolicy.mode,
  autoApproveReadOnly: workspace.approvals?.autoApproveReadOnly ?? defaultApprovalPolicy.autoApproveReadOnly,
  autoApproveSkills: workspace.approvals?.autoApproveSkills ?? defaultApprovalPolicy.autoApproveSkills,
});

watch(
  () => workspace.approvals,
  (approvals) => {
    approvalDraft.mode = approvals?.mode ?? defaultApprovalPolicy.mode;
    approvalDraft.autoApproveReadOnly =
      approvals?.autoApproveReadOnly ?? defaultApprovalPolicy.autoApproveReadOnly;
    approvalDraft.autoApproveSkills = approvals?.autoApproveSkills ?? defaultApprovalPolicy.autoApproveSkills;
  },
  { deep: true, immediate: true },
);

const defaultModelName = computed(() => {
  const id = workspace.defaultModelProfileId;
  return workspace.models.find((item) => item.id === id)?.name ?? "未设置默认模型";
});

const alwaysAllowedToolsLabel = computed(() => {
  const tools = workspace.approvals?.alwaysAllowedTools ?? defaultApprovalPolicy.alwaysAllowedTools;
  return tools.length ? tools.join("、") : "暂无";
});

const runtimeStatePath = computed(() => {
  return workspace.runtimeStateFilePath ?? "运行时未返回状态文件路径";
});

const myClawRootPath = computed(() => {
  return workspace.myClawRootPath ?? "运行时未返回 MyClaw 根目录";
});

const skillsRootPath = computed(() => {
  return workspace.skillsRootPath ?? "运行时未返回 Skills 目录";
});

const sessionsRootPath = computed(() => {
  return workspace.sessionsRootPath ?? "运行时未返回 Sessions 目录";
});

/** 根据完整 profile 推断供应商标签，避免兼容协议族误显示成首个预设。 */
function getProviderLabel(profile: ModelProfile) {
  return resolveProviderPreset(profile)?.label || "Other";
}

async function testModelProfile(profileId: string) {
  modelConnectivityLoading[profileId] = true;
  modelConnectivityStatus[profileId] = "测试中...";

  try {
    const payload = await workspace.testModelProfileConnectivity(profileId);
    const latency = typeof payload.latencyMs === "number" ? `${Math.round(payload.latencyMs)}ms` : "--";
    modelConnectivityStatus[profileId] = payload.ok ? `可用 (${latency})` : "失败";
  } catch (error) {
    modelConnectivityStatus[profileId] = `失败: ${error instanceof Error ? error.message : "未知错误"}`;
  } finally {
    modelConnectivityLoading[profileId] = false;
  }
}


async function saveApprovalPolicy() {
  await workspace.updateApprovalPolicy({
    mode: approvalDraft.mode,
    autoApproveReadOnly: approvalDraft.autoApproveReadOnly,
    autoApproveSkills: approvalDraft.autoApproveSkills,
  });
}
</script>

<style scoped>
.page-container {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}

.card {
  padding: 32px;
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
}

.no-padding {
  padding: 0;
  background: transparent;
  border: 0;
}

h3, h4 {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}
h3 { font-size: 16px; }
h4 { font-size: 14px; margin-bottom: 12px; }

.card p {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
  margin: 0;
}

.tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-base);
  padding: 4px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
}

.tab {
  padding: 6px 16px;
  border: 0;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
}

.tab:hover {
  color: var(--text-primary);
}

.tab.active {
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

.primary, .secondary {
  padding: 10px 16px;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.primary {
  background: var(--text-primary);
  color: var(--bg-base);
  border-color: var(--text-primary);
}

.primary:hover:not(:disabled) {
  opacity: 0.9;
}

.secondary {
  background: var(--bg-base);
  color: var(--text-primary);
  border-color: var(--glass-border);
}

.secondary:hover:not(:disabled) {
  background: var(--bg-card);
  border-color: var(--text-muted);
}

.primary:disabled, .secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.section-header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
}

.header-content h3 {
  font-size: 24px;
  margin: 0 0 8px;
}

.description {
  color: var(--text-muted);
  max-width: 600px;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
}

.model-cards-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.model-card {
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  position: relative;
}

.model-card:hover {
  border-color: var(--text-muted);
  transform: translateY(-4px);
  box-shadow: 0 12px 24px -12px rgba(0,0,0,0.2);
}

.model-card.is-active {
  border-color: #2ea043;
  background: linear-gradient(135deg, var(--bg-card), rgba(46, 160, 67, 0.03));
}

.card-status-bar {
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--glass-border);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status-badge.active {
  color: #2ea043;
}

.status-badge.inactive {
  color: var(--text-muted);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2ea043;
  box-shadow: 0 0 8px #2ea043;
}

.card-actions-mini {
  display: flex;
  gap: 4px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: var(--bg-base);
  color: var(--text-primary);
}

.card-body {
  padding: 24px 20px;
  flex: 1;
}

.model-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.provider-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  background: var(--bg-base);
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  color: var(--text-muted);
  text-transform: uppercase;
}

.model-info strong {
  font-size: 16px;
  color: var(--text-primary);
}

.model-info p {
  font-size: 13px;
  margin: 0;
  display: flex;
  gap: 8px;
}

.model-info p span {
  color: var(--text-muted);
  width: 32px;
  font-weight: 500;
}

.connectivity-info {
  margin-top: 16px;
  font-size: 12px;
}

.status-text.ok {
  color: #2ea043;
}

.card-footer-actions {
  padding: 16px 20px;
  background: rgba(0, 0, 0, 0.1);
  border-top: 1px solid var(--glass-border);
}

.primary-ghost {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-primary);
  width: 100%;
  padding: 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.primary-ghost:hover:not(.disabled) {
  background: #2ea043;
  color: white;
  border-color: #2ea043;
}

.model-card.is-active .primary-ghost.disabled {
  color: #2ea043;
  font-weight: 700;
  border-color: transparent;
  cursor: default;
}

.storage-section {
  margin-top: 32px;
}

.setting-row { margin-bottom: 24px; }
.path-text { font-family: monospace; font-size: 12px; background: var(--bg-base); padding: 8px; border-radius: 4px; border: 1px solid var(--glass-border); }

.approval-controls {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 14px;
}
</style>

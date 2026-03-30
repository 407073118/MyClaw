<template>
  <main class="page-container">
    <header class="page-header">
      <div class="header-text">
        <span class="eyebrow">Managed Skills</span>
        <h2 class="page-title">技能管理</h2>
        <p class="page-subtitle">
          当前页面按标准 `SKILL.md` 包展示本地 Skills。点击任意 Skill 即可查看完整 `SKILL.md` 正文与包结构。
        </p>
      </div>
    </header>

    <p v-if="workspace.skills.length === 0" class="empty-copy">当前还没有可用 Skill。</p>

    <section v-else class="skills-grid">
      <button
        v-for="skill in workspace.skills"
        :key="skill.id"
        type="button"
        class="skill-card"
        :data-testid="`skill-card-${skill.id}`"
        @click="openSkillDetail(skill)"
      >
        <div class="skill-header">
          <div class="skill-title-block">
            <h3>{{ skill.name }}</h3>
            <span :class="['status-badge', { enabled: skill.enabled }]">
              {{ skill.enabled ? "已启用" : "已停用" }}
            </span>
          </div>
          <p class="skill-desc">{{ skill.description }}</p>
        </div>

        <div class="skill-meta">
          <div class="meta-item">
            <span class="meta-label">入口</span>
            <span class="meta-value">SKILL.md</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">结构</span>
            <div class="package-chip-list">
              <span
                v-for="feature in describeSkillPackage(skill)"
                :key="`${skill.id}-${feature}`"
                class="package-chip"
              >
                {{ feature }}
              </span>
            </div>
          </div>
        </div>

        <div class="skill-footer">
          <span class="entry-preview">{{ buildFallbackEntryPath(skill.path) }}</span>
          <span class="detail-link">查看 SKILL.md</span>
        </div>
      </button>
    </section>

    <div v-if="selectedSkill" class="modal-overlay" @click.self="closeSkillDetail">
      <section class="detail-modal">
        <header class="detail-header">
          <div class="detail-header-copy">
            <span class="eyebrow">Skill Detail</span>
            <h3 class="detail-title" data-testid="skill-detail-title">{{ selectedSkill.name }}</h3>
            <p class="detail-summary">{{ selectedSkill.description }}</p>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Close skill detail"
            @click="closeSkillDetail"
          >
            ×
          </button>
        </header>

        <div class="detail-meta-grid">
          <div class="detail-meta-item">
            <span class="meta-label">入口文件</span>
            <code class="entry-path" data-testid="skill-detail-entry-path">{{ selectedEntryPath }}</code>
          </div>
          <div class="detail-meta-item">
            <span class="meta-label">标准目录</span>
            <div class="package-chip-list">
              <span
                v-for="feature in describeSkillPackage(selectedSkill)"
                :key="`detail-${selectedSkill.id}-${feature}`"
                class="package-chip"
              >
                {{ feature }}
              </span>
            </div>
          </div>
        </div>

        <p v-if="detailError" class="detail-error">{{ detailError }}</p>
        <div v-else-if="detailLoading" class="detail-loading">正在加载 SKILL.md…</div>
        <pre
          v-else-if="selectedSkillDetail"
          class="detail-content"
          data-testid="skill-detail-content"
        >{{ selectedSkillDetail.content }}</pre>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import type { SkillDefinition, SkillDetail } from "@myclaw-desktop/shared";
import { computed, ref } from "vue";

import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const selectedSkill = ref<SkillDefinition | null>(null);
const selectedSkillDetailState = ref<SkillDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);

const selectedSkillDetail = computed(() => selectedSkillDetailState.value);

const selectedEntryPath = computed(() => {
  if (!selectedSkill.value) {
    return "";
  }

  return selectedSkillDetail.value?.entryPath ?? buildFallbackEntryPath(selectedSkill.value.path);
});

/** 基于 Skill 根目录拼出默认的 SKILL.md 路径预览。 */
function buildFallbackEntryPath(skillPath: string): string {
  return `${skillPath}/SKILL.md`;
}

/** 把标准 skill 包结构整理成稳定展示顺序，便于用户理解包能力。 */
function describeSkillPackage(skill: SkillDefinition): string[] {
  const features = ["SKILL.md"];

  if (skill.hasScriptsDirectory) {
    features.push("scripts");
  }
  if (skill.hasReferencesDirectory) {
    features.push("references");
  }
  if (skill.hasAssetsDirectory) {
    features.push("assets");
  }
  if (skill.hasTestsDirectory) {
    features.push("tests");
  }
  if (skill.hasAgentsDirectory) {
    features.push("agents");
  }

  return features;
}

/** 打开指定 Skill 的详情弹层，并按需加载完整的 SKILL.md。 */
async function openSkillDetail(skill: SkillDefinition) {
  selectedSkill.value = skill;
  selectedSkillDetailState.value = workspace.skillDetails[skill.id] ?? null;
  detailLoading.value = true;
  detailError.value = null;
  console.info("[skills-view] 加载 Skill 详情", {
    skillId: skill.id,
    skillName: skill.name,
  });

  try {
    selectedSkillDetailState.value = await workspace.loadSkillDetail(skill.id);
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : "加载 Skill 详情失败";
    console.error("[skills-view] Skill 详情加载失败", {
      skillId: skill.id,
      detail: detailError.value,
    });
  } finally {
    detailLoading.value = false;
  }
}

/** 关闭 Skill 详情弹层，并清理当前错误与加载状态。 */
function closeSkillDetail() {
  selectedSkill.value = null;
  selectedSkillDetailState.value = null;
  detailLoading.value = false;
  detailError.value = null;
}
</script>

<style scoped>
.page-container {
  height: 100%;
  overflow-y: auto;
}

.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
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

.skill-card {
  display: flex;
  flex-direction: column;
  text-align: left;
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  padding: 24px;
  gap: 20px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
  width: 100%;
  color: inherit;
}

.skill-card:hover {
  transform: translateY(-2px);
  border-color: var(--text-muted);
}

.skill-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.skill-title-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.skill-title-block h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--bg-base);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
}

.status-badge.enabled {
  background: rgba(46, 160, 67, 0.1);
  border-color: rgba(46, 160, 67, 0.2);
  color: #2ea043;
}

.skill-desc {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skill-meta {
  display: grid;
  grid-template-columns: minmax(0, 120px) minmax(0, 1fr);
  gap: 16px;
  padding-top: 20px;
  border-top: 1px solid var(--glass-border);
}

.meta-item,
.detail-meta-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meta-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.meta-value {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

.package-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.package-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: color-mix(in srgb, var(--bg-base, #121214) 82%, white 18%);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1;
}

.skill-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--glass-border);
}

.entry-preview,
.entry-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-muted);
}

.entry-path {
  color: var(--text-primary);
}

.detail-link {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-cyan);
  flex-shrink: 0;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
  display: grid;
  place-items: center;
  padding: 24px;
}

.detail-modal {
  width: min(920px, 100%);
  max-height: min(80vh, 900px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-card, #18181b);
  border: 1px solid var(--glass-border, #27272a);
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.38);
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 24px;
  border-bottom: 1px solid var(--glass-border, #27272a);
}

.detail-header-copy {
  min-width: 0;
}

.detail-title {
  margin: 0;
  font-size: 22px;
  color: var(--text-primary);
}

.detail-summary {
  margin: 8px 0 0;
  color: var(--text-secondary);
  line-height: 1.6;
}

.icon-button {
  background: transparent;
  border: 1px solid var(--glass-border, #3f3f46);
  color: var(--text-secondary, #a1a1aa);
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  transition: all 0.2s;
}

.icon-button:hover {
  color: var(--text-primary);
  border-color: var(--text-primary);
}

.detail-meta-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 16px;
  padding: 20px 24px 0;
}

.detail-loading,
.detail-error,
.detail-content {
  margin: 20px 24px 24px;
}

.detail-loading,
.detail-error {
  font-size: 14px;
  color: var(--text-secondary);
}

.detail-error {
  color: #ef4444;
}

.detail-content {
  flex: 1;
  overflow: auto;
  padding: 20px;
  border-radius: 12px;
  background: var(--bg-base, #121214);
  border: 1px solid var(--glass-border, #27272a);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.65;
  color: var(--text-primary);
  font-size: 13px;
}

@media (max-width: 900px) {
  .detail-meta-grid {
    grid-template-columns: 1fr;
  }

  .skill-meta,
  .skill-footer {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>

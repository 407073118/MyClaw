<template>
  <main class="page-container tools-view">
    <header class="page-header">
      <div class="header-text">
        <p class="eyebrow">工具目录</p>
        <h2 class="page-title">内置工具与 MCP 工具</h2>
        <p class="page-subtitle">统一管理是否启用、是否暴露给模型，以及当前审批策略。</p>
      </div>

      <div class="header-actions tools-header-actions">
        <span v-for="item in headerStats" :key="item.label" class="summary-pill">
          <strong>{{ item.value }}</strong>
          <small>{{ item.label }}</small>
        </span>
      </div>
    </header>

    <article v-for="group in groupedTools" :key="group.id" class="group-card">
      <div class="group-header">
        <div>
          <p class="eyebrow">{{ group.label }}</p>
          <h3>{{ group.title }}</h3>
        </div>
        <span class="count-pill">{{ group.items.length }} 个工具</span>
      </div>

      <ul class="tool-list">
        <li v-for="tool in group.items" :key="tool.id" class="tool-item">
          <div class="tool-main">
            <div class="tool-title-row">
              <strong>{{ tool.name }}</strong>
              <span class="risk-pill">{{ riskLabel(tool.risk) }}</span>
            </div>
            <p>{{ tool.description }}</p>
            <small>{{ tool.id }}</small>
            <small v-if="tool.kind === 'builtin' && tool.requiresAttachedDirectory">需要附加目录</small>
            <small v-if="tool.kind === 'mcp'">归属服务：{{ tool.serverId }}</small>
          </div>

          <div class="tool-controls">
            <label class="switch-row">
              <span>启用</span>
              <input
                :data-testid="`tool-enabled-${tool.id}`"
                :checked="tool.enabled"
                type="checkbox"
                @change="toggleEnabled(tool, ($event.target as HTMLInputElement).checked)"
              />
            </label>

            <label class="switch-row">
              <span>暴露给模型</span>
              <input
                :data-testid="`tool-exposed-${tool.id}`"
                :checked="tool.exposedToModel"
                :disabled="!tool.enabled"
                type="checkbox"
                @change="toggleExposed(tool, ($event.target as HTMLInputElement).checked)"
              />
            </label>

            <span class="approval-pill">{{ approvalModeLabel(tool.effectiveApprovalMode) }}</span>
          </div>
        </li>
      </ul>
    </article>
  </main>
</template>

<script setup lang="ts">
import type {
  BuiltinToolApprovalMode,
  ResolvedBuiltinTool,
  ResolvedMcpTool,
  ToolRiskCategory,
} from "@myclaw-desktop/shared";
import { computed, onMounted } from "vue";

import { useWorkspaceStore } from "@/stores/workspace";

type ToolCard =
  | ({ kind: "builtin" } & ResolvedBuiltinTool)
  | ({ kind: "mcp" } & ResolvedMcpTool);

const workspace = useWorkspaceStore();

const headerStats = computed(() => {
  const managedTools = [...workspace.builtinTools, ...workspace.mcpTools];

  return [
    { label: "个内置工具", value: workspace.builtinTools.length },
    { label: "个 MCP 工具", value: workspace.mcpTools.length },
    { label: "个已暴露", value: managedTools.filter((tool) => tool.exposedToModel).length },
  ];
});

const groupedTools = computed(() => {
  const builtinTitles: Record<string, string> = {
    fs: "文件",
    exec: "执行",
    git: "代码仓库",
    process: "进程",
    http: "网络",
    archive: "归档",
  };

  const groups = [...workspace.builtinTools]
    .map<ToolCard>((tool) => ({ ...tool, kind: "builtin" }))
    .reduce<Array<{ id: string; label: string; title: string; items: ToolCard[] }>>((result, tool) => {
      const existing = result.find((item) => item.id === `builtin-${tool.group}`);
      if (existing) {
        existing.items.push(tool);
        return result;
      }

      result.push({
        id: `builtin-${tool.group}`,
        label: tool.group,
        title: builtinTitles[tool.group] ?? tool.group,
        items: [tool],
      });
      return result;
    }, []);

  if (workspace.mcpTools.length > 0) {
    groups.push({
      id: "mcp",
      label: "mcp",
      title: "MCP 工具",
      items: [...workspace.mcpTools]
        .map<ToolCard>((tool) => ({ ...tool, kind: "mcp" }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    });
  }

  return groups;
});

onMounted(() => {
  if (workspace.builtinTools.length === 0) {
    void workspace.loadBuiltinTools();
  }
  if (workspace.mcpTools.length === 0) {
    void workspace.loadMcpTools();
  }
});

function riskLabel(risk: ToolRiskCategory) {
  return (
    {
      read: "读取",
      write: "写入",
      exec: "执行",
      install: "安装",
      network: "联网",
    }[risk] ?? risk
  );
}

function approvalModeLabel(mode: BuiltinToolApprovalMode) {
  return (
    {
      inherit: "跟随全局策略",
      "always-ask": "始终询问",
      "always-allow": "始终允许",
    }[mode] ?? mode
  );
}

async function toggleEnabled(tool: ToolCard, enabled: boolean) {
  const payload = {
    enabled,
    exposedToModel: enabled ? tool.exposedToModel : false,
    approvalModeOverride: tool.effectiveApprovalMode,
  };

  if (tool.kind === "builtin") {
    await workspace.updateBuiltinToolPreference(tool.id, payload);
    return;
  }

  await workspace.updateMcpToolPreference(tool.id, payload);
}

async function toggleExposed(tool: ToolCard, exposedToModel: boolean) {
  const payload = {
    enabled: tool.enabled,
    exposedToModel,
    approvalModeOverride: tool.effectiveApprovalMode,
  };

  if (tool.kind === "builtin") {
    await workspace.updateBuiltinToolPreference(tool.id, payload);
    return;
  }

  await workspace.updateMcpToolPreference(tool.id, payload);
}
</script>

<style scoped>
.tools-view {
  flex: 1;
  overflow-y: auto;
}

.group-card {
  padding: 32px;
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
}

.tools-header-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.summary-pill {
  min-width: 112px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-pill strong {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
}

.summary-pill small,
.tool-main p,
.tool-main small,
.group-header p {
  color: var(--text-secondary);
}

.summary-pill small {
  font-size: 12px;
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 24px;
}

.group-header h3 {
  margin: 0;
  color: var(--text-primary);
}

.count-pill,
.risk-pill,
.approval-pill {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
}

.tool-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(440px, 1fr));
  gap: 16px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.tool-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 20px;
  padding: 20px;
  border-radius: var(--radius-md);
  background: var(--bg-base);
  border: 1px solid var(--glass-border);
  transition: all 0.2s ease;
}

.tool-item:hover {
  border-color: var(--text-secondary);
}

.tool-main {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.tool-title-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.tool-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-end;
  justify-content: center;
}

.switch-row {
  display: flex;
  gap: 12px;
  align-items: center;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
}

@media (max-width: 1024px) {
  .tool-list {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .tools-header-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .tool-item {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .tool-controls {
    align-items: flex-start;
  }
}
</style>

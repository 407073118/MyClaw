<template>
  <main data-testid="mcp-view" class="page-container">
    <header class="page-header">
      <div class="header-text">
        <span class="eyebrow">全局 MCP</span>
        <h2 class="page-title">MCP 服务库</h2>
        <p class="page-subtitle">用卡片统一管理 MCP 服务，进入详情页查看配置、状态与工具。</p>
      </div>
      <RouterLink to="/mcp/new" class="btn-premium accent new-button" data-testid="mcp-new-button">
        新建 MCP
      </RouterLink>
    </header>

    <p v-if="loadError" class="error-copy">{{ loadError }}</p>

    <section v-else-if="servers.length === 0" class="empty-state" data-testid="mcp-empty-state">
      当前还没有 MCP 服务，先新建一个吧。
    </section>

    <section v-else class="card-grid">
      <McpLibraryCard
        v-for="server in servers"
        :key="server.id"
        :server="server"
        @refresh="handleRefresh"
        @toggle="handleToggle"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import type { McpServer, McpServerConfig } from "@myclaw-desktop/shared";
import { computed, onMounted, ref } from "vue";

import McpLibraryCard from "@/components/mcp/McpLibraryCard.vue";
import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const loadError = ref("");

const servers = computed(() => workspace.mcpServers);

onMounted(() => {
  if (workspace.mcpServers.length > 0) {
    return;
  }

  console.info("[mcp-view] MCP 服务列表为空，开始加载");
  void workspace.loadMcpServers().catch((error: unknown) => {
    loadError.value = error instanceof Error ? error.message : "加载 MCP 服务失败。";
    console.error("[mcp-view] 加载 MCP 服务失败", {
      detail: loadError.value,
    });
  });
});

/** 从服务快照中提取可提交的配置对象。 */
function toServerConfig(server: McpServer, enabled = server.enabled): McpServerConfig {
  if (server.transport === "http") {
    return {
      id: server.id,
      name: server.name,
      source: server.source,
      enabled,
      transport: "http",
      url: server.url,
      ...(server.headers ? { headers: server.headers } : {}),
    };
  }

  return {
    id: server.id,
    name: server.name,
    source: server.source,
    enabled,
    transport: "stdio",
    command: server.command,
    ...(server.args ? { args: server.args } : {}),
    ...(server.cwd ? { cwd: server.cwd } : {}),
    ...(server.env ? { env: server.env } : {}),
  };
}

/** 刷新指定 MCP 服务。 */
async function handleRefresh(serverId: string) {
  console.info("[mcp-view] 刷新 MCP 服务", { serverId });
  try {
    await workspace.refreshMcpServer(serverId);
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "刷新 MCP 服务失败。";
    console.error("[mcp-view] 刷新 MCP 服务失败", {
      serverId,
      detail: loadError.value,
    });
  }
}

/** 切换指定 MCP 服务启用状态。 */
async function handleToggle(serverId: string) {
  const server = workspace.mcpServers.find((item) => item.id === serverId);
  if (!server) {
    loadError.value = "未找到要切换的 MCP 服务。";
    console.error("[mcp-view] 切换 MCP 服务失败", { serverId, detail: loadError.value });
    return;
  }

  console.info("[mcp-view] 切换 MCP 服务启用状态", {
    serverId,
    enabled: server.enabled,
  });
  try {
    await workspace.updateMcpServer(serverId, toServerConfig(server, !server.enabled));
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "切换 MCP 服务状态失败。";
    console.error("[mcp-view] 切换 MCP 服务状态失败", {
      serverId,
      detail: loadError.value,
    });
  }
}
</script>

<style scoped>
.page-container {
  height: 100%;
  overflow-y: auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
  margin-bottom: 28px;
}

.header-text {
  min-width: 0;
}

.eyebrow {
  display: inline-block;
  margin-bottom: 8px;
  color: var(--accent-cyan, #67e8f9);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.page-title {
  margin: 0;
  color: var(--text-primary, #fff);
  font-size: 28px;
}

.page-subtitle {
  margin: 10px 0 0;
  max-width: 620px;
  color: var(--text-secondary, #b0b0b8);
  line-height: 1.7;
}

.new-button {
  text-decoration: none;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
}

.empty-state,
.error-copy {
  padding: 48px 24px;
  border-radius: 16px;
  text-align: center;
}

.empty-state {
  border: 1px dashed var(--glass-border, #3f3f46);
  color: var(--text-secondary, #b0b0b8);
  background: color-mix(in srgb, var(--bg-card, #1b1b20) 70%, transparent);
}

.error-copy {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

@media (max-width: 720px) {
  .page-header {
    flex-direction: column;
  }
}
</style>

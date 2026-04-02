import React, { useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspace";

type ToolRiskCategory = "read" | "write" | "exec" | "install" | "network";
type BuiltinToolApprovalMode = "inherit" | "always-ask" | "always-allow";

interface ResolvedBuiltinTool {
  id: string;
  name: string;
  description: string;
  group: string;
  risk: ToolRiskCategory;
  enabled: boolean;
  exposedToModel: boolean;
  effectiveApprovalMode: BuiltinToolApprovalMode;
  requiresAttachedDirectory?: boolean;
}

interface ResolvedMcpTool {
  id: string;
  name: string;
  description: string;
  risk: ToolRiskCategory;
  enabled: boolean;
  exposedToModel: boolean;
  effectiveApprovalMode: BuiltinToolApprovalMode;
  serverId: string;
}

type ToolCard =
  | ({ kind: "builtin" } & ResolvedBuiltinTool)
  | ({ kind: "mcp" } & ResolvedMcpTool);

function riskLabel(risk: ToolRiskCategory): string {
  return ({ read: "读取", write: "写入", exec: "执行", install: "安装", network: "联网" } as Record<string, string>)[risk] ?? risk;
}

function approvalModeLabel(mode: BuiltinToolApprovalMode): string {
  return ({ inherit: "跟随全局策略", "always-ask": "始终询问", "always-allow": "始终允许" } as Record<string, string>)[mode] ?? mode;
}

const BUILTIN_TITLES: Record<string, string> = {
  fs: "文件",
  exec: "执行",
  git: "代码仓库",
  process: "进程",
  http: "网络",
  archive: "归档",
};

export default function ToolsPage() {
  const workspace = useWorkspaceStore();

  useEffect(() => {
    if ((workspace.builtinTools ?? []).length === 0) void workspace.loadBuiltinTools();
    if ((workspace.mcpTools ?? []).length === 0) void workspace.loadMcpTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headerStats = (() => {
    const managedTools = [...(workspace.builtinTools ?? []), ...(workspace.mcpTools ?? [])];
    return [
      { label: "个内置工具", value: (workspace.builtinTools ?? []).length },
      { label: "个 MCP 工具", value: (workspace.mcpTools ?? []).length },
      { label: "个已暴露", value: managedTools.filter((t: any) => t.exposedToModel).length },
    ];
  })();

  const groupedTools = (() => {
    const groups = [...(workspace.builtinTools ?? [])]
      .map<ToolCard>((tool: any) => ({ ...tool, kind: "builtin" }))
      .reduce<Array<{ id: string; label: string; title: string; items: ToolCard[] }>>((result, tool) => {
        const groupId = `builtin-${(tool as any).group}`;
        const existing = result.find((item) => item.id === groupId);
        if (existing) { existing.items.push(tool); return result; }
        result.push({ id: groupId, label: (tool as any).group, title: BUILTIN_TITLES[(tool as any).group] ?? (tool as any).group, items: [tool] });
        return result;
      }, []);

    if ((workspace.mcpTools ?? []).length > 0) {
      groups.push({
        id: "mcp",
        label: "mcp",
        title: "MCP 工具",
        items: [...(workspace.mcpTools ?? [])].map<ToolCard>((tool: any) => ({ ...tool, kind: "mcp" })).sort((a, b) => a.id.localeCompare(b.id)),
      });
    }

    return groups;
  })();

  async function toggleEnabled(tool: ToolCard, enabled: boolean) {
    const payload = { enabled, exposedToModel: enabled ? tool.exposedToModel : false, approvalModeOverride: tool.effectiveApprovalMode };
    if (tool.kind === "builtin") {
      await workspace.updateBuiltinToolPreference(tool.id, payload);
    } else {
      await workspace.updateMcpToolPreference(tool.id, payload);
    }
  }

  async function toggleExposed(tool: ToolCard, exposedToModel: boolean) {
    const payload = { enabled: tool.enabled, exposedToModel, approvalModeOverride: tool.effectiveApprovalMode };
    if (tool.kind === "builtin") {
      await workspace.updateBuiltinToolPreference(tool.id, payload);
    } else {
      await workspace.updateMcpToolPreference(tool.id, payload);
    }
  }

  return (
    <main className="page-container tools-view">
      <header className="page-header">
        <div className="header-text">
          <p className="eyebrow">工具目录</p>
          <h2 className="page-title">内置工具与 MCP 工具</h2>
          <p className="page-subtitle">统一管理是否启用、是否暴露给模型，以及当前审批策略。</p>
        </div>
        <div className="header-actions tools-header-actions">
          {headerStats.map((item) => (
            <span key={item.label} className="summary-pill">
              <strong>{item.value}</strong>
              <small>{item.label}</small>
            </span>
          ))}
        </div>
      </header>

      {groupedTools.map((group) => (
        <article key={group.id} className="group-card">
          <div className="group-header">
            <div>
              <p className="eyebrow">{group.label}</p>
              <h3>{group.title}</h3>
            </div>
            <span className="count-pill">{group.items.length} 个工具</span>
          </div>
          <ul className="tool-list">
            {group.items.map((tool) => (
              <li key={tool.id} className="tool-item">
                <div className="tool-main">
                  <div className="tool-title-row">
                    <strong>{tool.name}</strong>
                    <span className="risk-pill">{riskLabel(tool.risk)}</span>
                  </div>
                  <p>{tool.description}</p>
                  <small>{tool.id}</small>
                  {tool.kind === "builtin" && (tool as any).requiresAttachedDirectory && <small>需要附加目录</small>}
                  {tool.kind === "mcp" && <small>归属服务：{(tool as any).serverId}</small>}
                </div>
                <div className="tool-controls">
                  <label className="switch-row">
                    <span>启用</span>
                    <input
                      data-testid={`tool-enabled-${tool.id}`}
                      type="checkbox"
                      checked={tool.enabled}
                      onChange={(e) => void toggleEnabled(tool, e.target.checked)}
                    />
                  </label>
                  <label className="switch-row">
                    <span>暴露给模型</span>
                    <input
                      data-testid={`tool-exposed-${tool.id}`}
                      type="checkbox"
                      checked={tool.exposedToModel}
                      disabled={!tool.enabled}
                      onChange={(e) => void toggleExposed(tool, e.target.checked)}
                    />
                  </label>
                  <span className="approval-pill">{approvalModeLabel(tool.effectiveApprovalMode)}</span>
                </div>
              </li>
            ))}
          </ul>
        </article>
      ))}

      <style>{`
        .tools-view { flex: 1; overflow-y: auto; }
        .group-card { padding: 32px; border-radius: var(--radius-lg); background: var(--bg-card); border: 1px solid var(--glass-border); margin-bottom: 16px; }
        .tools-header-actions { flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
        .summary-pill { min-width: 112px; padding: 12px 14px; border-radius: var(--radius-md); border: 1px solid var(--glass-border); background: var(--bg-card); display: flex; flex-direction: column; gap: 4px; }
        .summary-pill strong { color: var(--text-primary); font-size: 18px; font-weight: 700; line-height: 1; }
        .summary-pill small, .tool-main p, .tool-main small, .group-header p { color: var(--text-secondary); }
        .summary-pill small { font-size: 12px; }
        .group-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px; }
        .group-header h3 { margin: 0; color: var(--text-primary); }
        .count-pill, .risk-pill, .approval-pill { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--glass-border); background: var(--bg-base); color: var(--text-primary); font-size: 12px; font-weight: 500; }
        .tool-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: 16px; list-style: none; padding: 0; margin: 0; }
        .tool-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; padding: 20px; border-radius: var(--radius-md); background: var(--bg-base); border: 1px solid var(--glass-border); transition: all 0.2s ease; }
        .tool-item:hover { border-color: var(--text-secondary); }
        .tool-main { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
        .tool-title-row { display: flex; gap: 12px; align-items: center; }
        .tool-main strong { color: var(--text-primary); font-size: 14px; font-weight: 600; }
        .tool-main p { font-size: 13px; margin: 0; line-height: 1.5; }
        .tool-main small { font-size: 11px; color: var(--text-muted); font-family: monospace; }
        .tool-controls { display: flex; flex-direction: column; gap: 12px; align-items: flex-end; justify-content: center; }
        .switch-row { display: flex; gap: 12px; align-items: center; color: var(--text-primary); font-size: 13px; cursor: pointer; }
        @media (max-width: 1024px) { .tool-list { grid-template-columns: 1fr; } }
        @media (max-width: 768px) {
          .tools-header-actions { width: 100%; justify-content: flex-start; }
          .tool-item { grid-template-columns: 1fr; gap: 16px; }
          .tool-controls { align-items: flex-start; }
        }
      `}</style>
    </main>
  );
}

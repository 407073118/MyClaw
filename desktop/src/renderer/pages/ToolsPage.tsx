import React, { useEffect } from "react";
import { Power, ShieldCheck, Wrench } from "lucide-react";
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
  return ({ read: "读取", write: "写入", exec: "执行", install: "安装", network: "网络" } as Record<string, string>)[risk] ?? risk;
}

function riskTone(risk: ToolRiskCategory): "green" | "yellow" | "accent" | "red" | "muted" {
  return ({
    read: "green",
    write: "yellow",
    exec: "red",
    install: "accent",
    network: "accent",
  } as Record<string, "green" | "yellow" | "accent" | "red" | "muted">)[risk] ?? "muted";
}

function approvalModeLabel(mode: BuiltinToolApprovalMode): string {
  return ({ inherit: "继承环境", "always-ask": "每次确认", "always-allow": "始终放行" } as Record<
    string,
    string
  >)[mode] ?? mode;
}

const BUILTIN_TITLES: Record<string, string> = {
  fs: "文件",
  exec: "执行",
  git: "源码版本",
  process: "进程",
  http: "网络",
  archive: "归档",
};

function formatApprovalMode(mode: BuiltinToolApprovalMode) {
  return approvalModeLabel(mode);
}

export default function ToolsPage() {
  const workspace = useWorkspaceStore();

  /** 初始化时拉取内置工具与 MCP 工具，两类数据都作为桌面列表页展示源。 */
  useEffect(() => {
    if ((workspace.builtinTools ?? []).length === 0) void workspace.loadBuiltinTools();
    if ((workspace.mcpTools ?? []).length === 0) void workspace.loadMcpTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 页面顶部统计卡片：总内置、总 MCP、模型可见总量。 */
  const headerStats = (() => {
    const managedTools = [...(workspace.builtinTools ?? []), ...(workspace.mcpTools ?? [])];
    return [
      { label: "内置工具", value: (workspace.builtinTools ?? []).length },
      { label: "MCP 工具", value: (workspace.mcpTools ?? []).length },
      { label: "对模型可见", value: managedTools.filter((tool) => tool.exposedToModel).length },
    ];
  })();

  /** 将工具按分类分组，沿用桌面端列表模式显示每个分组下的列表。 */
  const groupedTools = (() => {
    const groups = [...(workspace.builtinTools ?? [])]
      .map<ToolCard>((tool) => ({ ...tool, kind: "builtin" }))
      .reduce<Array<{ id: string; label: string; title: string; items: ToolCard[] }>>((result, tool) => {
        const groupId = `builtin-${(tool as ResolvedBuiltinTool).group}`;
        const existing = result.find((item) => item.id === groupId);
        const builtinTool = tool as ResolvedBuiltinTool;
        if (existing) {
          existing.items.push(tool);
          return result;
        }

        result.push({
          id: groupId,
          label: builtinTool.group,
          title: BUILTIN_TITLES[builtinTool.group] ?? builtinTool.group,
          items: [tool],
        });
        return result;
      }, []);

    if ((workspace.mcpTools ?? []).length > 0) {
      groups.push({
        id: "mcp",
        label: "mcp",
        title: "MCP 工具",
        items: [...(workspace.mcpTools ?? [])]
          .map<ToolCard>((tool) => ({ ...tool, kind: "mcp" }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      });
    }

    return groups;
  })();

  /** 切换工具启用状态，并写入日志便于排查配置写入路径。 */
  async function toggleEnabled(tool: ToolCard, enabled: boolean) {
    const payload = {
      enabled,
      exposedToModel: enabled ? tool.exposedToModel : false,
      approvalModeOverride: tool.effectiveApprovalMode,
    };
    console.info("[tools-page] 切换工具启用状态", {
      id: tool.id,
      name: tool.name,
      enabled,
      group: "kind" in tool ? tool.kind : "unknown",
    });

    try {
      if (tool.kind === "builtin") {
        await workspace.updateBuiltinToolPreference(tool.id, payload);
      } else {
        await workspace.updateMcpToolPreference(tool.id, payload);
      }
    } catch (error) {
      console.error("[tools-page] 更新工具启用状态失败", { toolId: tool.id, error: String(error) });
    }
  }

  /** 切换“是否向模型暴露”开关，关闭时自动保持工具自身可用。 */
  async function toggleExposed(tool: ToolCard, exposedToModel: boolean) {
    const payload = {
      enabled: tool.enabled,
      exposedToModel,
      approvalModeOverride: tool.effectiveApprovalMode,
    };
    console.info("[tools-page] 切换工具模型可见性", {
      id: tool.id,
      name: tool.name,
      exposedToModel,
    });

    try {
      if (tool.kind === "builtin") {
        await workspace.updateBuiltinToolPreference(tool.id, payload);
      } else {
        await workspace.updateMcpToolPreference(tool.id, payload);
      }
    } catch (error) {
      console.error("[tools-page] 更新工具模型可见性失败", { toolId: tool.id, error: String(error) });
    }
  }

  return (
    <div className="page-shell">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <Wrench size={14} />
            <span>Tools</span>
          </div>
          <h2 className="page-header__title">工具中心</h2>
          <p className="page-header__subtitle">统一展示内置工具与 MCP 工具，并控制“是否启用 / 是否向模型暴露”。</p>
        </div>
        <div className="page-header__actions tools-header-actions">
          {headerStats.map((item) => (
            <span key={item.label} className="tools-summary-chip">
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </span>
          ))}
        </div>
      </header>

      <main className="page-content">
        {groupedTools.length === 0 ? (
          <section className="empty-state">
            <Wrench size={32} className="empty-state__icon" />
            <h3 className="empty-state__title">暂无可用工具</h3>
            <p className="empty-state__body">
              先在运行环境初始化完成后再刷新试试，或前往 MCP 配置页添加工具源。
            </p>
          </section>
        ) : (
          <div className="tools-groups">
            {groupedTools.map((group) => (
              <section key={group.id} className="tools-group">
                <header className="tools-group__header">
                  <div className="tools-group__info">
                    <p className="tools-group__kind">{group.label}</p>
                    <h3 className="tools-group__title">{group.title}</h3>
                    <p className="tools-group__subtitle">
                      {group.title} 中的工具用于在工作流与聊天运行时触发外部能力。
                    </p>
                  </div>
                  <span className="tools-group__count">{group.items.length} 个</span>
                </header>

                <div className="list-rows">
                  {group.items.map((tool) => {
                    const isBuiltin = tool.kind === "builtin";
                    const builtinTool = tool as ResolvedBuiltinTool;
                    const mcpTool = tool as ResolvedMcpTool;
                    const sourceLabel = isBuiltin ? `内置分组：${builtinTool.group}` : `来源服务器：${mcpTool.serverId}`;
                    const scopeLabel = isBuiltin ? "内置" : "MCP";
                    const scopeTone = isBuiltin ? "accent" : "green";

                    return (
                      <article key={tool.id} className={`list-row${!tool.enabled ? " is-disabled" : ""}`}>
                        <div className="list-row__lead">
                          <span
                            className={`status-dot status-dot--${tool.enabled ? "green" : "muted"}`}
                            title={tool.enabled ? "已启用" : "未启用"}
                          />
                        </div>

                        <div className="list-row__main">
                          <div className="list-row__title-row">
                            <span className="list-row__title">{tool.name}</span>
                            <span className={`tag tag--${scopeTone}`}>{scopeLabel}</span>
                            <span className={`tag tag--${riskTone(tool.risk)}`}>{riskLabel(tool.risk)}</span>
                            {tool.exposedToModel ? (
                              <span className="tag tag--green">已暴露</span>
                            ) : (
                              <span className="tag tag--muted">未暴露</span>
                            )}
                          </div>
                          <div className="list-row__description">{tool.description}</div>
                          <div className="list-row__meta-row">
                            <span className="list-row__meta list-row__meta--mono">{tool.id}</span>
                            <span className="list-row__meta-sep" />
                            <span className="list-row__meta">{sourceLabel}</span>
                            {isBuiltin && builtinTool.requiresAttachedDirectory ? (
                              <>
                                <span className="list-row__meta-sep" />
                                <span className="list-row__meta">需工作目录上下文</span>
                              </>
                            ) : null}
                          </div>
                        </div>

                        <div className="list-row__trailing tools-row__controls">
                          <button
                            type="button"
                            className="btn-toolbar tools-toggle-btn"
                            onClick={() => void toggleEnabled(tool, !tool.enabled)}
                          >
                            <Power size={12} />
                            {tool.enabled ? "停用" : "启用"}
                          </button>
                          <button
                            type="button"
                            className="btn-toolbar tools-toggle-btn"
                            disabled={!tool.enabled}
                            onClick={() => void toggleExposed(tool, !tool.exposedToModel)}
                          >
                            <ShieldCheck size={12} />
                            {tool.exposedToModel ? "取消暴露" : "向模型暴露"}
                          </button>
                          <span className="tag tag--yellow tools-approval">{formatApprovalMode(tool.effectiveApprovalMode)}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <style>{`
        .tools-header-actions {
          align-items: stretch;
          justify-content: flex-end;
          flex-wrap: wrap;
        }

        .tools-summary-chip {
          min-width: 112px;
          padding: 8px 12px;
          border-radius: var(--radius-lg);
          border: 1px solid var(--glass-border);
          background: rgba(255, 255, 255, 0.03);
          display: grid;
          gap: 4px;
          justify-items: start;
        }

        .tools-summary-chip strong {
          font-size: 18px;
          color: var(--text-primary);
          line-height: 1;
          font-weight: 700;
        }

        .tools-summary-chip span {
          font-size: 11px;
          color: var(--text-muted);
        }

        .tools-groups {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .tools-group {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-xl);
          background: var(--bg-surface);
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          box-shadow: var(--shadow-card), var(--glass-inner-glow);
        }

        .tools-group__header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .tools-group__info {
          min-width: 0;
          display: grid;
          gap: 4px;
        }

        .tools-group__kind {
          margin: 0;
          color: var(--text-muted);
          font-size: 12px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          font-weight: 600;
        }

        .tools-group__title {
          margin: 0;
          color: var(--text-primary);
          font-size: 18px;
          font-weight: 700;
          line-height: 1.2;
        }

        .tools-group__subtitle {
          margin: 0;
          color: var(--text-secondary);
          font-size: 12px;
        }

        .tools-group__count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 4px 10px;
          border-radius: 999px;
          height: 24px;
          border: 1px solid var(--glass-border);
          background: rgba(255, 255, 255, 0.03);
          color: var(--text-secondary);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .tools-row__controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .tools-toggle-btn {
          height: 30px;
          gap: 6px;
          padding: 0 10px;
          font-size: 12px;
          min-width: 86px;
        }

        .tools-approval {
          white-space: nowrap;
        }

        @media (max-width: 1200px) {
          .list-row {
            align-items: flex-start;
          }

          .list-row__trailing {
            justify-content: flex-start;
            width: 100%;
          }

          .tools-row__controls {
            width: 100%;
          }

          .tools-group__header {
            flex-direction: column;
            align-items: flex-start;
          }

          .tools-group__count {
            align-self: flex-start;
          }
        }

        @media (max-width: 768px) {
          .page-content {
            padding: 20px 16px;
          }

          .tools-header-actions {
            width: 100%;
          }

          .tools-summary-chip {
            width: 100%;
            max-width: 124px;
          }
        }
      `}</style>
    </div>
  );
}

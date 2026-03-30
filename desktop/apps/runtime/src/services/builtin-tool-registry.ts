import type {
  BuiltinToolDefinition,
  BuiltinToolPreference,
  ResolvedBuiltinTool,
} from "@myclaw-desktop/shared";
import { ToolRiskCategory } from "@myclaw-desktop/shared";
import type { ModelConversationToolDefinition } from "./model-provider";
import { listBuiltinModelToolDefinitions } from "./model-provider/tool-definitions";

const BUILTIN_TOOL_DEFINITIONS: BuiltinToolDefinition[] = [
  {
    id: "fs.list",
    name: "列出文件",
    description: "列出当前附加工作目录下的文件和子目录。",
    group: "fs",
    risk: ToolRiskCategory.Read,
    requiresAttachedDirectory: true,
    enabledByDefault: true,
    exposedByDefault: true,
    approvalMode: "inherit",
  },
  {
    id: "fs.read",
    name: "读取文件",
    description: "读取当前附加工作目录下的文本文件。",
    group: "fs",
    risk: ToolRiskCategory.Read,
    requiresAttachedDirectory: true,
    enabledByDefault: true,
    exposedByDefault: true,
    approvalMode: "inherit",
  },
  {
    id: "fs.search",
    name: "搜索文件",
    description: "在当前附加工作目录下搜索文本内容。",
    group: "fs",
    risk: ToolRiskCategory.Read,
    requiresAttachedDirectory: true,
    enabledByDefault: true,
    exposedByDefault: true,
    approvalMode: "inherit",
  },
  {
    id: "fs.stat",
    name: "查看文件信息",
    description: "查看当前附加工作目录下的文件元信息。",
    group: "fs",
    risk: ToolRiskCategory.Read,
    requiresAttachedDirectory: true,
    enabledByDefault: true,
    exposedByDefault: true,
    approvalMode: "inherit",
  },
  {
    id: "fs.write",
    name: "写入文件",
    description: "向当前附加工作目录写入文本文件。",
    group: "fs",
    risk: ToolRiskCategory.Write,
    requiresAttachedDirectory: true,
    enabledByDefault: true,
    exposedByDefault: true,
    approvalMode: "always-ask",
  },
  {
    id: "fs.apply_patch",
    name: "应用补丁",
    description: "对当前附加工作目录下的文件应用结构化补丁。",
    group: "fs",
    risk: ToolRiskCategory.Write,
    requiresAttachedDirectory: true,
    enabledByDefault: true,
    exposedByDefault: false,
    approvalMode: "always-ask",
  },
  {
    id: "fs.move",
    name: "移动路径",
    description: "在当前附加工作目录下移动或重命名文件。",
    group: "fs",
    risk: ToolRiskCategory.Write,
    requiresAttachedDirectory: true,
    enabledByDefault: false,
    exposedByDefault: false,
    approvalMode: "always-ask",
  },
  {
    id: "fs.delete",
    name: "删除路径",
    description: "删除当前附加工作目录下的文件或目录。",
    group: "fs",
    risk: ToolRiskCategory.Write,
    requiresAttachedDirectory: true,
    enabledByDefault: false,
    exposedByDefault: false,
    approvalMode: "always-ask",
  },
  {
    id: "exec.command",
    name: "执行命令",
    description: "在当前会话工作目录中执行命令。",
    group: "exec",
    risk: ToolRiskCategory.Exec,
    requiresAttachedDirectory: false,
    enabledByDefault: true,
    exposedByDefault: true,
    approvalMode: "always-ask",
  },
  {
    id: "exec.task",
    name: "执行预设任务",
    description: "执行预定义的开发任务。",
    group: "exec",
    risk: ToolRiskCategory.Exec,
    requiresAttachedDirectory: false,
    enabledByDefault: true,
    exposedByDefault: false,
    approvalMode: "always-ask",
  },
  {
    id: "git.status",
    name: "Git 状态",
    description: "查看仓库工作区状态。",
    group: "git",
    risk: ToolRiskCategory.Read,
    requiresAttachedDirectory: false,
    enabledByDefault: true,
    exposedByDefault: true,
    approvalMode: "inherit",
  },
  {
    id: "git.diff",
    name: "Git 差异",
    description: "查看仓库差异内容。",
    group: "git",
    risk: ToolRiskCategory.Read,
    requiresAttachedDirectory: false,
    enabledByDefault: true,
    exposedByDefault: true,
    approvalMode: "inherit",
  },
  {
    id: "git.show",
    name: "Git 详情",
    description: "查看仓库中的提交或对象详情。",
    group: "git",
    risk: ToolRiskCategory.Read,
    requiresAttachedDirectory: false,
    enabledByDefault: true,
    exposedByDefault: true,
    approvalMode: "inherit",
  },
  {
    id: "process.list",
    name: "列出进程",
    description: "查看本机正在运行的进程。",
    group: "process",
    risk: ToolRiskCategory.Read,
    requiresAttachedDirectory: false,
    enabledByDefault: false,
    exposedByDefault: false,
    approvalMode: "inherit",
  },
  {
    id: "process.kill",
    name: "结束进程",
    description: "按进程号终止本机进程。",
    group: "process",
    risk: ToolRiskCategory.Exec,
    requiresAttachedDirectory: false,
    enabledByDefault: false,
    exposedByDefault: false,
    approvalMode: "always-ask",
  },
  {
    id: "http.fetch",
    name: "获取网页",
    description: "发起 GET 请求并查看响应内容。",
    group: "http",
    risk: ToolRiskCategory.Network,
    requiresAttachedDirectory: false,
    enabledByDefault: false,
    exposedByDefault: false,
    approvalMode: "always-ask",
  },
  {
    id: "archive.extract",
    name: "解压归档",
    description: "将归档文件解压到当前附加工作目录。",
    group: "archive",
    risk: ToolRiskCategory.Write,
    requiresAttachedDirectory: true,
    enabledByDefault: false,
    exposedByDefault: false,
    approvalMode: "always-ask",
  },
];

const BUILTIN_MODEL_TOOL_DEFINITIONS: Record<string, ModelConversationToolDefinition> =
  listBuiltinModelToolDefinitions();

/** 返回 coding-first 内置工具的静态定义列表。 */
export function listBuiltinToolDefinitions(): BuiltinToolDefinition[] {
  return BUILTIN_TOOL_DEFINITIONS.map((tool) => ({ ...tool }));
}

/** 根据工具 ID 读取静态内置工具定义。 */
export function getBuiltinToolDefinition(toolId: string): BuiltinToolDefinition | null {
  const tool = BUILTIN_TOOL_DEFINITIONS.find((item) => item.id === toolId);
  return tool ? { ...tool } : null;
}

/** 将静态定义与持久化偏好合并为当前可展示的工具目录。 */
export function resolveBuiltinTools(preferences: BuiltinToolPreference[]): ResolvedBuiltinTool[] {
  const preferenceMap = new Map(preferences.map((item) => [item.toolId, item]));

  return BUILTIN_TOOL_DEFINITIONS.map((tool) => {
    const preference = preferenceMap.get(tool.id);

    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      group: tool.group,
      risk: tool.risk,
      requiresAttachedDirectory: tool.requiresAttachedDirectory,
      enabled: preference?.enabled ?? tool.enabledByDefault,
      exposedToModel: preference?.exposedToModel ?? tool.exposedByDefault,
      effectiveApprovalMode: preference?.approvalModeOverride ?? tool.approvalMode,
    };
  });
}

/** 将当前启用且暴露给模型的内置工具转换为模型可消费的 tool schema。 */
export function listExposedBuiltinModelTools(
  tools: ResolvedBuiltinTool[],
): ModelConversationToolDefinition[] {
  return tools
    .filter((tool) => tool.enabled && tool.exposedToModel)
    .map((tool) => BUILTIN_MODEL_TOOL_DEFINITIONS[tool.id])
    .filter((tool): tool is ModelConversationToolDefinition => Boolean(tool))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: { ...tool.parameters },
    }));
}

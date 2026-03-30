import type {
  ApprovalPolicy,
  ApprovalRequest,
  BuiltinToolPreference,
  McpServerConfig,
  McpToolPreference,
} from "@myclaw-desktop/shared";

import { isBuiltinToolApprovalMode, isMcpSource } from "./runtime-state-shared-parsers";

/** 清洗审批策略字段，异常输入按 fallback 回退。 */
export function sanitizeApprovalPolicy(
  input: Partial<ApprovalPolicy> | undefined,
  fallback: ApprovalPolicy,
): ApprovalPolicy {
  if (!input || typeof input !== "object") {
    return fallback;
  }

  return {
    mode:
      input.mode === "prompt" || input.mode === "auto-read-only" || input.mode === "auto-allow-all"
        ? input.mode
        : fallback.mode,
    autoApproveReadOnly:
      typeof input.autoApproveReadOnly === "boolean"
        ? input.autoApproveReadOnly
        : fallback.autoApproveReadOnly,
    autoApproveSkills:
      typeof input.autoApproveSkills === "boolean"
        ? input.autoApproveSkills
        : fallback.autoApproveSkills,
    alwaysAllowedTools: Array.isArray(input.alwaysAllowedTools)
      ? input.alwaysAllowedTools.filter((item): item is string => typeof item === "string")
      : fallback.alwaysAllowedTools,
  };
}

/** 过滤审批请求，仅保留结构完整的记录。 */
export function sanitizeApprovalRequests(
  input: ApprovalRequest[] | undefined,
  fallback: ApprovalRequest[],
): ApprovalRequest[] {
  if (!Array.isArray(input)) {
    return fallback;
  }

  return input.filter((item): item is ApprovalRequest => {
    if (!item || typeof item !== "object") {
      return false;
    }

    return (
      typeof item.id === "string" &&
      typeof item.sessionId === "string" &&
      typeof item.source === "string" &&
      typeof item.toolId === "string" &&
      typeof item.label === "string" &&
      typeof item.risk === "string" &&
      typeof item.detail === "string" &&
      (item.arguments === undefined ||
        (!!item.arguments && typeof item.arguments === "object" && !Array.isArray(item.arguments))) &&
      (item.resumeConversation === undefined || typeof item.resumeConversation === "boolean")
    );
  });
}

/** 清洗 MCP 服务配置，并按传输模式校验关键字段。 */
export function sanitizeMcpServerConfigs(
  input: McpServerConfig[] | undefined,
  fallback: McpServerConfig[],
): McpServerConfig[] {
  if (!Array.isArray(input)) {
    return fallback;
  }

  const sanitized: McpServerConfig[] = [];
  input.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }

    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      !isMcpSource(item.source) ||
      typeof item.enabled !== "boolean"
    ) {
      return;
    }

    if (item.transport === "stdio") {
      if (typeof item.command !== "string" || !item.command.trim()) {
        return;
      }

      const config: McpServerConfig = {
        id: item.id,
        name: item.name,
        source: item.source,
        transport: "stdio",
        command: item.command,
        enabled: item.enabled,
      };
      if (Array.isArray(item.args)) {
        const args = item.args.filter((entry): entry is string => typeof entry === "string");
        if (args.length > 0) {
          config.args = args;
        }
      }
      if (typeof item.cwd === "string" && item.cwd.trim()) {
        config.cwd = item.cwd;
      }
      if (item.env && typeof item.env === "object" && !Array.isArray(item.env)) {
        const envEntries = Object.entries(item.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        );
        if (envEntries.length > 0) {
          config.env = Object.fromEntries(envEntries);
        }
      }
      sanitized.push(config);
      return;
    }

    if (item.transport === "http") {
      if (typeof item.url !== "string" || !item.url.trim()) {
        return;
      }

      const config: McpServerConfig = {
        id: item.id,
        name: item.name,
        source: item.source,
        transport: "http",
        url: item.url,
        enabled: item.enabled,
      };
      if (item.headers && typeof item.headers === "object" && !Array.isArray(item.headers)) {
        const headerEntries = Object.entries(item.headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        );
        if (headerEntries.length > 0) {
          config.headers = Object.fromEntries(headerEntries);
        }
      }
      sanitized.push(config);
    }
  });

  return sanitized;
}

/** 过滤 MCP 工具偏好中的无效项。 */
export function sanitizeMcpToolPreferences(
  input: McpToolPreference[] | undefined,
  fallback: McpToolPreference[],
): McpToolPreference[] {
  if (!Array.isArray(input)) {
    return fallback;
  }

  return input.filter((item): item is McpToolPreference => {
    if (!item || typeof item !== "object") {
      return false;
    }

    return (
      typeof item.toolId === "string" &&
      typeof item.serverId === "string" &&
      typeof item.enabled === "boolean" &&
      typeof item.exposedToModel === "boolean" &&
      (item.approvalModeOverride === null || isBuiltinToolApprovalMode(item.approvalModeOverride)) &&
      typeof item.updatedAt === "string"
    );
  });
}

/** 过滤内置工具偏好中的无效项。 */
export function sanitizeBuiltinToolPreferences(
  input: BuiltinToolPreference[] | undefined,
  fallback: BuiltinToolPreference[],
): BuiltinToolPreference[] {
  if (!Array.isArray(input)) {
    return fallback;
  }

  return input.filter((item): item is BuiltinToolPreference => {
    if (!item || typeof item !== "object") {
      return false;
    }

    return (
      typeof item.toolId === "string" &&
      typeof item.enabled === "boolean" &&
      typeof item.exposedToModel === "boolean" &&
      (item.approvalModeOverride === null || isBuiltinToolApprovalMode(item.approvalModeOverride)) &&
      typeof item.updatedAt === "string"
    );
  });
}

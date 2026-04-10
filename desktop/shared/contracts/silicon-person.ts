import type { SiliconPersonStatus } from "./events";

export type SiliconPersonSource = "personal" | "enterprise" | "hub";

export const SILICON_PERSON_SOURCE_VALUES = [
  "personal",
  "enterprise",
  "hub",
] as const satisfies readonly SiliconPersonSource[];

export type SiliconPersonApprovalMode = "inherit" | "always_ask" | "auto_approve";

export const SILICON_PERSON_APPROVAL_MODE_VALUES = [
  "inherit",
  "always_ask",
  "auto_approve",
] as const satisfies readonly SiliconPersonApprovalMode[];

export type SiliconPersonSessionSummary = {
  id: string;
  title: string;
  status: SiliconPersonStatus;
  unreadCount: number;
  hasUnread: boolean;
  needsApproval: boolean;
  updatedAt: string;
};

export type SiliconPerson = {
  id: string;
  name: string;
  title: string;
  description: string;
  status: SiliconPersonStatus;
  source: SiliconPersonSource;
  approvalMode: SiliconPersonApprovalMode;
  currentSessionId: string | null;
  sessions: SiliconPersonSessionSummary[];
  unreadCount: number;
  hasUnread: boolean;
  needsApproval: boolean;
  workflowIds: string[];
  /** @deprecated 使用 soul 字段替代。 */
  baseIdentity?: string;
  /** @deprecated 使用 soul 字段替代。 */
  rolePersona?: string;
  /** 员工身份人格定义，包含角色、行为风格与个性描述。 */
  soul?: string;
  /** 员工使用的模型 ID，对应用户已配置的 ModelProfile.id。为空时使用全局默认模型。 */
  modelProfileId?: string;
  /** 员工推理等级: low（快速）、medium（思考）、high（深度）。为空时默认 medium。 */
  reasoningEffort?: "low" | "medium" | "high";
  /** 模型配置快照，创建时冻结，不随全局模型变化而更新。 */
  modelBindingSnapshot?: {
    modelProfileId: string;
    modelName: string;
    frozenAt: string;
  } | null;
  /**
   * @deprecated 技能已独立存储在员工工作空间 skills/ 目录下，不再通过 ID 引用全局资源。
   * 保留字段仅为兼容旧数据迁移，新代码不应读写此字段。
   */
  skillIds?: string[];
  /**
   * @deprecated MCP 服务已独立存储在员工工作空间 mcp-servers.json 中，不再通过 ID 引用。
   * 保留字段仅为兼容旧数据迁移，新代码不应读写此字段。
   */
  mcpServerIds?: string[];
  updatedAt: string;
};

/** 统一 currentSession 解析规则，避免多个层各自决定默认 session。 */
export function resolveSiliconPersonCurrentSessionId(input: {
  currentSessionId?: string | null;
  sessions: Array<{ id: string }>;
}): string | null {
  const { currentSessionId, sessions } = input;
  if (currentSessionId && sessions.some((session) => session.id === currentSessionId)) {
    return currentSessionId;
  }
  return sessions[0]?.id ?? null;
}

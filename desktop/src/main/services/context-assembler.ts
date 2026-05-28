/**
 * 上下文组装器 — 将系统提示、近期轮次、工作记忆组装为模型请求消息。
 * 替代原来 sessions.ts 中的 buildModelMessagesWithCompact。
 */

import type {
  ChatSession,
  ExecutionPlan,
  ModelCapability,
  ContextBudgetPolicy,
  ContextCheckpoint,
  ContextCompactionMetadata,
  CompiledContextSection,
  SessionReplayPolicy,
  SkillDefinition,
} from "@shared/contracts";
import { compileContext } from "./context-compiler";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 组装后的上下文结果 */
export type AssembledContext = {
  /** 最终发送给模型的消息列表 */
  messages: Array<{ role: string; content: string; reasoning?: string | null; tool_call_id?: string; tool_calls?: unknown[] }>;
  /** 估算的总 token 数 */
  budgetUsed: number;
  /** 是否执行了压缩 */
  wasCompacted: boolean;
  /** 压缩原因 */
  compactionReason: string | null;
  /** 被移除的消息数 */
  removedCount: number;
  /** 被 Observation Masking 替换的工具输出数 */
  maskedToolOutputCount: number;
  /** 是否建议用户新建对话 */
  shouldSuggestNewChat: boolean;
  /** 本轮上下文编译的结构化元数据。 */
  metadata?: ContextCompactionMetadata;
  /** 本轮压缩生成的结构化检查点。 */
  checkpoint?: ContextCheckpoint;
  /** 本轮上下文编译的预算分段。 */
  sections?: CompiledContextSection[];
  /** 编译阶段产生的警告。 */
  warnings?: string[];
};

export type AssembleInput = {
  session: ChatSession;
  capability: ModelCapability;
  policy?: ContextBudgetPolicy;
  workingDir: string;
  skills?: SkillDefinition[];
  /** 可选的系统提示构建器，不传则使用默认摘要 */
  systemPromptBuilder?: (session: ChatSession, workingDir: string, skills?: SkillDefinition[]) => string;
  /** 可选的工作记忆内容 */
  workingMemory?: string;
  replayPolicy?: SessionReplayPolicy;
  executionPlan?: Pick<ExecutionPlan, "replayPolicy"> | null;
  /** 已累计执行的压缩次数（由调用方跟踪，用于判断是否建议新建对话） */
  priorCompactionCount?: number;
  /** 模型配置级压缩触发阈值，优先于 ratio 派生阈值，但不会放宽安全预算。 */
  compactTriggerTokens?: number;
  /** 当前轮次 ID，用于 checkpoint 和 metadata 关联。 */
  turnId?: string;
};

// ---------------------------------------------------------------------------
// 默认系统提示
// ---------------------------------------------------------------------------

/**
 * 组装完整的模型请求上下文。
 *
 * 流程：
 * 1. 委托 Context Compiler 计算预算、checkpoint、记忆召回和压缩结果
 * 2. 保持旧 AssembledContext 字段，兼容 sessions.ts 和既有测试
 * 3. 透传 metadata/checkpoint/sections，供新 UI 和持久化链路使用
 */
export function assembleContext(input: AssembleInput): AssembledContext {
  const compiled = compileContext(input);
  const wasCompacted = compiled.metadata.removedMessageIds.length > 0 || compiled.metadata.maskedToolOutputIds.length > 0;
  const currentCompactionCount = (input.priorCompactionCount ?? 0) + (wasCompacted ? 1 : 0);
  const suggestThreshold = input.policy?.suggestNewChatAfterCompactions ?? 2;
  const totalOriginalMessages = input.session.messages.length;
  const removedRatio = totalOriginalMessages > 0
    ? compiled.metadata.removedMessageIds.length / totalOriginalMessages
    : 0;
  const shouldSuggestNewChat =
    currentCompactionCount >= suggestThreshold ||
    totalOriginalMessages >= 100 ||
    removedRatio > 0.6;

  return {
    messages: compiled.messages,
    budgetUsed: compiled.metadata.budgetUsed,
    wasCompacted,
    compactionReason: compiled.metadata.reason === "within-budget" ? null : compiled.metadata.reason,
    removedCount: compiled.metadata.removedMessageIds.length,
    maskedToolOutputCount: compiled.metadata.maskedToolOutputIds.length,
    shouldSuggestNewChat,
    metadata: compiled.metadata,
    checkpoint: compiled.checkpoint,
    sections: compiled.sections,
    warnings: compiled.warnings,
  };
}

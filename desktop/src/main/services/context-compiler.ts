/**
 * 跨模型上下文编译器 — 将原始会话编译为本轮可发送的模型上下文。
 *
 * 设计原则：原始消息不删除；checkpoint、记忆召回和压缩 metadata 都是本轮编译产物。
 */

import { randomUUID } from "node:crypto";

import type {
  ChatMessage,
  ChatSession,
  ContextBudgetPolicy,
  ContextCheckpoint,
  ContextCompactionMetadata,
  ContextCompileResult,
  ExecutionPlan,
  ModelCapability,
  SessionReplayPolicy,
  SkillDefinition,
} from "@shared/contracts";
import { DEFAULT_CONTEXT_BUDGET_POLICY, textOfContent } from "@shared/contracts";
import { buildBudgetSnapshot } from "./token-budget-manager";
import { estimateTokenCount } from "./token-estimator";
import { compactMessages, type CompactionResult } from "./context-compactor";
import { createCheckpoint } from "./context-checkpoint-service";
import { retrieveContextMemories, type ContextMemoryRecord } from "./context-memory-index";

export type CompileContextInput = {
  session: ChatSession;
  capability: ModelCapability;
  policy?: ContextBudgetPolicy;
  workingDir: string;
  skills?: SkillDefinition[];
  systemPromptBuilder?: (session: ChatSession, workingDir: string, skills?: SkillDefinition[]) => string;
  workingMemory?: string;
  replayPolicy?: SessionReplayPolicy;
  executionPlan?: Pick<ExecutionPlan, "replayPolicy"> | null;
  priorCompactionCount?: number;
  compactTriggerTokens?: number;
  turnId?: string;
};

const MESSAGE_OVERHEAD = 4;
const DEFAULT_SECTION_BUDGET_RATIOS = {
  system_core_rules: 0.15,
  recent_turns: 0.35,
  checkpoint: 0.15,
  tool_artifact_refs: 0.15,
  retrieved_memories: 0.15,
  safety_reserve: 0.05,
} as const;

/** 解析本轮应该使用的 replay policy，executionPlan 优先于直接入参。 */
function resolveReplayPolicy(input: Pick<CompileContextInput, "executionPlan" | "replayPolicy">): SessionReplayPolicy | null {
  return input.executionPlan?.replayPolicy ?? input.replayPolicy ?? null;
}

/** 计算编译结果的分层预算，用于解释和后续策略调优。 */
function buildSectionBudgets(limit: number): Record<keyof typeof DEFAULT_SECTION_BUDGET_RATIOS, number> {
  return Object.fromEntries(
    Object.entries(DEFAULT_SECTION_BUDGET_RATIOS).map(([key, ratio]) => [key, Math.floor(limit * ratio)]),
  ) as Record<keyof typeof DEFAULT_SECTION_BUDGET_RATIOS, number>;
}

/** 构建最小系统提示，供测试和未注入构建器的调用方使用。 */
function buildDefaultSystemPrompt(_session: ChatSession, workingDir: string): string {
  return [
    "You are MyClaw, an expert AI coding assistant.",
    `Working directory: ${workingDir}`,
    `Current date: ${new Date().toISOString().split("T")[0]}`,
  ].join("\n");
}

/** 将 checkpoint 编译成短系统块，避免作为普通历史消息参与压缩或回放。 */
function buildCheckpointBlock(checkpoint: ContextCheckpoint): string {
  const lines = [
    "# Context Checkpoint",
    `id: ${checkpoint.id}`,
    `turn: ${checkpoint.turnId}`,
    checkpoint.taskGoal ? `goal: ${checkpoint.taskGoal.slice(0, 180)}` : null,
    checkpoint.currentPhase ? `phase: ${checkpoint.currentPhase}` : null,
    checkpoint.nextGoal ? `next: ${checkpoint.nextGoal.slice(0, 180)}` : null,
    checkpoint.decisions.length > 0 ? `decisions: ${checkpoint.decisions.slice(0, 3).join(" | ").slice(0, 240)}` : null,
    checkpoint.activeAssumptions.length > 0 ? `assumptions: ${checkpoint.activeAssumptions.slice(0, 3).join(" | ").slice(0, 240)}` : null,
    checkpoint.touchedFiles.length > 0 ? `files: ${checkpoint.touchedFiles.slice(0, 8).join(", ")}` : null,
    checkpoint.openItems.length > 0 ? `open: ${checkpoint.openItems.slice(0, 4).join(" | ").slice(0, 240)}` : null,
    checkpoint.blockers.length > 0 ? `blockers: ${checkpoint.blockers.slice(0, 3).join(" | ").slice(0, 180)}` : null,
    checkpoint.toolOutcomes.length > 0
      ? `tools: ${checkpoint.toolOutcomes.slice(-4).map((item) => `${item.tool}:${item.summary}`).join(" | ").slice(0, 260)}`
      : null,
    `sourceMessageCount: ${checkpoint.sourceMessageIds.length}`,
    `checksum: ${checkpoint.checksum.slice(0, 16)}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** 将召回记忆编译成短系统块，保留来源 ID 便于排查。 */
function buildMemoryBlock(memories: ContextMemoryRecord[]): string {
  if (memories.length === 0) return "";
  return [
    "# Retrieved Context Memories",
    ...memories.map((memory) => `- ${memory.id} (${memory.messageId}, score ${memory.score.toFixed(2)}): ${memory.text}`),
  ].join("\n");
}

/** 把会话消息转换成模型客户端可直接消费的轻量消息。 */
function toCompiledMessage(
  msg: ChatMessage,
  replayPolicy: SessionReplayPolicy | null,
): ContextCompileResult["messages"][number] {
  const entry: ContextCompileResult["messages"][number] = {
    role: msg.role,
    content: textOfContent(msg.content),
  };
  if ((replayPolicy === null || replayPolicy === "assistant-turn-with-reasoning") && msg.reasoning) {
    entry.reasoning = msg.reasoning;
  }
  if (msg.tool_call_id) entry.tool_call_id = msg.tool_call_id;
  if (msg.tool_calls && msg.tool_calls.length > 0) entry.tool_calls = msg.tool_calls;
  return entry;
}

/** 判断压缩触发来源，供 UI 和持久化记录解释。 */
function resolveCompactionTrigger(session: ChatSession, result: CompactionResult): ContextCompactionMetadata["trigger"] {
  if (session.messages.length >= 100) return "message_count";
  if (result.reason === "tool-output-trimmed" || result.maskedToolOutputCount > 0) return "large_tool_output";
  return "token_threshold";
}

/** 根据系统提示和压缩预算执行一次消息压缩。 */
function compileMessagesOnce(input: {
  session: ChatSession;
  systemPrompt: string;
  capability: ModelCapability;
  policy: Required<ContextBudgetPolicy>;
  replayPolicy: SessionReplayPolicy | null;
  executionPlan?: Pick<ExecutionPlan, "replayPolicy"> | null;
  compileLimit: number;
}): {
  compaction: CompactionResult;
  systemTokens: number;
  messageBudget: number;
} {
  const mode = input.capability.tokenCountingMode ?? "character-fallback";
  const systemTokens = estimateTokenCount(input.systemPrompt, mode) + MESSAGE_OVERHEAD;
  const messageBudget = Math.max(0, input.compileLimit - systemTokens);
  const compaction = compactMessages({
    messages: input.session.messages,
    budgetTokens: messageBudget,
    capability: input.capability,
    policy: input.policy,
    replayPolicy: input.replayPolicy ?? undefined,
    executionPlan: input.executionPlan,
  });
  if (compaction.removedCount > 0 || compaction.maskedToolOutputCount > 0 || compaction.reason != null) {
    console.info("[context-compiler] 已完成一次上下文编译压缩", {
      sessionId: input.session.id,
      compileLimit: input.compileLimit,
      systemTokens,
      messageBudget,
      estimatedTokens: compaction.estimatedTokens,
      removedCount: compaction.removedCount,
      maskedToolOutputCount: compaction.maskedToolOutputCount,
    });
  }
  return { compaction, systemTokens, messageBudget };
}

/**
 * 编译本轮模型上下文。
 * 该函数是跨厂商主链入口，所有 provider 默认先经过本地编译层。
 */
export function compileContext(input: CompileContextInput): ContextCompileResult {
  const policy: Required<ContextBudgetPolicy> = {
    ...DEFAULT_CONTEXT_BUDGET_POLICY,
    ...(input.policy ?? {}),
  };
  const replayPolicy = resolveReplayPolicy(input);
  const budget = buildBudgetSnapshot(input.capability, policy, {
    compactTriggerTokens: input.compactTriggerTokens,
  });
  const compileLimit = Math.max(0, Math.min(budget.safeInputBudget, budget.compactTriggerTokens));
  const sectionBudgets = buildSectionBudgets(compileLimit);
  const turnId = input.turnId ?? randomUUID();
  const buildPrompt = input.systemPromptBuilder ?? buildDefaultSystemPrompt;
  const baseSystemPrompt = buildPrompt(input.session, input.workingDir, input.skills);
  let finalSystemPrompt = input.workingMemory
    ? `${baseSystemPrompt}\n\n# Working Memory\n${input.workingMemory}`
    : baseSystemPrompt;

  let compiled = compileMessagesOnce({
    session: input.session,
    systemPrompt: finalSystemPrompt,
    capability: input.capability,
    policy,
    replayPolicy,
    executionPlan: input.executionPlan,
    compileLimit,
  });

  let checkpoint: ContextCheckpoint | undefined;
  let memories: ContextMemoryRecord[] = [];
  let removedMessageIds = compiled.compaction.removedMessageIds;
  const shouldCreateCheckpoint = policy.enableContextCheckpoint &&
    (compiled.compaction.removedCount > 0 || compiled.compaction.maskedToolOutputCount > 0);

  if (shouldCreateCheckpoint) {
    checkpoint = createCheckpoint(input.session, {
      turnId,
      sourceMessageIds: input.session.messages.map((message) => message.id),
    });
    const retainedIds = compiled.compaction.compacted.map((message) => message.id);
    const lastUserMessage = [...input.session.messages].reverse().find((message) => message.role === "user");
    memories = policy.enableLongTermMemory
      ? retrieveContextMemories({
          session: input.session,
          query: textOfContent(lastUserMessage?.content ?? ""),
          excludeMessageIds: retainedIds,
          limit: Math.max(1, policy.maxSummaryBlocks),
          tokenBudget: sectionBudgets.retrieved_memories,
        })
      : [];

    finalSystemPrompt = [
      finalSystemPrompt,
      buildCheckpointBlock(checkpoint),
      buildMemoryBlock(memories),
    ].filter(Boolean).join("\n\n");
    compiled = compileMessagesOnce({
      session: input.session,
      systemPrompt: finalSystemPrompt,
      capability: input.capability,
      policy,
      replayPolicy,
      executionPlan: input.executionPlan,
      compileLimit,
    });
    removedMessageIds = compiled.compaction.removedMessageIds;
  }

  const maskedToolOutputIds = compiled.compaction.maskedToolOutputIds;
  const strategy: ContextCompactionMetadata["strategy"] = ["exact_keep"];
  if (maskedToolOutputIds.length > 0 || compiled.compaction.maskedToolOutputCount > 0) strategy.push("tool_mask");
  if (checkpoint) strategy.push("checkpoint");
  if (memories.length > 0) strategy.push("memory_retrieve");

  const budgetUsed = compiled.systemTokens + compiled.compaction.estimatedTokens;
  const metadata: ContextCompactionMetadata = {
    id: randomUUID(),
    sessionId: input.session.id,
    turnId,
    createdAt: new Date().toISOString(),
    trigger: resolveCompactionTrigger(input.session, compiled.compaction),
    strategy,
    budgetUsed,
    budgetLimit: compileLimit,
    removedMessageIds,
    maskedToolOutputIds,
    ...(checkpoint ? { checkpointId: checkpoint.id } : {}),
    memoryIds: memories.map((memory) => memory.id),
    providerNativeCompactionUsed: false,
    reason: compiled.compaction.reason ?? "within-budget",
  };

  const messages: ContextCompileResult["messages"] = [
    { role: "system", content: finalSystemPrompt },
    ...compiled.compaction.compacted.map((message) => toCompiledMessage(message, replayPolicy)),
  ];
  const sections: ContextCompileResult["sections"] = [
    { kind: "system", tokenBudget: sectionBudgets.system_core_rules, sourceIds: [] },
    ...(checkpoint ? [{ kind: "checkpoint", tokenBudget: sectionBudgets.checkpoint, sourceIds: checkpoint.sourceMessageIds }] : []),
    ...(memories.length > 0 ? [{ kind: "retrieved_memories", tokenBudget: sectionBudgets.retrieved_memories, sourceIds: memories.map((memory) => memory.messageId) }] : []),
    ...(maskedToolOutputIds.length > 0 ? [{ kind: "tool_artifact_refs", tokenBudget: sectionBudgets.tool_artifact_refs, sourceIds: maskedToolOutputIds }] : []),
    { kind: "recent_turns", tokenBudget: sectionBudgets.recent_turns, sourceIds: compiled.compaction.compacted.map((message) => message.id) },
    { kind: "safety_reserve", tokenBudget: sectionBudgets.safety_reserve, sourceIds: [] },
  ];

  if (removedMessageIds.length > 0 || maskedToolOutputIds.length > 0 || checkpoint || memories.length > 0 || budgetUsed > compileLimit) {
    console.info("[context-compiler] 已生成跨模型上下文编译结果", {
      sessionId: input.session.id,
      turnId,
      budgetUsed,
      budgetLimit: compileLimit,
      removedCount: removedMessageIds.length,
      maskedToolOutputCount: maskedToolOutputIds.length,
      checkpointId: checkpoint?.id ?? null,
      memoryCount: memories.length,
    });
  }

  return {
    messages,
    sections,
    metadata,
    ...(checkpoint ? { checkpoint } : {}),
    warnings: budgetUsed > compileLimit
      ? [`上下文编译结果仍超过预算：${budgetUsed}/${compileLimit}`]
      : [],
  };
}

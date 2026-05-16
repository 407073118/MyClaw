import type {
  AwarenessAction,
  AwarenessBudgetPolicy,
  AwarenessDecision,
  AwarenessDecisionPolicy,
  AwarenessSignal,
} from "@shared/contracts";

export type DecisionEngineDeps = {
  callModel: (prompt: string, modelProfileId?: string) => Promise<string>;
  getModelCallsToday: (routineId: string) => number;
  incrementModelCalls: (routineId: string) => void;
  getGlobalModelCallsToday?: () => number;
  incrementGlobalModelCalls?: () => void;
};

export function createAwarenessDecisionEngine(deps: DecisionEngineDeps) {
  /** 根据策略、信号和预算选择规则决策或模型决策。 */
  function decide(
    signals: AwarenessSignal[],
    policy: AwarenessDecisionPolicy,
    routineId: string,
    routinePurpose: string,
    budgetPolicy?: AwarenessBudgetPolicy,
  ): Promise<AwarenessDecision> {
    const needsModel = shouldUseModel(signals, policy);
    if (!needsModel) {
      console.info("[awareness-decision] 使用规则决策，当前信号不需要模型分析", {
        routineId,
        signalCount: signals.length,
      });
      return Promise.resolve(ruleBasedDecision(signals, routineId, routinePurpose, "no_signal"));
    }

    if (isBudgetExceeded(routineId, policy, budgetPolicy)) {
      console.info("[awareness-decision] 模型预算已用尽，降级为规则决策", {
        routineId,
        routineCallsToday: deps.getModelCallsToday(routineId),
        globalCallsToday: deps.getGlobalModelCallsToday?.() ?? 0,
      });
      return Promise.resolve(ruleBasedDecision(signals, routineId, routinePurpose, "budget_exceeded"));
    }

    return modelBasedDecision(signals, routineId, routinePurpose, policy);
  }

  /** 判断当前信号是否值得调用模型，避免简单信息也消耗预算。 */
  function shouldUseModel(signals: AwarenessSignal[], policy: AwarenessDecisionPolicy): boolean {
    return Boolean(
      (policy.useModelForCrossSource && new Set(signals.map((signal) => signal.sourceKind)).size > 1)
        || (policy.useModelForActionSuggestion && signals.some((signal) => signal.severity !== "info")),
    );
  }

  /** 判断 per-tick、routine 日预算和全局日预算是否已经触顶。 */
  function isBudgetExceeded(
    routineId: string,
    policy: AwarenessDecisionPolicy,
    budgetPolicy?: AwarenessBudgetPolicy,
  ): boolean {
    if (policy.maxModelCallsPerTick <= 0) return true;
    const routineCalls = deps.getModelCallsToday(routineId);
    if (budgetPolicy && routineCalls >= budgetPolicy.maxModelCallsPerRoutinePerDay) return true;
    const globalCalls = deps.getGlobalModelCallsToday?.() ?? 0;
    return Boolean(budgetPolicy && globalCalls >= budgetPolicy.maxModelCallsPerDay);
  }

  /** 使用确定性规则生成兜底决策，保证模型不可用时值守仍然可用。 */
  function ruleBasedDecision(
    signals: AwarenessSignal[],
    routineId: string,
    routinePurpose: string,
    skipReason?: AwarenessDecision["skipReason"],
  ): AwarenessDecision {
    const criticals = signals.filter((signal) => signal.severity === "critical");
    const warnings = signals.filter((signal) => signal.severity === "warning");
    const infos = signals.filter((signal) => signal.severity === "info");

    const actions: AwarenessAction[] = [];
    let notify = false;
    let requiresApproval = false;

    if (criticals.length > 0) {
      notify = true;
      actions.push({
        kind: "notify_user",
        description: `${criticals.length} 个严重问题需要关注`,
        riskLevel: "low",
      });
    }

    for (const signal of warnings) {
      actions.push({
        kind: "log_only",
        description: `记录警告: ${signal.summary}`,
        riskLevel: "low",
      });
    }

    if (infos.length > 0) {
      actions.push({
        kind: "log_only",
        description: `${infos.length} 个信息级别信号`,
        riskLevel: "low",
      });
    }

    const reasonParts: string[] = [];
    if (criticals.length > 0) reasonParts.push(`${criticals.length} critical`);
    if (warnings.length > 0) reasonParts.push(`${warnings.length} warning`);
    if (infos.length > 0) reasonParts.push(`${infos.length} info`);
    requiresApproval = actions.some((action) => action.riskLevel === "high");

    return {
      routineId,
      notify,
      actions,
      requiresApproval,
      reason: reasonParts.length > 0
        ? `规则决策: ${reasonParts.join(", ")} (${routinePurpose})`
        : `规则决策: 无显著信号 (${routinePurpose})`,
      confidence: 1.0,
      skipReason,
      modelUsed: false,
    };
  }

  /** 调用模型生成语义决策，失败时自动回落到规则决策。 */
  async function modelBasedDecision(
    signals: AwarenessSignal[],
    routineId: string,
    routinePurpose: string,
    policy: AwarenessDecisionPolicy,
  ): Promise<AwarenessDecision> {
    deps.incrementModelCalls(routineId);
    deps.incrementGlobalModelCalls?.();

    const signalSummary = signals
      .map((signal) => `[${signal.severity}] ${signal.sourceKind}:${signal.sourceId} - ${signal.summary}`)
      .join("\n");

    const prompt = `你是 MyClaw 值守决策引擎。以下是当前检测到的信号：

${signalSummary}

值守目的: ${routinePurpose}

请分析这些信号，判断是否需要采取行动。返回 JSON：
{
  "notify": boolean,
  "actions": [{ "kind": "log_only|notify_user|dismiss_signal", "description": "...", "riskLevel": "low|medium|high" }],
  "requiresApproval": boolean,
  "reason": "...",
  "confidence": 0.0-1.0
}

注意：你只能建议行动，不能直接执行高风险操作。`;

    try {
      const response = await deps.callModel(prompt, policy.modelProfileId);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn("[awareness-decision] 模型未返回 JSON，降级为规则决策", { routineId });
        return ruleBasedDecision(signals, routineId, routinePurpose);
      }
      const parsed = JSON.parse(jsonMatch[0]) as AwarenessDecision;
      return {
        routineId,
        notify: parsed.notify ?? false,
        actions: (parsed.actions ?? []).map((action) => ({
          kind: action.kind ?? "log_only",
          description: action.description ?? "",
          riskLevel: action.riskLevel ?? "low",
          payload: action.payload,
        })),
        requiresApproval: parsed.requiresApproval ?? false,
        reason: parsed.reason ?? "模型决策",
        confidence: parsed.confidence ?? 0.5,
        modelUsed: true,
        modelProfileId: policy.modelProfileId,
      };
    } catch (error) {
      console.warn("[awareness-decision] 模型决策失败，降级为规则决策", {
        routineId,
        error: error instanceof Error ? error.message : String(error),
      });
      return ruleBasedDecision(signals, routineId, routinePurpose);
    }
  }

  return { decide };
}

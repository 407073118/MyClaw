import type {
  AwarenessAction,
  AwarenessDecision,
  AwarenessSignal,
  AwarenessDecisionPolicy,
} from "@shared/contracts";

export type DecisionEngineDeps = {
  callModel: (prompt: string) => Promise<string>;
  getModelCallsToday: (routineId: string) => number;
  incrementModelCalls: (routineId: string) => void;
};

export function createAwarenessDecisionEngine(deps: DecisionEngineDeps) {
  function decide(
    signals: AwarenessSignal[],
    policy: AwarenessDecisionPolicy,
    routineId: string,
    routinePurpose: string,
  ): Promise<AwarenessDecision> {
    const budgetExceeded = deps.getModelCallsToday(routineId) >= policy.maxModelCallsPerTick;
    const needsModel = policy.useModelForCrossSource && signals.length > 1
      || policy.useModelForActionSuggestion && signals.some((s) => s.severity !== "info");

    if (budgetExceeded || !needsModel) {
      return Promise.resolve(ruleBasedDecision(signals, routineId, routinePurpose));
    }

    return modelBasedDecision(signals, routineId, routinePurpose);
  }

  function ruleBasedDecision(
    signals: AwarenessSignal[],
    routineId: string,
    routinePurpose: string,
  ): AwarenessDecision {
    const criticals = signals.filter((s) => s.severity === "critical");
    const warnings = signals.filter((s) => s.severity === "warning");
    const infos = signals.filter((s) => s.severity === "info");

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

    for (const sig of warnings) {
      actions.push({
        kind: "log_only",
        description: `记录警告: ${sig.summary}`,
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

    return {
      routineId,
      notify,
      actions,
      requiresApproval,
      reason: reasonParts.length > 0
        ? `规则决策: ${reasonParts.join(", ")} (${routinePurpose})`
        : `无显著信号 (${routinePurpose})`,
      confidence: 1.0,
    };
  }

  async function modelBasedDecision(
    signals: AwarenessSignal[],
    routineId: string,
    routinePurpose: string,
  ): Promise<AwarenessDecision> {
    deps.incrementModelCalls(routineId);

    const signalSummary = signals
      .map((s) => `[${s.severity}] ${s.sourceKind}:${s.sourceId} — ${s.summary}`)
      .join("\n");

    const prompt = `你是 MyClaw 值守决策引擎。以下是当前检测到的信号：

${signalSummary}

值守目的: ${routinePurpose}

请分析这些信号，判断是否需要采取行动。返回 JSON 格式：
{
  "notify": boolean,
  "actions": [{ "kind": "log_only|notify_user|dismiss_signal", "description": "...", "riskLevel": "low|medium|high" }],
  "requiresApproval": boolean,
  "reason": "...",
  "confidence": 0.0-1.0
}

注意：你不能直接执行任何动作，只能建议。高风险操作必须标记 requiresApproval=true。`;

    try {
      const response = await deps.callModel(prompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return ruleBasedDecision(signals, routineId, routinePurpose);
      }
      const parsed = JSON.parse(jsonMatch[0]) as AwarenessDecision;
      return {
        routineId,
        notify: parsed.notify ?? false,
        actions: (parsed.actions ?? []).map((a) => ({
          kind: a.kind ?? "log_only",
          description: a.description ?? "",
          riskLevel: a.riskLevel ?? "low",
        })),
        requiresApproval: parsed.requiresApproval ?? false,
        reason: parsed.reason ?? "模型决策",
        confidence: parsed.confidence ?? 0.5,
      };
    } catch {
      return ruleBasedDecision(signals, routineId, routinePurpose);
    }
  }

  return { decide };
}

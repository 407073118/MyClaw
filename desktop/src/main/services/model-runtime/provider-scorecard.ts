import type {
  ProtocolTarget,
  ProviderFamily,
  ProviderFamilyScorecard,
  TurnOutcome,
  VendorFamily,
  VendorProtocolScorecard,
} from "@shared/contracts";

import { listProviderFamilyRolloutGates } from "./rollout-gates";

export type ProviderScorecard = ProviderFamilyScorecard;
export type VendorProtocolRuntimeScorecard = VendorProtocolScorecard;

const PROVIDER_FAMILY_ORDER = new Map(
  listProviderFamilyRolloutGates().map((gate, index) => [gate.providerFamily, index] as const),
);

function compareProviderFamilies(left: ProviderFamily, right: ProviderFamily): number {
  return (PROVIDER_FAMILY_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (PROVIDER_FAMILY_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER);
}

/** 根据 TurnOutcome 聚合 family scorecard。 */
export function buildProviderScorecard(
  providerFamily: ProviderFamily,
  outcomes: TurnOutcome[],
): ProviderScorecard {
  const familyOutcomes = outcomes.filter((outcome) => outcome.providerFamily === providerFamily);
  const totalTurns = familyOutcomes.length;
  if (totalTurns === 0) {
    return {
      providerFamily,
      completionRate: 0,
      toolSuccessRate: 0,
      fallbackRate: 0,
      p95Latency: 0,
      contextStabilityRate: 0,
      sampleSize: 0,
    };
  }

  const successCount = familyOutcomes.filter((outcome) => outcome.success).length;
  const totalToolCalls = familyOutcomes.reduce((sum, outcome) => sum + (outcome.toolCallCount ?? 0), 0);
  const successfulToolCalls = familyOutcomes.reduce((sum, outcome) => sum + (outcome.toolSuccessCount ?? 0), 0);
  const fallbackCount = familyOutcomes.filter(
    (outcome) => (outcome.fallbackEvents?.length ?? 0) > 0 || !!outcome.fallbackReason,
  ).length;
  const stableCount = familyOutcomes.filter((outcome) => outcome.contextStability !== false).length;
  const sortedLatency = familyOutcomes.map((outcome) => outcome.latencyMs).sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(sortedLatency.length * 0.95) - 1);

  return {
    providerFamily,
    completionRate: successCount / totalTurns,
    toolSuccessRate: totalToolCalls > 0 ? successfulToolCalls / totalToolCalls : 1,
    fallbackRate: fallbackCount / totalTurns,
    p95Latency: sortedLatency[p95Index] ?? 0,
    contextStabilityRate: stableCount / totalTurns,
    sampleSize: totalTurns,
  };
}

/** 按 family 分组生成全部 scorecard。 */
export function buildProviderScorecards(outcomes: TurnOutcome[]): ProviderScorecard[] {
  const families = [...new Set(outcomes.map((outcome) => outcome.providerFamily))];
  return families
    .sort(compareProviderFamilies)
    .map((family) => buildProviderScorecard(family, outcomes));
}

function compareVendorProtocols(
  left: { vendorFamily: VendorFamily | string; protocolTarget: ProtocolTarget },
  right: { vendorFamily: VendorFamily | string; protocolTarget: ProtocolTarget },
): number {
  const vendorOrder = String(left.vendorFamily).localeCompare(String(right.vendorFamily));
  if (vendorOrder !== 0) {
    return vendorOrder;
  }
  return left.protocolTarget.localeCompare(right.protocolTarget);
}

/** 根据 TurnOutcome 聚合 vendor+protocol scorecard，供放量与兼容复盘使用。 */
export function buildVendorProtocolScorecards(
  outcomes: TurnOutcome[],
): VendorProtocolRuntimeScorecard[] {
  const keys = [...new Set(outcomes.map((outcome) => `${outcome.vendorFamily ?? outcome.providerFamily}:${outcome.protocolTarget}`))];

  return keys
    .map((key) => {
      const [vendorFamily, protocolTarget] = key.split(":") as [VendorFamily | string, ProtocolTarget];
      const scopedOutcomes = outcomes.filter(
        (outcome) => `${outcome.vendorFamily ?? outcome.providerFamily}:${outcome.protocolTarget}` === key,
      );
      const totalTurns = scopedOutcomes.length;
      const successCount = scopedOutcomes.filter((outcome) => outcome.success).length;
      const totalToolCalls = scopedOutcomes.reduce((sum, outcome) => sum + (outcome.toolCallCount ?? 0), 0);
      const successfulToolCalls = scopedOutcomes.reduce((sum, outcome) => sum + (outcome.toolSuccessCount ?? 0), 0);
      const fallbackCount = scopedOutcomes.filter(
        (outcome) => (outcome.fallbackEvents?.length ?? 0) > 0 || !!outcome.fallbackReason,
      ).length;
      const stableCount = scopedOutcomes.filter((outcome) => outcome.contextStability !== false).length;
      const sortedLatency = scopedOutcomes.map((outcome) => outcome.latencyMs).sort((left, right) => left - right);
      const p95Index = totalTurns === 0 ? 0 : Math.max(0, Math.ceil(sortedLatency.length * 0.95) - 1);

      return {
        vendorFamily,
        protocolTarget,
        sampleSize: totalTurns,
        completionRate: totalTurns === 0 ? 0 : successCount / totalTurns,
        toolSuccessRate: totalToolCalls > 0 ? successfulToolCalls / totalToolCalls : 1,
        fallbackRate: totalTurns === 0 ? 0 : fallbackCount / totalTurns,
        p95Latency: sortedLatency[p95Index] ?? 0,
        contextStabilityRate: totalTurns === 0 ? 0 : stableCount / totalTurns,
      };
    })
    .sort(compareVendorProtocols);
}

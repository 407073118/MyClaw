import type { TurnOutcome } from "@shared/contracts";

export { buildTurnTelemetryEvent } from "./telemetry";

/** 将失败归类为稳定的诊断类别，供 observability 测试与 UI 聚合复用。 */
export function classifyFailureDiagnostics(input: {
  error?: unknown;
  success: boolean;
  toolSucceeded?: boolean;
  persisted?: boolean;
}): "transport" | "protocol" | "tool" | "persistence" | "unknown" {
  if (input.success) {
    return "unknown";
  }
  if (input.persisted === false) {
    return "persistence";
  }
  if (input.toolSucceeded === false) {
    return "tool";
  }
  const message = input.error instanceof Error ? input.error.message : String(input.error ?? "");
  if (/timeout|network|fetch|429|5\d\d/i.test(message)) {
    return "transport";
  }
  return "protocol";
}

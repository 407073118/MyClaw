import { performance } from "node:perf_hooks";

export type PerformanceSpanName =
  | "context.assembly"
  | "gateway.latency"
  | "turn.first_delta"
  | "session.save"
  | "session.flush"
  | "stream.patch_flush"
  | "approval.open"
  | "input.keystroke_commit"
  | "workflow.checkpoint_save"
  | "workflow.checkpoint_flush"
  | "workflow.checkpoint_restore"
  | string;

export type PerformanceSpanRecord = {
  name: PerformanceSpanName;
  label: string;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  attributes: Record<string, unknown>;
};

export type PerformanceSpan = {
  /** 结束当前性能片段，并记录中文可读的业务上下文。 */
  end(attributes?: Record<string, unknown>): void;
  /** 导出不可变记录，供 turn outcome、JSONL 或测试读取。 */
  toJSON(): PerformanceSpanRecord;
};

/** 创建一个性能片段，使用单调时钟计算耗时，避免系统时间跳变影响 duration。 */
export function createPerformanceSpan(name: PerformanceSpanName, label: string): PerformanceSpan {
  const startedAtMs = performance.now();
  const startedAt = new Date().toISOString();
  let endedAtMs = startedAtMs;
  let endedAt = startedAt;
  let attributes: Record<string, unknown> = {};
  let ended = false;

  return {
    end(nextAttributes = {}) {
      if (ended) {
        console.warn("[performance] 性能片段重复结束，已忽略后续 end 调用", { name, label });
        return;
      }
      ended = true;
      endedAtMs = performance.now();
      endedAt = new Date().toISOString();
      attributes = { ...nextAttributes };
    },
    toJSON() {
      const durationMs = Math.max(0, endedAtMs - startedAtMs);
      return {
        name,
        label,
        durationMs,
        startedAt,
        endedAt,
        attributes,
      };
    },
  };
}

/** 汇总多个性能片段，方便测试和调试面板读取总耗时。 */
export function summarizePerformanceSpans(spans: PerformanceSpanRecord[]): {
  totalMs: number;
  spans: PerformanceSpanRecord[];
} {
  return {
    totalMs: spans.reduce((sum, span) => sum + span.durationMs, 0),
    spans: [...spans],
  };
}

/** 断言性能预算，测试中用于阻止本地可控链路继续退化。 */
export function assertPerformanceBudget(
  name: string,
  actualMs: number,
  budget: { p95BudgetMs: number },
): void {
  if (actualMs > budget.p95BudgetMs) {
    throw new Error(`${name} exceeded p95 budget: ${actualMs}ms > ${budget.p95BudgetMs}ms`);
  }
}

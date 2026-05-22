import { describe, expect, it } from "vitest";

import {
  assertPerformanceBudget,
  createPerformanceSpan,
  summarizePerformanceSpans,
} from "../src/main/services/performance/performance-metrics";

describe("performance metrics", () => {
  it("records spans with a Chinese-readable label", () => {
    const span = createPerformanceSpan("session.save", "会话保存");

    span.end({ sessionId: "session-1" });
    const record = span.toJSON();

    expect(record.name).toBe("session.save");
    expect(record.label).toBe("会话保存");
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(record.attributes.sessionId).toBe("session-1");
  });

  it("summarizes spans and enforces budgets", () => {
    const span = createPerformanceSpan("approval.open", "审批弹窗打开");
    span.end();

    const summary = summarizePerformanceSpans([span.toJSON()]);

    expect(summary.totalMs).toBeGreaterThanOrEqual(0);
    expect(() => assertPerformanceBudget("approval.open", 121, { p95BudgetMs: 120 })).toThrow(/approval\.open/);
  });
});

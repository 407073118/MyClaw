import { describe, expect, it } from "vitest";

import {
  AWARENESS_SIGNAL_SOURCE_KIND_VALUES,
  createDefaultActionPolicy,
  createDefaultBudgetPolicy,
  createDefaultCatchUpPolicy,
  createDefaultContextPolicy,
  createDefaultDecisionPolicy,
  createDefaultDeliveryPolicy,
  createDefaultQuietHoursPolicy,
} from "@shared/contracts";

describe("awareness contracts", () => {
  it("exports stable signal source values used by runtime and UI", () => {
    expect(AWARENESS_SIGNAL_SOURCE_KIND_VALUES).toEqual([
      "agent_task",
      "schedule_job",
      "workflow_run",
      "background_task",
      "session_stuck",
      "approval_pending",
      "system_health",
    ]);
  });

  it("defaults to rules-first, quiet, bounded awareness behavior", () => {
    expect(createDefaultDecisionPolicy()).toMatchObject({
      useModelForCrossSource: true,
      useModelForActionSuggestion: true,
      maxModelCallsPerTick: 1,
    });
    expect(createDefaultActionPolicy().requireApproval).toContain("notify_user");
    expect(createDefaultDeliveryPolicy()).toMatchObject({
      notifyOnSignal: false,
      notifyOnDecision: true,
      deliveryChannel: "today_catchup",
    });
    expect(createDefaultBudgetPolicy().pausedOnBudgetExceeded).toBe(true);
  });

  it("defines durable context, quiet-hours, and catch-up defaults for complete heartbeat behavior", () => {
    expect(createDefaultContextPolicy()).toEqual({
      includeScheduleJobs: true,
      includeAgentTasks: true,
      includeWorkflowRuns: true,
      includeBackgroundTasks: true,
      includeApprovalRequests: true,
      includeSiliconPersons: true,
      maxSignalContextItems: 50,
    });
    expect(createDefaultQuietHoursPolicy()).toEqual({
      respectAvailabilityPolicy: true,
      criticalOverridesQuietHours: true,
    });
    expect(createDefaultCatchUpPolicy()).toEqual({
      mode: "once",
      maxMissedRuns: 1,
    });
  });
});

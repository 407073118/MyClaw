import { describe, expect, it } from "vitest";

import type { EmployeeTask } from "../src/core/task-store";
import { resolveHarnessExecutorDecision } from "../src/harness/executor-adapter";

/** 构建测试用最小任务，避免每个用例重复样板字段。 */
function makeTask(requestedCapability?: EmployeeTask["requestedCapability"]): EmployeeTask {
  return {
    schemaVersion: 1,
    id: `task-${requestedCapability?.replaceAll(".", "-") ?? "default"}`,
    title: "测试任务",
    instruction: "请执行测试任务。",
    status: "queued",
    attempt: 1,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    requestedCapability,
    runHistory: [],
  };
}

describe("resolveHarnessExecutorDecision", () => {
  it("allows artifact writes through the local minimal executor", () => {
    expect(resolveHarnessExecutorDecision(makeTask("artifact.write"))).toMatchObject({
      capability: "artifact.write",
      mode: "local_minimal",
      canExecute: true,
    });
  });

  it("allows filesystem reads through the local minimal executor boundary", () => {
    expect(resolveHarnessExecutorDecision(makeTask("filesystem.read"))).toMatchObject({
      capability: "filesystem.read",
      mode: "local_minimal",
      canExecute: true,
    });
  });

  it("blocks shell execution until a real shell adapter exists", () => {
    expect(resolveHarnessExecutorDecision(makeTask("shell.execute"))).toMatchObject({
      capability: "shell.execute",
      mode: "missing_adapter",
      canExecute: false,
    });
  });

  it("blocks external network until a real network adapter exists", () => {
    expect(resolveHarnessExecutorDecision(makeTask("network.external"))).toMatchObject({
      capability: "network.external",
      mode: "missing_adapter",
      canExecute: false,
    });
  });

  it("forbids cross employee access at the executor boundary", () => {
    expect(resolveHarnessExecutorDecision(makeTask("employee.cross_access"))).toMatchObject({
      capability: "employee.cross_access",
      mode: "forbidden",
      canExecute: false,
    });
  });
});

import { describe, expect, it } from "vitest";

import { evaluateCapabilityPolicy } from "../src/policy/policy-engine";

describe("evaluateCapabilityPolicy", () => {
  it("classifies silicon employee capabilities into allow, approval, and forbid decisions", () => {
    expect(evaluateCapabilityPolicy("filesystem.read")).toMatchObject({
      capability: "filesystem.read",
      decision: "allow",
    });
    expect(evaluateCapabilityPolicy("artifact.write")).toMatchObject({
      capability: "artifact.write",
      decision: "allow",
    });
    expect(evaluateCapabilityPolicy("shell.execute")).toMatchObject({
      capability: "shell.execute",
      decision: "approval_required",
    });
    expect(evaluateCapabilityPolicy("network.external")).toMatchObject({
      capability: "network.external",
      decision: "approval_required",
    });
    expect(evaluateCapabilityPolicy("employee.cross_access")).toMatchObject({
      capability: "employee.cross_access",
      decision: "forbid",
    });
  });
});

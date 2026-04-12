import { describe, expect, it } from "vitest";

import { classifyFailureDiagnostics } from "../../../src/main/services/model-runtime/turn-telemetry";

describe("failure diagnostics", () => {
  it("classifies transport, protocol, tool, and persistence failures", () => {
    expect(classifyFailureDiagnostics({ success: false, error: new Error("network timeout") })).toBe("transport");
    expect(classifyFailureDiagnostics({ success: false, toolSucceeded: false })).toBe("tool");
    expect(classifyFailureDiagnostics({ success: false, persisted: false })).toBe("persistence");
    expect(classifyFailureDiagnostics({ success: false, error: new Error("unexpected shape") })).toBe("protocol");
  });
});

import { describe, expect, it } from "vitest";

import { buildTurnExecutionPlan } from "../../../src/main/services/model-runtime/turn-execution-plan-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("br minimax family", () => {
  it("keeps minimax on compatibility protocol with reasoning fallback", () => {
    const plan = buildTurnExecutionPlan({ profile: makeProfile({ providerFlavor: "br-minimax", model: "minimax-m2-5" }), legacyExecutionPlan: makeLegacyExecutionPlan({ replayPolicy: "assistant-turn-with-reasoning" }) });
    expect(plan.providerFamily).toBe("br-minimax");
    expect(plan.replayMode).toBe("family-specific");
  });
});

import { describe, expect, it } from "vitest";

import * as modelProviderFacade from "../../../src/services/model-provider";
import * as modelProviderDirectoryEntry from "../../../src/services/model-provider/index";

describe("model-provider facade exports", () => {
  it("keeps server-facing exports stable across facade and directory entry", () => {
    expect(modelProviderDirectoryEntry.runModelConversation).toBe(modelProviderFacade.runModelConversation);
    expect(modelProviderDirectoryEntry.testModelProfileConnectivity).toBe(
      modelProviderFacade.testModelProfileConnectivity,
    );
  });

  it("exposes consistent tool and type-facing values from both import paths", () => {
    expect(modelProviderDirectoryEntry.MYCLAW_MODEL_TOOLS).toBe(modelProviderFacade.MYCLAW_MODEL_TOOLS);
    expect(modelProviderDirectoryEntry.createOpenAiCompatibleReply).toBe(
      modelProviderFacade.createOpenAiCompatibleReply,
    );
    expect(modelProviderDirectoryEntry.testOpenAiCompatibleProfile).toBe(
      modelProviderFacade.testOpenAiCompatibleProfile,
    );
  });
});

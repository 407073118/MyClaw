import { describe, expect, it } from "vitest";
import { createRuntimeApp } from "../../../src/server/index";
import { runModelConversation } from "../../../src/services/model-provider/index";

describe("runtime facade skeleton", () => {
  it("loads the new facade barrels", () => {
    expect(typeof createRuntimeApp).toBe("function");
    expect(typeof runModelConversation).toBe("function");
  });
});

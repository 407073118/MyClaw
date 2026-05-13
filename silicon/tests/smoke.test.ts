import { describe, expect, it } from "vitest";

import { SILICON_RUNTIME_NAME } from "../src/index";

describe("silicon runtime package", () => {
  it("exports the stable runtime name", () => {
    expect(SILICON_RUNTIME_NAME).toBe("silicon-employee-runtime");
  });
});

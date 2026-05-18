import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("realtime bridge bootstrap", () => {
  it("enables raw body capture for ingress HMAC verification", () => {
    const mainSource = readFileSync("src/main.ts", "utf8");

    expect(mainSource).toContain("rawBody: true");
  });
});

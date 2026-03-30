import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const loginViewSource = readFileSync(
  join(process.cwd(), "src/views/LoginView.vue"),
  "utf8",
);

describe("LoginView", () => {
  it("locks the viewport height so the login screen does not show an unnecessary vertical scrollbar", () => {
    expect(loginViewSource).toContain("height: 100vh;");
    expect(loginViewSource).toContain("overflow: hidden;");
  });
});

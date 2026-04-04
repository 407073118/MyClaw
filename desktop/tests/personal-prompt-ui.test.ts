import { describe, expect, it, vi } from "vitest";

describe("personal prompt UI helpers", () => {
  it("builds compact example rows instead of showing full prompt blocks", async () => {
    const { buildExampleDescriptor } = await import("../src/renderer/utils/personal-prompt-ui");

    const descriptor = buildExampleDescriptor(
      "我是黑盒测试，主要负责需求测试、回归测试和上线验证。平时会看 PRD、原型、接口文档，输出测试点、测试用例和缺陷单。我希望你先帮我补齐测试思路，再帮我整理输出。",
    );

    expect(descriptor.title).toBe("黑盒测试");
    expect(descriptor.preview.length).toBeLessThan(80);
    expect(descriptor.preview).toContain("需求测试");
  });

  it("requires confirmation before overwriting a dirty draft with an example", async () => {
    const { shouldApplyExamplePrompt } = await import("../src/renderer/utils/personal-prompt-ui");

    const confirmFn = vi.fn(() => false);
    const allowed = shouldApplyExamplePrompt(true, confirmFn);

    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(allowed).toBe(false);
  });

  it("detects both mac and windows save shortcuts", async () => {
    const { isSaveShortcut } = await import("../src/renderer/utils/personal-prompt-ui");

    expect(isSaveShortcut({ key: "s", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSaveShortcut({ key: "S", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isSaveShortcut({ key: "p", metaKey: true, ctrlKey: false })).toBe(false);
  });
});

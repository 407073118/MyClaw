import { describe, expect, it } from "vitest";
import { renderSafeSkillMarkdown, sanitizePreviewHtml, shouldShowSkillPreviewToggle } from "../src/renderer/utils/skill-preview";

describe("skill preview safety helpers", () => {
  it("strips high-risk html from markdown preview output", () => {
    const html = renderSafeSkillMarkdown([
      "# Title",
      "",
      '<img src="x" onerror="alert(1)">',
      "<script>alert('xss')</script>",
      "[link](javascript:alert(1))",
    ].join("\n"));

    expect(html).toContain("<h1>Title</h1>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:alert(1)");
  });

  it("keeps the sanitizer reusable for raw preview html", () => {
    const html = sanitizePreviewHtml('<div onclick="evil()"><iframe src="x"></iframe><p>safe</p></div>');

    expect(html).toContain("<p>safe</p>");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<iframe");
  });

  it("disables html preview toggle for html files", () => {
    expect(shouldShowSkillPreviewToggle("view.html")).toBe(false);
    expect(shouldShowSkillPreviewToggle("SKILL.md")).toBe(true);
  });
});

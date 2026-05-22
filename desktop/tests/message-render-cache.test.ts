import { describe, expect, it, vi } from "vitest";

import {
  clearMessageRenderCache,
  renderCachedMarkdown,
  renderMessageForDisplay,
} from "../src/renderer/utils/message-render-cache";

describe("message render cache", () => {
  it("reuses markdown output for identical message content across different message ids", () => {
    clearMessageRenderCache();
    const renderer = vi.fn((content: string) => `<p>${content}</p>`);

    const first = renderCachedMarkdown("same **answer**", renderer);
    const second = renderCachedMarkdown("same **answer**", renderer);

    expect(first).toBe("<p>same **answer**</p>");
    expect(second).toBe("<p>same **answer**</p>");
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it("caches A2UI extraction and renders the remaining assistant text once", () => {
    clearMessageRenderCache();
    const renderer = vi.fn((content: string) => `<p>${content}</p>`);
    const content = [
      "表单说明",
      "```a2ui",
      JSON.stringify({ text: "请补充信息", ui: { kind: "form", id: "form-1", fields: [] } }),
      "```",
    ].join("\n");

    const first = renderMessageForDisplay({
      id: "message-a",
      role: "assistant",
      content,
      renderMarkdown: renderer,
    });
    const second = renderMessageForDisplay({
      id: "message-b",
      role: "assistant",
      content,
      renderMarkdown: renderer,
    });

    expect(first.content).toBe("表单说明");
    expect(second.content).toBe("表单说明");
    expect(first.ui).toEqual({ kind: "form", id: "form-1", fields: [] });
    expect(second.renderedHtml).toBe("<p>表单说明</p>");
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it("materializes fallback A2UI ids per message even when content is cached", () => {
    clearMessageRenderCache();
    const renderer = vi.fn((content: string) => `<p>${content}</p>`);
    const content = [
      "表单说明",
      "```a2ui",
      JSON.stringify({ text: "请补充信息", ui: { kind: "form", fields: [] } }),
      "```",
    ].join("\n");

    const first = renderMessageForDisplay({
      id: "message-a",
      role: "assistant",
      content,
      renderMarkdown: renderer,
    });
    const second = renderMessageForDisplay({
      id: "message-b",
      role: "assistant",
      content,
      renderMarkdown: renderer,
    });

    expect(first.ui).toEqual({ kind: "form", id: "message-a", fields: [] });
    expect(second.ui).toEqual({ kind: "form", id: "message-b", fields: [] });
    expect(renderer).toHaveBeenCalledTimes(1);
  });
});

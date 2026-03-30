import { describe, expect, it } from "vitest";

import { parseAssistantReply } from "./a2ui";

describe("parseAssistantReply", () => {
  it("keeps numbered next-step choices in plain conversation", () => {
    const reply = parseAssistantReply(
      [
        "I inspected the E: drive and found two directories with content.",
        "Choose the next step:",
        "1. Continue into E:\\BaiduNetdiskDownload\\BTS",
        "2. Show hidden files",
        "3. List large files on E:",
        "4. Scan the whole E: drive recursively",
      ].join("\n"),
    );

    expect(reply.ui).toBeUndefined();
    expect(reply.content).toContain("Choose the next step:");
    expect(reply.content).toContain("1. Continue into E:\\BaiduNetdiskDownload\\BTS");
  });

  it("does not convert ordinary numbered instructions into a form", () => {
    const reply = parseAssistantReply(
      [
        "Run the cleanup in this order:",
        "1. Install dependencies",
        "2. Run the tests",
        "3. Restart the service",
      ].join("\n"),
    );

    expect(reply.ui).toBeUndefined();
    expect(reply.content).toContain("Run the cleanup in this order:");
  });

  it("drops explicit single-field a2ui forms and keeps the conversational text", () => {
    const reply = parseAssistantReply(
      [
        "```a2ui",
        JSON.stringify({
          version: "a2ui-lite/v1",
          text: "Please confirm whether I should continue.",
          ui: {
            kind: "form",
            id: "confirm-next-step",
            title: "Continue?",
            submitLabel: "Submit",
            fields: [
              {
                name: "confirmation",
                label: "Confirmation",
                input: "select",
                required: true,
                options: [
                  { label: "Yes", value: "yes" },
                  { label: "No", value: "no" },
                ],
              },
            ],
          },
        }),
        "```",
      ].join("\n"),
    );

    expect(reply.ui).toBeUndefined();
    expect(reply.content).toBe("Please confirm whether I should continue.");
  });
});

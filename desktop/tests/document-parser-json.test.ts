/**
 * JSON 文档 parser 测试。
 *
 * 覆盖目标：
 * - JSON 可进入 DocumentIR，并保留 pointer 定位。
 * - outline 暴露结构骨架，便于 document_read 先看结构再精读。
 * - 无效 JSON 会抛出可诊断错误。
 */

import { describe, expect, it } from "vitest";
import { parseJsonBuffer, jsonParser } from "../src/main/services/document/parsers/json-parser";
import type { CodeNode } from "@shared/contracts";

function makeInput(text: string, path = "/fixtures/config.json") {
  return {
    path,
    buffer: Buffer.from(text, "utf8"),
    sha256: "1".repeat(64),
    mediaDir: "/tmp/unused",
  };
}

describe("jsonParser", () => {
  it("parses JSON into pointer-addressable outline and body nodes", async () => {
    const ir = await parseJsonBuffer(makeInput(JSON.stringify({
      scripts: { build: "vite build" },
      dependencies: { react: "18.3.1" },
      items: [{ id: 1, name: "alpha" }],
    })));

    expect(ir.source.format).toBe("json");
    expect(ir.outline.map((item) => item.locator.pointer)).toContain("/");
    expect(ir.outline.map((item) => item.locator.pointer)).toContain("/scripts");
    expect(ir.outline.map((item) => item.locator.pointer)).toContain("/dependencies/react");
    expect(ir.outline.map((item) => item.locator.pointer)).toContain("/items/0/name");

    const reactNode = ir.body.find((node) => node.locator.pointer === "/dependencies/react") as CodeNode;
    expect(reactNode.kind).toBe("code");
    expect(reactNode.lang).toBe("json");
    expect(reactNode.text).toBe("\"18.3.1\"");
  });

  it("strips UTF-8 BOM before parsing JSON", async () => {
    const ir = await parseJsonBuffer(makeInput("﻿{\"ok\":true}"));
    const okNode = ir.body.find((node) => node.locator.pointer === "/ok") as CodeNode;
    expect(okNode.text).toBe("true");
  });

  it("throws [E_DOC_PARSE_FAILED] for invalid JSON", async () => {
    await expect(parseJsonBuffer(makeInput("{bad json"))).rejects.toThrow("[E_DOC_PARSE_FAILED]");
  });

  it("exposes DocumentParser shape", () => {
    expect(jsonParser.format).toBe("json");
    expect(typeof jsonParser.parse).toBe("function");
  });
});

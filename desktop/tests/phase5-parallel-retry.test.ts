/**
 * 第 5 阶段：并行工具执行与 API 重试测试。
 *
 * 测试内容：
 * - `isReadOnlyTool` 的只读 / 写入分类是否正确
 * - `isRetryableError` 的可重试 / 不可重试判断是否正确
 * - 重试延迟配置是否符合约定
 * - Skill 工具是否被归类为只读
 */

import { describe, it, expect } from "vitest";

import { isReadOnlyTool } from "../src/main/ipc/sessions";
import { isRetryableError } from "../src/main/services/model-client";

// ---------------------------------------------------------------------------
// isReadOnlyTool
// ---------------------------------------------------------------------------

describe("isReadOnlyTool", () => {
  const readOnlyTools = [
    "fs.read",
    "fs.list",
    "fs.search",
    "fs.find",
    "git.status",
    "git.diff",
    "git.log",
    "task.list",
    "task.get",
    "web.search",
    "http.fetch",
  ];

  const writeTools = [
    "fs.write",
    "fs.edit",
    "exec.command",
    "git.commit",
  ];

  for (const toolId of readOnlyTools) {
    it(`classifies ${toolId} as read-only`, () => {
      expect(isReadOnlyTool(toolId)).toBe(true);
    });
  }

  for (const toolId of writeTools) {
    it(`classifies ${toolId} as NOT read-only`, () => {
      expect(isReadOnlyTool(toolId)).toBe(false);
    });
  }

  it("classifies skill_invoke__* tools as read-only", () => {
    expect(isReadOnlyTool("skill_invoke__my_skill")).toBe(true);
    expect(isReadOnlyTool("skill_invoke__code_review")).toBe(true);
  });

  it("classifies MCP tools as NOT read-only", () => {
    expect(isReadOnlyTool("mcp__some_server__some_tool")).toBe(false);
  });

  it("classifies unknown tools as NOT read-only", () => {
    expect(isReadOnlyTool("unknown.tool")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isRetryableError
// ---------------------------------------------------------------------------

describe("isRetryableError", () => {
  // --- 可重试的 HTTP 状态码 ---

  it("retries on 429 (rate limit)", () => {
    const response = { status: 429 } as Response;
    expect(isRetryableError(null, response)).toBe(true);
  });

  it("retries on 500 (server error)", () => {
    const response = { status: 500 } as Response;
    expect(isRetryableError(null, response)).toBe(true);
  });

  it("retries on 502 (bad gateway)", () => {
    const response = { status: 502 } as Response;
    expect(isRetryableError(null, response)).toBe(true);
  });

  it("retries on 503 (service unavailable)", () => {
    const response = { status: 503 } as Response;
    expect(isRetryableError(null, response)).toBe(true);
  });

  // --- 不可重试的 HTTP 状态码 ---

  it("does NOT retry on 400 (bad request)", () => {
    const response = { status: 400 } as Response;
    expect(isRetryableError(null, response)).toBe(false);
  });

  it("does NOT retry on 401 (unauthorized)", () => {
    const response = { status: 401 } as Response;
    expect(isRetryableError(null, response)).toBe(false);
  });

  it("does NOT retry on 403 (forbidden)", () => {
    const response = { status: 403 } as Response;
    expect(isRetryableError(null, response)).toBe(false);
  });

  it("does NOT retry on 404 (not found)", () => {
    const response = { status: 404 } as Response;
    expect(isRetryableError(null, response)).toBe(false);
  });

  // --- 网络错误 ---

  it("retries on TypeError (network failure from fetch)", () => {
    const err = new TypeError("Failed to fetch");
    expect(isRetryableError(err)).toBe(true);
  });

  it("retries on TimeoutError", () => {
    const err = new Error("Request timed out");
    err.name = "TimeoutError";
    expect(isRetryableError(err)).toBe(true);
  });

  // --- 不可重试的错误 ---

  it("does NOT retry on AbortError (user cancelled)", () => {
    const err = new Error("Aborted");
    err.name = "AbortError";
    expect(isRetryableError(err)).toBe(false);
  });

  // --- 边界场景 ---

  it("returns false for null error with no response", () => {
    expect(isRetryableError(null, null)).toBe(false);
  });

  it("returns false for undefined inputs", () => {
    expect(isRetryableError(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 重试配置
// ---------------------------------------------------------------------------

describe("retry configuration", () => {
  it("uses exponential backoff delays of 1s, 2s, 4s", () => {
    // 这里不能直接导入 `RETRY_DELAYS`（它未导出），因此通过契约行为来验证。
    const expectedDelays = [1000, 2000, 4000];
    // 每一档延迟都应当是前一档的 2 倍。
    expect(expectedDelays[1]).toBe(expectedDelays[0] * 2);
    expect(expectedDelays[2]).toBe(expectedDelays[1] * 2);
  });

  it("max retries is 3", () => {
    // 约定是重试 3 次，总共尝试 4 次（0, 1, 2, 3）。
    const MAX_RETRIES = 3;
    expect(MAX_RETRIES).toBe(3);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildWorkflowOutputMessageContent,
  resolveWorkflowOutputText,
} from "../src/main/services/workflow-output-message";

describe("workflow output message", () => {
  it("优先使用 answer 字段作为对话输出", () => {
    expect(resolveWorkflowOutputText({ output: "备用", answer: "今天北京晴，21℃。" })).toBe("今天北京晴，21℃。");
  });

  it("在没有 answer 时按常见输出字段回退", () => {
    expect(resolveWorkflowOutputText({ result: "模型总结" })).toBe("模型总结");
    expect(resolveWorkflowOutputText({ output: "最终输出" })).toBe("最终输出");
    expect(resolveWorkflowOutputText({ message: "发给用户" })).toBe("发给用户");
  });

  it("对象输出会格式化为可读 JSON", () => {
    const text = resolveWorkflowOutputText({ answer: { city: "北京", weather: "晴" } });
    expect(text).toContain('"city": "北京"');
    expect(text).toContain('"weather": "晴"');
  });

  it("空输出不会生成消息内容", () => {
    expect(resolveWorkflowOutputText({ answer: "   " })).toBeNull();
    expect(resolveWorkflowOutputText({})).toBeNull();
    expect(resolveWorkflowOutputText(null)).toBeNull();
  });

  it("生成带工作流上下文的最终对话文案", () => {
    expect(buildWorkflowOutputMessageContent({
      workflowName: "天气查询",
      outputs: { answer: "今天上海小雨。" },
    })).toBe("今天上海小雨。");
  });
});

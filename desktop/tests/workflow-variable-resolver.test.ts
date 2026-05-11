import { describe, expect, it } from "vitest";
import type { WorkflowNodeInputSource } from "@shared/contracts";
import {
  resolveWorkflowInputSources,
  renderWorkflowTemplate,
} from "../src/main/services/workflow-engine/variable-resolver";

describe("workflow variable resolver", () => {
  const state = new Map<string, unknown>([
    ["inputs", { topic: "季度复盘", payload: { id: 42 } }],
    ["sys", { runId: "run-1" }],
    ["vars", { retries: 2 }],
    ["nodes", { llm_1: { content: "分析完成", usage: { totalTokens: 8 } } }],
    ["legacyTitle", "旧字段"],
  ]);

  it("resolves static, variable, expression, and legacy input sources", () => {
    const sources: Record<string, WorkflowNodeInputSource> = {
      topic: { mode: "variable", ref: { scope: "input", path: "topic", valueType: "string" } },
      runId: { mode: "variable", ref: { scope: "system", path: "runId", valueType: "string" } },
      summary: { mode: "expression", expression: "主题：{{ inputs.topic }}；上游：{{ nodes.llm_1.content }}" },
      fixed: { mode: "static", value: 7 },
      legacy: { mode: "variable", ref: { scope: "run", path: "legacyTitle", valueType: "string" } },
    };

    expect(resolveWorkflowInputSources(sources, state)).toEqual({
      topic: "季度复盘",
      runId: "run-1",
      summary: "主题：季度复盘；上游：分析完成",
      fixed: 7,
      legacy: "旧字段",
    });
  });

  it("renders dotted templates without dropping object values", () => {
    expect(renderWorkflowTemplate("id={{ inputs.payload.id }} tokens={{ nodes.llm_1.usage.totalTokens }}", state))
      .toBe("id=42 tokens=8");
  });

  it("renders plain English-code variables from input and run scopes", () => {
    expect(renderWorkflowTemplate("topic={{ topic }} retries={{ retries }}", state))
      .toBe("topic=季度复盘 retries=2");
  });
});

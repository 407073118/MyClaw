import { describe, it, expect, vi } from "vitest";
import { StartNodeExecutor } from "../src/main/services/workflow-engine/executors/start";
import { EndNodeExecutor } from "../src/main/services/workflow-engine/executors/end";
import { AnswerNodeExecutor } from "../src/main/services/workflow-engine/executors/answer";
import { CodeNodeExecutor } from "../src/main/services/workflow-engine/executors/code";
import { ConditionNodeExecutor } from "../src/main/services/workflow-engine/executors/condition";
import { LlmNodeExecutor } from "../src/main/services/workflow-engine/executors/llm";
import { TemplateNodeExecutor } from "../src/main/services/workflow-engine/executors/template";
import { ToolNodeExecutor, parseMcpToolId } from "../src/main/services/workflow-engine/executors/tool";
import { VariableAssignerNodeExecutor } from "../src/main/services/workflow-engine/executors/variable-assigner";
import { WorkflowEventEmitter } from "../src/main/services/workflow-engine/event-emitter";
import type { WorkflowConditionNode, WorkflowLlmNode, WorkflowToolNode } from "@shared/contracts";

function makeCtx(node: any, state: Record<string, unknown> = {}, resolvedInputs: Record<string, unknown> = {}) {
  return {
    node,
    state: new Map(Object.entries(state)),
    resolvedInputs,
    config: { recursionLimit: 50, workingDirectory: "/tmp", modelProfileId: "default", checkpointPolicy: "every-step" as const },
    emitter: new WorkflowEventEmitter(),
    signal: new AbortController().signal,
    runId: "test-run",
  };
}

describe("StartNodeExecutor", () => {
  it("produces no writes (passthrough)", async () => {
    const exec = new StartNodeExecutor();
    const result = await exec.execute(makeCtx({ id: "s1", kind: "start", label: "Start" }));
    expect(result.writes).toEqual([]);
  });
});

describe("EndNodeExecutor", () => {
  it("writes __done__ signal", async () => {
    const exec = new EndNodeExecutor();
    const result = await exec.execute(makeCtx({ id: "e1", kind: "end", label: "End" }));
    expect(result.writes).toEqual([
      { channelName: "outputs", value: {} },
      { channelName: "__done__", value: true },
    ]);
  });

  it("maps configured final outputs from workflow variables", async () => {
    const exec = new EndNodeExecutor();
    const result = await exec.execute(makeCtx(
      {
        id: "e2",
        kind: "end",
        label: "End",
        outputSources: {
          summary: { mode: "variable", ref: { scope: "node", nodeId: "llm_1", path: "content", valueType: "string" } },
          title: { mode: "expression", expression: "标题：{{ inputs.topic }}" },
        },
      },
      {
        inputs: { topic: "季度复盘" },
        nodes: { llm_1: { content: "分析完成" } },
      },
    ));

    expect(result.writes).toEqual([
      { channelName: "outputs", value: { summary: "分析完成", title: "标题：季度复盘" } },
      { channelName: "__done__", value: true },
    ]);
    expect(result.outputs).toEqual({ summary: "分析完成", title: "标题：季度复盘" });
  });
});

describe("AnswerNodeExecutor", () => {
  it("renders an explicit chatflow answer into outputs.answer", async () => {
    const exec = new AnswerNodeExecutor();
    const result = await exec.execute(makeCtx(
      {
        id: "answer-1",
        kind: "answer",
        label: "Answer",
        answer: {
          template: "天气：{{ nodes.weather.content }}",
        },
      },
      {
        nodes: { weather: { content: "晴，22℃" } },
      },
    ));

    expect(result.writes).toEqual([{ channelName: "outputs", value: { answer: "天气：晴，22℃" } }]);
    expect(result.outputs).toEqual({ answer: "天气：晴，22℃" });
  });
});

describe("TemplateNodeExecutor", () => {
  it("renders a template transform node and writes to its output key", async () => {
    const exec = new TemplateNodeExecutor();
    const result = await exec.execute(makeCtx(
      {
        id: "template-1",
        kind: "template",
        label: "Template",
        template: {
          template: "用户 {{ inputs.user }}：{{ nodes.llm.content }}",
          outputKey: "summaryText",
        },
      },
      {
        inputs: { user: "小张" },
        nodes: { llm: { content: "任务完成" } },
      },
    ));

    expect(result.writes).toEqual([{ channelName: "summaryText", value: "用户 小张：任务完成" }]);
    expect(result.outputs).toEqual({ content: "用户 小张：任务完成" });
  });
});

describe("CodeNodeExecutor", () => {
  it("runs a bounded javascript transform with resolved inputs", async () => {
    const exec = new CodeNodeExecutor();
    const result = await exec.execute(makeCtx(
      {
        id: "code-1",
        kind: "code",
        label: "Code",
        code: {
          language: "javascript",
          source: "return { total: inputs.price * inputs.count, label: `${inputs.name}:${state.inputs.trace}` };",
          outputKey: "calc",
        },
      },
      {
        inputs: { trace: "T1" },
      },
      {
        price: 12,
        count: 3,
        name: "订单",
      },
    ));

    expect(result.writes).toEqual([{ channelName: "calc", value: { total: 36, label: "订单:T1" } }]);
    expect(result.outputs).toEqual({ result: { total: 36, label: "订单:T1" } });
  });
});

describe("VariableAssignerNodeExecutor", () => {
  it("assigns resolved values into the vars channel", async () => {
    const exec = new VariableAssignerNodeExecutor();
    const result = await exec.execute(makeCtx(
      {
        id: "assign-1",
        kind: "variable-assigner",
        label: "Assign",
        variableAssigner: {
          target: "vars",
          assignments: {
            city: { mode: "variable", ref: { scope: "input", path: "city", valueType: "string" } },
            summary: { mode: "expression", expression: "{{ nodes.weather.content }}" },
          },
        },
      },
      {
        inputs: { city: "上海" },
        nodes: { weather: { content: "小雨" } },
      },
    ));

    expect(result.writes).toEqual([{ channelName: "vars", value: { city: "上海", summary: "小雨" } }]);
    expect(result.outputs).toEqual({ assigned: { city: "上海", summary: "小雨" }, target: "vars" });
  });
});

describe("ConditionNodeExecutor", () => {
  it("routes to trueNodeId when condition matches", async () => {
    const node: WorkflowConditionNode = {
      id: "c1", kind: "condition", label: "Check",
      condition: { operator: "equals", leftPath: "$.status", rightValue: "ready" },
      route: { trueNodeId: "n-yes", falseNodeId: "n-no" },
    };
    const exec = new ConditionNodeExecutor();
    const result = await exec.execute(makeCtx(node, { status: "ready" }));
    expect(result.writes).toEqual([{ channelName: "__route__", value: "n-yes" }]);
  });

  it("routes to falseNodeId when condition fails", async () => {
    const node: WorkflowConditionNode = {
      id: "c1", kind: "condition", label: "Check",
      condition: { operator: "equals", leftPath: "$.status", rightValue: "ready" },
      route: { trueNodeId: "n-yes", falseNodeId: "n-no" },
    };
    const exec = new ConditionNodeExecutor();
    const result = await exec.execute(makeCtx(node, { status: "pending" }));
    expect(result.writes).toEqual([{ channelName: "__route__", value: "n-no" }]);
  });

  it("handles exists operator", async () => {
    const node: WorkflowConditionNode = {
      id: "c1", kind: "condition", label: "Check",
      condition: { operator: "exists", leftPath: "$.data" },
      route: { trueNodeId: "n-yes", falseNodeId: "n-no" },
    };
    const exec = new ConditionNodeExecutor();
    const result = await exec.execute(makeCtx(node, { data: "something" }));
    expect(result.writes).toEqual([{ channelName: "__route__", value: "n-yes" }]);
  });
});

describe("LlmNodeExecutor", () => {
  it("passes workflow llm experience overrides through to the model caller", async () => {
    const modelCaller = vi.fn(async () => ({ content: "done" }));
    const exec = new LlmNodeExecutor(modelCaller, () => ({ id: "profile-1" }));
    const node: WorkflowLlmNode = {
      id: "llm-1",
      kind: "llm",
      label: "Think",
      llm: {
        prompt: "hello {{topic}}",
        providerFamily: "anthropic-native",
        protocolTarget: "anthropic-messages",
        experienceProfileId: "claude-best",
      },
    };

    await exec.execute(makeCtx(node, { topic: "world" }));

    expect(modelCaller).toHaveBeenCalledWith(expect.objectContaining({
      profile: { id: "profile-1" },
      messages: [{ role: "user", content: "hello world" }],
      providerFamily: "anthropic-native",
      protocolTarget: "anthropic-messages",
      experienceProfileId: "claude-best",
      workflowRunId: "test-run",
    }));
  });

  it("uses the final model content when no streaming deltas are emitted", async () => {
    const modelCaller = vi.fn(async () => ({ content: "final reply" }));
    const exec = new LlmNodeExecutor(modelCaller, () => ({ id: "profile-1" }));
    const node: WorkflowLlmNode = {
      id: "llm-2",
      kind: "llm",
      label: "Summarize",
      llm: {
        prompt: "summarize {{topic}}",
      },
    };

    const result = await exec.execute(makeCtx(node, { topic: "status" }));

    expect(result.writes).toEqual([{ channelName: "lastLlmOutput", value: "final reply" }]);
    expect(result.outputs).toEqual({ content: "final reply" });
  });

  it("rejects incomplete streamed model results instead of writing partial output", async () => {
    const modelCaller = vi.fn(async () => ({ content: "partial reply", streamCompleted: false }));
    const exec = new LlmNodeExecutor(modelCaller, () => ({ id: "profile-1" }));
    const node: WorkflowLlmNode = {
      id: "llm-stream",
      kind: "llm",
      label: "Summarize",
      llm: {
        prompt: "summarize {{topic}}",
      },
    };

    await expect(exec.execute(makeCtx(node, { topic: "status" }))).rejects.toThrow("模型响应流异常截断");
  });

  it("renders dotted workflow variable references in prompts", async () => {
    const modelCaller = vi.fn(async () => ({ content: "final reply" }));
    const exec = new LlmNodeExecutor(modelCaller, () => ({ id: "profile-1" }));
    const node: WorkflowLlmNode = {
      id: "llm-3",
      kind: "llm",
      label: "Summarize",
      llm: {
        prompt: "主题 {{ inputs.topic }}；上游 {{ nodes.fetch.body.title }}；跟踪 {{ traceId }}",
      },
    };

    await exec.execute(makeCtx(
      node,
      {
        inputs: { topic: "季度复盘" },
        nodes: { fetch: { body: { title: "接口返回" } } },
      },
      { traceId: "trace-1" },
    ));

    expect(modelCaller).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: "user", content: "主题 季度复盘；上游 接口返回；跟踪 trace-1" }],
    }));
  });
});

describe("ToolNodeExecutor", () => {
  it("passes structured args to builtin tool executors instead of label strings", async () => {
    const toolExecutor = vi.fn(async () => ({ success: true, output: "ok" }));
    const exec = new ToolNodeExecutor(toolExecutor, null);
    const node: WorkflowToolNode = {
      id: "tool-1",
      kind: "tool",
      label: "Read file",
      tool: {
        toolId: "fs.read",
        args: {},
        outputKey: "fileText",
      },
      inputBindings: {
        path: "inputs.path",
      },
    };

    const result = await exec.execute(makeCtx(node, { inputs: { path: "README.md" } }, { maxChars: 2000 }));

    expect(toolExecutor).toHaveBeenCalledWith("fs.read", { path: "README.md", maxChars: 2000 }, "/tmp");
    expect(result.writes).toEqual([{ channelName: "fileText", value: "ok" }]);
  });

  it("parses MCP ids with double underscores inside the tool name", () => {
    expect(parseMcpToolId("mcp__server_one__search__docs")).toEqual({
      serverId: "server_one",
      toolName: "search__docs",
    });
  });
});

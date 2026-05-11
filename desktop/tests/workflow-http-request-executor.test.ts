import { describe, expect, it, vi } from "vitest";
import type { WorkflowHttpRequestNode, WorkflowNodeInputSource } from "@shared/contracts";
import { WorkflowEventEmitter } from "../src/main/services/workflow-engine/event-emitter";
import { HttpRequestNodeExecutor } from "../src/main/services/workflow-engine/executors/http-request";

function makeCtx(
  node: WorkflowHttpRequestNode,
  state: Record<string, unknown> = {},
  resolvedInputs: Record<string, unknown> = {},
) {
  return {
    node,
    state: new Map(Object.entries(state)),
    resolvedInputs,
    config: {
      recursionLimit: 50,
      workingDirectory: "/tmp",
      modelProfileId: "default",
      checkpointPolicy: "every-step" as const,
    },
    emitter: new WorkflowEventEmitter(),
    signal: new AbortController().signal,
    runId: "test-run",
  };
}

describe("HttpRequestNodeExecutor", () => {
  it("writes the response body into the configured output channel", async () => {
    const response = new Response("pong", { status: 200 });
    const fetchMock = vi.fn(async () => response);
    const exec = new HttpRequestNodeExecutor(fetchMock as unknown as typeof fetch);
    const node: WorkflowHttpRequestNode = {
      id: "http-1",
      kind: "http-request",
      label: "Call API",
      httpRequest: {
        method: "GET",
        url: "https://example.com/ping",
        headers: {},
        outputKey: "apiResult",
      },
    };

    const result = await exec.execute(makeCtx(node));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/ping",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.writes).toEqual([{ channelName: "apiResult", value: "pong" }]);
    expect(result.outputs).toEqual(expect.objectContaining({ status: 200, body: "pong" }));
  });

  it("renders URL, headers, and body from workflow variables", async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 201 });
    const fetchMock = vi.fn(async () => response);
    const exec = new HttpRequestNodeExecutor(fetchMock as unknown as typeof fetch);
    const inputSources: Record<string, WorkflowNodeInputSource> = {
      traceId: { mode: "variable", ref: { scope: "input", path: "traceId", valueType: "string" } },
    };
    const node: WorkflowHttpRequestNode = {
      id: "http-2",
      kind: "http-request",
      label: "Create API",
      inputSources,
      httpRequest: {
        method: "POST",
        url: "https://example.com/items/{{ inputs.itemId }}",
        headers: { "X-Trace": "{{ traceId }}" },
        body: "{\"title\":\"{{ inputs.title }}\",\"summary\":\"{{ nodes.llm_1.content }}\"}",
        outputKey: "apiResult",
      },
    };

    await exec.execute(makeCtx(
      node,
      {
        inputs: { itemId: "abc", title: "季度复盘", traceId: "trace-1" },
        nodes: { llm_1: { content: "分析完成" } },
      },
      { traceId: "trace-1" },
    ));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/items/abc",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Trace": "trace-1" }),
        body: "{\"title\":\"季度复盘\",\"summary\":\"分析完成\"}",
      }),
    );
  });
});

import { describe, expect, it } from "vitest";

import type { WorkflowEndNode } from "@shared/contracts";
import { EndNodeExecutor } from "../src/main/services/workflow-engine/executors/end";
import { WorkflowEventEmitter } from "../src/main/services/workflow-engine/event-emitter";

describe("EndNodeExecutor outputSources", () => {
  it("把配置的 outputSources 写入 outputs channel", async () => {
    const executor = new EndNodeExecutor();
    const node: WorkflowEndNode = {
      id: "node-end",
      kind: "end",
      label: "结束",
      outputSources: {
        answer: {
          mode: "variable",
          ref: { scope: "node", nodeId: "node-llm", path: "content", valueType: "string" },
        },
      },
    };

    const result = await executor.execute({
      node,
      state: new Map([
        ["nodes", { "node-llm": { content: "今天杭州多云。" } }],
      ]),
      resolvedInputs: {},
      config: {
        recursionLimit: 10,
        workingDirectory: "F:/MyClaw",
        modelProfileId: "profile-1",
        checkpointPolicy: "none",
      },
      emitter: new WorkflowEventEmitter(),
      signal: new AbortController().signal,
      runId: "run-1",
    });

    expect(result.outputs).toEqual({ answer: "今天杭州多云。" });
    expect(result.writes).toEqual(expect.arrayContaining([
      { channelName: "outputs", value: { answer: "今天杭州多云。" } },
      { channelName: "__done__", value: true },
    ]));
  });
});

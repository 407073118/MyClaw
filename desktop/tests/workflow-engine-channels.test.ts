import { describe, it, expect } from "vitest";
import {
  LastValueChannel,
  ReducerChannel,
  EphemeralChannel,
  compileChannels,
} from "../src/main/services/workflow-engine/channels";
import type { WorkflowStateSchemaField } from "@shared/contracts";

describe("LastValueChannel", () => {
  it("stores last written value", () => {
    const ch = new LastValueChannel<string>("test", "");
    expect(ch.get()).toBe("");
    const changed = ch.update(["hello"]);
    expect(changed).toBe(true);
    expect(ch.get()).toBe("hello");
    expect(ch.version).toBe(1);
  });

  it("returns false when value unchanged", () => {
    const ch = new LastValueChannel<string>("test", "x");
    ch.update(["hello"]);
    expect(ch.version).toBe(1);
    const changed = ch.update(["hello"]);
    expect(changed).toBe(false);
    expect(ch.version).toBe(1);
  });

  it("keeps last value when multiple updates in one call", () => {
    const ch = new LastValueChannel<string>("test", "");
    ch.update(["a", "b", "c"]);
    expect(ch.get()).toBe("c");
  });

  it("checkpoints and restores", () => {
    const ch = new LastValueChannel<string>("test", "");
    ch.update(["saved"]);
    const cp = ch.checkpoint();
    ch.update(["overwritten"]);
    ch.fromCheckpoint(cp);
    expect(ch.get()).toBe("saved");
  });
});

describe("ReducerChannel", () => {
  it("appends arrays", () => {
    const ch = new ReducerChannel<string[]>(
      "messages",
      (cur, upd) => [...cur, ...upd],
      [],
    );
    ch.update([["hello"]]);
    ch.update([["world"]]);
    expect(ch.get()).toEqual(["hello", "world"]);
    expect(ch.version).toBe(2);
  });

  it("merges from multiple writers in one superstep", () => {
    const ch = new ReducerChannel<string[]>(
      "messages",
      (cur, upd) => [...cur, ...upd],
      [],
    );
    ch.update([["from-node-a"], ["from-node-b"]]);
    expect(ch.get()).toEqual(["from-node-a", "from-node-b"]);
  });

  it("checkpoints and restores", () => {
    const ch = new ReducerChannel<number>(
      "counter",
      (cur, upd) => cur + upd,
      0,
    );
    ch.update([5]);
    ch.update([3]);
    const cp = ch.checkpoint();
    ch.update([100]);
    ch.fromCheckpoint(cp);
    expect(ch.get()).toBe(8);
  });
});

describe("EphemeralChannel", () => {
  it("stores value then clears on reset", () => {
    const ch = new EphemeralChannel<string>("signal");
    ch.update(["go"]);
    expect(ch.get()).toBe("go");
    ch.reset();
    expect(ch.get()).toBeUndefined();
  });
});

describe("compileChannels", () => {
  it("creates channels from state schema", () => {
    const schema: WorkflowStateSchemaField[] = [
      {
        key: "result", label: "Result", description: "", valueType: "string",
        mergeStrategy: "replace", required: false, producerNodeIds: [], consumerNodeIds: [],
      },
      {
        key: "messages", label: "Messages", description: "", valueType: "array",
        mergeStrategy: "append", required: false, producerNodeIds: [], consumerNodeIds: [],
      },
    ];
    const channels = compileChannels(schema);
    expect(channels.has("result")).toBe(true);
    expect(channels.has("messages")).toBe(true);
    expect(channels.has("__route__")).toBe(true);
    expect(channels.has("__interrupt__")).toBe(true);
    expect(channels.has("__resume__")).toBe(true);
    expect(channels.has("__done__")).toBe(true);
  });
});

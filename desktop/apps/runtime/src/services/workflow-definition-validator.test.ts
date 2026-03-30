import { describe, expect, it } from "vitest";

import type { WorkflowDefinition } from "@myclaw-desktop/shared";

import { validateWorkflowDefinition } from "./workflow-definition-validator";

function createValidDefinition(): WorkflowDefinition {
  return {
    id: "workflow-risk-review",
    name: "Risk Review",
    description: "Routes decisions",
    status: "draft",
    source: "personal",
    updatedAt: "2026-03-24T00:00:00.000Z",
    version: 1,
    nodeCount: 2,
    edgeCount: 1,
    libraryRootId: "personal",
    entryNodeId: "node-start",
    nodes: [
      {
        id: "node-start",
        kind: "start",
        label: "Start",
      },
      {
        id: "node-end",
        kind: "end",
        label: "End",
      },
    ],
    edges: [
      {
        id: "edge-start-end",
        fromNodeId: "node-start",
        toNodeId: "node-end",
        kind: "normal",
      },
    ],
    stateSchema: [],
    editor: {
      canvas: {
        viewport: {
          offsetX: 0,
          offsetY: 0,
        },
        nodes: [
          {
            nodeId: "node-start",
            position: {
              x: 120,
              y: 140,
            },
          },
          {
            nodeId: "node-end",
            position: {
              x: 420,
              y: 140,
            },
          },
        ],
      },
    },
  };
}

describe("workflow definition validator", () => {
  it("accepts a valid definition", () => {
    const result = validateWorkflowDefinition(createValidDefinition());
    expect(result.valid).toBe(true);
  });

  it("rejects canvas layout entries with duplicate node ids", () => {
    const definition = createValidDefinition();
    definition.editor = {
      canvas: {
        viewport: {
          offsetX: 0,
          offsetY: 0,
        },
        nodes: [
          {
            nodeId: "node-start",
            position: {
              x: 100,
              y: 100,
            },
          },
          {
            nodeId: "node-start",
            position: {
              x: 300,
              y: 100,
            },
          },
        ],
      },
    };

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("editor_canvas_duplicate_node_id");
    }
  });

  it("rejects canvas layout entries that reference missing nodes", () => {
    const definition = createValidDefinition();
    definition.editor = {
      canvas: {
        viewport: {
          offsetX: 0,
          offsetY: 0,
        },
        nodes: [
          {
            nodeId: "node-start",
            position: {
              x: 100,
              y: 100,
            },
          },
          {
            nodeId: "node-missing",
            position: {
              x: 300,
              y: 100,
            },
          },
        ],
      },
    };

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("editor_canvas_node_not_found");
    }
  });

  it("rejects canvas viewport values that are not finite numbers", () => {
    const definition = createValidDefinition();
    definition.editor = {
      canvas: {
        viewport: {
          offsetX: Number.POSITIVE_INFINITY,
          offsetY: 0,
        },
        nodes: [
          {
            nodeId: "node-start",
            position: {
              x: 100,
              y: 100,
            },
          },
        ],
      },
    };

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("editor_canvas_viewport_invalid");
    }
  });

  it("rejects canvas node positions that are not finite numbers", () => {
    const definition = createValidDefinition();
    definition.editor = {
      canvas: {
        viewport: {
          offsetX: 0,
          offsetY: 0,
        },
        nodes: [
          {
            nodeId: "node-start",
            position: {
              x: Number.NaN,
              y: 100,
            },
          },
        ],
      },
    };

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("editor_canvas_position_invalid");
    }
  });

  it("rejects missing entry nodes", () => {
    const definition = createValidDefinition();
    definition.entryNodeId = "node-missing";

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("entry_node_not_found");
    }
  });

  it("rejects conditional edges without condition", () => {
    const definition = createValidDefinition();
    definition.edges = [
      {
        id: "edge-start-end",
        fromNodeId: "node-start",
        toNodeId: "node-end",
        kind: "conditional",
      } as WorkflowDefinition["edges"][number],
    ];

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("conditional_edge_missing_condition");
    }
  });

  it("rejects edges with unknown nodes", () => {
    const definition = createValidDefinition();
    definition.edges = [
      {
        id: "edge-invalid",
        fromNodeId: "node-start",
        toNodeId: "node-x",
        kind: "normal",
      },
    ];

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("edge_target_not_found");
    }
  });

  it("rejects unknown node kinds", () => {
    const definition = createValidDefinition();
    definition.nodes = [
      ...(definition.nodes.slice(0, 1) as WorkflowDefinition["nodes"]),
      {
        id: "node-unknown",
        kind: "unknown-kind",
        label: "Unknown",
      } as unknown as WorkflowDefinition["nodes"][number],
    ];
    definition.entryNodeId = "node-start";
    definition.edges = [];
    definition.nodeCount = definition.nodes.length;
    definition.edgeCount = 0;

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("node_kind_invalid");
    }
  });

  it("rejects llm nodes without prompts", () => {
    const definition = createValidDefinition();
    definition.nodes = [
      {
        id: "node-start",
        kind: "start",
        label: "Start",
      },
      {
        id: "node-llm",
        kind: "llm",
        label: "Draft",
        llm: {
          prompt: "   ",
        },
      },
      {
        id: "node-end",
        kind: "end",
        label: "End",
      },
    ];
    definition.edges = [
      {
        id: "edge-start-llm",
        fromNodeId: "node-start",
        toNodeId: "node-llm",
        kind: "normal",
      },
      {
        id: "edge-llm-end",
        fromNodeId: "node-llm",
        toNodeId: "node-end",
        kind: "normal",
      },
    ];
    definition.nodeCount = 3;
    definition.edgeCount = 2;

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("llm_node_prompt_required");
    }
  });

  it("rejects invalid state schema field structures", () => {
    const definition = createValidDefinition();
    definition.stateSchema = [
      {
        key: "decision",
        label: "Decision",
        description: "Decision state",
        valueType: "string",
        mergeStrategy: "replace",
        required: "yes",
        producerNodeIds: ["node-start"],
        consumerNodeIds: ["node-end"],
      } as unknown as WorkflowDefinition["stateSchema"][number],
    ];

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("state_field_required_invalid");
    }
  });

  it("rejects join nodes with invalid mode", () => {
    const definition = createValidDefinition();
    definition.nodes = [
      {
        id: "node-start",
        kind: "start",
        label: "Start",
      },
      {
        id: "node-join",
        kind: "join",
        label: "Join",
        join: {
          mode: "invalid",
          upstreamNodeIds: ["node-start"],
        },
      } as unknown as WorkflowDefinition["nodes"][number],
      {
        id: "node-end",
        kind: "end",
        label: "End",
      },
    ];
    definition.edges = [
      {
        id: "edge-start-join",
        fromNodeId: "node-start",
        toNodeId: "node-join",
        kind: "normal",
      },
      {
        id: "edge-join-end",
        fromNodeId: "node-join",
        toNodeId: "node-end",
        kind: "normal",
      },
    ];
    definition.nodeCount = 3;
    definition.edgeCount = 2;

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("join_mode_invalid");
    }
  });

  it("rejects join overrides for unknown state fields", () => {
    const definition = createValidDefinition();
    definition.nodes = [
      {
        id: "node-start",
        kind: "start",
        label: "Start",
      },
      {
        id: "node-join",
        kind: "join",
        label: "Join",
        join: {
          mode: "all",
          upstreamNodeIds: ["node-start"],
          mergeStrategyOverrides: {
            missingField: "replace",
          },
        },
      },
      {
        id: "node-end",
        kind: "end",
        label: "End",
      },
    ];
    definition.edges = [
      {
        id: "edge-start-join",
        fromNodeId: "node-start",
        toNodeId: "node-join",
        kind: "normal",
      },
      {
        id: "edge-join-end",
        fromNodeId: "node-join",
        toNodeId: "node-end",
        kind: "normal",
      },
    ];
    definition.stateSchema = [
      {
        key: "decision",
        label: "Decision",
        description: "Decision state",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["node-start"],
        consumerNodeIds: ["node-end"],
      },
    ];
    definition.nodeCount = 3;
    definition.edgeCount = 2;

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("join_merge_field_not_found");
    }
  });

  it("rejects join overrides with invalid merge strategies", () => {
    const definition = createValidDefinition();
    definition.nodes = [
      {
        id: "node-start",
        kind: "start",
        label: "Start",
      },
      {
        id: "node-join",
        kind: "join",
        label: "Join",
        join: {
          mode: "all",
          upstreamNodeIds: ["node-start"],
          mergeStrategyOverrides: {
            decision: "invalid-strategy",
          },
        },
      } as unknown as WorkflowDefinition["nodes"][number],
      {
        id: "node-end",
        kind: "end",
        label: "End",
      },
    ];
    definition.edges = [
      {
        id: "edge-start-join",
        fromNodeId: "node-start",
        toNodeId: "node-join",
        kind: "normal",
      },
      {
        id: "edge-join-end",
        fromNodeId: "node-join",
        toNodeId: "node-end",
        kind: "normal",
      },
    ];
    definition.stateSchema = [
      {
        key: "decision",
        label: "Decision",
        description: "Decision state",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["node-start"],
        consumerNodeIds: ["node-end"],
      },
    ];
    definition.nodeCount = 3;
    definition.edgeCount = 2;

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("join_merge_strategy_invalid");
    }
  });

  it("rejects summary index mismatches", () => {
    const definition = createValidDefinition();
    definition.nodeCount = 3;

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("summary_node_count_mismatch");
    }
  });

  it("rejects malformed defaults run policy", () => {
    const definition = createValidDefinition();
    definition.defaults = {
      run: {
        maxParallelNodes: -1,
        checkpointPolicy: "sometimes",
      } as unknown as NonNullable<WorkflowDefinition["defaults"]>["run"],
    };

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("defaults_run_policy_invalid");
    }
  });

  it("rejects malformed node policy payloads", () => {
    const definition = createValidDefinition();
    definition.nodes = [
      {
        id: "node-start",
        kind: "start",
        label: "Start",
        policy: {
          retry: {
            maxAttempts: 0,
            backoffMs: 100,
          },
        },
      },
      {
        id: "node-end",
        kind: "end",
        label: "End",
      },
    ];

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("node_policy_invalid");
    }
  });

  it("rejects route-on-failure policies without a target node", () => {
    const definition = createValidDefinition();
    definition.nodes = [
      {
        id: "node-start",
        kind: "start",
        label: "Start",
        policy: {
          onFailure: {
            mode: "route",
          },
        },
      } as WorkflowDefinition["nodes"][number],
      {
        id: "node-end",
        kind: "end",
        label: "End",
      },
    ];

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("node_policy_invalid");
    }
  });

  it("accepts condition nodes with inline condition route config", () => {
    const definition = createValidDefinition();
    definition.nodes = [
      {
        id: "node-start",
        kind: "start",
        label: "Start",
      },
      {
        id: "node-condition",
        kind: "condition",
        label: "Decide",
        condition: {
          operator: "greater-than",
          leftPath: "score",
          rightValue: 80,
        },
        route: {
          trueNodeId: "node-pass",
          falseNodeId: "node-fail",
        },
      } as WorkflowDefinition["nodes"][number],
      {
        id: "node-pass",
        kind: "end",
        label: "Pass",
      },
      {
        id: "node-fail",
        kind: "end",
        label: "Fail",
      },
    ];
    definition.edges = [
      {
        id: "edge-start-condition",
        fromNodeId: "node-start",
        toNodeId: "node-condition",
        kind: "normal",
      },
      {
        id: "edge-condition-pass",
        fromNodeId: "node-condition",
        toNodeId: "node-pass",
        kind: "normal",
      },
      {
        id: "edge-condition-fail",
        fromNodeId: "node-condition",
        toNodeId: "node-fail",
        kind: "normal",
      },
    ];
    definition.entryNodeId = "node-start";
    definition.nodeCount = definition.nodes.length;
    definition.edgeCount = definition.edges.length;
    definition.editor = {
      canvas: {
        viewport: {
          offsetX: 0,
          offsetY: 0,
        },
        nodes: [
          { nodeId: "node-start", position: { x: 120, y: 140 } },
          { nodeId: "node-condition", position: { x: 320, y: 140 } },
          { nodeId: "node-pass", position: { x: 540, y: 80 } },
          { nodeId: "node-fail", position: { x: 540, y: 220 } },
        ],
      },
    };

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(true);
  });

  it("rejects condition nodes without rule config or conditional edge", () => {
    const definition = createValidDefinition();
    definition.nodes = [
      {
        id: "node-start",
        kind: "start",
        label: "Start",
      },
      {
        id: "node-condition",
        kind: "condition",
        label: "Decide",
      } as WorkflowDefinition["nodes"][number],
      {
        id: "node-end",
        kind: "end",
        label: "End",
      },
    ];
    definition.edges = [
      {
        id: "edge-start-condition",
        fromNodeId: "node-start",
        toNodeId: "node-condition",
        kind: "normal",
      },
      {
        id: "edge-condition-end",
        fromNodeId: "node-condition",
        toNodeId: "node-end",
        kind: "normal",
      },
    ];
    definition.nodeCount = definition.nodes.length;
    definition.edgeCount = definition.edges.length;

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("condition_node_rule_required");
    }
  });

  it("rejects condition route targets that are not reachable from the condition node", () => {
    const definition = createValidDefinition();
    definition.nodes = [
      {
        id: "node-start",
        kind: "start",
        label: "Start",
      },
      {
        id: "node-condition",
        kind: "condition",
        label: "Decide",
        condition: {
          operator: "equals",
          leftPath: "flag",
          rightValue: true,
        },
        route: {
          trueNodeId: "node-pass",
        },
      } as WorkflowDefinition["nodes"][number],
      {
        id: "node-pass",
        kind: "end",
        label: "Pass",
      },
      {
        id: "node-end",
        kind: "end",
        label: "End",
      },
    ];
    definition.edges = [
      {
        id: "edge-start-condition",
        fromNodeId: "node-start",
        toNodeId: "node-condition",
        kind: "normal",
      },
      {
        id: "edge-condition-end",
        fromNodeId: "node-condition",
        toNodeId: "node-end",
        kind: "normal",
      },
    ];
    definition.nodeCount = definition.nodes.length;
    definition.edgeCount = definition.edges.length;

    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("condition_route_edge_missing");
    }
  });
});

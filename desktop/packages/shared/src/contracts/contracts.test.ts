import { describe, expect, it } from "vitest";

import {
  A2UI_LITE_VERSION,
  BUILTIN_TOOL_APPROVAL_MODES,
  BUILTIN_TOOL_GROUPS,
  EventType,
  EmployeePackageSource,
  ScopeKind,
  ToolRiskCategory,
  WorkflowEdgeKind,
  WorkflowMergeStrategy,
  WorkflowNodeKind,
  WorkflowPackageSource,
  WorkflowRunStatus,
  WorkflowStatus,
  WorkflowTransitionConditionOperator,
  createDefaultApprovalPolicy,
  shouldRequestApproval,
} from "../index";
import type {
  ChatMessage,
  LocalEmployeeSummary,
  ModelProfile,
  WorkflowCanvasNodeLayout,
  WorkflowCanvasPoint,
  WorkflowCanvasViewport,
  WorkflowDefinition,
  WorkflowDefinitionSummary,
  WorkflowEditorCanvas,
  WorkflowEditorMetadata,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodePolicy,
  WorkflowRunSummary,
  WorkflowStateSchemaField,
  WorkflowSummary,
} from "../index";

describe("shared contracts", () => {
  it("exports stable enums", () => {
    expect(EventType.ApprovalRequested).toBe("approval.requested");
    expect(ToolRiskCategory.Read).toBe("read");
    expect(ScopeKind.Global).toBe("global");
    expect(A2UI_LITE_VERSION).toBe("a2ui-lite/v1");
    expect(BUILTIN_TOOL_GROUPS).toContain("fs");
    expect(BUILTIN_TOOL_GROUPS).toContain("archive");
    expect(BUILTIN_TOOL_APPROVAL_MODES).toContain("always-ask");
  });

  it("creates a sensible approval policy baseline", () => {
    const policy = createDefaultApprovalPolicy();

    expect(policy.autoApproveReadOnly).toBe(true);
    expect(policy.autoApproveSkills).toBe(true);
    expect(policy.mode).toBe("prompt");
  });

  it("exports employee and workflow platform contracts", () => {
    const employee: LocalEmployeeSummary = {
      id: "employee-onboarding",
      name: "Onboarding Assistant",
      description: "Guides a new teammate through startup tasks.",
      status: "draft",
      source: EmployeePackageSource.Personal,
      workflowIds: ["workflow-onboarding"],
      updatedAt: "2026-03-23T00:00:00.000Z",
    };

    const workflow: WorkflowDefinitionSummary = {
      id: "workflow-onboarding",
      name: "Onboarding Workflow",
      description: "Covers setup, follow-up, and completion checks.",
      status: "draft",
      source: WorkflowPackageSource.Personal,
      updatedAt: "2026-03-23T00:00:00.000Z",
      version: 1,
      nodeCount: 2,
      edgeCount: 1,
      libraryRootId: "personal",
    };

    expect(employee.source).toBe("personal");
    expect(workflow.source).toBe("personal");
    expect(EmployeePackageSource.Hub).toBe("hub");
    expect(WorkflowPackageSource.Enterprise).toBe("enterprise");

    const legacyWorkflowSummary: WorkflowDefinitionSummary = {
      id: "workflow-legacy-onboarding",
      name: "Legacy Onboarding Workflow",
      description: "Legacy summary shape should keep type compatibility.",
      status: "draft",
      source: WorkflowPackageSource.Personal,
      updatedAt: "2026-03-23T00:00:00.000Z",
    };
    expect(legacyWorkflowSummary.id).toBe("workflow-legacy-onboarding");
  });

  it("exports workflow graph contracts for executable definitions", () => {
    const stateField: WorkflowStateSchemaField = {
      key: "riskSignals",
      label: "Risk Signals",
      description: "Signals collected from parallel tools.",
      valueType: "array",
      mergeStrategy: WorkflowMergeStrategy.Append,
      required: false,
      producerNodeIds: ["node-tool-a", "node-tool-b"],
      consumerNodeIds: ["node-join-1"],
    };

    const policy: WorkflowNodePolicy = {
      timeoutMs: 30_000,
      retry: {
        maxAttempts: 3,
        backoffMs: 500,
      },
      idempotencyKeyTemplate: "{{runId}}:{{nodeId}}",
      onFailure: {
        mode: "route",
        routeNodeId: "node-end-error",
      },
    };

    const nodes: WorkflowNode[] = [
      {
        id: "node-start-1",
        kind: WorkflowNodeKind.Start,
        label: "Start",
      },
      {
        id: "node-join-1",
        kind: WorkflowNodeKind.Join,
        label: "Join Results",
        join: {
          mode: "all",
          upstreamNodeIds: ["node-tool-a", "node-tool-b"],
          timeoutMs: 10_000,
          mergeStrategyOverrides: {
            riskSignals: WorkflowMergeStrategy.Append,
          },
        },
      },
      {
        id: "node-end-1",
        kind: WorkflowNodeKind.End,
        label: "Finish",
      },
    ];

    const edges: WorkflowEdge[] = [
      {
        id: "edge-start-to-join",
        fromNodeId: "node-start-1",
        toNodeId: "node-join-1",
        kind: WorkflowEdgeKind.Normal,
      },
      {
        id: "edge-join-to-end",
        fromNodeId: "node-join-1",
        toNodeId: "node-end-1",
        kind: WorkflowEdgeKind.Conditional,
        condition: {
          operator: WorkflowTransitionConditionOperator.Equals,
          leftPath: "state.business.decision",
          rightValue: "approve",
        },
      },
    ];

    const summary: WorkflowSummary = {
      id: "workflow-risk-review",
      name: "Risk Review",
      description: "Evaluates risk signals before approval.",
      status: WorkflowStatus.Draft,
      source: WorkflowPackageSource.Personal,
      updatedAt: "2026-03-24T00:00:00.000Z",
      version: 1,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      libraryRootId: "personal",
    };

    const definition: WorkflowDefinition = {
      ...summary,
      entryNodeId: "node-start-1",
      nodes,
      edges,
      stateSchema: [stateField],
      defaults: {
        run: {
          maxParallelNodes: 4,
          checkpointPolicy: "node-complete",
        },
        nodePolicy: policy,
      },
    };

    const runSummary: WorkflowRunSummary = {
      id: "run-1",
      workflowId: definition.id,
      workflowVersion: definition.version,
      status: WorkflowRunStatus.WaitingJoin,
      currentNodeIds: ["node-join-1"],
      startedAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:05.000Z",
    };

    expect(definition.nodes[1]?.kind).toBe("join");
    expect(definition.defaults?.nodePolicy?.retry?.maxAttempts).toBe(3);
    expect(runSummary.currentNodeIds).toContain("node-join-1");
    expect(WorkflowRunStatus.RetryScheduled).toBe("retry-scheduled");

    // type-level gate: conditional edge must include condition
    // @ts-expect-error conditional edge requires a condition payload
    const invalidConditionalEdge: WorkflowEdge = {
      id: "edge-invalid-conditional",
      fromNodeId: "node-join-1",
      toNodeId: "node-end-1",
      kind: WorkflowEdgeKind.Conditional,
    };
    expect(invalidConditionalEdge).toBeDefined();

    // type-level gate: non-conditional edge cannot include condition payload
    // @ts-expect-error normal edge must not accept condition payload
    const invalidNormalEdge: WorkflowEdge = {
      id: "edge-invalid-normal",
      fromNodeId: "node-start-1",
      toNodeId: "node-join-1",
      kind: WorkflowEdgeKind.Normal,
      condition: {
        operator: WorkflowTransitionConditionOperator.Equals,
        leftPath: "state.business.decision",
        rightValue: "approve",
      },
    };
    expect(invalidNormalEdge).toBeDefined();
  });

  it("supports typed node configs for llm/tool/subgraph/condition routing", () => {
    const nodes: WorkflowNode[] = [
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
          prompt: "Draft response",
          outputKey: "llmDraft",
        },
      },
      {
        id: "node-tool",
        kind: "tool",
        label: "Lookup",
        tool: {
          toolId: "fs.read",
          outputKey: "toolResult",
        },
      },
      {
        id: "node-condition",
        kind: "condition",
        label: "Route",
        condition: {
          operator: "exists",
          leftPath: "toolResult",
        },
        route: {
          trueNodeId: "node-subgraph",
          falseNodeId: "node-end",
        },
      } as WorkflowNode,
      {
        id: "node-subgraph",
        kind: "subgraph",
        label: "Child Workflow",
        subgraph: {
          workflowId: "wf-child",
          outputKey: "subgraphResult",
        },
      },
      {
        id: "node-end",
        kind: "end",
        label: "End",
      },
    ];

    expect(nodes.find((node) => node.kind === "llm")).toEqual(expect.objectContaining({
      llm: expect.objectContaining({
        outputKey: "llmDraft",
      }),
    }));
    expect(nodes.find((node) => node.kind === "tool")).toEqual(expect.objectContaining({
      tool: expect.objectContaining({
        outputKey: "toolResult",
      }),
    }));
    expect(nodes.find((node) => node.kind === "subgraph")).toEqual(expect.objectContaining({
      subgraph: expect.objectContaining({
        outputKey: "subgraphResult",
      }),
    }));
    expect(nodes.find((node) => node.kind === "condition")).toEqual(expect.objectContaining({
      route: expect.objectContaining({
        trueNodeId: "node-subgraph",
      }),
    }));
  });

  it("exports workflow editor canvas contracts", () => {
    const viewport: WorkflowCanvasViewport = {
      offsetX: 0,
      offsetY: 0,
    };
    const startPosition: WorkflowCanvasPoint = {
      x: 120,
      y: 140,
    };
    const nodeLayouts: WorkflowCanvasNodeLayout[] = [
      {
        nodeId: "node-start-1",
        position: startPosition,
      },
      {
        nodeId: "node-end-1",
        position: {
          x: 420,
          y: 140,
        },
      },
    ];
    const canvas: WorkflowEditorCanvas = {
      viewport,
      nodes: nodeLayouts,
    };
    const editor: WorkflowEditorMetadata = {
      canvas,
    };

    const definition: WorkflowDefinition = {
      id: "workflow-editor-canvas",
      name: "Workflow Editor Canvas",
      description: "Canvas metadata should be available on workflow definitions.",
      status: "draft",
      source: "personal",
      updatedAt: "2026-03-24T00:00:00.000Z",
      version: 1,
      nodeCount: 2,
      edgeCount: 1,
      libraryRootId: "personal",
      entryNodeId: "node-start-1",
      nodes: [
        {
          id: "node-start-1",
          kind: "start",
          label: "Start",
        },
        {
          id: "node-end-1",
          kind: "end",
          label: "End",
        },
      ],
      edges: [
        {
          id: "edge-start-end",
          fromNodeId: "node-start-1",
          toNodeId: "node-end-1",
          kind: "normal",
        },
      ],
      stateSchema: [],
      editor,
    };

    expect(definition.editor?.canvas.viewport.offsetX).toBe(0);
    expect(definition.editor?.canvas.nodes).toHaveLength(2);
    expect(definition.editor?.canvas.nodes[1]?.position.x).toBe(420);
  });

  it("does not request approval for Skills when skill auto-approval is enabled", () => {
    const policy = createDefaultApprovalPolicy();

    expect(
      shouldRequestApproval({
        policy,
        source: "skill",
        toolId: "skill.project_scan",
        risk: ToolRiskCategory.Exec,
      }),
    ).toBe(false);
  });

  it("accepts request body config on model profiles and reasoning on chat messages", () => {
    const profile: ModelProfile = {
      id: "model-gateway",
      name: "Gateway",
      provider: "openai-compatible",
      baseUrl: "https://gateway.example.com/v1",
      apiKey: "sk-test",
      model: "gateway-model",
      requestBody: {
        reasoning_effort: "high",
        enable_thinking: true,
      },
    };

    const message: ChatMessage = {
      id: "msg-assistant-1",
      role: "assistant",
      content: "最终答复",
      reasoning: "先分析代码，再调用工具。",
      createdAt: "2026-03-20T00:00:00.000Z",
    };

    expect(profile.requestBody).toEqual({
      reasoning_effort: "high",
      enable_thinking: true,
    });
    expect(message.reasoning).toBe("先分析代码，再调用工具。");
  });
});

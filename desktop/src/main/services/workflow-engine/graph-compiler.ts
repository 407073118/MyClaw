import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "@shared/contracts";

export type CompiledGraph = {
  entryNodeId: string;
  adjacency: Map<string, string[]>;
  nodeSubscriptions: Map<string, string[]>;
  nodeOutputs: Map<string, string[]>;
  nodeMap: Map<string, WorkflowNode>;
  edges: WorkflowEdge[];
};

export function compileGraph(def: WorkflowDefinition): CompiledGraph {
  const nodeMap = new Map(def.nodes.map((n) => [n.id, n]));

  // Build adjacency from edges
  const adjacency = new Map<string, string[]>();
  for (const node of def.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of def.edges) {
    const list = adjacency.get(edge.fromNodeId);
    if (list && !list.includes(edge.toNodeId)) {
      list.push(edge.toNodeId);
    }
  }

  // Build output map from stateSchema.producerNodeIds
  const nodeOutputs = new Map<string, string[]>();
  for (const node of def.nodes) {
    nodeOutputs.set(node.id, []);
  }
  for (const field of def.stateSchema) {
    for (const producerId of field.producerNodeIds) {
      const outputs = nodeOutputs.get(producerId);
      if (outputs && !outputs.includes(field.key)) {
        outputs.push(field.key);
      }
    }
  }

  // Also derive from outputBindings and legacy outputKey
  for (const node of def.nodes) {
    const outputs = nodeOutputs.get(node.id) ?? [];
    if (node.outputBindings) {
      for (const channelName of Object.values(node.outputBindings)) {
        if (!outputs.includes(channelName)) outputs.push(channelName);
      }
    }
    if (node.kind === "llm" && node.llm?.outputKey) {
      const key = node.llm.outputKey;
      if (!outputs.includes(key)) outputs.push(key);
    }
    if (node.kind === "tool" && node.tool?.outputKey) {
      const key = node.tool.outputKey;
      if (!outputs.includes(key)) outputs.push(key);
    }
    if (node.kind === "subgraph" && node.subgraph?.outputKey) {
      const key = node.subgraph.outputKey;
      if (!outputs.includes(key)) outputs.push(key);
    }
    nodeOutputs.set(node.id, outputs);
  }

  // Build subscriptions
  const nodeSubscriptions = new Map<string, string[]>();
  for (const node of def.nodes) {
    const channels = new Set<string>();
    const upstreamNodeIds = def.edges
      .filter((e) => e.toNodeId === node.id)
      .map((e) => e.fromNodeId);
    for (const upId of upstreamNodeIds) {
      const upOutputs = nodeOutputs.get(upId) ?? [];
      for (const ch of upOutputs) channels.add(ch);
    }
    for (const field of def.stateSchema) {
      if (field.consumerNodeIds.includes(node.id)) {
        channels.add(field.key);
      }
    }
    if (node.inputBindings) {
      for (const channelName of Object.values(node.inputBindings)) {
        channels.add(channelName);
      }
    }
    nodeSubscriptions.set(node.id, [...channels]);
  }

  return { entryNodeId: def.entryNodeId, adjacency, nodeSubscriptions, nodeOutputs, nodeMap, edges: def.edges };
}

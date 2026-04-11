import type {
  CanonicalToolSpec,
  McpTool,
  SkillDefinition,
} from "@shared/contracts";

import { type OpenAIFunctionTool, buildToolSchemas } from "../tool-schemas";

function inferToolSource(name: string): CanonicalToolSpec["source"] {
  if (name.startsWith("skill_invoke__") || name === "skill_view") return "skill";
  if (name.startsWith("mcp__")) return "mcp";
  return "builtin";
}

/** 把 legacy function tool 定义转成 canonical tool spec。 */
export function canonicalToolSpecFromFunctionTool(
  tool: OpenAIFunctionTool,
  metadata?: CanonicalToolSpec["metadata"],
): CanonicalToolSpec {
  return {
    id: tool.function.name,
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    source: inferToolSource(tool.function.name),
    metadata,
  };
}

/**
 * 构建 canonical tool registry。
 * 当前先复用既有 schema 定义，再转成 provider-neutral 结构，避免主链回归。
 */
export function buildCanonicalToolRegistry(
  cwd: string,
  skills?: SkillDefinition[],
  mcpTools?: Array<McpTool & { serverId: string }>,
  toolPolicyId?: string,
): CanonicalToolSpec[] {
  return buildToolSchemas(cwd, skills, mcpTools, toolPolicyId).map((tool) => canonicalToolSpecFromFunctionTool(tool, {
    cwd,
    serverId: mcpTools?.find((candidate) => candidate.name === tool.function.name || candidate.id === tool.function.name)?.serverId ?? null,
  }));
}

/** 把 legacy tools 重新水化为 canonical registry，供 gateway shim 与测试复用。 */
export function hydrateCanonicalToolRegistryFromLegacyTools(
  legacyTools?: OpenAIFunctionTool[],
): CanonicalToolSpec[] {
  return (legacyTools ?? []).map((tool) => canonicalToolSpecFromFunctionTool(tool));
}

/** 兼容旧命名，供 gateway shim 与测试复用。 */
export const canonicalizeLegacyTools = hydrateCanonicalToolRegistryFromLegacyTools;

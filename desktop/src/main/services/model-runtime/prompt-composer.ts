import type {
  CanonicalTurnContent,
  ChatSession,
  ExperienceProfileId,
  McpTool,
  PersonalPromptProfile,
  PromptSection,
  ProviderFamily,
  SkillDefinition,
} from "@shared/contracts";
import {
  resolvePromptOverlayLines,
  resolvePromptProfileLines,
  resolveReasoningProfileLines,
  resolveToolPolicySummaryLines,
} from "./vendor-policy-registry";
import { buildToolSchemas } from "../tool-schemas";

function createSection(
  id: string,
  title: string,
  layer: PromptSection["layer"],
  content: string,
): PromptSection {
  return { id, title, layer, content };
}

function buildPersonalPromptContext(profile?: PersonalPromptProfile | null): string | null {
  if (!profile) return null;
  const summary = profile.summary?.trim();
  const prompt = profile.prompt?.trim();
  const parts = [summary, prompt].filter((value): value is string => !!value);
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

function buildFamilyOverlay(
  providerFamily: ProviderFamily,
  experienceProfileId: ExperienceProfileId,
): string {
  return [
    `Provider family: ${providerFamily}`,
    `Experience profile: ${experienceProfileId}`,
    ...resolvePromptOverlayLines(providerFamily),
  ].join("\n");
}

export type ComposePromptInput = {
  session: ChatSession;
  workingDir: string;
  providerFamily: ProviderFamily;
  experienceProfileId: ExperienceProfileId;
  promptPolicyId?: string | null;
  toolPolicyId?: string | null;
  reasoningProfileId?: string | null;
  skills?: SkillDefinition[];
  gitBranch?: string | null;
  personalPromptProfile?: PersonalPromptProfile | null;
  reasoningEffort?: "low" | "medium" | "high" | null;
  enrichedContextBlock?: string | null;
  mcpTools?: Array<McpTool & { serverId: string }>;
};

/**
 * 组合 canonical prompt sections，保留旧 system prompt 的主要信息结构。
 */
export function composePromptSections(input: ComposePromptInput): PromptSection[] {
  const effort = input.reasoningEffort ?? "medium";
  const now = new Date();
  const sections: PromptSection[] = [];

  sections.push(createSection(
    "identity",
    "Identity",
    "identity",
    [
      "You are MyClaw, an expert AI assistant that helps users accomplish real work tasks.",
      "Your goal is to understand what the user actually needs, choose the right approach, and execute it well.",
      "Always read the user's message carefully — a vague request deserves a clarifying question, not a guess.",
    ].join("\n"),
  ));

  sections.push(createSection(
    "environment",
    "Environment",
    "environment",
    [
      `Working directory: ${input.workingDir}`,
      `Platform: ${process.platform} (${process.arch})`,
      `Date: ${now.toISOString().split("T")[0]} ${now.toTimeString().split(" ")[0]}`,
      input.gitBranch ? `Git branch: ${input.gitBranch}` : null,
    ].filter((value): value is string => !!value).join("\n"),
  ));

  if (input.enrichedContextBlock) {
    sections.push(createSection(
      "session-context",
      "Session Context",
      "context",
      input.enrichedContextBlock,
    ));
  }

  sections.push(createSection(
    "response-strategy",
    "Response Strategy",
    "other",
    effort === "low"
      ? "Answer directly and stay concise unless the user clearly signals they need more depth."
      : [
          "Adapt the response to the user's intent:",
          "- Ask/Explain → explain clearly with relevant code snippets.",
          "- Fix/Debug → locate the issue first, then fix with evidence.",
          "- Build/Create → clarify scope if needed, then plan and implement step by step.",
          "- Review/Improve → prioritize the highest-signal issues first.",
          "- Quick/Direct → keep the answer focused and short.",
        ].join("\n"),
  ));

  sections.push(createSection(
    "task-planning",
    "Task Planning",
    "task",
    effort === "low"
      ? "Use task tracking only when the user explicitly asks for a tracked workflow."
      : [
          "For non-trivial work, decompose the request before execution.",
          "Create all obvious tasks before starting the first implementation step.",
          "Update task status immediately when work starts or finishes.",
        ].join("\n"),
  ));

  const availableTools = buildToolSchemas(
    input.workingDir,
    input.skills,
    input.mcpTools,
    input.toolPolicyId ?? "generic.tools.default",
  ).map((tool) => tool.function.name);
  const toolLines = [
    `Builtin and connected tools: ${availableTools.join(", ")}`,
  ];
  if (input.mcpTools && input.mcpTools.length > 0) {
    toolLines.push(`Connected MCP tools: ${input.mcpTools.map((tool) => tool.name).join(", ")}`);
  }
  sections.push(createSection("tools", "Tools", "tools", toolLines.join("\n")));

  const toolPolicyLines = input.toolPolicyId ? resolveToolPolicySummaryLines(input.toolPolicyId) : [];
  if (toolPolicyLines.length > 0) {
    sections.push(createSection(
      "tool-policy",
      "Tool Policy",
      "guidelines",
      [
        `Tool policy: ${input.toolPolicyId}`,
        ...toolPolicyLines,
      ].join("\n"),
    ));
  }

  if (input.skills && input.skills.length > 0) {
    const enabledSkills = input.skills.filter((skill) => skill.enabled).map((skill) => skill.name);
    sections.push(createSection(
      "skills",
      "Skills",
      "skills",
      enabledSkills.length > 0
        ? `Enabled skills: ${enabledSkills.join(", ")}`
        : "No enabled skills are currently available.",
    ));
  }

  sections.push(createSection(
    "family-overlay",
    "Family Overlay",
    "family-overlay",
    buildFamilyOverlay(input.providerFamily, input.experienceProfileId),
  ));

  const promptProfileLines = input.promptPolicyId ? resolvePromptProfileLines(input.promptPolicyId) : [];
  if (promptProfileLines.length > 0) {
    sections.push(createSection(
      "prompt-policy",
      "Prompt Policy",
      "guidelines",
      [
        `Prompt policy: ${input.promptPolicyId}`,
        ...promptProfileLines,
      ].join("\n"),
    ));
  }

  const reasoningProfileLines = input.reasoningProfileId ? resolveReasoningProfileLines(input.reasoningProfileId) : [];
  if (reasoningProfileLines.length > 0) {
    sections.push(createSection(
      "reasoning-policy",
      "Reasoning Policy",
      "guidelines",
      [
        `Reasoning profile: ${input.reasoningProfileId}`,
        ...reasoningProfileLines,
      ].join("\n"),
    ));
  }

  const personalPromptContext = buildPersonalPromptContext(input.personalPromptProfile);
  if (personalPromptContext) {
    sections.push(createSection(
      "user-profile",
      "User Profile",
      "other",
      personalPromptContext,
    ));
  }

  return sections;
}

/**
 * 将 canonical prompt sections 渲染成当前主链可消费的 system prompt 字符串。
 */
export function renderPromptSections(sections: PromptSection[]): string {
  return sections
    .map((section) => `# ${section.title}\n${section.content}`)
    .join("\n\n");
}

/**
 * 把 prompt sections 写回 canonical turn content，供测试与回放复用。
 */
export function attachPromptSectionsToContent(
  content: CanonicalTurnContent,
  sections: PromptSection[],
): CanonicalTurnContent {
  return {
    ...content,
    systemSections: sections,
  };
}

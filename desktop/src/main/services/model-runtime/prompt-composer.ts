import type {
  CanonicalTurnContent,
  ChatSession,
  ExperienceProfileId,
  McpTool,
  PersonalPromptProfile,
  PromptSection,
  ProtocolTarget,
  ProviderFamily,
  SkillDefinition,
} from "@shared/contracts";
import {
  resolvePromptOverlayLines,
  resolvePromptProfileLines,
  resolveReasoningProfileLines,
  resolveToolPolicySummaryLines,
} from "./vendor-policy-registry";

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
  protocolTarget?: ProtocolTarget | null;
  deploymentProfile?: string | null;
  experienceProfileId: ExperienceProfileId;
  promptPolicyId?: string | null;
  toolPolicyId?: string | null;
  reasoningProfileId?: string | null;
  skills?: SkillDefinition[];
  gitBranch?: string | null;
  personalPromptProfile?: PersonalPromptProfile | null;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | null;
  enrichedContextBlock?: string | null;
  artifactContextBlock?: string | null;
  /** 关联会议录音的转写稿上下文块，用户选择「对话分析」时由 sessions 主链填入。 */
  meetingContextBlock?: string | null;
  mcpTools?: Array<McpTool & { serverId: string }>;
};

/** 仅在百融 MiniMax Responses 深度思考路线下注入更强的规划控制提示。 */
function shouldApplyBrMiniMaxResponsesDeepPlanningOverlay(input: Pick<
  ComposePromptInput,
  "providerFamily" | "protocolTarget" | "deploymentProfile" | "reasoningEffort"
>): boolean {
  return input.providerFamily === "br-minimax"
    && input.protocolTarget === "openai-responses"
    && input.deploymentProfile === "br-private"
    && (input.reasoningEffort === "high" || input.reasoningEffort === "xhigh");
}

/** 为百融 MiniMax Responses 深度思考路线构建更硬的规划阶段提示。 */
function buildBrMiniMaxResponsesDeepPlanningOverlay(): string {
  return [
    "For research, analysis, comparison, or report requests, the first round is planning-only.",
    "Create the full task set before execution.",
    "Do not describe multiple steps in prose and then create only one task.",
    "If the plan does not yet cover information gathering, core analysis, and output synthesis, continue planning.",
    "Do not call work tools until the planning phase is complete.",
  ].join("\n");
}

// ── Task Planning 引导内容 ──────────────────────────────────────

function buildTaskPlanningContent(effort: string): string {
  if (effort === "low") {
    return "You have task tracking tools (task_create, task_update, etc.) — use them only when explicitly asked.";
  }
  const lines: string[] = [
    "You have task tools for decomposing and tracking user requests. **This is your primary workflow — use it for every non-trivial request.**",
    "",
    "## Mandatory Workflow (Two Phases)",
    "When you receive a user request (except simple Q&A like \"what is X?\"), you MUST follow this two-phase workflow:",
    "",
    "### Phase 1: Planning (ONLY task_create calls)",
    "1. **Analyze** — Understand what the user really wants. Identify the logical steps needed.",
    "2. **Decompose** — Call `task_create` for EACH step to build a task list.",
    "3. **STOP** — End your response after creating all tasks. Do NOT call any work tools (fs_read, exec_command, web_search, etc.) in this response.",
    "",
    "⚠️ **ENFORCED CONSTRAINT**: If you call `task_create` in the same response as any non-task tool (e.g., fs_read, exec_command), **the non-task tools will be automatically rejected by the system**. You MUST separate planning from execution into different responses.",
    "",
    "### Phase 2: Execution (task_update + work tools)",
    "4. **Execute** — Work through tasks one by one:",
    "   - `task_update(id, status: \"in_progress\")` → do the work with appropriate tools → `task_update(id, status: \"completed\")`",
    "5. **Complete ALL tasks** — Do not stop until every task is marked completed. The system will prompt you to continue if you stop prematurely.",
    "",
    "## Task Tools",
    "- `task_create({ subject, description, activeForm })` — subject: imperative (e.g. \"修复登录Bug\"), activeForm: present continuous (e.g. \"正在修复登录Bug\"). Always provide activeForm.",
    "- `task_update({ id, status })` — Mark \"in_progress\" before starting, \"completed\" immediately after finishing.",
    "- `task_list()` / `task_get({ id })` — Check current task state.",
    "- **Status flow**: pending → in_progress → completed. Only ONE task can be in_progress at a time.",
    "",
    "## Key Rules",
    "- **Plan first, execute second** — Create ALL tasks before starting the first one. These two phases MUST be in separate responses.",
    "- **Even single-step requests get a task** — Creating a task signals \"I understood your request and here's what I'll do.\"",
    "- **Discover new steps? Add tasks** — If you find additional work during execution, call task_create alone (no other work tools in the same response).",
    "- **Finish ALL tasks** — Never stop responding while tasks are still pending or in_progress. Complete every task you created.",
    "- **Skip tasks ONLY for**: direct factual Q&A, greetings, or clarification questions.",
  ];
  if (effort === "high") {
    lines.push(
      "",
      "## Deep Reasoning Protocol (MANDATORY)",
      "- Before creating tasks, output your analysis: what is the core need? what are the constraints? what could go wrong?",
      "- Express task dependencies via `blocks`/`blockedBy` fields.",
      "- If a task fails or is blocked, update its description with the reason and create a follow-up task.",
      "- After completing each task, verify the result before marking completed.",
      "- Consider edge cases and failure modes for every task.",
    );
  }
  return lines.join("\n");
}

// ── Tool Strategy 引导内容 ──────────────────────────────────────

function buildToolStrategyContent(effort: string): string {
  if (effort === "low") {
    return [
      "- You can call multiple independent tools in a single response — no need to call them one by one.",
      "- Keep tool usage minimal. One search or file read is usually sufficient.",
      "- Answer directly when you already know the answer.",
    ].join("\n");
  }
  if (effort === "high") {
    return [
      "## Aggressive Parallel Calling",
      "Call up to 10 tools in a single response. NEVER call independent tools one by one.",
      "",
      "For information research, plan 3-5 different search queries and issue them ALL at once:",
      "- Vary keywords and angles to maximize coverage",
      "- Mix languages (Chinese + English) for broader sources",
      "- Use specific terms alongside general queries",
      "",
      "For code investigation, batch-read all related files in one response:",
      "- Source files, type definitions, tests, configs — read them all at once",
      "- Then read upstream/downstream dependencies in the next round",
      "",
      "## Iterative Research Loop (MANDATORY)",
      "One round of tool calls is NEVER enough for deep thinking. Follow this cycle:",
      "",
      "  Round 1 — Broad gathering",
      "    Issue multiple parallel tool calls to cover different angles.",
      "    (e.g., 5 web_searches with different queries, or 8 fs_reads for all related files)",
      "",
      "  Assess — Review what you received",
      "    What did you learn? What's still unclear? What needs deeper investigation?",
      "",
      "  Round 2 — Targeted deep-dive",
      "    Based on gaps identified, issue focused tool calls:",
      "    - http_fetch to read full articles from promising search results",
      "    - fs_read for dependency files that turned out to be relevant",
      "    - Additional web_search with refined queries",
      "",
      "  Assess — Is information sufficient?",
      "    Can you give a comprehensive, verified answer? Are there contradictions to resolve?",
      "",
      "  Round 3+ — Fill remaining gaps",
      "    Continue gathering until you can answer with confidence.",
      "    There is no round limit — keep going until the information is sufficient.",
      "",
      "## Web Research Escalation",
      "For information gathering, prefer this escalation order:",
      "1. web_search — Fast, returns summarized results",
      "2. http_fetch — Read full page content from promising URLs",
      "3. browser_open + browser_snapshot — For JS-heavy sites that http_fetch can't render",
      "",
      "## Verification",
      "- Cross-reference key facts across multiple sources",
      "- If search results contradict each other, investigate further",
      "- For code changes, read back modified files to verify correctness",
      "",
      "## Skill Awareness",
      "Before starting complex tasks, review available skills — a skill may already encapsulate the workflow you need.",
      "",
      "## What NOT to Over-Research",
      "Even in deep mode, skip deep research for:",
      "- Direct factual Q&A you already know (\"what is a closure?\")",
      "- Greetings and clarification questions",
      "- Requests where the user explicitly wants a quick answer",
    ].join("\n");
  }
  // medium
  return [
    "## Parallel Calling",
    "You can call MULTIPLE tools in a single response. When operations are independent, issue them all at once.",
    "",
    "Examples:",
    "- Need 3 files? → 3× fs_read in one response (parallel)",
    "- Need to search 2 topics? → 2× web_search in one response (parallel)",
    "- Need git status + file content? → Both in one response (parallel)",
    "",
    "BAD: web_search → wait for result → another web_search → wait → ... (sequential, slow)",
    "GOOD: web_search + web_search + web_search in one response (parallel, fast)",
    "",
    "## Iterative Gathering",
    "After receiving tool results, assess whether you have enough information:",
    "- If yes → proceed to answer or next task",
    "- If gaps remain → call more tools to fill them",
    "",
    "For research questions, expect 1-2 rounds of tool calls before answering.",
  ].join("\n");
}

// ── Tool Usage 分类引导 ─────────────────────────────────────────

function buildToolUsageContent(
  mcpTools?: Array<{ name: string; description?: string }>,
): string {
  const lines: string[] = [
    "## Files",
    "- `fs_read` — Read file contents. **Always read before editing.**",
    "- `fs_edit` — Replace a specific string in a file (preferred for partial edits).",
    "- `fs_write` — Create new files or full rewrites only.",
    "- `fs_list` / `fs_find` / `fs_search` — List dirs, find files by glob, grep text.",
    "## Shell & Git",
    "- `exec_command` — Run shell commands (dangerous commands are blocked).",
    "- `git_status` / `git_diff` / `git_log` / `git_commit` — Git operations.",
    "## Web & Browser",
    "- `web_search` — Search the web for current information.",
    "- `http_fetch` — Fetch a URL via HTTP GET.",
    "- Browser workflow: `browser_open` → `browser_snapshot` (accessibility tree, use ref=N) → `browser_click`/`browser_type` → `browser_snapshot` to verify.",
    "- Also: `browser_screenshot`, `browser_evaluate`, `browser_select`, `browser_hover`, `browser_scroll`, `browser_press_key`, `browser_back`, `browser_forward`, `browser_wait`.",
    "## Presentation (PPT)",
    "- `ppt_themes` — List available presentation themes (call first to show user the options).",
    "- `ppt_generate` — Generate an editable .pptx file from structured slide data.",
    "- When the user asks to create a PPT, presentation, slide deck, 汇报, 演示, or 幻灯片: **always use ppt_generate**, not plain text.",
    "- Workflow: understand requirements → `ppt_themes` to pick a theme → structure slides as JSON → `ppt_generate` to create the file.",
    "- Available layouts: cover(封面), section(章节过渡), key_points(要点列表), metrics(数据大字报), comparison(左右对比), closing(结束页).",
    "- If a `ppt-designer` skill is available, invoke it first for design methodology guidance.",
    "## Time",
    "- `reminder_create` / `reminder_list` — Manage user-facing reminders in the local desktop time center.",
    "- `schedule_job_create` / `schedule_job_list` — Manage autonomous scheduled jobs for workflows, silicon persons, or assistant prompts.",
    "- `today_brief_get` — Read the current local today brief without mutating state.",
    "- Use `reminder_create` for user attention and `schedule_job_create` for autonomous time-based execution.",
  ];
  if (mcpTools && mcpTools.length > 0) {
    lines.push(
      "## Connected Services (MCP)",
      "You have access to the following enterprise tools via MCP servers.",
      "These connect to internal company systems — use them when you need corporate data.",
      "",
    );
    for (const tool of mcpTools) {
      const desc = tool.description ? ` — ${tool.description}` : "";
      lines.push(`- \`${tool.name}\`${desc}`);
    }
    lines.push(
      "",
      "When the user asks about internal projects, tasks, or company data, prefer these MCP tools over web_search.",
    );
  }
  return lines.join("\n");
}

// ── Skills 引导内容 ─────────────────────────────────────────────

function buildSkillsContent(skills: SkillDefinition[]): string {
  if (skills.length === 0) {
    return "No skills are currently available.";
  }
  const skillsWithView = skills.filter((s) => s.hasViewFile);
  const lines: string[] = [
    "**IMPORTANT — Skill-first principle:** Before doing any work manually, check if one of the skills below matches the user's request. If a skill's description matches the user's intent, you MUST call `skill_invoke__<skill_id>` first to read the skill's instructions, then follow those instructions to complete the work. Do NOT try to do the work yourself without reading the skill first.",
    "",
    "How to use skills:",
    "1. **Match**: Compare the user's request against each skill's description below.",
    "2. **Invoke**: Call `skill_invoke__<skill_id>` to read the skill's instructions (SKILL.md).",
    "3. **Execute**: Follow the skill's instructions to complete the work — the skill tells you what tools to call, what scripts to run, and what data to produce.",
  ];
  if (skillsWithView.length > 0) {
    lines.push("4. **Visualize**: If the skill has an HTML panel, call `skill_view({ skill_id, page, data })` with the generated data to open the visual panel.");
  }
  lines.push("", "**Available skills:**");
  const usedIds = new Set<string>();
  for (const skill of skills) {
    let sid = skill.id.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    const baseSid = sid;
    let sfx = 2;
    while (usedIds.has(sid)) { sid = `${baseSid}_${sfx}`; sfx++; }
    usedIds.add(sid);
    const viewNote = skill.hasViewFile
      ? ` [有HTML面板: ${skill.viewFiles?.join(", ")} — 完成后用 skill_view 传入数据打开]`
      : "";
    lines.push(`- **${skill.name}**: ${skill.description || "(无描述)"}${viewNote} → call \`skill_invoke__${sid}\``);
  }
  return lines.join("\n");
}

// ── Guidelines 引导内容 ─────────────────────────────────────────

function buildGuidelinesContent(effort: string): string {
  const lines: string[] = [
    "- Respond in the same language the user uses.",
    "- Read existing code before modifying it. Understand context first.",
    "- If a tool call fails, analyze the error — don't retry blindly.",
  ];
  if (effort === "high") {
    lines.push(
      "- **Deep reasoning mode is ON.** You must think deeply and thoroughly before acting.",
      "- Before responding, spend significant time analyzing the request: what is the user really asking? What are the constraints? What could go wrong?",
      "- Break complex problems into sub-problems. Consider multiple approaches and choose the best one with explicit reasoning.",
      "- Consider edge cases, error handling, and potential regressions before writing any code.",
      "- After completing work, verify results by reading back modified files or running tests.",
      "- If an available skill matches the user's request, invoke the skill FIRST — do not attempt manual workarounds.",
      "- Explain your reasoning process and trade-offs clearly.",
    );
  } else if (effort === "low") {
    lines.push(
      "- Be extremely concise. Direct answers, no filler.",
      "- Prefer the simplest solution that works.",
    );
  } else {
    lines.push(
      "- For multi-step tasks, plan first, then execute step by step.",
    );
  }
  return lines.join("\n");
}

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

  if (input.artifactContextBlock) {
    sections.push(createSection(
      "work-files",
      "Work Files",
      "context",
      input.artifactContextBlock,
    ));
  }

  if (input.meetingContextBlock) {
    sections.push(createSection(
      "meeting-context",
      "Meeting Context",
      "context",
      input.meetingContextBlock,
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
    "Task Planning (IMPORTANT)",
    "task",
    buildTaskPlanningContent(effort),
  ));

  if (shouldApplyBrMiniMaxResponsesDeepPlanningOverlay(input)) {
    sections.push(createSection(
      "minimax-deep-planning-controller",
      "MiniMax Responses Deep Planning Controller",
      "task",
      buildBrMiniMaxResponsesDeepPlanningOverlay(),
    ));
  }

  sections.push(createSection(
    "tool-strategy",
    "Tool Strategy",
    "guidelines",
    buildToolStrategyContent(effort),
  ));

  sections.push(createSection(
    "tools",
    "Tools",
    "tools",
    buildToolUsageContent(input.mcpTools),
  ));

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
    sections.push(createSection(
      "skills",
      "Available Skills",
      "skills",
      buildSkillsContent(input.skills),
    ));
  }

  sections.push(createSection(
    "guidelines",
    "Guidelines",
    "guidelines",
    buildGuidelinesContent(effort),
  ));

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

# Feature Landscape

**Domain:** Enterprise internal AI assistant platform, desktop-first employee copilot
**Researched:** 2026-04-04
**Overall confidence:** MEDIUM-HIGH

## Executive View

For this project, the market has already moved past "chat with an LLM" as the bar. Across Microsoft 365 Copilot, OpenAI ChatGPT Enterprise/Business, Atlassian Rovo, Google Gemini Enterprise/Agentspace, and Slack AI, the baseline is now permission-aware retrieval, grounded answers, connector-based enterprise data access, and some form of governed action execution. That means these are table stakes, not differentiators.

The real opportunity for `MyClaw` is not adding more visible surfaces. The repo already has Skills, MCP, and desktop runtime foundations, while internal concerns show unfinished workflow/publish surfaces and fragile execution paths. The product should therefore differentiate on execution quality: better intent recovery from weak prompts, stronger tool choice/orchestration, richer role and project context, and safer use of enterprise public data.

Several attractive ideas are anti-features in this setting. The ecosystem is converging on explicit permissions, admin controls, scoped memory, citations, and optional approvals. The wrong move is to build a "magic" assistant that acts without review, hoovers up all enterprise data into one opaque memory, or exposes half-built workflow products as if they are reliable.

## Table Stakes

Features users now expect. Missing these makes the assistant feel behind the market.

| Capability Cluster | Why Expected | Complexity | Notes |
|---|---|---|---|
| Permission-aware grounded answers with citations | Microsoft, Slack, Atlassian, OpenAI, and Google all center enterprise answers on existing access controls plus source grounding/citations. | Medium | Must answer from internal systems only when the user already has access; responses should show which systems/documents were used. Confidence: HIGH |
| Connector-based enterprise search across common systems | Cross-app retrieval is now standard: files, chats, docs, tickets, calendars, and common SaaS sources. | High | Start with a narrow connector set that covers daily employee work instead of broad connector count. Confidence: HIGH |
| Safe tool execution with approvals for state-changing actions | Enterprise assistants are increasingly expected to take actions, not just answer questions. But action-taking is governed, not silent. | High | Read-only tools can be inline; create/update/delete actions need approval, previews, or dry runs. Confidence: MEDIUM-HIGH |
| Strong intent recovery from low-quality prompts | Employees do not write perfect prompts. Assistants now need to infer missing structure and ask clarifying questions when needed. | Medium | Especially important for short, vague, or role-specific requests like "help me push this" or "find the latest hiring update". Confidence: MEDIUM |
| Scoped working context across a task/session | Persistent context within a session or workspace is now expected, especially for multi-turn work. | Medium | Should include current task, recent tool outputs, selected files, and active enterprise entities; avoid unbounded cross-task memory. Confidence: MEDIUM-HIGH |
| Admin governance for models, tools, connectors, and auditability | Enterprise buyers expect admins to decide what is enabled and to inspect usage. | High | Model access, connector enablement, memory policy, approval policy, and audit events should all be centrally governed. Confidence: HIGH |
| Desktop-native execution primitives | A desktop assistant is expected to operate on local files, clipboard, browser/app context, and foreground work, not just cloud SaaS data. | High | This is part of the product's core value versus browser-only assistants, but it should be treated as baseline for this product, not novelty. Confidence: MEDIUM |

## Differentiators

Capabilities that can make `MyClaw` materially better than a generic enterprise copilot.

| Capability Cluster | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Context-pack assembly for role, team, project, and task | The assistant starts each task with a high-quality working context instead of relying on the user to restate everything. | High | Best differentiator for this project. Build reusable context packs from role metadata, org context, recent artifacts, and current task state. Confidence: MEDIUM |
| Cross-tool execution planning with recovery | The assistant can choose, sequence, and retry tools across desktop and enterprise systems to finish real work, not just call one tool once. | High | Focus on plan quality, error recovery, and idempotent retries before adding more tools. Confidence: MEDIUM-HIGH |
| Enterprise public-data fusion | Blend personal/local context with governed enterprise public data such as org directory, employee metadata, policies, project ownership, and approved shared systems. | High | This aligns directly with the stated goal of reducing data silos. Confidence: HIGH |
| Explainable execution trace | Users and admins can inspect why the assistant chose a tool, which data sources were used, what was skipped, and where confidence was low. | Medium | Valuable trust feature for enterprise rollouts and debugging fragile tool chains. Confidence: MEDIUM |
| Hybrid chat plus structured task surfaces | When a task is inherently structured, the assistant should render forms/checklists/approval UIs instead of forcing prompt gymnastics. | Medium | Strong fit with the repo's A2UI rule. Use for create/update operations, imports, publishing, and multi-field enterprise actions. Confidence: MEDIUM-HIGH |
| Role-adaptive assistance layers | The same assistant behaves differently for engineering, HR, finance, ops, and managers without splitting into separate products. | High | Use shared core orchestration plus role-specific context, policies, and tool recommendations. Confidence: MEDIUM |
| Continuous evaluation of assistant quality | Treat prompt understanding, retrieval quality, tool selection, and task completion rate as first-class product features. | Medium | Atlassian already exposes agent evaluation; this project should build quality instrumentation into the runtime. Confidence: MEDIUM-HIGH |

## Anti-Features

Capabilities to explicitly avoid in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|---|---|---|
| Unbounded autonomy for write actions | Enterprise trust collapses if the assistant edits systems, sends messages, or mutates records without explicit checkpoints. | Use approval gates, dry runs, change previews, and action scopes. |
| Opaque global memory across tasks and systems | Cross-task memory can leak stale or sensitive context and is hard to govern. | Keep memory scoped to user, workspace, project, and task type, with clear admin/user controls. |
| "One giant enterprise brain" indexing everything | Official products consistently preserve permissions and admin connector controls; a blanket index creates oversharing risk. | Connect specific approved systems and preserve source ACLs end to end. |
| Tool-count expansion as the main product strategy | The repo already has Skills/MCP foundations. More tools without better routing and recovery just increase failure modes. | Improve tool selection, sequencing, observability, and safety before adding large tool inventories. |
| Shipping visible but incomplete workflow surfaces | Current codebase concerns already show workflow/publish paths exposed before the runtime is real. | Hide unfinished surfaces or keep them internal until backed by durable execution contracts. |
| Pure chat UX for structured enterprise operations | Employees should not type long pseudo-forms into chat for approvals, publishing, imports, or record creation. | Render structured UI components, confirm required fields, then let chat handle reasoning around them. |
| Turning this milestone into a full new workflow/knowledge product line | Project scope is optimization of the existing desktop assistant, not expansion into adjacent large products. | Prioritize execution quality, context quality, and enterprise data usage within the current desktop assistant. |

## Feature Dependencies

```text
Admin governance + connector permissions -> enterprise data connectors -> grounded retrieval -> cited answers

Intent recovery + scoped working context -> better tool selection -> multi-step execution planning

Approval system + idempotent tool contracts -> safe write actions -> trustworthy task automation

Enterprise public-data connectors -> role/team/project context packs -> role-adaptive assistance

Structured UI surfaces -> reliable create/update flows -> higher trust in action-taking

Quality instrumentation -> eval datasets/replays -> measurable improvements in assistant quality
```

## MVP Recommendation

Prioritize:

1. Permission-aware retrieval with citations across a small set of high-value enterprise systems.
2. Better prompt understanding and clarification loops for vague employee requests.
3. Safe tool planning/execution with approvals for write actions.
4. Scoped context packs that combine session state with role/team/project metadata.
5. One differentiator: structured task surfaces for high-friction enterprise operations.

Defer:

- Broad agent marketplace expansion: this adds surface area before core execution quality is reliable.
- Fully autonomous workflows: too risky before approvals, retries, and observability are solid.
- Massive connector breadth: depth on a few critical systems is more valuable than shallow coverage everywhere.

## Recommendation For Requirements

Use this milestone's requirements around four capability pillars:

1. **Assistant quality**: intent recovery, clarification, grounded answering, context continuity.
2. **Tool usage quality**: tool choice, sequencing, approvals, retries, and user-visible execution traces.
3. **Contextual understanding**: role/team/project/task context packs rather than generic memory.
4. **Enterprise data usage**: governed connectors to approved shared systems with ACL-preserving retrieval.

Avoid writing requirements as a list of new surfaces. Write them as measurable improvements in task completion quality.

## Confidence Notes

- **Table stakes:** HIGH confidence. These patterns appear consistently in current official product docs.
- **Differentiators:** MEDIUM confidence. These are evidence-backed recommendations and synthesis, not all explicit vendor labels.
- **Anti-features:** MEDIUM-HIGH confidence. They are partly inferred from official governance/security patterns and partly reinforced by this codebase's current concerns.

## Sources

- Internal project context: [`.planning/PROJECT.md`](/Users/zhangjianing/WebstormProjects/ai-project/MyClaw/.planning/PROJECT.md)
- Internal architecture: [`.planning/codebase/ARCHITECTURE.md`](/Users/zhangjianing/WebstormProjects/ai-project/MyClaw/.planning/codebase/ARCHITECTURE.md)
- Internal concerns: [`.planning/codebase/CONCERNS.md`](/Users/zhangjianing/WebstormProjects/ai-project/MyClaw/.planning/codebase/CONCERNS.md)
- Microsoft 365 Copilot architecture and data access: https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-architecture
- Microsoft enterprise data protection for Copilot: https://learn.microsoft.com/en-us/microsoft-365/copilot/enterprise-data-protection
- Microsoft agent security and permission model: https://learn.microsoft.com/en-us/microsoft-365/copilot/agent-essentials/agent-essentials-overview
- Atlassian Rovo chat capabilities: https://support.atlassian.com/rovo/docs/chat-actions/
- Atlassian Rovo agents and knowledge sources: https://support.atlassian.com/rovo/docs/agents/
- Atlassian Rovo agent creation and permissions: https://support.atlassian.com/rovo/docs/create-and-edit-agents/
- Atlassian Rovo permissions and governance: https://support.atlassian.com/rovo/docs/rovo-agent-permissions-and-governance/
- Atlassian Rovo external app connection model: https://support.atlassian.com/rovo/docs/connect-to-external-products/
- Atlassian Rovo admin control for web search: https://support.atlassian.com/organization-administration/docs/manage-a-web-search-option-for-rovo/
- Atlassian Rovo evaluation tooling: https://support.atlassian.com/rovo/docs/evaluate-the-performance-of-your-rovo-agent/
- Atlassian Rovo response debugging: https://support.atlassian.com/rovo/docs/debug-responses-from-rovo-agents/
- OpenAI ChatGPT Business memory controls: https://help.openai.com/en/articles/9295112-memory-faq-business-version
- OpenAI ChatGPT Enterprise/Edu release notes on connectors and admin controls: https://help.openai.com/en/articles/10128477-chatgpt-enterprise-and-edu-release-notes
- Slack AI search and access model: https://slack.com/help/articles/31739993134867-Search-with-AI-in-Slack
- Google Workspace source-grounded writing help: https://workspace.google.com/blog/product-announcements/new-ways-to-do-your-best-work
- Google Gemini Enterprise / Agentspace positioning: https://cloud.google.com/gemini-enterprise
- Google Agentspace enterprise search and agent platform: https://cloud.google.com/blog/products/ai-machine-learning/bringing-ai-agents-to-enterprises-with-google-agentspace

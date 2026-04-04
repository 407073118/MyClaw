# Project Research Summary

**Project:** MyClaw
**Domain:** Enterprise internal AI assistant platform, desktop-first employee copilot
**Researched:** 2026-04-04
**Confidence:** HIGH

## Executive Summary

MyClaw is a brownfield enterprise AI assistant with an existing `desktop` + `cloud` split, plus verified Skills and MCP foundations. The research is consistent on one point: this milestone should not chase more surfaces or more autonomous agent theatrics. It should make the existing desktop assistant materially better at understanding weak employee prompts, choosing and sequencing tools, and using governed enterprise data to complete real work.

The recommended direction is to keep `desktop` as the host-side execution edge and evolve `cloud` into the control plane for policy, enterprise connectors, model governance, tracing, and evaluation. Technically, that means replacing the current desktop OpenAI-compatible orchestration shim with a TypeScript-native AI runtime, introducing explicit intent routing and context compilation, separating local tools from governed enterprise connectors, and measuring every meaningful run before increasing autonomy.

The main risks are also aligned across the research: shipping smarter-looking behavior before building evaluation and traceability, exposing too many weakly-defined tools, treating context as one giant prompt, and connecting enterprise systems without clear read/write, permission, and trust boundaries. The mitigation is sequencing, not novelty: first add seams and observability, then harden tool and policy contracts, then improve context understanding, and only then expand enterprise connectors and planner sophistication.

## Key Findings

### Recommended Stack

The stack recommendation is an incremental brownfield upgrade, not a rewrite. Keep the Electron + React desktop and NestJS cloud split, but move orchestration to AI SDK 6 with provider-native adapters, MCP-first connector integration, and cloud-side policy, telemetry, and eval services.

**Core technologies:**
- `ai` 6.x: primary TypeScript orchestration layer for model routing, tool calls, MCP, and telemetry without maintaining a fragile custom client.
- `@ai-sdk/openai` and `@ai-sdk/anthropic`: preserve provider-native tool and reasoning behavior instead of flattening everything into an OpenAI-compatible shim.
- `zod`: structured intent classification, planner outputs, and tool argument validation to improve prompt understanding and reduce malformed tool calls.
- `@modelcontextprotocol/sdk` and `@ai-sdk/mcp`: standard bridge for managed MCP connectors and remote enterprise capabilities.
- OpenTelemetry + LangSmith + Promptfoo: trace backbone, AI run inspection, and CI regression gates so quality changes become measurable.
- PostgreSQL 17+ with `pgvector`: separate AI data plane for retrieval, memory, traces, and connector-normalized data when retrieval volume justifies it.

**Critical version requirements:**
- AI runtime assumptions are based on AI SDK 6 and current MCP support.
- Model portfolio should stay multi-vendor, with `gpt-5.4` / `claude-sonnet-4-6` class models as the primary execution tier and cheaper models for routing/classification.
- PostgreSQL + `pgvector` is a recommended second-stage addition, not a day-one prerequisite.

### Expected Features

The research draws a clear line between market-baseline expectations and where MyClaw can actually differentiate. Table stakes are now governed, grounded, connector-aware assistance. Differentiation comes from execution quality, context quality, and trust.

**Must have (table stakes):**
- Permission-aware grounded answers with citations across approved internal systems.
- Connector-based enterprise search over a narrow, high-value system set rather than shallow connector sprawl.
- Safe tool execution with approval gates for state-changing actions.
- Strong intent recovery and clarification for weak, vague, or role-specific prompts.
- Scoped working context across a task/session, plus admin governance for models, connectors, tools, and audit.

**Should have (competitive differentiators):**
- Context packs combining role, team, project, and task state before planning begins.
- Cross-tool execution planning with recovery and idempotent retries.
- Enterprise public-data fusion that joins personal/local context with governed shared company data.
- Explainable execution traces and structured task surfaces for create/update flows.
- Continuous evaluation of task completion, retrieval quality, and tool choice as a product capability.

**Defer (v2+ or after control foundations):**
- Broad marketplace/tool-count expansion.
- Fully autonomous write workflows.
- Large-scale connector breadth before depth on core systems.
- LangGraph/Temporal-style advanced orchestration in the hot path of normal chat turns.

### Architecture Approach

The target architecture is a split control plane / execution plane. `desktop` remains the host for session state, approvals, local context, and local tools. `cloud` becomes the governed model and connector control plane for policy, audit, traces, evals, token brokerage, and enterprise access. MCP stays as the capability boundary, but MyClaw keeps host control over context aggregation, tool exposure, and permission enforcement.

**Major components:**
1. Desktop Agent Host: owns run lifecycle, streaming, approvals, and coordination across local tools and governed remote capabilities.
2. Context Pipeline + Model Orchestrator: compile structured task context, select model lane, expose only the needed tool subset, and run bounded tool loops.
3. Cloud Policy / Connector / Trace Plane: centralize policy, enterprise model access, entitlement-aware connectors, execution ledger, and evaluation data.

**Key patterns to follow:**
- Host-controlled runtime instead of pushing all orchestration into cloud.
- Two-speed capability model separating local interactive tools from governed enterprise connectors.
- Context compiler instead of prompt concatenation.
- Durable execution ledger before deeper autonomy.
- Separate search/read lanes from write/action lanes for enterprise systems.

### Critical Pitfalls

1. **Optimizing intelligence before measurement**: do not add planner complexity or more tools before task goldens, traces, and replayable evals exist.
2. **Growing tool surface faster than tool contracts**: reduce overlapping tools, expose only the allowed subset per task, and return typed errors instead of `null`/empty placeholders.
3. **Treating context as one giant prompt**: compile structured user, role, task, approval, and knowledge context instead of endlessly appending prose to the system prompt.
4. **Mixing enterprise read, retrieval, and write semantics**: define a decision record per data domain so static knowledge, live transactional reads, and write actions use the right path.
5. **Over-trusting internal content and connectors**: assume prompt injection can cross systems, keep least-privilege auth, and preview every high-risk write action.

## Implications for Roadmap

Based on the combined research, the roadmap should be phase-driven around control, context, and governed connectivity rather than around new user-facing surfaces.

### Phase 1: Runtime Seams, Execution Ledger, and Evaluation Baseline

**Rationale:** Every later quality claim depends on measurable runs, typed failures, and replayable datasets. The architecture and pitfalls research both say this must come before autonomy upgrades.
**Delivers:** explicit orchestration seams in `desktop`, run IDs/statuses, trace correlation, offline eval datasets, tool success/failure metrics, and regression gates.
**Addresses:** continuous evaluation, explainable execution trace, baseline admin auditability.
**Avoids:** Pitfall 1 (measure later), Pitfall 8 (silent fallback), and the architecture anti-pattern of invisible in-memory loops.

### Phase 2: Tool Contract Hardening and Policy Centralization

**Rationale:** The current system already has Skills/MCP foundations, so the next highest-leverage step is making tool selection safer and more legible before adding more capability.
**Delivers:** tool namespace cleanup, schema-validated inputs, typed errors, explicit approval thresholds, local-vs-enterprise tool classes, and cloud-managed policy objects.
**Uses:** `zod`, MCP tooling, approval system, cloud policy services.
**Implements:** two-speed capability model and policy/approval boundary.
**Avoids:** Pitfall 3 (weak tool contracts), Pitfall 7 (admin-centric permissions), and MCP trust anti-patterns.

### Phase 3: Context Pipeline and Role-Aware Intent Routing

**Rationale:** Research says better user understanding comes from structured context and routing, not more prompt text. This should land before broad connector work so retrieval and tool exposure are demand-shaped by task intent.
**Delivers:** intent router, structured task frame, role/team/project context packs, missing-info detection, context compaction, and bounded tool manifests per run.
**Uses:** AI SDK runtime, cheap classifier models, `zod` outputs, existing session/memory surfaces.
**Implements:** context compiler and host-controlled orchestration.
**Addresses:** strong intent recovery, scoped working context, role-adaptive assistance.
**Avoids:** Pitfall 4 (giant prompt), Pitfall 2 (premature multi-agent split), and role-blind assistance.

### Phase 4: Governed Enterprise Read Connectors and Grounded Retrieval

**Rationale:** Once runs are measurable and context is structured, MyClaw can safely connect the first set of high-value shared enterprise systems. Read/search should come before write/action.
**Delivers:** cloud-managed connector gateway, entitlement-aware read connectors, citations, retrieval decision records by data domain, and a small set of high-value data sources.
**Uses:** MCP-managed connectors, OAuth/OBO auth, optional PostgreSQL + `pgvector` data plane when connector-normalized retrieval volume is high enough.
**Implements:** connector gateway, read/index path separation, grounded answer flow.
**Addresses:** permission-aware grounded answers, connector-based enterprise search, enterprise public-data fusion.
**Avoids:** Pitfall 5 (wrong data path), Pitfall 6 (cross-system prompt injection), and direct desktop-to-enterprise credential sprawl.

### Phase 5: Enterprise Action Adapters and Structured Task Surfaces

**Rationale:** State-changing actions should only follow after read paths, policy, and traceability are stable. This phase converts trust into governed action-taking rather than generic chat-only operations.
**Delivers:** narrow write adapters, approval previews, idempotency/retry contracts, structured A2UI flows for create/update operations, and user-visible execution traces.
**Uses:** existing approval foundations, cloud connector gateway, structured UI surfaces.
**Implements:** separate action lane and approval-first execution path.
**Addresses:** safe tool execution with approvals, hybrid chat + structured task surfaces.
**Avoids:** anti-feature of unbounded autonomy and Pitfalls 6-8 around unsafe writes, over-broad permissions, and fake-success responses.

### Phase 6: Planner Optimization and Selective Advanced Orchestration

**Rationale:** Only after control, context, connectors, and write safety are in place should MyClaw pursue deeper execution planning or durable long-running flows.
**Delivers:** better cross-tool planning, recovery heuristics, shadow rollout for new planners/policies, and selective adoption of LangGraph or Temporal where checkpoints or long-running jobs are actually needed.
**Uses:** primary reasoning models, cheaper router/verifier models, optional LangGraph/Temporal only for bounded flows.
**Implements:** planner/router upgrades without making complex orchestration the default for every turn.
**Addresses:** cross-tool execution planning with recovery.
**Avoids:** Pitfall 2 (agent proliferation) and the stack anti-pattern of introducing heavy workflow tooling into the hot path too early.

### Phase Ordering Rationale

- Phase 1 comes first because brownfield optimization without traceability will produce unprovable regressions.
- Phases 2 and 3 are grouped ahead of connector expansion because tool quality and context quality determine whether enterprise data improves results or only adds failure modes.
- Phase 4 is intentionally read-first because retrieval and search can deliver enterprise value with lower blast radius than write actions.
- Phase 5 is gated by stable approval, audit, and idempotent contracts; otherwise trust collapses on the first bad mutation.
- Phase 6 stays last because smarter planning is only useful when the underlying tools, policies, and context pipeline are reliable.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4:** enterprise connector selection, identity propagation, and per-domain retrieval strategy need system-specific API and auth validation.
- **Phase 5:** write adapters, approval UX, and idempotency models need domain-by-domain contract research before requirements freeze.
- **Phase 6:** only research if a proposed flow truly needs checkpoints, long-running jobs, or more than a bounded planner/verifier loop.

Phases with standard patterns (likely skip `research-phase`):
- **Phase 1:** execution ledger, tracing, replay datasets, and regression gates are well-documented and low-ambiguity.
- **Phase 2:** tool schema validation, policy centralization, and approval gating are standard hardening work.
- **Phase 3:** intent routing and context compilation patterns are sufficiently well-established to plan directly.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Strong alignment between current repo shape and current official documentation for AI SDK, MCP, OpenTelemetry, and evaluation tooling. |
| Features | MEDIUM-HIGH | Table stakes are strongly evidenced by current enterprise assistant products; differentiators are a synthesis but consistent with project goals. |
| Architecture | MEDIUM-HIGH | Component boundaries and sequencing are strongly supported, though exact rollout details for cloud model gateway and data plane timing remain implementation choices. |
| Pitfalls | HIGH | Risks are concrete, repeated across official guidance, and reinforced by current codebase concerns such as silent fallbacks and unfinished runtime paths. |

**Overall confidence:** HIGH

### Gaps to Address

- **Connector priority list:** planning still needs a ranked list of initial enterprise systems by user value, auth feasibility, and data semantics.
- **Identity model:** confirm where user identity can be passed through directly versus where platform-brokered scoped tokens are required.
- **AI data plane timing:** validate whether early phases need PostgreSQL + `pgvector`, or whether connector reads can ship first without retrieval infrastructure.
- **Structured task surface scope:** decide which create/update flows justify A2UI treatment in the first action-taking phase.

## Sources

### Primary (HIGH confidence)
- [STACK.md](/Users/zhangjianing/WebstormProjects/ai-project/MyClaw/.planning/research/STACK.md)
- [FEATURES.md](/Users/zhangjianing/WebstormProjects/ai-project/MyClaw/.planning/research/FEATURES.md)
- [ARCHITECTURE.md](/Users/zhangjianing/WebstormProjects/ai-project/MyClaw/.planning/research/ARCHITECTURE.md)
- [PITFALLS.md](/Users/zhangjianing/WebstormProjects/ai-project/MyClaw/.planning/research/PITFALLS.md)
- [PROJECT.md](/Users/zhangjianing/WebstormProjects/ai-project/MyClaw/.planning/PROJECT.md)
- https://ai-sdk.dev/docs/reference/ai-sdk-core
- https://modelcontextprotocol.io/specification/2025-06-18/architecture
- https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- https://developers.openai.com/api/docs/guides/agent-evals
- https://opentelemetry.io/docs/languages/js/

### Secondary (MEDIUM confidence)
- https://support.atlassian.com/rovo/docs/agents/
- https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-architecture
- https://slack.com/help/articles/31739993134867-Search-with-AI-in-Slack
- https://cloud.google.com/blog/products/ai-machine-learning/bringing-ai-agents-to-enterprises-with-google-agentspace
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#long-context-prompting
- https://www.anthropic.com/engineering/writing-tools-for-agents

---
*Research completed: 2026-04-04*
*Ready for roadmap: yes*

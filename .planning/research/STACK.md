# Technology Stack

**Project:** MyClaw enterprise internal AI assistant platform
**Scope:** Stack dimension for improving an existing desktop + cloud assistant
**Researched:** 2026-04-04

## Recommendation In One Sentence

Keep the existing Electron + React desktop and NestJS cloud split, but replace the desktop's custom OpenAI-compatible orchestration layer with a TypeScript-native agent runtime built on AI SDK 6, provider-native model adapters, MCP-first enterprise connectors, structured intent routing, and cloud-side evaluation/telemetry.

## Recommended Stack

### Core Assistant Runtime

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `ai` | `6.0.146` | Primary LLM orchestration in Node/Electron/Nest | Best brownfield fit for this repo: TypeScript-native, multi-provider, supports tool calling, MCP, embeddings, reranking, middleware, and telemetry. This lets MyClaw stop maintaining a fragile custom fetch client while staying inside the current TS stack. |
| `@ai-sdk/openai` | `3.0.50` | OpenAI provider adapter | Use provider-native OpenAI capabilities through the same runtime surface instead of flattening everything into a generic OpenAI-compatible shim. |
| `@ai-sdk/anthropic` | `3.0.66` | Anthropic provider adapter | Same reason as above; preserves Anthropic-native tool and reasoning behavior while keeping one TypeScript orchestration layer. |
| `zod` | `4.3.6` | Structured intent classification, planner output, tool argument validation | User-intent understanding improves when routing and plan extraction become explicit schemas instead of prompt-only prose. |
| `@modelcontextprotocol/sdk` | `1.29.0` | Cloud-managed MCP servers and connector infrastructure | MyClaw already has MCP as a core concept. Double down on it instead of inventing another connector protocol. |
| `@ai-sdk/mcp` | `1.0.32` | Bridge MCP servers into the AI runtime | Lowest-friction way to expose managed MCP tools to the orchestrator without custom glue everywhere. |

### Model Portfolio

| Model Tier | Recommended Choice | Purpose | Why |
|------------|--------------------|---------|-----|
| Primary reasoning + coding | `gpt-5.4` or `claude-sonnet-4-6` | Default desktop worker model | This tier is now the standard sweet spot for enterprise assistants: strong tool use, strong reasoning, better latency/cost than “max” models. Do not hard-code one vendor; route by workload and keep snapshots for stability. |
| Escalation model | `gpt-5.4-pro` or `claude-opus-4-6` | Only for hard tasks, long plans, failed first attempts | Reserve expensive frontier models for retries/escalations, not every turn. This keeps quality high without blowing per-seat cost. |
| Router / classifier / cheap subagent | `gpt-5.4-mini` / `gpt-5.4-nano` or `claude-haiku-4-5` | Intent classification, slot extraction, summarization, rerank prompts | Strong enterprise assistants do not use one model for everything. Use a fast cheap model for routing and a stronger model for execution. |
| Speech input | `gpt-4o-mini-transcribe` | Voice input for desktop | Use only if voice becomes important; otherwise defer. |

### Enterprise Connectivity

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Remote MCP over HTTP/SSE | Current MCP spec | Standard connector boundary for enterprise systems | Put SAP/HR/CRM/ITSM/BI access behind managed cloud MCP servers. Desktop should consume approved capabilities, not hold direct enterprise credentials. |
| OAuth 2.0 client credentials / OBO | Current enterprise standard | Service-to-service auth for managed connectors | This is the right control point for scoped, auditable access to enterprise APIs. |
| Cloud connector gateway in NestJS | Existing cloud runtime | Policy enforcement, connector tenancy, auditing, token brokerage | Fits current architecture. Keep governance in `cloud`, execution experience in `desktop`. |

### Retrieval, Memory, And Data Plane

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| PostgreSQL | `17+` | New AI data plane for retrieval caches, semantic memory, eval traces, connector-normalized data | Do not force vector search and retrieval-heavy workloads into the current MySQL admin schema. Add a dedicated AI data plane. |
| `pgvector` | `0.8.2` | Vector search inside Postgres | Standard 2026 default until scale clearly exceeds what Postgres handles comfortably. Supports HNSW, filtering, hybrid search patterns, and keeps ops simple. |
| `pg` | `8.20.0` | Direct Node access to the AI data plane | Use a small explicit DAL for the new AI store. Do not contort the current Prisma/MySQL setup to become the retrieval layer. |
| Hybrid retrieval + reranking | via AI SDK + provider rerank model | Enterprise document/data retrieval | Use lexical + vector retrieval, then rerank. Pure embedding lookup is not enough for enterprise system data. |

### Observability, Evaluation, And Safety

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| OpenTelemetry JS | `@opentelemetry/api 1.9.1`, `@opentelemetry/sdk-node 0.214.0` | Standard traces/metrics/log correlation across desktop, cloud, tools, and connectors | Make AI runs first-class platform telemetry, not special-case logs. |
| `@opentelemetry/auto-instrumentations-node` | `0.72.0` | Fast initial tracing coverage | Good first step before adding richer custom spans for model/tool phases. |
| LangSmith | `0.5.16` | LLM-native trace inspection and evaluation workflows | Best fit when the goal is improving task completion and tool-use quality, not just API uptime. |
| Promptfoo | `0.121.3` | CI regression evals, jailbreak/tool-call safety suites | Use it in CI to keep prompts, routing, and tool policies from regressing between releases. |

### Optional Workflow Layer

| Technology | Version | Purpose | When To Use |
|------------|---------|---------|-------------|
| `@langchain/langgraph` | `1.2.6` | Explicit multi-step graph orchestration | Use only for bounded, stateful flows that need checkpoints or branch logic beyond a normal tool loop. Do not make it the default for every chat turn. |
| Temporal TypeScript SDK | `1.15.0` | Durable background jobs and long-running connector workflows | Use for connector sync, approval-expiring tasks, and multi-minute/multi-hour enterprise actions. Keep interactive desktop turns out of Temporal. |

## Prescriptive Technical Approach

### 1. Replace The Current Model Client, Not The Whole Product

The highest-leverage move is to replace `desktop/src/main/services/model-client.ts` as the orchestration abstraction. The current custom client is workable, but it keeps MyClaw trapped at the lowest common denominator of “OpenAI-compatible chat completions + custom parsing”.

Use AI SDK as the runtime surface and keep MyClaw's existing:

- Electron main-process execution model
- approval system
- tool preference model
- MCP discovery/management
- context compaction and session persistence

This is a brownfield upgrade, not a rewrite.

### 2. Split Each Turn Into Explicit Stages

Do not let one giant prompt do everything.

Recommended per-turn pipeline:

1. **Intent router**
   - Fast model.
   - Structured output only.
   - Extract: intent, confidence, missing fields, whether enterprise data is needed, risk class, suggested tool families.
2. **Planner / executor**
   - Strong reasoning model.
   - Tool-enabled.
   - Produces bounded tool loop, not open-ended autonomy.
3. **Verifier**
   - Cheap model or rule checks.
   - Validates completion, missing data, unsafe tool output, and whether follow-up is needed.

This is the standard pattern for improving user-intent understanding and tool-use quality without letting latency or cost explode.

### 3. Keep MCP, But Move Enterprise Systems Behind Cloud-Managed Connectors

Desktop should continue to host personal/local tools.

Enterprise systems should move toward this pattern:

- `desktop`: requests an approved capability
- `cloud`: resolves policy, tenancy, role, and token scope
- managed connector / MCP server: talks to the enterprise system
- `desktop`: receives normalized, minimally scoped results

This preserves the current cloud/desktop boundary and is materially safer than direct desktop-to-enterprise API access.

### 4. Add A Separate AI Data Plane

Keep current MySQL + Prisma for existing cloud product entities such as skills, MCP catalog, installs, and admin metadata.

Add PostgreSQL + pgvector for:

- retrieval indexes for enterprise reference data
- normalized connector cache tables
- semantic memory
- eval datasets and replayable traces
- ranking features and query analytics

Do not overload the current MySQL schema with vector and retrieval responsibilities. That will slow down both the product and the roadmap.

### 5. Measure Quality As A Product Capability

To improve model quality, tool use, and intent understanding, add an evaluation loop, not just better prompts.

Recommended stack split:

- OpenTelemetry: system-wide trace backbone
- LangSmith: run-level AI traces, prompt/version comparisons, dataset evaluations
- Promptfoo: CI guardrail and regression suite

This gives MyClaw a practical answer to “did the assistant actually get better?”.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Orchestration runtime | AI SDK 6 in TypeScript | Keep custom `fetch` orchestration | Too much protocol drift, too much hand-maintained parsing, and it blocks provider-native features. |
| Provider strategy | Provider-native adapters with snapshots | Generic OpenAI-compatible proxy as the main abstraction | Lowest-common-denominator design hurts tool use, reasoning controls, and model-specific capabilities. |
| Agent framework default | AI SDK tool loop + explicit router/planner/verifier | LangGraph everywhere | Too much ceremony for the common case in this brownfield desktop assistant. |
| Enterprise connectivity | Cloud-managed MCP connectors | Direct desktop calls into internal APIs | Wrong security boundary, hard to govern, hard to audit, and difficult to rotate credentials safely. |
| Retrieval store | PostgreSQL + pgvector | Dedicated vector DB on day one | Unnecessary new ops burden until scale clearly demands it. |
| Gateway | Stay inside Node/Nest first | Add Python-centric LiteLLM proxy immediately | Adds another runtime and service tier before the current TypeScript platform has extracted the basic orchestration layer. |

## What Not To Use

- Do **not** keep extending the current “OpenAI-compatible first” client as the strategic foundation.
- Do **not** put enterprise API secrets, long-lived access tokens, or direct system credentials in the desktop app.
- Do **not** rely on one giant autonomous agent loop with unrestricted tool access; use bounded loops and approvals.
- Do **not** treat vector search as a substitute for structured enterprise data integration; connectors still matter.
- Do **not** introduce LangGraph or Temporal into the hot path of every chat turn.
- Do **not** optimize first for local/on-device open-weight models. For this phase, task quality and connector quality matter more than offline novelty.

## Brownfield Adoption Order

1. Replace desktop model orchestration with AI SDK + provider-native adapters.
2. Add structured intent routing with `zod` outputs before the executor loop.
3. Move enterprise-system access behind cloud-managed MCP connectors and scoped auth.
4. Add OTel + LangSmith + Promptfoo so quality changes become measurable.
5. Add PostgreSQL + pgvector only when retrieval/memory/connectors start producing enough normalized data to justify it.
6. Add LangGraph or Temporal selectively for the minority of workflows that are truly stateful and durable.

## Installation

```bash
# Core orchestration
pnpm add ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/mcp zod @modelcontextprotocol/sdk

# Observability and evaluation
pnpm add langsmith @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http
pnpm add -D promptfoo

# AI data plane
pnpm add pg

# Optional advanced orchestration
pnpm add @langchain/langgraph
pnpm add @temporalio/client @temporalio/worker @temporalio/workflow
```

## Confidence Assessment

| Recommendation Area | Confidence | Notes |
|---------------------|------------|-------|
| AI SDK as the main TS orchestration layer | HIGH | Strong fit for current TypeScript/Electron/Nest brownfield and verified current docs support tools, MCP, embeddings, reranking, middleware, and telemetry. |
| Multi-model portfolio with explicit router/executor split | HIGH | This is standard current practice and directly addresses the user's stated problems: task quality, tool quality, and intent understanding. |
| Cloud-managed MCP connectors for enterprise systems | HIGH | Strong match for the existing MyClaw architecture and verified current MCP auth patterns. |
| PostgreSQL + pgvector as the AI data plane | MEDIUM | Technically strong and standard, but adoption timing depends on how much retrieval/memory the next milestone actually needs. |
| LangSmith + Promptfoo + OTel evaluation stack | HIGH | Strong evidence and clear operational value for improving quality over time. |
| LangGraph / Temporal as selective additions only | MEDIUM | Correct pattern for bounded complex flows, but only some future phases will need them. |

## Sources

- AI SDK Core reference: https://ai-sdk.dev/docs/reference/ai-sdk-core
- AI SDK telemetry: https://ai-sdk.dev/docs/ai-sdk-core/telemetry
- OpenAI prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
- OpenAI model docs, including current `gpt-5.4` family and tool-enabled endpoints: https://developers.openai.com/api/docs/models/gpt-5.4
- Anthropic models overview, including Claude Opus 4.6 / Sonnet 4.6 / Haiku 4.5 and regional endpoint notes: https://platform.claude.com/docs/en/about-claude/models/overview
- Anthropic tool use overview: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Model Context Protocol OAuth client credentials extension: https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials
- OpenTelemetry JavaScript docs: https://opentelemetry.io/docs/languages/js/
- LangSmith docs: https://docs.smith.langchain.com/
- Promptfoo docs: https://www.promptfoo.dev/docs/
- Temporal docs: https://docs.temporal.io/
- pgvector project docs: https://github.com/pgvector/pgvector

# Architecture Patterns

**Domain:** Enterprise internal AI desktop assistant platform
**Researched:** 2026-04-04
**Overall confidence:** MEDIUM-HIGH

## Recommended Architecture

For this brownfield system, keep `desktop` as the user-facing agent host and execution edge, and evolve `cloud` into the governance and integration control plane. Do not move all orchestration into cloud in one step, and do not keep letting the desktop main process absorb every new concern.

The safe target shape is:

```text
User
  -> Desktop UI
  -> Desktop Agent Host
     -> Context Pipeline
     -> Model Orchestrator
     -> Local Tool Runtime
     -> Policy/Approval Client
     -> Enterprise Connector Gateway (cloud-managed)
Cloud Control Plane
  -> Model Gateway / managed model access
  -> Tool and connector registry
  -> Policy / approval rules
  -> Execution ledger + traces + evals
  -> Connector workers + entitlement-aware index
Enterprise Systems
  -> HR / OA / ticket / docs / search / internal APIs
```

This uses MCP as the standard capability boundary for remote tools and connectors, but keeps host-side orchestration, policy decisions, and context aggregation under MyClaw control. That matches MCP's host-client-server model, where the host coordinates LLM integration, context aggregation, permissions, and isolation between servers. Confidence: HIGH. Sources: MCP architecture spec, project codebase architecture.

The key design choice is a **split control plane / execution plane**:

- `desktop` owns request intake, user approvals, local context, local OS/browser/file tools, and interactive UX.
- `cloud` owns policies, enterprise-managed models, connector registration, audit, traces, evals, and enterprise data access.
- Enterprise data connectors are not called directly from renderer or ad hoc from model prompts; they sit behind a governed gateway with scoped identity, ACL preservation, and explicit approval rules.

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Desktop UI Shell | Chat UX, task status, approval prompts, result rendering | Desktop Agent Host |
| Desktop Agent Host | Session lifecycle, run state, streaming, approval UX, local runtime coordination | Context Pipeline, Model Orchestrator, Local Tool Runtime, Policy Client |
| Context Pipeline | Convert raw user input into task frame, user-role hints, session memory, allowed tool set, connector candidates | Desktop Agent Host, Profile/Memory Store, Connector Gateway |
| Model Orchestrator | Select model lane, build bounded prompt/tool manifest, interpret tool-call loop, decide next step | Context Pipeline, Policy Client, Model Gateway or direct personal model provider |
| Local Tool Runtime | Execute safe local capabilities such as filesystem, browser, shell, local MCP, local artifacts | Model Orchestrator, Approval subsystem |
| Policy and Approval Layer | Enforce tool allowlists, approval thresholds, connector scopes, data egress checks, run classification | Desktop Agent Host, Model Orchestrator, Connector Gateway, Audit store |
| Cloud Model Gateway | Hold enterprise model credentials, route to approved providers, attach trace IDs, apply org policy | Model Orchestrator, Execution Ledger |
| Connector Gateway | Uniform read/write interface for internal systems; token exchange, ACL checks, rate limits, schema normalization | Model Orchestrator, Connector Workers, Enterprise Systems |
| Connector Workers and Index | Incremental sync, event ingestion, entitlement-aware index, schema mapping, background jobs | Connector Gateway, Enterprise Systems, Search/Index store |
| Execution Ledger, Tracing, and Evals | Durable run/tool records, statuses, trace correlation, offline evaluation, rollout comparison | Desktop Agent Host, Cloud Model Gateway, Connector Gateway, analytics jobs |

### Boundary Rules

1. The renderer never holds enterprise connector secrets or enterprise model credentials.
2. The model never talks to enterprise systems directly; it only emits intents and tool calls.
3. Local tools and enterprise connectors are different classes of capability and must stay on different policy paths.
4. Connector read paths and connector write paths are different products internally, even if they share auth and schema code.
5. Full conversation state stays with the host; tools and MCP servers receive only the context needed for one call. This is directly aligned with MCP design principles. Confidence: HIGH.

## Data Flow

### Primary interactive flow

```text
User message
  -> Desktop UI Shell
  -> Desktop Agent Host creates run_id
  -> Context Pipeline compiles:
       session summary
       user role/profile hints
       approved tools
       connector candidates
       safety classification
  -> Model Orchestrator selects execution lane:
       personal/local model
       or cloud-managed enterprise model
  -> Model receives bounded context + bounded tool manifest
  -> Model returns answer or tool call intent
  -> Policy/Approval Layer checks intent
  -> Local Tool Runtime OR Connector Gateway executes
  -> Result returns to Model Orchestrator
  -> Model synthesizes final answer / next tool step
  -> Desktop UI streams output and updates run state
  -> Execution Ledger stores trace, tool calls, approvals, outcomes
```

### Enterprise data read flow

```text
Model tool intent
  -> Connector Gateway
  -> Connector-specific auth/token exchange
  -> ACL / scope validation
  -> Entitlement-aware retrieval:
       live API read for fresh transactional data
       or indexed read for searchable shared content
  -> Redaction / normalization
  -> Result back to orchestrator
```

### Enterprise action flow

```text
Model proposes action
  -> Policy/Approval Layer
  -> User approval or policy auto-approval
  -> Connector Gateway write adapter
  -> Enterprise system
  -> Compensating record + audit event + user-visible result
```

### Background flow

Long-running work must switch from transient IPC handling to durable run handling:

```text
Interactive run requests background execution
  -> Execution Ledger status = queued / in_progress / waiting_approval / completed / failed
  -> Worker resumes orchestration
  -> Desktop polls or subscribes for status updates
```

This is the right shape for brownfield evolution because current desktop session handling is still largely synchronous and main-process-centric. Introducing a run ledger first gives you a seam to improve orchestration without breaking the chat UX. Confidence: MEDIUM-HIGH.

## Patterns to Follow

### Pattern 1: Host-Controlled Agent Runtime

**What:** Keep the desktop host as the coordinator for session state, context aggregation, approval UX, and cross-tool isolation. Remote MCP servers and enterprise connectors remain subordinate capabilities, not peers that can inspect the whole conversation.

**When:** Always. This is the core safety boundary for a desktop assistant.

**Why:** MCP explicitly assigns context aggregation, authorization decisions, and security boundary enforcement to the host, not to servers. That maps well to the existing desktop runtime.

**Example:**

```typescript
type AgentRun = {
  runId: string;
  sessionId: string;
  userId: string;
  taskFrame: CompiledTaskFrame;
  allowedTools: ToolGrant[];
};

async function handleTurn(run: AgentRun, input: UserInput) {
  const context = await contextPipeline.compile(run, input);
  const plan = await orchestrator.plan(context);
  return executePlan(plan, run);
}
```

### Pattern 2: Two-Speed Capability Model

**What:** Split capabilities into:

- Local interactive tools: filesystem, browser, shell, local MCP, local artifacts
- Governed enterprise capabilities: HR, OA, ITSM, employee directory, docs, internal search, write-back actions

**When:** Immediately. This should be a first-order architectural boundary, not a naming convention.

**Why:** Local tools optimize latency and personal productivity; enterprise connectors optimize governance, identity, audit, and blast-radius control. Mixing them in one executor creates policy confusion.

### Pattern 3: Context Compiler, Not Prompt Concatenation

**What:** Turn context understanding into a pipeline that produces structured artifacts:

- normalized intent
- task type
- user role / team hints
- needed freshness
- allowed systems
- candidate tools
- missing information questions

**When:** Before trying model fine-tuning or heavy prompt complexity.

**Why:** Existing brownfield systems often degrade because every new need is appended to the system prompt. OpenAI's current APIs support durable conversation state, but application-side context selection still determines quality and cost. Confidence: HIGH for the principle, MEDIUM for exact implementation shape.

### Pattern 4: Execution Ledger Over In-Memory Loops

**What:** Give every run, tool call, approval request, and connector job a durable record and status model.

**When:** Before adding more autonomous multi-step behavior.

**Why:** Current orchestration improvements will otherwise be invisible and un-debuggable. OpenAI explicitly recommends logging request IDs and using evals because model behavior changes between snapshots. That means the platform needs its own run ledger and evaluation spine.

**Suggested status model:** `queued -> planning -> waiting_approval -> running_tool -> synthesizing -> completed | failed | canceled`

### Pattern 5: Read/Index Path Separate From Write/Action Path

**What:** Connector retrieval should have two internal lanes:

- `search/read lane`: index-backed or live read, optimized for relevance and ACL preservation
- `action lane`: narrow write APIs, narrow scopes, approval-first, idempotent, fully audited

**When:** For every enterprise system integration.

**Why:** Microsoft Graph connectors model this separation clearly: connections define schema and index lifecycle, while external items preserve ACLs and sync strategy separately. Dynamic or sensitive data should prefer event-based freshness; content-heavy corpora can use scheduled sync. Confidence: HIGH.

### Pattern 6: Shadow Rollout for New Planners and Policies

**What:** New model router, prompt pack, tool selector, or connector policy runs in observe-only mode against sampled production traffic before becoming authoritative.

**When:** Every time orchestration logic changes materially.

**Why:** Brownfield safety depends on comparing old and new behavior with shared trace IDs and eval datasets, not on intuition.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Expanding `desktop` Main Process Into a Permanent Monolith

**What:** Keep adding orchestration, context logic, tool logic, policy checks, and connector logic into one session handler.

**Why bad:** Every future change becomes high-risk because the same code path owns UX, runtime state, model calls, and side effects.

**Instead:** Extract stable interfaces first, then move implementations behind them without changing the UI contract.

### Anti-Pattern 2: Treating All MCP Servers As Equally Trusted

**What:** Give arbitrary MCP servers broad access and skip approval because the protocol is standardized.

**Why bad:** MCP standardizes transport and capability negotiation, not trust. OpenAI's current MCP guidance explicitly warns that remote servers are third-party services, may change behavior, and should be approved and reviewed carefully.

**Instead:** Use allowlisted servers, per-server trust levels, bounded tool imports, approval defaults, and separate policies for local vs remote servers.

### Anti-Pattern 3: Putting Secrets in Client-Side Storage for Governed Workloads

**What:** Store enterprise model keys or connector tokens in renderer/browser storage because the desktop app is "internal."

**Why bad:** OpenAI's API guidance is explicit that API keys should not be exposed in client-side apps; the same principle applies to enterprise connector credentials.

**Instead:** Keep enterprise credentials in cloud-managed gateways or OS secure storage, and issue scoped short-lived tokens to the desktop only when unavoidable.

### Anti-Pattern 4: Sending Full Conversation History to Every Tool or Connector

**What:** Serialize the whole chat and attach it to every tool call for convenience.

**Why bad:** It violates least privilege, raises prompt injection surface, and leaks irrelevant internal data.

**Instead:** Send call-local task context only, with explicit provenance and redaction.

### Anti-Pattern 5: Building Connectors As Pure Chat-Time Live Calls

**What:** Every enterprise read becomes a synchronous live API call from the active conversation.

**Why bad:** High latency, brittle auth, uneven freshness, and no reusable entitlement-aware index.

**Instead:** Use hybrid connector architecture: incremental/event sync for searchable shared content, live API reads for fresh transactional data, and separate write adapters.

## Suggested Build Order

### Step 1: Extract orchestration seams inside the existing desktop runtime

Create explicit interfaces around the current context assembler, model client, built-in tool executor, and approval handling. Do not move UX or transport yet.

**Why first:** This is the lowest-risk brownfield move and creates a future migration seam.

### Step 2: Add execution ledger, trace IDs, and evaluation harness

Every run and tool call gets a durable ID, status, timing, request correlation, and outcome record. Build replayable eval datasets from real tasks before changing planner behavior.

**Why second:** Without this, later orchestration work cannot be measured safely.

### Step 3: Centralize policy and approval decisions

Move allowlists, approval rules, connector trust levels, and data egress policy into cloud-managed policy objects, while desktop still enforces them at runtime.

**Why third:** This reduces governance drift before more connectors and autonomy are introduced.

### Step 4: Build the context pipeline

Add structured intent analysis, role/job-context enrichment, memory compaction, and connector selection logic as a first-class subsystem.

**Why fourth:** This directly improves "understanding users" without yet increasing side-effect risk.

### Step 5: Introduce connector gateway with read-only enterprise connectors first

Start with high-value shared data such as employee directory, organization info, knowledge/doc search, ticket lookup, and policy search. Prefer read-only and entitlement-aware retrieval before write actions.

**Why fifth:** It unlocks enterprise usefulness while keeping blast radius small.

### Step 6: Add enterprise action adapters

After policy, audit, and approvals are stable, add write actions such as create ticket, update directory metadata, submit workflow, or trigger internal process.

**Why sixth:** Write paths are where governance failures become incidents.

### Step 7: Add smarter planner/router upgrades and partial autonomy

Only after traces and evals are stable should you add deeper multi-tool planning, automatic retries, self-critique loops, or role-specific orchestration packs.

**Why seventh:** Optimization belongs after control and observability.

## Build Order Implications for the Roadmap

1. The first roadmap phases should be about **seams, visibility, and policy**, not "smarter agent" behavior.
2. Context understanding should be implemented before broad enterprise write connectors.
3. Connector work should start with **read/search/inform** scenarios, then expand to **write/act** scenarios.
4. Managed enterprise model access should be introduced as a second lane, not as a flag day replacement for all existing desktop model profiles.
5. Planner sophistication should be the last major step because it depends on policy, traceability, and connector quality.

## Scalability Considerations

| Concern | At 100 users | At 10K users | At 1M users |
|---------|--------------|--------------|-------------|
| Run orchestration | Single MySQL-backed ledger and desktop polling is enough | Add async workers and queue-backed background runs | Partition run store, event streams, and workflow workers by tenant/org/region |
| Tool execution | Local execution dominates | Add per-tool concurrency limits and retry policy | Isolate workers by risk class and use dedicated pools for browser / heavy tools |
| Connector freshness | Manual or scheduled sync is acceptable | Incremental plus event-based sync for sensitive datasets | Per-connector change feeds, backpressure control, and separate hot/cold indexes |
| Policy enforcement | Static allowlists can work | Central policy objects with audit and staged rollout | Fine-grained ABAC/RBAC, connector trust tiers, continuous verification |
| Observability | Basic traces and logs | Full trace correlation across desktop/cloud/model/connectors | Cost, latency, safety, and eval dashboards with automated rollback triggers |

## Confidence Notes

| Area | Confidence | Notes |
|------|------------|-------|
| Host-centered orchestration boundary | HIGH | Strongly supported by MCP architecture and the current desktop-first product shape |
| Split local tools vs governed enterprise connectors | HIGH | Supported by Zero Trust principles and current repo boundaries |
| Connector gateway with ACL-preserving retrieval | HIGH | Supported by Microsoft Graph connector model and enterprise least-privilege practice |
| Execution ledger + eval-first rollout | HIGH | Supported by OpenAI guidance on request IDs, pinned versions, and evals |
| Exact cloud model gateway rollout shape | MEDIUM | Recommended inference from current brownfield state, not a direct product doc requirement |

## Sources

- Internal: `.planning/PROJECT.md`
- Internal: `.planning/codebase/ARCHITECTURE.md`
- Internal: `.planning/codebase/INTEGRATIONS.md`
- Model Context Protocol, Architecture: https://modelcontextprotocol.io/specification/2025-06-18/architecture
- Model Context Protocol, Authorization: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- OpenAI API, Conversation state: https://developers.openai.com/api/docs/guides/conversation-state
- OpenAI API, Using tools: https://developers.openai.com/api/docs/guides/tools
- OpenAI API, MCP and Connectors: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- OpenAI API, Background mode: https://developers.openai.com/api/docs/guides/background
- OpenAI API reference overview: https://developers.openai.com/api/reference/overview
- OpenAI API, Agent evals: https://developers.openai.com/api/docs/guides/agent-evals
- Microsoft Learn, Zero Trust overview: https://learn.microsoft.com/en-us/security/zero-trust/zero-trust-overview
- Microsoft Graph, manage connections: https://learn.microsoft.com/en-us/graph/connecting-external-content-manage-connections
- Microsoft Graph, manage items: https://learn.microsoft.com/en-us/graph/connecting-external-content-manage-items

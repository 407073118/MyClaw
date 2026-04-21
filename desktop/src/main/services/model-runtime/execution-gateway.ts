import { randomUUID } from "node:crypto";

import type {
  BackgroundTaskHandle,
  CapabilityExecutionRoute,
  CanonicalToolSpec,
  CanonicalTurnContent,
  ExecutionPlan,
  ModelProfile,
  TurnActualExecutionPath,
  TurnExecutionPlan,
  TurnFallbackEvent,
  TurnOutcome,
} from "@shared/contracts";
import type { MyClawPaths } from "../directory-service";
import type { ArtifactManager } from "../artifact-manager";
import type { ChatMessage as ModelChatMessage, ModelCallResult } from "../model-client";

import {
  buildCanonicalTurnContent,
  canonicalTurnContentToLegacyMessages,
} from "./canonical-turn-content";
import { resolveProtocolDriver, type ProtocolExecutionOutput } from "./protocols";
import type { ProviderRolloutFlags, VendorProtocolRolloutFlags } from "./rollout-gates";
import { resolveEffectiveExecutionRolloutGate } from "./rollout-gates";
import { buildTurnTelemetryEvent } from "./telemetry";
import { filterRegistryForMoonshotFormula, isMoonshotFormulaToolStackActive } from "./moonshot-formula-tools";
import { createToolMiddleware, type CompiledToolBundle, type ToolMiddleware } from "./tool-middleware";
import {
  buildCanonicalToolRegistry,
  hydrateCanonicalToolRegistryFromLegacyTools,
} from "./tool-registry";
import { resolveTurnExecutionPlan } from "./turn-execution-plan-resolver";
import { saveTurnOutcome } from "./turn-outcome-store";
import type { ComputerActionHarness } from "./computer-action-harness";

export type ExecutionGatewayInput = {
  mode?: "legacy" | "canonical";
  profile: ModelProfile;
  plan?: TurnExecutionPlan | ExecutionPlan;
  executionPlan?: TurnExecutionPlan | ExecutionPlan | null;
  modelProfileId?: string;
  content?: CanonicalTurnContent | null;
  previousResponseId?: string | null;
  messages?: ModelChatMessage[];
  tools?: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  toolSpecs?: CanonicalToolSpec[];
  workingDir?: string;
  signal?: AbortSignal;
  onDelta?: (delta: { content?: string; reasoning?: string }) => void;
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void;
  sessionId?: string | null;
  workflowRunId?: string | null;
};

export type ExecutionGatewayResult = ProtocolExecutionOutput & {
  plan: TurnExecutionPlan;
  providerFamily: TurnExecutionPlan["providerFamily"];
  protocolTarget: TurnExecutionPlan["protocolTarget"];
  capabilityRoutes: NonNullable<TurnExecutionPlan["capabilityRoutes"]>;
  actualExecutionPath: TurnActualExecutionPath;
  toolBundle: CompiledToolBundle;
  latencyMs: number;
  outcome: TurnOutcome;
  outcomeId: string;
  requestShape: Record<string, unknown>;
};

export type ExecutionGatewayDeps = {
  paths?: MyClawPaths;
  artifactManager?: ArtifactManager;
  rolloutFlags?: ProviderRolloutFlags;
  vendorProtocolFlags?: VendorProtocolRolloutFlags;
  toolMiddleware?: ToolMiddleware;
  computerHarness?: ComputerActionHarness;
};

function isTurnExecutionPlan(plan: TurnExecutionPlan | ExecutionPlan): plan is TurnExecutionPlan {
  return Object.prototype.hasOwnProperty.call(plan, "legacyExecutionPlan");
}

function mergeFallbackEvents(
  preparedFallbacks: TurnFallbackEvent[],
  result: ProtocolExecutionOutput,
): TurnFallbackEvent[] {
  return [...preparedFallbacks, ...(result.fallbackEvents ?? [])];
}

function normalizeModelCallResult(result: ModelCallResult): ProtocolExecutionOutput {
  return {
    content: result.content,
    reasoning: result.reasoning,
    toolCalls: result.toolCalls,
    finishReason: result.finishReason,
    streamCompleted: result.streamCompleted,
    usage: result.usage,
    responseId: null,
    requestVariantId: result.transport?.requestVariantId ?? "primary",
    fallbackReason: result.transport?.fallbackReason ?? null,
    retryCount: result.transport?.retryCount ?? 0,
    fallbackEvents: result.transport?.fallbackEvents ?? [],
    citations: [],
    capabilityEvents: [],
    backgroundTask: null,
  };
}

/** 为 legacy shim 补齐协议层元数据，避免观测层只看到底层 transport 的 primary 标签。 */
function applyLegacyProtocolMetadata(
  plan: TurnExecutionPlan,
  result: ProtocolExecutionOutput,
): ProtocolExecutionOutput {
  const shouldPromoteProtocolTarget = (result.requestVariantId === undefined || result.requestVariantId === null || result.requestVariantId === "primary")
    && plan.protocolTarget !== "openai-chat-compatible";

  if (!shouldPromoteProtocolTarget) {
    return result;
  }

  return {
    ...result,
    requestVariantId: plan.protocolTarget,
  };
}

function buildCanonicalInput(input: ExecutionGatewayInput, plan: TurnExecutionPlan): CanonicalTurnContent {
  if (input.content) {
    return input.content;
  }

  return buildCanonicalTurnContent({
    systemSections: [],
    legacyMessages: input.messages ?? [],
    replayPolicy: plan.legacyExecutionPlan.replayPolicy,
  });
}

/** 当厂商原生 search 可用时，过滤掉会与 built-in tool 重名的本地回退工具。 */
function filterRegistryForCapabilityRoutes(
  registry: CanonicalToolSpec[],
  capabilityRoutes: CapabilityExecutionRoute[] | undefined,
): CanonicalToolSpec[] {
  const nativeSearchEnabled = capabilityRoutes?.some((route) =>
    route.capabilityId === "search"
    && route.routeType === "vendor-native"
    && route.nativeToolName === "web_search",
  ) ?? false;

  const deduplicatedRegistry = nativeSearchEnabled
    ? registry.filter((tool) => tool.name !== "web_search")
    : registry;

  if (isMoonshotFormulaToolStackActive(capabilityRoutes)) {
    return filterRegistryForMoonshotFormula(deduplicatedRegistry, capabilityRoutes);
  }

  return deduplicatedRegistry;
}

function resolveToolStackSource(capabilityRoutes: CapabilityExecutionRoute[] | undefined): TurnOutcome["toolStackSource"] {
  const toolStackSources = new Set(
    (capabilityRoutes ?? [])
      .map((route) => route.toolStackSource)
      .filter((value): value is NonNullable<TurnOutcome["toolStackSource"]> => !!value && value !== "none"),
  );

  if (toolStackSources.has("vendor-native") && toolStackSources.has("managed-local")) {
    return "hybrid";
  }
  if (toolStackSources.has("vendor-native")) {
    return "vendor-native";
  }
  if (toolStackSources.has("managed-local")) {
    return "managed-local";
  }
  return "none";
}

function resolveActiveNativeToolStackId(
  plan: TurnExecutionPlan,
  capabilityRoutes: CapabilityExecutionRoute[] | undefined,
): string | null {
  return capabilityRoutes?.find((route) => route.nativeToolStackId)?.nativeToolStackId
    ?? plan.nativeToolStackId
    ?? null;
}

function buildToolBundle(
  input: ExecutionGatewayInput,
  plan: TurnExecutionPlan,
  toolMiddleware: ToolMiddleware,
): CompiledToolBundle {
  const registry = filterRegistryForCapabilityRoutes(input.toolSpecs
    ?? (input.tools
      ? hydrateCanonicalToolRegistryFromLegacyTools(input.tools as any)
      : input.workingDir
        ? buildCanonicalToolRegistry(input.workingDir, undefined, undefined, plan.toolPolicyId)
        : []), plan.capabilityRoutes);

  return toolMiddleware.compile(registry, plan.toolCompileTarget);
}

function buildOutcome(input: {
  outcomeId: string;
  plan: TurnExecutionPlan;
  profile: ModelProfile;
  result: ProtocolExecutionOutput;
  latencyMs: number;
  sessionId?: string | null;
  workflowRunId?: string | null;
  toolBundle: CompiledToolBundle;
  startedAt: string;
  finishedAt: string;
  fallbackEvents: TurnFallbackEvent[];
  actualExecutionPath: TurnActualExecutionPath;
}): TurnOutcome {
  const outcome: TurnOutcome = {
    id: input.outcomeId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.workflowRunId ? { workflowRunId: input.workflowRunId } : {}),
    providerFamily: input.plan.providerFamily,
    vendorFamily: input.plan.vendorFamily,
    protocolTarget: input.plan.protocolTarget,
    modelProfileId: input.profile.id,
    experienceProfileId: input.plan.experienceProfileId,
    promptPolicyId: input.plan.promptPolicyId,
    taskPolicyId: input.plan.taskPolicyId,
    toolPolicyId: input.plan.toolPolicyId,
    contextPolicyId: input.plan.contextPolicyId,
    reliabilityPolicyId: input.plan.reliabilityPolicyId,
    requestVariantId: input.result.requestVariantId ?? null,
    fallbackReason: input.result.fallbackReason ?? null,
    fallbackEvents: input.fallbackEvents,
    retryCount: input.result.retryCount,
    toolCompileMode: input.toolBundle.compileMode,
    replayMode: input.plan.replayMode,
    reasoningEnabled: input.plan.reasoningEnabled,
    thinkingControlKind: input.plan.thinkingControlKind,
    toolChoiceConstraint: input.plan.toolChoiceConstraint,
    nativeToolStackId: resolveActiveNativeToolStackId(input.plan, input.plan.capabilityRoutes),
    toolStackSource: resolveToolStackSource(input.plan.capabilityRoutes),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    success: input.result.finishReason !== "error",
    finishReason: input.result.finishReason ?? null,
    latencyMs: input.latencyMs,
    usage: input.result.usage,
    responseId: input.result.responseId ?? null,
    actualExecutionPath: input.actualExecutionPath,
    toolCallCount: input.result.toolCalls.length,
    toolSuccessCount: 0,
    contextStability: (input.result.fallbackEvents?.length ?? 0) === 0 && !input.result.fallbackReason,
    citations: input.result.citations ?? [],
    capabilityEvents: input.result.capabilityEvents ?? [],
    computerCalls: input.result.computerCalls ?? [],
    backgroundTask: input.result.backgroundTask ?? null,
    telemetryTags: input.plan.telemetryTags,
  };

  outcome.telemetry = buildTurnTelemetryEvent({
    plan: input.plan,
    outcome,
    fallbackEvents: input.fallbackEvents,
  });

  return outcome;
}

/** 创建共享执行网关：先收敛 legacy shim，再承接 canonical plan / family / protocol 层。 */
export function createExecutionGateway(deps: ExecutionGatewayDeps = {}) {
  const toolMiddleware = deps.toolMiddleware ?? createToolMiddleware();

  return {
    async executeTurn(input: ExecutionGatewayInput): Promise<ExecutionGatewayResult> {
      const startedAt = new Date().toISOString();
      const startTime = Date.now();
      const basePlan = input.plan ?? input.executionPlan;
      if (!basePlan) {
        throw new Error("ExecutionGateway requires plan or executionPlan");
      }

      const plan = isTurnExecutionPlan(basePlan)
        ? basePlan
        : resolveTurnExecutionPlan({
            profile: input.profile,
            legacyExecutionPlan: basePlan,
            capability: input.profile.discoveredCapabilities ?? null,
            modelProfileId: input.modelProfileId ?? input.profile.id,
          });
      const canonicalContent = buildCanonicalInput(input, plan);
      const legacyMessages = input.messages ?? canonicalTurnContentToLegacyMessages(canonicalContent);
      const toolBundle = buildToolBundle(input, plan, toolMiddleware);
      const rolloutGate = resolveEffectiveExecutionRolloutGate({
        providerFamily: plan.providerFamily,
        vendorFamily: plan.vendorFamily ?? null,
        protocolTarget: plan.protocolTarget,
        providerFlags: deps.rolloutFlags,
        vendorProtocolFlags: deps.vendorProtocolFlags,
      });
      const protocolDriver = resolveProtocolDriver(plan.protocolTarget);
      const protocolInput = {
        profile: input.profile,
        plan,
        content: canonicalContent,
        toolBundle,
        previousResponseId: input.previousResponseId ?? null,
        signal: input.signal,
        onDelta: input.onDelta,
        onToolCallDelta: input.onToolCallDelta,
        sessionId: input.sessionId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        rolloutGate,
      };
      const actualExecutionPath = input.mode === "legacy"
        ? "legacy-shim"
        : plan.protocolTarget !== "openai-chat-compatible" && !rolloutGate.enabled
          ? "canonical-rollout-fallback"
          : "canonical-driver";
      const requestShape = protocolDriver.buildRequestBody ? protocolDriver.buildRequestBody(protocolInput) : {};
      let result = input.mode === "canonical"
        ? await protocolDriver.execute(protocolInput)
        : applyLegacyProtocolMetadata(plan, normalizeModelCallResult(await (async () => {
            const { callModel } = await import("../model-client");
            return callModel({
              profile: input.profile,
              messages: legacyMessages,
              tools: (input.tools ?? toolBundle.tools) as Array<{
                type: "function";
                function: { name: string; description: string; parameters: Record<string, unknown> };
              }>,
              executionPlan: plan.legacyExecutionPlan,
              signal: input.signal,
              onDelta: input.onDelta,
              onToolCallDelta: input.onToolCallDelta,
            });
          })()));

      if (input.mode === "canonical" && deps.computerHarness && plan.protocolTarget === "openai-responses") {
        const aggregatedComputerCalls = [...(result.computerCalls ?? [])];
        const aggregatedCapabilityEvents = [...(result.capabilityEvents ?? [])];
        const aggregatedCitations = [...(result.citations ?? [])];
        const aggregatedFallbackEvents = [...(result.fallbackEvents ?? [])];
        let aggregatedRetryCount = result.retryCount;

        while ((result.computerCalls?.length ?? 0) > 0 && result.responseId) {
          const harnessOutput = await deps.computerHarness.executeCalls({
            sessionId: input.sessionId ?? null,
            workflowRunId: input.workflowRunId ?? null,
            responseId: result.responseId,
            computerCalls: result.computerCalls ?? [],
            signal: input.signal,
          });
          aggregatedCapabilityEvents.push(...harnessOutput.capabilityEvents);
          const continuation = await protocolDriver.execute({
            ...protocolInput,
            previousResponseId: result.responseId,
            responseInputItems: harnessOutput.responseInputItems,
          });
          aggregatedRetryCount += continuation.retryCount;
          aggregatedFallbackEvents.push(...(continuation.fallbackEvents ?? []));
          aggregatedCitations.push(...(continuation.citations ?? []));
          aggregatedCapabilityEvents.push(...(continuation.capabilityEvents ?? []));
          aggregatedComputerCalls.push(...(continuation.computerCalls ?? []));
          result = continuation;
        }

        result = {
          ...result,
          retryCount: aggregatedRetryCount,
          fallbackEvents: aggregatedFallbackEvents,
          citations: aggregatedCitations,
          capabilityEvents: aggregatedCapabilityEvents,
          computerCalls: aggregatedComputerCalls,
        };
      }

      const latencyMs = Date.now() - startTime;
      const finishedAt = new Date().toISOString();
      const fallbackEvents = mergeFallbackEvents([], result);
      const outcomeId = randomUUID();
      const outcome = buildOutcome({
        outcomeId,
        plan,
        profile: input.profile,
        result,
        latencyMs,
        sessionId: input.sessionId,
        workflowRunId: input.workflowRunId,
        toolBundle,
        startedAt,
        finishedAt,
        fallbackEvents,
        actualExecutionPath,
      });

      if (deps.paths) {
        await saveTurnOutcome(deps.paths, outcome, deps.artifactManager);
      }

      return {
        ...result,
        plan,
        providerFamily: plan.providerFamily,
        protocolTarget: plan.protocolTarget,
        capabilityRoutes: plan.capabilityRoutes ?? [],
        actualExecutionPath,
        toolBundle,
        latencyMs,
        outcome,
        outcomeId,
        requestShape,
      };
    },
  };
}

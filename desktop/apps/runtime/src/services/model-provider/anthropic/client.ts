import type { ModelProfile } from "@myclaw-desktop/shared";

import { ANTHROPIC_API_VERSION, buildRequestBody } from "../shared";
import { normalizeBaseUrl, readProviderErrorMessage } from "../shared/http";
import type { ModelConversationDelta, ModelConversationToolDefinition, ProfileConnectivityInput, ProfileConnectivityOutput } from "../types";
import { createAnthropicToolsPayload } from "./messages";
import { parseAnthropicStep } from "./parser";
import { parseAnthropicStepFromSse } from "./sse";
import type { AnthropicMessage, AnthropicStepResult } from "./types";

/** 构造 Anthropic 请求头。 */
function createAnthropicHeaders(profile: ModelProfile): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": profile.apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION,
    ...(profile.headers ?? {}),
  };
}

/** 请求单轮 Anthropic 对话并解析步进结果。 */
export async function requestAnthropicStep(input: {
  profile: ModelProfile;
  system: string;
  messages: AnthropicMessage[];
  includeTools: boolean;
  tools: readonly ModelConversationToolDefinition[];
  streamResponse?: boolean;
  onAssistantDelta?: (delta: ModelConversationDelta) => Promise<void> | void;
}): Promise<AnthropicStepResult> {
  const body = buildRequestBody(
    {
      model: input.profile.model,
      max_tokens: 2048,
      stream: Boolean(input.streamResponse),
      messages: input.messages,
    },
    input.profile,
  );

  if (input.system.trim()) {
    body.system = input.system;
  }

  if (input.includeTools) {
    body.tools = createAnthropicToolsPayload(input.tools);
    body.tool_choice = { type: "auto" };
  }

  const response = await fetch(`${normalizeBaseUrl(input.profile.baseUrl)}/messages`, {
    method: "POST",
    headers: createAnthropicHeaders(input.profile),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await readProviderErrorMessage(response);
    throw new Error(`Model request failed with status ${response.status}: ${detail}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (input.streamResponse && contentType.includes("text/event-stream")) {
    return parseAnthropicStepFromSse(response, input.onAssistantDelta);
  }

  const payload = (await response.json()) as unknown;
  const step = parseAnthropicStep(payload);
  if (input.onAssistantDelta) {
    if (step.assistantReasoning) {
      await input.onAssistantDelta({ reasoning: step.assistantReasoning });
    }
    if (step.assistantText) {
      await input.onAssistantDelta({ content: step.assistantText });
    }
  }
  return step;
}

/** 对 Anthropic profile 做连通性探测。 */
export async function performAnthropicConnectivityTest(
  input: ProfileConnectivityInput,
): Promise<ProfileConnectivityOutput> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${normalizeBaseUrl(input.profile.baseUrl)}/messages`, {
      method: "POST",
      headers: createAnthropicHeaders(input.profile),
      signal: controller.signal,
      body: JSON.stringify(
        buildRequestBody(
          {
            model: input.profile.model,
            max_tokens: 1,
            messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
          },
          input.profile,
        ),
      ),
    });

    if (!response.ok) {
      const detail = await readProviderErrorMessage(response);
      throw new Error(`Provider returned ${response.status}: ${detail}`);
    }

    return { latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Connectivity test timed out after 8000ms.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

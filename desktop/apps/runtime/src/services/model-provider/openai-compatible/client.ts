import type { ModelProfile } from "@myclaw-desktop/shared";

import { buildRequestBody } from "../shared";
import { resolveProviderApiBaseUrl } from "../shared/endpoint";
import { readModelIds, readProviderErrorMessage } from "../shared/http";
import type {
  ModelConversationDelta,
  ModelConversationToolDefinition,
  ProfileConnectivityInput,
  ProfileConnectivityOutput,
  ProfileModelCatalogInput,
  ProfileModelCatalogOutput,
} from "../types";
import { shouldStreamOpenAiCompatibleStep, resolveOpenAiCompatibleFlavor } from "./flavor";
import { createOpenAiToolsPayload } from "./messages";
import { parseOpenAiStep } from "./parser";
import { parseOpenAiStepFromSse } from "./sse";
import type { OpenAiRequestMessage, OpenAiStepResult } from "./types";

/** 构造 OpenAI-compatible 请求头。 */
function createOpenAiCompatibleHeaders(profile: ModelProfile): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${profile.apiKey}`,
    ...(profile.headers ?? {}),
  };
}

/** 请求单轮 OpenAI-compatible 对话并解析步进结果。 */
export async function requestOpenAiStep(input: {
  profile: ModelProfile;
  messages: OpenAiRequestMessage[];
  includeTools: boolean;
  tools: readonly ModelConversationToolDefinition[];
  streamResponse?: boolean;
  onAssistantDelta?: (delta: ModelConversationDelta) => Promise<void> | void;
}): Promise<OpenAiStepResult> {
  const providerFlavor = resolveOpenAiCompatibleFlavor(input.profile);
  const shouldStream = shouldStreamOpenAiCompatibleStep({
    profile: input.profile,
    includeTools: input.includeTools,
    requestedStream: Boolean(input.streamResponse),
  });
  const body = buildRequestBody(
    {
      model: input.profile.model,
      stream: shouldStream,
      messages: input.messages,
    },
    input.profile,
  );

  if (input.includeTools) {
    body.tools = createOpenAiToolsPayload(input.tools);
    if (providerFlavor !== "qwen") {
      body.tool_choice = "auto";
    }
  }

  const response = await fetch(`${resolveProviderApiBaseUrl(input.profile)}/chat/completions`, {
    method: "POST",
    headers: createOpenAiCompatibleHeaders(input.profile),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await readProviderErrorMessage(response);
    throw new Error(`Model request failed with status ${response.status}: ${detail}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (shouldStream && contentType.includes("text/event-stream")) {
    return parseOpenAiStepFromSse(response, input.onAssistantDelta);
  }

  const rawBody = await response.text();
  const step = parseOpenAiStep(rawBody, contentType);
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

/** 对 OpenAI-compatible profile 做连通性探测。 */
export async function performOpenAiConnectivityTest(
  input: ProfileConnectivityInput,
): Promise<ProfileConnectivityOutput> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${resolveProviderApiBaseUrl(input.profile)}/chat/completions`, {
      method: "POST",
      headers: createOpenAiCompatibleHeaders(input.profile),
      signal: controller.signal,
      body: JSON.stringify(
        buildRequestBody(
          {
            model: input.profile.model,
            temperature: 0,
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
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

/** 拉取 OpenAI-compatible 厂商的模型目录，并统一返回模型 id 列表。 */
export async function listOpenAiCompatibleModelIds(
  input: ProfileModelCatalogInput,
): Promise<ProfileModelCatalogOutput> {
  const response = await fetch(`${resolveProviderApiBaseUrl(input.profile)}/models`, {
    method: "GET",
    headers: createOpenAiCompatibleHeaders(input.profile),
  });

  if (!response.ok) {
    const detail = await readProviderErrorMessage(response);
    throw new Error(`Provider returned ${response.status}: ${detail}`);
  }

  const payload = (await response.json()) as unknown;
  return {
    modelIds: readModelIds(payload),
  };
}

import type {
  BackgroundTaskHandle,
  BackgroundTaskStatus,
  ModelProfile,
} from "@shared/contracts";

import { buildRequestHeaders } from "../model-client";
import { parseOpenAiResponsesJsonPayload } from "./protocols/openai-responses-driver";
import type { ProtocolExecutionOutput } from "./protocols/shared";

export type BackgroundTaskSnapshot = {
  id: string;
  status: BackgroundTaskStatus;
  outputText: string;
  task: BackgroundTaskHandle | null;
  result: ProtocolExecutionOutput;
};

type BackgroundTaskManagerDeps = {
  fetchImpl?: typeof fetch;
};

type BackgroundTaskRequest = {
  profile: Pick<ModelProfile, "baseUrl" | "provider" | "providerFlavor" | "apiKey" | "model" | "headers">;
  task: BackgroundTaskHandle;
};

/** 统一裁剪 Responses base URL，保证 retrieve/cancel 与 create 使用同一套地址解析规则。 */
function stripEndpointSuffixes(url: string): string {
  return url
    .replace(/\/(chat\/completions|responses|messages)$/i, "")
    .replace(/\/(compatible-mode\/v1|v1)$/i, "")
    .replace(/\/+$/, "");
}

/** 解析 OpenAI Responses 任务详情地址。 */
function resolveResponseUrl(profile: Pick<ModelProfile, "baseUrl">, responseId: string): string {
  return `${stripEndpointSuffixes(profile.baseUrl)}/v1/responses/${responseId}`;
}

/** 从 Responses JSON 输出中抽取最终文本，供后台任务面板和恢复逻辑直接使用。 */
function extractOutputText(payload: Record<string, unknown>): string {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    if (record.type !== "message" || !Array.isArray(record.content)) {
      continue;
    }

    for (const contentPart of record.content) {
      if (!contentPart || typeof contentPart !== "object") {
        continue;
      }

      const contentRecord = contentPart as Record<string, unknown>;
      if (contentRecord.type === "output_text" && typeof contentRecord.text === "string") {
        parts.push(contentRecord.text);
      }
    }
  }

  return parts.join("");
}

/** 把 Responses API 的最新 JSON 响应归一成后台任务快照。 */
function materializeSnapshot(
  payload: Record<string, unknown>,
  input: BackgroundTaskRequest,
): BackgroundTaskSnapshot {
  const parsed = parseOpenAiResponsesJsonPayload(payload, {
    providerFamily: input.task.providerFamily,
    protocolTarget: input.task.protocolTarget,
    backgroundMode: {
      enabled: true,
      reason: "background_poll",
      pollAfterMs: input.task.pollAfterMs ?? 2000,
    },
    vendor: input.profile.providerFlavor === "openai" ? "openai" : undefined,
  });
  const responseId = typeof payload.id === "string" ? payload.id : input.task.providerResponseId;
  const status = typeof payload.status === "string"
    ? payload.status
    : parsed.backgroundTask?.status ?? input.task.status;
  const updatedAt = new Date().toISOString();
  const nextTask = parsed.backgroundTask
    ? {
        ...parsed.backgroundTask,
        id: responseId,
        providerResponseId: responseId,
        updatedAt,
      }
    : null;

  return {
    id: responseId,
    status,
    outputText: parsed.content || extractOutputText(payload),
    task: nextTask,
    result: parsed,
  };
}

/** 创建后台任务管理器，统一处理 OpenAI Responses 的 retrieve/cancel 生命周期。 */
export function createBackgroundTaskManager(deps: BackgroundTaskManagerDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    async retrieve(input: BackgroundTaskRequest): Promise<BackgroundTaskSnapshot> {
      const response = await fetchImpl(resolveResponseUrl(input.profile, input.task.providerResponseId), {
        method: "GET",
        headers: buildRequestHeaders(input.profile, "openai-responses"),
      });
      if (!response.ok) {
        throw new Error(`Background task retrieve failed: ${response.status} ${response.statusText}`);
      }

      const payload = await response.json() as Record<string, unknown>;
      return materializeSnapshot(payload, input);
    },

    async cancel(input: BackgroundTaskRequest): Promise<BackgroundTaskSnapshot> {
      const response = await fetchImpl(`${resolveResponseUrl(input.profile, input.task.providerResponseId)}/cancel`, {
        method: "POST",
        headers: buildRequestHeaders(input.profile, "openai-responses"),
      });
      if (!response.ok) {
        throw new Error(`Background task cancel failed: ${response.status} ${response.statusText}`);
      }

      const payload = await response.json() as Record<string, unknown>;
      return materializeSnapshot(payload, input);
    },
  };
}

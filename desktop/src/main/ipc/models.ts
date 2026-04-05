import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";

import type { ModelCatalogItem, ModelProfile, ProviderFlavor } from "@shared/contracts";
import {
  isBrMiniMaxProfile,
  type BrMiniMaxRuntimeDiagnostics,
  withBrMiniMaxRuntimeDiagnostics,
} from "@shared/br-minimax";

import type { RuntimeContext } from "../services/runtime-context";
import {
  saveModelProfile,
  deleteModelProfileFile,
  saveSettings,
} from "../services/state-persistence";
import { buildRequestHeaders, resolveModelEndpointUrl } from "../services/model-client";
import { probeBrMiniMaxRuntime } from "../services/br-minimax-runtime";
import { coerceManagedProfileWrite } from "../services/managed-model-profile";
import { normalizeAnthropicCatalog } from "../services/provider-capability-probers/anthropic";
import { normalizeLocalGatewayCatalog } from "../services/provider-capability-probers/local-gateway";
import { normalizeOllamaCatalog } from "../services/provider-capability-probers/ollama";
import { normalizeOpenAiCompatibleCatalog } from "../services/provider-capability-probers/openai-compatible";
import { normalizeOpenRouterCatalog } from "../services/provider-capability-probers/openrouter";
import { normalizeVercelGatewayCatalog } from "../services/provider-capability-probers/vercel-ai-gateway";

type CreateModelInput = Omit<ModelProfile, "id">;
type UpdateModelInput = Partial<Omit<ModelProfile, "id">>;

// ---------------------------------------------------------------------------
// URL 解析辅助方法
// ---------------------------------------------------------------------------

/**
 * 从模型配置推导模型列表接口地址。
 *
 * 聊天补全接口请继续使用 `resolveModelEndpointUrl`，
 * 那里包含更完整的 provider 感知逻辑。
 */
function resolveModelsListUrl(profile: ModelProfile): string {
  // 先拿到聊天接口使用的 API 根路径，再把尾段替换成 `/models`。
  const chatUrl = resolveModelEndpointUrl(profile);

  // 移除最后一段路径并拼成 `/models`。
  // 例如：
  // .../v1/chat/completions -> .../v1/models
  // .../v1/messages        -> .../v1/models
  const lastSlash = chatUrl.lastIndexOf("/");
  const parentPath = chatUrl.slice(0, lastSlash);
  const parentLastSlash = parentPath.lastIndexOf("/");
  const parentSegment = parentPath.slice(parentLastSlash + 1);

  // 如果末级目录是 `chat` 或 `messages`，就继续向上回退一层再拼 `/models`。
  if (parentSegment === "chat" || parentSegment === "messages") {
    // 再向上回退一层，确保得到正确的模型列表根路径。
    return `${parentPath.slice(0, parentLastSlash)}/models`;
  }

  return `${parentPath}/models`;
}

/**
 * 根据配置推断 provider flavor，优先使用用户显式配置。
 */
function resolveProviderFlavor(
  profile: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "model">,
): ProviderFlavor {
  if (profile.providerFlavor) return profile.providerFlavor;

  const baseUrl = profile.baseUrl.trim().toLowerCase();
  const model = profile.model.trim().toLowerCase();

  if (baseUrl.includes("openrouter.ai")) return "openrouter";
  if (baseUrl.includes("vercel") && baseUrl.includes("gateway")) return "vercel-ai-gateway";
  if (baseUrl.includes("dashscope.aliyuncs.com") || model.startsWith("qwen")) return "qwen";
  if (baseUrl.includes("moonshot")) return "moonshot";
  if (baseUrl.includes("api.openai.com")) return "openai";
  if (baseUrl.includes("ollama") || baseUrl.includes(":11434")) return "ollama";
  if (baseUrl.includes("minimax") || baseUrl.includes("minimaxi") || model.startsWith("minimax")) return "minimax-anthropic";

  if (profile.provider === "anthropic") {
    return "anthropic";
  }

  if (profile.provider === "local-gateway") {
    return "generic-local-gateway";
  }

  return "generic-openai-compatible";
}

/**
 * 按 provider flavor 选择目录归一化策略。
 */
function normalizeCatalogPayload(
  payload: unknown,
  provider: ModelProfile["provider"],
  providerFlavor: ProviderFlavor,
): ModelCatalogItem[] {
  if (providerFlavor === "openrouter") {
    return normalizeOpenRouterCatalog(payload, provider, providerFlavor);
  }

  if (providerFlavor === "vercel-ai-gateway") {
    return normalizeVercelGatewayCatalog(payload, provider, providerFlavor);
  }

  if (providerFlavor === "ollama") {
    return normalizeOllamaCatalog(payload, provider, providerFlavor);
  }

  if (provider === "anthropic" || providerFlavor === "anthropic" || providerFlavor === "minimax-anthropic") {
    return normalizeAnthropicCatalog(payload, provider, providerFlavor);
  }

  if (provider === "local-gateway" || providerFlavor === "generic-local-gateway") {
    return normalizeLocalGatewayCatalog(payload, provider, providerFlavor);
  }

  return normalizeOpenAiCompatibleCatalog(payload, provider, providerFlavor);
}

// ---------------------------------------------------------------------------
// IPC 处理器
// ---------------------------------------------------------------------------

export function registerModelHandlers(ctx: RuntimeContext): void {
  // 列出全部模型配置。
  ipcMain.handle("model:list", async (): Promise<ModelProfile[]> => {
    return [...ctx.state.models];
  });

  // 创建新的模型配置。
  ipcMain.handle("model:create", async (_event, input: CreateModelInput): Promise<ModelProfile> => {
    const { id: _discardId, ...unsafeInput } = input as ModelProfile;
    const safeInput = coerceManagedProfileWrite(null, unsafeInput) as Omit<ModelProfile, "id">;
    const profile: ModelProfile = {
      ...safeInput,
      id: randomUUID(),
    };
    ctx.state.models.push(profile);

    // 如果这是第一个模型，则自动设为默认模型。
    if (ctx.state.models.length === 1 || !ctx.state.getDefaultModelProfileId()) {
      ctx.state.setDefaultModelProfileId(profile.id);
      saveSettings(ctx.runtime.paths, {
        defaultModelProfileId: profile.id,
        approvalPolicy: ctx.state.getApprovals(),
        personalPrompt: ctx.state.getPersonalPromptProfile(),
      }).catch((err) => {
        console.error("[model:create] failed to persist default model setting", err);
      });
    }

    // 写盘后再返回，确保文件已经落地。
    await saveModelProfile(ctx.runtime.paths, profile);

    return profile;
  });

  // 更新已有模型配置。
  ipcMain.handle(
    "model:update",
    async (_event, id: string, updates: UpdateModelInput): Promise<ModelProfile> => {
      const index = ctx.state.models.findIndex((m) => m.id === id);
      if (index === -1) {
        throw new Error(`Model profile not found: ${id}`);
      }
      const nextUpdates = coerceManagedProfileWrite(ctx.state.models[index] ?? null, updates);
      const updated: ModelProfile = { ...ctx.state.models[index], ...nextUpdates, id };
      ctx.state.models[index] = updated;

      await saveModelProfile(ctx.runtime.paths, updated);

      return updated;
    },
  );

  // 删除模型配置。
  ipcMain.handle("model:delete", async (_event, id: string) => {
    const index = ctx.state.models.findIndex((m) => m.id === id);
    if (index === -1) {
      return { models: [...ctx.state.models], defaultModelProfileId: ctx.state.getDefaultModelProfileId(), sessions: ctx.state.sessions };
    }
    ctx.state.models.splice(index, 1);

    // 如果删掉的是默认模型，则自动选择下一个可用模型并持久化。
    const currentDefault = ctx.state.getDefaultModelProfileId();
    if (currentDefault === id || currentDefault === null) {
      const nextDefaultId = ctx.state.models[0]?.id ?? null;
      ctx.state.setDefaultModelProfileId(nextDefaultId);
      saveSettings(ctx.runtime.paths, {
        defaultModelProfileId: nextDefaultId,
        approvalPolicy: ctx.state.getApprovals(),
        personalPrompt: ctx.state.getPersonalPromptProfile(),
      }).catch((err) => {
        console.error("[model:delete] failed to persist runtime state", err);
      });
    }

    deleteModelProfileFile(ctx.runtime.paths, id).catch((err) => {
      console.error("[model:delete] failed to delete model file", id, err);
    });

    return {
      models: [...ctx.state.models],
      defaultModelProfileId: ctx.state.getDefaultModelProfileId(),
      sessions: ctx.state.sessions,
    };
  });

  // 设置默认模型配置。
  ipcMain.handle(
    "model:set-default",
    async (_event, id: string): Promise<{ defaultModelProfileId: string }> => {
      const exists = ctx.state.models.some((m) => m.id === id);
      if (!exists) {
        throw new Error(`Model profile not found: ${id}`);
      }
      ctx.state.setDefaultModelProfileId(id);

      saveSettings(ctx.runtime.paths, {
        defaultModelProfileId: id,
        approvalPolicy: ctx.state.getApprovals(),
        personalPrompt: ctx.state.getPersonalPromptProfile(),
      }).catch((err) => {
        console.error("[model:set-default] failed to persist runtime state", err);
      });

      return { defaultModelProfileId: id };
    },
  );

  // Test connectivity for a model profile
  ipcMain.handle(
    "model:test",
    async (
      _event,
      id: string,
    ): Promise<{
      success: boolean;
      ok: boolean;
      latencyMs?: number;
      error?: string;
      diagnostics?: BrMiniMaxRuntimeDiagnostics;
      profile?: ModelProfile;
    }> => {
      const profile = ctx.state.models.find((m) => m.id === id);
      if (!profile) {
        return { success: false, ok: false, error: `Model profile not found: ${id}` };
      }

      if (isBrMiniMaxProfile(profile)) {
        try {
          const probe = await probeBrMiniMaxRuntime(profile);
          const updatedProfile = withBrMiniMaxRuntimeDiagnostics(profile, probe.diagnostics);
          const index = ctx.state.models.findIndex((m) => m.id === id);
          if (index >= 0) {
            ctx.state.models[index] = updatedProfile;
            await saveModelProfile(ctx.runtime.paths, updatedProfile);
          }

          return {
            success: probe.ok,
            ok: probe.ok,
            latencyMs: probe.latencyMs,
            error: probe.error,
            diagnostics: probe.diagnostics,
            profile: updatedProfile,
          };
        } catch (err: unknown) {
          const message =
            err instanceof Error
              ? err.message
              : String(err);
          console.error("[model:test] BR MiniMax 探测失败", { modelId: id, error: message });
          return { success: false, ok: false, error: message };
        }
      }

      const url = resolveModelEndpointUrl(profile);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const startTime = Date.now();

      // 统一复用模型客户端的鉴权头构造，避免探测链路与聊天链路漂移。
      const testHeaders = buildRequestHeaders(profile);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: testHeaders,
          body: JSON.stringify({
            model: profile.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
          signal: controller.signal,
        });

        const latencyMs = Date.now() - startTime;

        if (!response.ok) {
          // Some providers return 400/422 on minimal requests but are reachable
          // treat 401/403 as auth failures, everything else as "reachable"
          if (response.status === 401 || response.status === 403) {
            return {
              success: false,
              ok: false,
              latencyMs,
              error: `Authentication failed (HTTP ${response.status})`,
            };
          }
          // For 400/422/etc the model endpoint is reachable — treat as success
          return { success: true, ok: true, latencyMs };
        }

        return { success: true, ok: true, latencyMs };
      } catch (err: unknown) {
        const latencyMs = Date.now() - startTime;
        const message =
          err instanceof Error
            ? err.name === "AbortError"
              ? "Request timed out after 8 seconds"
              : err.message
            : String(err);
        return { success: false, ok: false, latencyMs, error: message };
      } finally {
        clearTimeout(timeout);
      }
    },
  );

  // Get model catalog for a profile (lists available model IDs from the provider)
  ipcMain.handle(
    "model:catalog",
    async (_event, id: string): Promise<{ modelIds: ModelCatalogItem[] }> => {
      const profile = ctx.state.models.find((m) => m.id === id);
      if (!profile) {
        throw new Error(`Model profile not found: ${id}`);
      }

      const url = resolveModelsListUrl(profile);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        // 统一复用模型客户端的鉴权头构造，避免目录链路与聊天链路漂移。
        const catalogHeaders = buildRequestHeaders(profile);
        const response = await fetch(url, {
          method: "GET",
          headers: catalogHeaders,
          signal: controller.signal,
        });

        if (!response.ok) {
          console.warn(`[model:catalog] provider returned HTTP ${response.status}`);
          return { modelIds: [] };
        }

        const data = await response.json();
        const providerFlavor = resolveProviderFlavor(profile);
        const modelIds = normalizeCatalogPayload(data, profile.provider, providerFlavor);

        return { modelIds };
      } catch (err) {
        console.error("[model:catalog] failed to fetch catalog", err);
        return { modelIds: [] };
      } finally {
        clearTimeout(timeout);
      }
    },
  );

  // Fetch model catalog by raw config (no saved profile needed)
  ipcMain.handle(
    "model:catalog-by-config",
    async (
      _event,
      input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">,
    ): Promise<{ modelIds: ModelCatalogItem[] }> => {
      // Build a temporary profile to resolve URLs
      const tempProfile: ModelProfile = {
        id: "temp-catalog",
        name: "temp",
        provider: input.provider,
        providerFlavor: input.providerFlavor,
        baseUrl: input.baseUrl,
        baseUrlMode: input.baseUrlMode,
        apiKey: input.apiKey,
        model: input.model,
        headers: input.headers,
        requestBody: input.requestBody,
      };

      const url = resolveModelsListUrl(tempProfile);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        const catalogHeaders = buildRequestHeaders(tempProfile);
        const response = await fetch(url, {
          method: "GET",
          headers: catalogHeaders,
          signal: controller.signal,
        });

        if (!response.ok) {
          return { modelIds: [] };
        }

        const data = await response.json();
        const providerFlavor = resolveProviderFlavor(tempProfile);
        const modelIds = normalizeCatalogPayload(data, tempProfile.provider, providerFlavor);

        return { modelIds };
      } catch {
        return { modelIds: [] };
      } finally {
        clearTimeout(timeout);
      }
    },
  );
}

import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";

import type { ModelCatalogItem, ModelProfile, ProviderFlavor } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import {
  saveModelProfile,
  deleteModelProfileFile,
  saveSettings,
} from "../services/state-persistence";
import { resolveModelEndpointUrl } from "../services/model-client";
import { normalizeAnthropicCatalog } from "../services/provider-capability-probers/anthropic";
import { normalizeLocalGatewayCatalog } from "../services/provider-capability-probers/local-gateway";
import { normalizeOllamaCatalog } from "../services/provider-capability-probers/ollama";
import { normalizeOpenAiCompatibleCatalog } from "../services/provider-capability-probers/openai-compatible";
import { normalizeOpenRouterCatalog } from "../services/provider-capability-probers/openrouter";
import { normalizeVercelGatewayCatalog } from "../services/provider-capability-probers/vercel-ai-gateway";

type CreateModelInput = Omit<ModelProfile, "id">;
type UpdateModelInput = Partial<Omit<ModelProfile, "id">>;

// ---------------------------------------------------------------------------
// URL resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the models-list endpoint from a profile's baseUrl.
 *
 * For the chat completions endpoint use resolveModelEndpointUrl (imported
 * from model-client) which applies the full provider-aware logic.
 */
function resolveModelsListUrl(profile: ModelProfile): string {
  // Derive the models list URL from the same API root used for chat.
  // Replace the terminal path segment with /models.
  const chatUrl = resolveModelEndpointUrl(profile);

  // Strip the last path component and replace with /models.
  // e.g. .../v1/chat/completions → .../v1/models
  //      .../v1/messages        → .../v1/models
  const lastSlash = chatUrl.lastIndexOf("/");
  const parentPath = chatUrl.slice(0, lastSlash);
  const parentLastSlash = parentPath.lastIndexOf("/");
  const parentSegment = parentPath.slice(parentLastSlash + 1);

  // If the parent segment is already "v1" or "compatible-mode", go up two
  // levels so we end at the right root (e.g. .../compatible-mode/v1/models).
  // For /chat/completions the parent is /v1 → remove "chat" → /v1/models.
  if (parentSegment === "chat" || parentSegment === "messages") {
    // Go up one more: strip "chat" or "messages" then append /models
    return `${parentPath.slice(0, parentLastSlash)}/models`;
  }

  return `${parentPath}/models`;
}

/**
 * 根据配置推断 provider flavor，优先使用用户显式配置。
 */
export function resolveProviderFlavor(
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
export function normalizeCatalogPayload(
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

  if (provider === "anthropic" || providerFlavor === "anthropic") {
    return normalizeAnthropicCatalog(payload, provider, providerFlavor);
  }

  if (provider === "local-gateway" || providerFlavor === "generic-local-gateway") {
    return normalizeLocalGatewayCatalog(payload, provider, providerFlavor);
  }

  return normalizeOpenAiCompatibleCatalog(payload, provider, providerFlavor);
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

export function registerModelHandlers(ctx: RuntimeContext): void {

  // List all model profiles
  ipcMain.handle("model:list", async (): Promise<ModelProfile[]> => {
    return [...ctx.state.models];
  });

  // Create a new model profile
  ipcMain.handle("model:create", async (_event, input: CreateModelInput): Promise<ModelProfile> => {
    const { id: _discardId, ...safeInput } = input as ModelProfile;
    const profile: ModelProfile = {
      ...safeInput,
      id: randomUUID(),
    };
    ctx.state.models.push(profile);

    // If this is the first model, auto-set it as default
    if (ctx.state.models.length === 1 || !ctx.state.getDefaultModelProfileId()) {
      ctx.state.setDefaultModelProfileId(profile.id);
      saveSettings(ctx.runtime.paths, {
        defaultModelProfileId: profile.id,
        approvalPolicy: ctx.state.getApprovals(),
      }).catch((err) => {
        console.error("[model:create] failed to persist default model setting", err);
      });
    }

    // Persist to disk — await to guarantee file written before returning
    await saveModelProfile(ctx.runtime.paths, profile);

    return profile;
  });

  // Update an existing model profile
  ipcMain.handle(
    "model:update",
    async (_event, id: string, updates: UpdateModelInput): Promise<ModelProfile> => {
      const index = ctx.state.models.findIndex((m) => m.id === id);
      if (index === -1) {
        throw new Error(`Model profile not found: ${id}`);
      }
      const updated: ModelProfile = { ...ctx.state.models[index], ...updates, id };
      ctx.state.models[index] = updated;

      await saveModelProfile(ctx.runtime.paths, updated);

      return updated;
    },
  );

  // Delete a model profile
  ipcMain.handle("model:delete", async (_event, id: string) => {
    const index = ctx.state.models.findIndex((m) => m.id === id);
    if (index === -1) {
      return { models: [...ctx.state.models], defaultModelProfileId: ctx.state.getDefaultModelProfileId(), sessions: ctx.state.sessions };
    }
    ctx.state.models.splice(index, 1);

    // If the deleted model was the default, pick next available and persist
    const currentDefault = ctx.state.getDefaultModelProfileId();
    if (currentDefault === id || currentDefault === null) {
      const nextDefaultId = ctx.state.models[0]?.id ?? null;
      ctx.state.setDefaultModelProfileId(nextDefaultId);
      saveSettings(ctx.runtime.paths, {
        defaultModelProfileId: nextDefaultId,
        approvalPolicy: ctx.state.getApprovals(),
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

  // Set the default model profile ID
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
    ): Promise<{ success: boolean; ok: boolean; latencyMs?: number; error?: string }> => {
      const profile = ctx.state.models.find((m) => m.id === id);
      if (!profile) {
        return { success: false, ok: false, error: `Model profile not found: ${id}` };
      }

      const url = resolveModelEndpointUrl(profile);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const startTime = Date.now();

      // Build provider-specific headers for the connectivity probe.
      const testHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...(profile.provider === "anthropic"
          ? { "x-api-key": profile.apiKey, "anthropic-version": "2023-06-01" }
          : { Authorization: `Bearer ${profile.apiKey}` }),
        ...(profile.headers ?? {}),
      };

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
        // Use provider-appropriate auth headers.
        const catalogHeaders: Record<string, string> = {
          ...(profile.provider === "anthropic"
            ? { "x-api-key": profile.apiKey, "anthropic-version": "2023-06-01" }
            : { Authorization: `Bearer ${profile.apiKey}` }),
          ...(profile.headers ?? {}),
        };
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
        const catalogHeaders: Record<string, string> = {
          ...(tempProfile.provider === "anthropic"
            ? { "x-api-key": tempProfile.apiKey, "anthropic-version": "2023-06-01" }
            : { Authorization: `Bearer ${tempProfile.apiKey}` }),
          ...(tempProfile.headers ?? {}),
        };
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

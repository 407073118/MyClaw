import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import type { JsonValue, ModelCatalogItem, ModelProfile, ModelRouteProbeResult, ProtocolTarget, ProviderKind } from "@shared/contracts";
import {
  BR_MINIMAX_BASE_URL,
  BR_MINIMAX_DEFAULT_NAME,
  BR_MINIMAX_MODEL,
  BR_MINIMAX_PROVIDER_FLAVOR,
  BR_MINIMAX_REQUEST_BODY,
  createBrMiniMaxProfile,
  isBrMiniMaxProfile,
  readBrMiniMaxRuntimeDiagnostics,
} from "@shared/br-minimax";
import { resolveModelCapability } from "../../main/services/model-capability-resolver";
import { resolveNativeFileSearchConfig } from "../../main/services/model-runtime/tool-middleware";
import { formatTokenCount, formatCapabilitySource } from "../utils/context-ui-helpers";

// ── 供应商预设（从旧设置页内联迁移） ─────────────────────────────────────────

type ProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
  baseUrlMode: "provider-root" | "manual";
  provider: ProviderKind;
  providerFlavor?: ModelProfile["providerFlavor"];
};

const providerPresets: ProviderPreset[] = [
  { id: "br-minimax", label: "BR MiniMax", baseUrl: BR_MINIMAX_BASE_URL, baseUrlMode: "provider-root", provider: "openai-compatible", providerFlavor: BR_MINIMAX_PROVIDER_FLAVOR },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com", baseUrlMode: "provider-root", provider: "openai-compatible" },
  { id: "minimax", label: "MiniMax", baseUrl: "https://api.minimaxi.com", baseUrlMode: "provider-root", provider: "openai-compatible" },
  { id: "moonshot", label: "Moonshot", baseUrl: "https://api.moonshot.cn", baseUrlMode: "provider-root", provider: "openai-compatible" },
  { id: "qwen", label: "Qwen", baseUrl: "https://dashscope.aliyuncs.com", baseUrlMode: "provider-root", provider: "openai-compatible" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", baseUrlMode: "provider-root", provider: "openai-compatible", providerFlavor: "deepseek" },
  { id: "volcengine-ark", label: "火山引擎 (Ark)", baseUrl: "https://ark.cn-beijing.volces.com", baseUrlMode: "provider-root", provider: "openai-compatible", providerFlavor: "volcengine-ark" },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com", baseUrlMode: "provider-root", provider: "anthropic" },
  { id: "custom", label: "Custom", baseUrl: "", baseUrlMode: "manual", provider: "openai-compatible" },
];

/** 将协议路线转成人类可读标签，供推荐与详情面板复用。 */
function formatProtocolTargetLabel(target: ProtocolTarget): string {
  if (target === "openai-responses") return "OpenAI Responses";
  if (target === "anthropic-messages") return "Anthropic Messages";
  return "OpenAI Compatible";
}

/** 根据模型配置推断应该命中的供应商预设。 */
function resolveProviderPresetId(profile: Pick<ModelProfile, "provider" | "baseUrl" | "model">): string {
  if (isBrMiniMaxProfile({ ...profile, providerFlavor: (profile as ModelProfile).providerFlavor })) return "br-minimax";
  const normalizedBaseUrl = profile.baseUrl.trim().toLowerCase();
  const normalizedModel = profile.model.trim().toLowerCase();

  if (normalizedBaseUrl.includes("minimax") || normalizedBaseUrl.includes("minimaxi") || normalizedModel.startsWith("minimax")) return "minimax";
  if (profile.provider === "anthropic" || normalizedBaseUrl.includes("anthropic")) return "anthropic";
  if (normalizedBaseUrl.includes("dashscope.aliyuncs.com") || normalizedModel.startsWith("qwen")) return "qwen";
  if (normalizedBaseUrl.includes("moonshot")) return "moonshot";
  if (normalizedBaseUrl.includes("openai.com")) return "openai";
  if (normalizedBaseUrl.includes("volces.com") || normalizedBaseUrl.includes("volcengine")) return "volcengine-ark";
  return "custom";
}

/** 将结构化输入里的向量库 ID 清洗成稳定数组。 */
function parseVectorStoreIdsInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** 从 profile 中回填原生 file search 表单，兼容 responsesApiConfig 与旧 requestBody。 */
function resolveInitialFileSearchForm(profile: Pick<ModelProfile, "responsesApiConfig" | "requestBody">): {
  enabled: boolean;
  vectorStoresText: string;
  maxNumResultsText: string;
  includeSearchResults: boolean;
} {
  const config = resolveNativeFileSearchConfig(profile);
  return {
    enabled: !!config && config.vectorStoreIds.length > 0,
    vectorStoresText: config?.vectorStoreIds.join(", ") ?? "",
    maxNumResultsText: typeof config?.maxNumResults === "number" ? String(config.maxNumResults) : "",
    includeSearchResults: config?.includeSearchResults ?? false,
  };
}

/** 移除高级 JSON 中与结构化 file search 重复的字段，避免两套配置互相覆盖。 */
function stripStructuredFileSearchKeys(parsedBody: Record<string, JsonValue>): Record<string, JsonValue> {
  const nextBody = { ...parsedBody };
  delete nextBody.nativeFileSearch;
  delete nextBody.fileSearch;
  delete nextBody.file_search;
  return nextBody;
}

// ── ModelDetailPage 页面 ─────────────────────────────────────────────────────

/** 创建或编辑单个模型配置，并支持拉取可用模型列表。 */
export default function ModelDetailPage() {
  const { id: profileId } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useWorkspaceStore();

  const isNew = !profileId || location.pathname === "/settings/models/new";

  const [profile, setProfile] = useState<ModelProfile>({
    id: "",
    ...createBrMiniMaxProfile({ apiKey: "" }),
  });
  const [selectedPresetId, setSelectedPresetId] = useState("br-minimax");
  const [headersText, setHeadersText] = useState("");
  const [requestBodyText, setRequestBodyText] = useState("");
  const [nativeFileSearchEnabled, setNativeFileSearchEnabled] = useState(false);
  const [nativeFileSearchVectorStoresText, setNativeFileSearchVectorStoresText] = useState("");
  const [nativeFileSearchMaxResultsText, setNativeFileSearchMaxResultsText] = useState("");
  const [nativeFileSearchIncludeResults, setNativeFileSearchIncludeResults] = useState(false);
  const [defaultReasoningEffortValue, setDefaultReasoningEffortValue] = useState<"" | "low" | "medium" | "high" | "xhigh">("");
  const [contextWindowOverrideText, setContextWindowOverrideText] = useState("");
  const [maxOutputTokensOverrideText, setMaxOutputTokensOverrideText] = useState("");
  const [compactTriggerTokensText, setCompactTriggerTokensText] = useState("");
  const [disableResponseStorageEnabled, setDisableResponseStorageEnabled] = useState(false);
  const [useServerStateEnabled, setUseServerStateEnabled] = useState(false);
  const [backgroundModeValue, setBackgroundModeValue] = useState<"" | "off" | "auto" | "always">("");
  const [backgroundPollIntervalText, setBackgroundPollIntervalText] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState("");
  const [catalogItems, setCatalogItems] = useState<ModelCatalogItem[]>([]);
  const [availableModelIds, setAvailableModelIds] = useState<string[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);
  const [routeProbeResult, setRouteProbeResult] = useState<ModelRouteProbeResult | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<ProtocolTarget | null>(null);
  const [routeSelectionSource, setRouteSelectionSource] = useState<"manual" | "probe-recommended" | "saved" | "auto-probe-on-save" | null>(null);
  const [isProbingRoutes, setIsProbingRoutes] = useState(false);
  const [routeProbeError, setRouteProbeError] = useState("");
  const [routeStatusMessage, setRouteStatusMessage] = useState("");
  const [showRouteDetails, setShowRouteDetails] = useState(false);

  const managedBrMiniMax = selectedPresetId === "br-minimax";
  const supportsStructuredFileSearch = !managedBrMiniMax && profile.provider === "openai-compatible";
  const brMiniMaxDiagnostics = readBrMiniMaxRuntimeDiagnostics(profile);
  const requiresModelBeforeProbe = !profile.model.trim();
  const baseUrlPlaceholder = profile.baseUrlMode === "provider-root"
    ? BR_MINIMAX_BASE_URL
    : "https://gateway.example.com/v1";

  const baseUrlHint = managedBrMiniMax
    ? "BR MiniMax 企业私有部署，预设值通常无需修改，如有自定义网关可在此调整。"
    : profile.baseUrlMode === "provider-root"
    ? "当前预设只需填写服务根地址，系统会自动补全对应厂商接口路径。"
    : "Custom 模式需要填写完整兼容地址，例如 https://gateway.example.com/v1。";

  /** 根据当前预设回填 provider、baseUrl 和默认名称。 */
  function applyPreset(presetId?: string) {
    const id = presetId ?? selectedPresetId;
    const preset = providerPresets.find((p) => p.id === id);
    if (preset) {
      setProfile((prev) => ({
        ...prev,
        provider: preset.provider,
        providerFlavor: preset.providerFlavor,
        vendorFamily: undefined,
        deploymentProfile: undefined,
        baseUrl: preset.baseUrl,
        baseUrlMode: preset.baseUrlMode,
        discoveredCapabilities: null,
        budgetPolicy: preset.id === "br-minimax" ? prev.budgetPolicy : undefined,
        ...(preset.id === "br-minimax"
          ? createBrMiniMaxProfile({ apiKey: prev.apiKey.trim() })
          : { model: "", ...(isNew ? { name: `New ${preset.label} Config` } : {}) }),
      }));
      if (preset.id === "br-minimax") {
        setHeadersText("");
        setRequestBodyText(JSON.stringify(BR_MINIMAX_REQUEST_BODY, null, 2));
        setNativeFileSearchEnabled(false);
        setNativeFileSearchVectorStoresText("");
        setNativeFileSearchMaxResultsText("");
        setNativeFileSearchIncludeResults(false);
      } else {
        setHeadersText("");
        setRequestBodyText("");
        setNativeFileSearchEnabled(false);
        setNativeFileSearchVectorStoresText("");
        setNativeFileSearchMaxResultsText("");
        setNativeFileSearchIncludeResults(false);
      }
      setCatalogItems([]);
      setAvailableModelIds([]);
      setModelCatalogError("");
      setRouteProbeResult(null);
      setSelectedRoute(null);
      setRouteSelectionSource(null);
      setRouteProbeError("");
      setRouteStatusMessage("");
      setShowRouteDetails(false);
    }
  }

  /** 当关键连接字段变化时，使现有路线探测与选择结果失效，避免旧结果污染新配置。 */
  function invalidateRouteState() {
    const hadRouteState = !!routeProbeResult || !!selectedRoute || !!routeSelectionSource;
    setRouteProbeResult(null);
    setSelectedRoute(null);
    setRouteSelectionSource(null);
    setRouteProbeError("");
    setShowRouteDetails(false);
    if (hadRouteState) {
      setRouteStatusMessage("模型配置已变更，请重新执行路线探测。");
    } else {
      setRouteStatusMessage("");
    }
  }

  useEffect(() => {
    if (!isNew) {
      const existing = workspace.models.find((m) => m.id === profileId);
      if (existing) {
        setProfile({ ...existing });
        setHeadersText(existing.headers ? JSON.stringify(existing.headers, null, 2) : "");
        setRequestBodyText(existing.requestBody ? JSON.stringify(existing.requestBody, null, 2) : "");
        const initialFileSearch = resolveInitialFileSearchForm(existing);
        setNativeFileSearchEnabled(initialFileSearch.enabled);
        setNativeFileSearchVectorStoresText(initialFileSearch.vectorStoresText);
        setNativeFileSearchMaxResultsText(initialFileSearch.maxNumResultsText);
        setNativeFileSearchIncludeResults(initialFileSearch.includeSearchResults);
        setDefaultReasoningEffortValue(existing.defaultReasoningEffort ?? "");
        setContextWindowOverrideText(
          typeof existing.contextWindowOverride === "number" ? String(existing.contextWindowOverride) : "",
        );
        setMaxOutputTokensOverrideText(
          typeof existing.capabilityOverrides?.maxOutputTokens === "number"
            ? String(existing.capabilityOverrides.maxOutputTokens)
            : "",
        );
        setCompactTriggerTokensText(
          typeof existing.compactTriggerTokens === "number" ? String(existing.compactTriggerTokens) : "",
        );
        setDisableResponseStorageEnabled(existing.responsesApiConfig?.disableResponseStorage ?? false);
        setUseServerStateEnabled(existing.responsesApiConfig?.useServerState ?? false);
        setBackgroundModeValue(existing.responsesApiConfig?.backgroundMode ?? "");
        setBackgroundPollIntervalText(
          typeof existing.responsesApiConfig?.backgroundPollIntervalMs === "number"
            ? String(existing.responsesApiConfig.backgroundPollIntervalMs)
            : "",
        );
        const presetId = resolveProviderPresetId(existing);
        setSelectedPresetId(presetId);
        setSelectedRoute(existing.protocolTarget ?? null);
        setRouteSelectionSource(existing.protocolTarget ? "saved" : null);
      } else {
        navigate("/settings");
      }
    } else {
      setDefaultReasoningEffortValue("");
      setContextWindowOverrideText("");
      setMaxOutputTokensOverrideText("");
      setCompactTriggerTokensText("");
      setDisableResponseStorageEnabled(false);
      setUseServerStateEnabled(false);
      setBackgroundModeValue("");
      setBackgroundPollIntervalText("");
      applyPreset("br-minimax");
    }
  }, [isNew, profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 把下拉中选中的模型 ID 回填到表单。 */
  function applySelectedModelId(event: React.ChangeEvent<HTMLSelectElement>) {
    invalidateRouteState();
    setProfile((prev) => ({ ...prev, model: event.target.value }));
  }

  /** 返回设置页。 */
  function handleBack() {
    navigate("/settings");
  }

  /** 删除当前模型配置。 */
  async function handleDelete() {
    if (!window.confirm("确定要删除此模型配置吗？")) return;
    setIsBusy(true);
    try {
      await workspace.deleteModelProfile(profile.id);
      navigate("/settings");
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setIsBusy(false);
    }
  }

  /** 解析当前表单中的可编辑负载，统一供探测、联通测试和保存逻辑复用。 */
  function parseEditablePayload(): {
    parsedHeaders: Record<string, string>;
    parsedBody: Record<string, JsonValue>;
  } | null {
    try {
      return {
        parsedHeaders: headersText.trim() ? JSON.parse(headersText) : {},
        parsedBody: requestBodyText.trim() ? JSON.parse(requestBodyText) as Record<string, JsonValue> : {},
      };
    } catch {
      setError("JSON 格式不正确，请检阅 Headers 或 RequestBody 字段。");
      return null;
    }
  }

  /** 组装路线探测所需的即时配置。 */
  function buildProbeInput(parsedHeaders: Record<string, string>, parsedBody: Record<string, JsonValue>) {
    return {
      provider: profile.provider,
      providerFlavor: profile.providerFlavor,
      baseUrl: profile.baseUrl.trim(),
      baseUrlMode: profile.baseUrlMode,
      apiKey: profile.apiKey.trim(),
      model: profile.model.trim() || (managedBrMiniMax ? BR_MINIMAX_MODEL : ""),
      headers: parsedHeaders,
      requestBody: managedBrMiniMax ? BR_MINIMAX_REQUEST_BODY : parsedBody,
    };
  }

  /** 从当前 catalog 结果中提取已选模型的能力字段，写回 profile 供后续页面复用。 */
  function resolveSelectedCatalogCapability(modelId: string): ModelProfile["discoveredCapabilities"] {
    const selectedItem = catalogItems.find((item) => item.id === modelId);
    if (!selectedItem) {
      return profile.discoveredCapabilities ?? null;
    }

    return {
      contextWindowTokens: selectedItem.contextWindowTokens,
      maxInputTokens: selectedItem.maxInputTokens,
      maxOutputTokens: selectedItem.maxOutputTokens,
      supportsTools: selectedItem.supportsTools,
      supportsStreaming: selectedItem.supportsStreaming,
      source: selectedItem.source ?? "provider-catalog",
    };
  }

  /** 将页面内部的路线来源状态映射为持久化的合同字段。 */
  function resolvePersistedProtocolSelectionSource(
    source: typeof routeSelectionSource,
  ): ModelProfile["protocolSelectionSource"] {
    if (source === "manual" || source === "saved") {
      return "saved";
    }
    if (source === "probe-recommended" || source === "auto-probe-on-save") {
      return "probe";
    }
    return "registry-default";
  }

  /** 将结构化 file search 表单折叠回 profile.responsesApiConfig。 */
  function resolveResponsesApiConfigFromForm(): ModelProfile["responsesApiConfig"] {
    const nextConfig: NonNullable<ModelProfile["responsesApiConfig"]> = {
      ...(profile.responsesApiConfig ?? {}),
      disableResponseStorage: disableResponseStorageEnabled,
      useServerState: useServerStateEnabled,
    };
    if (backgroundModeValue) {
      nextConfig.backgroundMode = backgroundModeValue;
    } else {
      delete nextConfig.backgroundMode;
    }
    if (backgroundPollIntervalText.trim()) {
      nextConfig.backgroundPollIntervalMs = Number.parseInt(backgroundPollIntervalText.trim(), 10);
    } else {
      delete nextConfig.backgroundPollIntervalMs;
    }
    const vectorStoreIds = parseVectorStoreIdsInput(nativeFileSearchVectorStoresText);

    if (nativeFileSearchEnabled && vectorStoreIds.length > 0) {
      const parsedMaxResults = nativeFileSearchMaxResultsText.trim()
        ? Number.parseInt(nativeFileSearchMaxResultsText.trim(), 10)
        : null;
      nextConfig.fileSearch = {
        vectorStoreIds,
        ...(typeof parsedMaxResults === "number" && Number.isFinite(parsedMaxResults) ? { maxNumResults: parsedMaxResults } : {}),
        includeSearchResults: nativeFileSearchIncludeResults,
      };
    } else {
      delete nextConfig.fileSearch;
    }

    return Object.keys(nextConfig).length > 0 ? nextConfig : undefined;
  }

  /** 手动触发路线探测，并把推荐路线同步到本地 UI 状态。 */
  async function probeRoutes(options?: { silent?: boolean }): Promise<ModelRouteProbeResult | null> {
    const parsed = managedBrMiniMax
      ? { parsedHeaders: {}, parsedBody: BR_MINIMAX_REQUEST_BODY as Record<string, JsonValue> }
      : parseEditablePayload();
    if (!parsed) {
      return null;
    }

    const modelId = profile.model.trim() || (managedBrMiniMax ? BR_MINIMAX_MODEL : "");
    if (!modelId) {
      setRouteProbeError("请先选择模型，再进行路线探测。");
      return null;
    }

    setRouteProbeError("");
    if (!options?.silent) {
      setRouteStatusMessage("");
    }
    setIsProbingRoutes(true);

    try {
      const result = await workspace.probeModelRoutes(buildProbeInput(parsed.parsedHeaders, parsed.parsedBody));
      setRouteProbeResult(result);
      setShowRouteDetails(false);

      const keepsExplicitSelection = !!selectedRoute
        && (routeSelectionSource === "manual" || routeSelectionSource === "saved")
        && result.availableProtocolTargets.includes(selectedRoute);

      if (keepsExplicitSelection) {
        setSelectedRoute(selectedRoute);
      } else if (result.recommendedProtocolTarget && routeSelectionSource !== "manual") {
        setSelectedRoute(result.recommendedProtocolTarget);
        setRouteSelectionSource("probe-recommended");
      } else if (selectedRoute && !result.availableProtocolTargets.includes(selectedRoute)) {
        setSelectedRoute(result.recommendedProtocolTarget);
        setRouteSelectionSource(result.recommendedProtocolTarget ? "probe-recommended" : null);
      }

      if (result.availableProtocolTargets.length === 0) {
        setRouteProbeError("未探测到当前模型可用的执行路线，请检查接口、鉴权或服务兼容性。");
      } else if (!options?.silent && result.recommendedProtocolTarget) {
        setRouteStatusMessage(`已完成路线探测，推荐路线：${formatProtocolTargetLabel(result.recommendedProtocolTarget)}`);
      }

      console.info("[model-detail] 路线探测完成", {
        model: modelId,
        recommendedProtocolTarget: result.recommendedProtocolTarget,
        availableProtocolTargets: result.availableProtocolTargets,
      });
      return result;
    } catch (e: unknown) {
      const message = (e as Error)?.message ?? "路线探测失败";
      setRouteProbeError(message);
      console.warn("[model-detail] 路线探测失败", {
        model: modelId,
        error: message,
      });
      return null;
    } finally {
      setIsProbingRoutes(false);
    }
  }

  /** 响应用户手动切换路线，把它标记为当前模型的默认选择。 */
  function handleRouteSelectionChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextRoute = event.target.value as ProtocolTarget;
    setSelectedRoute(nextRoute);
    setRouteSelectionSource("manual");
    setRouteStatusMessage(`已设置默认路线：${formatProtocolTargetLabel(nextRoute)}`);
  }

  /** 新建或更新模型配置，并在创建后设为默认模型。 */
  async function upsertProfile() {
    setError("");
    const parsed = managedBrMiniMax
      ? { parsedHeaders: {}, parsedBody: BR_MINIMAX_REQUEST_BODY as Record<string, JsonValue> }
      : parseEditablePayload();
    if (!parsed) {
      return;
    }

    setIsBusy(true);
    try {
      const vectorStoreIds = parseVectorStoreIdsInput(nativeFileSearchVectorStoresText);
      const parsedContextWindowOverride = contextWindowOverrideText.trim()
        ? Number.parseInt(contextWindowOverrideText.trim(), 10)
        : null;
      const parsedMaxOutputTokensOverride = maxOutputTokensOverrideText.trim()
        ? Number.parseInt(maxOutputTokensOverrideText.trim(), 10)
        : null;
      const parsedCompactTriggerTokens = compactTriggerTokensText.trim()
        ? Number.parseInt(compactTriggerTokensText.trim(), 10)
        : null;
      const parsedBackgroundPollInterval = backgroundPollIntervalText.trim()
        ? Number.parseInt(backgroundPollIntervalText.trim(), 10)
        : null;
      if (!managedBrMiniMax && nativeFileSearchEnabled && vectorStoreIds.length === 0) {
        setError("启用原生 File Search 后，至少需要填写一个 Vector Store ID。");
        return;
      }
      if (!managedBrMiniMax && nativeFileSearchMaxResultsText.trim()) {
        const parsedMaxResults = Number.parseInt(nativeFileSearchMaxResultsText.trim(), 10);
        if (!Number.isFinite(parsedMaxResults) || parsedMaxResults <= 0) {
          setError("File Search 的最大结果数必须是大于 0 的整数。");
          return;
        }
      }
      if (contextWindowOverrideText.trim() && (parsedContextWindowOverride == null || !Number.isFinite(parsedContextWindowOverride) || parsedContextWindowOverride <= 0)) {
        setError("上下文窗口覆盖值必须是大于 0 的整数。");
        return;
      }
      if (maxOutputTokensOverrideText.trim() && (parsedMaxOutputTokensOverride == null || !Number.isFinite(parsedMaxOutputTokensOverride) || parsedMaxOutputTokensOverride <= 0)) {
        setError("最大输出 Tokens 覆盖值必须是大于 0 的整数。");
        return;
      }
      if (compactTriggerTokensText.trim() && (parsedCompactTriggerTokens == null || !Number.isFinite(parsedCompactTriggerTokens) || parsedCompactTriggerTokens <= 0)) {
        setError("自动压缩阈值必须是大于 0 的整数。");
        return;
      }
      if (backgroundPollIntervalText.trim() && (parsedBackgroundPollInterval == null || !Number.isFinite(parsedBackgroundPollInterval) || parsedBackgroundPollInterval <= 0)) {
        setError("后台轮询间隔必须是大于 0 的整数毫秒。");
        return;
      }
      const sanitizedBody = managedBrMiniMax
        ? BR_MINIMAX_REQUEST_BODY
        : stripStructuredFileSearchKeys(parsed.parsedBody);
      const nextCapabilityOverrides = { ...(profile.capabilityOverrides ?? {}) };
      if (typeof parsedMaxOutputTokensOverride === "number" && Number.isFinite(parsedMaxOutputTokensOverride)) {
        nextCapabilityOverrides.maxOutputTokens = parsedMaxOutputTokensOverride;
      } else {
        delete nextCapabilityOverrides.maxOutputTokens;
      }
      const capabilityOverrides = Object.keys(nextCapabilityOverrides).length > 0 ? nextCapabilityOverrides : undefined;
      let finalProtocolTarget = selectedRoute;
      let allAvailableProtocols: ProtocolTarget[] = routeProbeResult?.availableProtocolTargets ?? [];
      let persistedSelectionSource = resolvePersistedProtocolSelectionSource(routeSelectionSource);
      if (!finalProtocolTarget) {
        const probeResult = await probeRoutes({ silent: true });
        finalProtocolTarget = probeResult?.recommendedProtocolTarget ?? null;
        allAvailableProtocols = probeResult?.availableProtocolTargets ?? [];
        if (!finalProtocolTarget) {
          setError("当前模型尚未探测到可用路线，无法保存配置。");
          return;
        }
        setSelectedRoute(finalProtocolTarget);
        setRouteSelectionSource("auto-probe-on-save");
        persistedSelectionSource = "probe";
        setRouteStatusMessage(`已完成路线探测，已为当前模型设置最佳路线：${formatProtocolTargetLabel(finalProtocolTarget)}`);
      }

      // 保存完整的探测可用列表，选中路线排首位，其余作为 fallback 链。
      const savedProtocolPreferences: ProtocolTarget[] | undefined = finalProtocolTarget
        ? [finalProtocolTarget, ...allAvailableProtocols.filter((t) => t !== finalProtocolTarget)]
        : undefined;

      const data: ModelProfile = managedBrMiniMax
        ? {
            ...profile,
            ...createBrMiniMaxProfile({ apiKey: profile.apiKey.trim() }),
            name: profile.name.trim() || BR_MINIMAX_DEFAULT_NAME,
            model: profile.model.trim() || BR_MINIMAX_MODEL,
            baseUrl: profile.baseUrl.trim() || BR_MINIMAX_BASE_URL,
            savedProtocolPreferences: savedProtocolPreferences?.length ? savedProtocolPreferences : undefined,
            protocolSelectionSource: persistedSelectionSource,
            protocolTarget: finalProtocolTarget ?? undefined,
          }
        : {
            ...profile,
            name: profile.name.trim() || "未命名配置",
            baseUrl: profile.baseUrl.trim(),
            baseUrlMode: profile.baseUrlMode,
            apiKey: profile.apiKey.trim(),
            model: profile.model.trim(),
            headers: parsed.parsedHeaders,
            requestBody: sanitizedBody,
            defaultReasoningEffort: defaultReasoningEffortValue || undefined,
            contextWindowOverride: typeof parsedContextWindowOverride === "number" && Number.isFinite(parsedContextWindowOverride)
              ? parsedContextWindowOverride
              : undefined,
            compactTriggerTokens: typeof parsedCompactTriggerTokens === "number" && Number.isFinite(parsedCompactTriggerTokens)
              ? parsedCompactTriggerTokens
              : undefined,
            capabilityOverrides,
            responsesApiConfig: resolveResponsesApiConfigFromForm(),
            discoveredCapabilities: resolveSelectedCatalogCapability(profile.model.trim()),
            savedProtocolPreferences: savedProtocolPreferences?.length ? savedProtocolPreferences : undefined,
            protocolSelectionSource: persistedSelectionSource,
            protocolTarget: finalProtocolTarget ?? undefined,
          };

      if (isNew) {
        const newProfile = await workspace.createModelProfile(data);
        await workspace.setDefaultModelProfile(newProfile.id);
      } else {
        await workspace.updateModelProfile(profile.id, data);
      }
      navigate("/settings", {
        state: {
          modelConfigNotice: `已保存模型配置，默认路线：${formatProtocolTargetLabel(finalProtocolTarget)}`,
          activeTab: "模型",
        },
      });
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setIsBusy(false);
    }
  }

  /** 基于当前表单配置拉取模型目录，并将首个结果回填到模型输入框。 */
  async function loadModelCatalog() {
    const parsed = managedBrMiniMax
      ? { parsedHeaders: {}, parsedBody: BR_MINIMAX_REQUEST_BODY as Record<string, JsonValue> }
      : parseEditablePayload();
    if (!parsed) {
      return;
    }
    setModelCatalogError("");
    setCatalogItems([]);
    setAvailableModelIds([]);
    setIsFetchingModels(true);

    try {
      const items = await workspace.fetchModelCatalog({
        provider: profile.provider,
        providerFlavor: profile.providerFlavor,
        baseUrl: profile.baseUrl.trim(),
        baseUrlMode: profile.baseUrlMode,
        apiKey: profile.apiKey.trim(),
        model: profile.model.trim(),
        headers: parsed.parsedHeaders,
        requestBody: parsed.parsedBody,
      });
      const modelIds = items.map((item) => item.id);

      setCatalogItems(items);
      setAvailableModelIds(modelIds);
      if (!profile.model && modelIds.length > 0) {
        setProfile((prev) => ({ ...prev, model: modelIds[0]! }));
      }
      if (modelIds.length === 0) {
        setModelCatalogError("当前服务未返回可用模型，请确认接口地址、权限与服务商兼容性。");
      }
    } catch (e: unknown) {
      setModelCatalogError((e as Error)?.message ?? "模型列表获取失败");
    } finally {
      setIsFetchingModels(false);
    }
  }

  /** 基于当前表单配置测试服务联通性。 */
  async function testConnectivity() {
    const parsed = managedBrMiniMax
      ? { parsedHeaders: {}, parsedBody: BR_MINIMAX_REQUEST_BODY as Record<string, JsonValue> }
      : parseEditablePayload();
    if (!parsed) {
      return;
    }
    setTestResult(null);
    setIsTesting(true);
    try {
      const result = await window.myClawAPI.testModelByConfig({
        provider: profile.provider,
        providerFlavor: profile.providerFlavor,
        baseUrl: profile.baseUrl.trim(),
        baseUrlMode: profile.baseUrlMode,
        apiKey: profile.apiKey.trim(),
        model: profile.model.trim() || (managedBrMiniMax ? BR_MINIMAX_MODEL : ""),
        headers: parsed.parsedHeaders,
        requestBody: managedBrMiniMax ? BR_MINIMAX_REQUEST_BODY : parsed.parsedBody,
      });
      setTestResult(result);
    } catch (e: unknown) {
      setTestResult({ ok: false, error: (e as Error)?.message ?? "测试失败" });
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <div className="model-detail-layout">
      {/* 紧凑顶部栏 */}
      <header className="detail-topbar">
        <div className="topbar-left">
          <button className="icon-back-btn" onClick={handleBack} title="返回设置">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 12H5M12 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div className="divider" />
          <div className="title-group">
            <span className="eyebrow">{isNew ? "新增模型" : "编辑配置"}</span>
            <h2 className="title">{profile.name || "未命名配置"}</h2>
          </div>
        </div>

        <div className="topbar-right">
          {!isNew && (
            <button className="danger-ghost-btn" onClick={handleDelete} disabled={isBusy}>
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
                />
              </svg>
              删除
            </button>
          )}
          <button className="primary-save-btn" data-testid="model-save-profile" onClick={upsertProfile} disabled={isBusy}>
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8"
              />
            </svg>
            {isBusy ? "保存中..." : "保存配置"}
          </button>
        </div>
      </header>

      <main className="detail-content">
        {error && (
          <div className="error-banner">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        <div className="main-form">
          {/* 基础参数区 */}
          <section className="form-section">
            <div className="section-header">
              <span className="dot-icon" />
              基础参数
            </div>
            <div className="field-grid">
              <label className="field">
                <span className="label">配置名称</span>
                <input
                  value={profile.name}
                  onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={managedBrMiniMax ? BR_MINIMAX_DEFAULT_NAME : "例如：我的 GPT-4o"}
                />
              </label>
              <label className="field">
                <span className="label">服务商预设</span>
                <div className="select-wrapper">
                  <select
                    value={selectedPresetId}
                    data-testid="model-preset-select"
                    onChange={(e) => {
                      setSelectedPresetId(e.target.value);
                      applyPreset(e.target.value);
                    }}
                  >
                    {providerPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <div className="select-arrow">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 9l6 6 6-6"
                      />
                    </svg>
                  </div>
                </div>
              </label>
              <label className="field">
                <span className="label">模型 ID</span>
                <input
                  value={profile.model}
                  onChange={(e) => {
                    invalidateRouteState();
                    setProfile((prev) => ({ ...prev, model: e.target.value }));
                  }}
                  data-testid="model-id-input"
                  placeholder="gpt-4o, claude-3-5-sonnet..."
                />
                {availableModelIds.length > 0 && (
                  <div className="field-inline">
                    <div className="select-wrapper">
                      <select
                        value={profile.model}
                        data-testid="model-id-select"
                        onChange={applySelectedModelId}
                      >
                        {availableModelIds.map((modelId) => (
                          <option key={modelId} value={modelId}>
                            {modelId}
                          </option>
                        ))}
                      </select>
                      <div className="select-arrow">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                          <path
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 9l6 6 6-6"
                          />
                        </svg>
                      </div>
                    </div>
                  </div>
                )}
                {catalogItems.length > 0 && (
                  <div className="catalog-preview-list">
                    {catalogItems.slice(0, 3).map((item) => (
                      <div key={item.id} className="catalog-preview-card">
                        <div className="catalog-preview-title-row">
                          <strong>{item.name || item.id}</strong>
                          {item.contextWindowTokens && (
                            <span className="catalog-preview-badge">{formatTokenCount(item.contextWindowTokens)}</span>
                          )}
                        </div>
                        <div className="catalog-preview-meta">{item.id}</div>
                        <div className="catalog-preview-tags">
                          {item.supportsTools && <span className="catalog-tag">工具调用</span>}
                          {item.supportsStreaming && <span className="catalog-tag">流式输出</span>}
                          {item.protocolTarget && <span className="catalog-tag">{formatProtocolTargetLabel(item.protocolTarget)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </label>
              <label className="field">
                <span className="label">接口地址 (Base URL)</span>
                <input
                  value={profile.baseUrl}
                  onChange={(e) => {
                    invalidateRouteState();
                    setProfile((prev) => ({ ...prev, baseUrl: e.target.value }));
                  }}
                  data-testid="model-base-url-input"
                  placeholder={baseUrlPlaceholder}
                />
                <input
                  type="hidden"
                  value={profile.baseUrlMode ?? "manual"}
                  data-testid="model-base-url-mode"
                  readOnly
                />
                <div className="field-hint">{baseUrlHint}</div>
              </label>
              <label className="field full-width">
                <span className="label">API Key / Token</span>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={profile.apiKey}
                    onChange={(e) => {
                      invalidateRouteState();
                      setProfile((prev) => ({ ...prev, apiKey: e.target.value }));
                    }}
                    data-testid="model-api-key-input"
                    placeholder="sk-..."
                  />
                  <button
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowPassword((v) => !v)}
                    title={showPassword ? "隐藏" : "显示"}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" width="16" height="16">
                        <path
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"
                        />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="16" height="16">
                        <path
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                        />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="field-inline">
                  <button
                    type="button"
                    className="secondary-action-btn"
                    data-testid="model-test-connectivity"
                    disabled={isTesting}
                    onClick={testConnectivity}
                  >
                    {isTesting ? "测试中..." : "测试联通"}
                  </button>
                  <button
                    type="button"
                    className="secondary-action-btn"
                    data-testid="model-fetch-list"
                    disabled={isFetchingModels}
                    onClick={loadModelCatalog}
                  >
                    {isFetchingModels ? "加载中..." : "获取模型列表"}
                  </button>
                  <button
                    type="button"
                    className="secondary-action-btn"
                    data-testid="model-probe-routes"
                    disabled={isProbingRoutes || (!managedBrMiniMax && !profile.model.trim())}
                    onClick={() => {
                      void probeRoutes();
                    }}
                  >
                    {isProbingRoutes ? "探测中..." : "探测路线"}
                  </button>
                </div>
                {requiresModelBeforeProbe && (
                  <div className="field-hint">请先选择模型，再进行路线探测。</div>
                )}
                {testResult && (
                  <div className={`field-hint ${testResult.ok ? "success-hint" : "error-hint"}`}>
                    {testResult.ok
                      ? `联通成功${testResult.latencyMs != null ? ` (${testResult.latencyMs}ms)` : ""}`
                      : `联通失败：${testResult.error ?? "未知错误"}`}
                  </div>
                )}
                {modelCatalogError && (
                  <div className="field-hint error-hint">{modelCatalogError}</div>
                )}
                {routeStatusMessage && (
                  <div className="field-hint success-hint">{routeStatusMessage}</div>
                )}
                {routeProbeError && (
                  <div className="field-hint error-hint">{routeProbeError}</div>
                )}
                {(routeProbeResult || selectedRoute) && (
                  <div className="route-diagnostics-card">
                    <div className="route-diagnostics-header">
                      <div className="route-diagnostics-copy">
                        <span className="route-diagnostics-label">执行路线</span>
                        {(routeSelectionSource === "saved" || routeSelectionSource === "manual") && selectedRoute && (
                          <span className="route-recommendation">
                            当前已保存路线：{formatProtocolTargetLabel(selectedRoute)}
                          </span>
                        )}
                        {routeProbeResult?.recommendedProtocolTarget && (
                          <span className="route-recommendation">
                            推荐路线：{formatProtocolTargetLabel(routeProbeResult.recommendedProtocolTarget)}
                          </span>
                        )}
                        {!routeProbeResult?.recommendedProtocolTarget && selectedRoute && routeSelectionSource !== "saved" && routeSelectionSource !== "manual" && (
                          <span className="route-recommendation">
                            当前已保存路线：{formatProtocolTargetLabel(selectedRoute)}
                          </span>
                        )}
                      </div>
                      {routeProbeResult && (
                        <button
                          type="button"
                          className="route-detail-btn"
                          aria-label="查看路线详情"
                          aria-expanded={showRouteDetails}
                          aria-controls="route-details-panel"
                          onClick={() => setShowRouteDetails((prev) => !prev)}
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14">
                            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
                            <line x1="12" y1="10" x2="12" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            <line x1="12" y1="7" x2="12.01" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <label className="field">
                      <span className="label">执行路线</span>
                      <div className="select-wrapper">
                        <select
                          aria-label="执行路线"
                          value={selectedRoute ?? ""}
                          onChange={handleRouteSelectionChange}
                        >
                          {(routeProbeResult?.availableProtocolTargets ?? (selectedRoute ? [selectedRoute] : []))
                            .map((route) => (
                              <option key={route} value={route}>
                                {formatProtocolTargetLabel(route)}
                              </option>
                            ))}
                        </select>
                        <div className="select-arrow">
                          <svg viewBox="0 0 24 24" width="16" height="16">
                            <path
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 9l6 6 6-6"
                            />
                          </svg>
                        </div>
                      </div>
                      {!routeProbeResult && selectedRoute && (
                        <div className="field-hint">如需切换到其他路线，请先重新执行路线探测。</div>
                      )}
                    </label>
                    {routeProbeResult && showRouteDetails && (
                      <div id="route-details-panel" className="route-details-panel">
                        {routeProbeResult.entries.map((entry) => (
                          <div key={entry.protocolTarget} className="route-detail-row">
                            <div className="route-detail-main">
                              <div className="route-detail-title-line">
                                <span className="route-detail-title">{formatProtocolTargetLabel(entry.protocolTarget)}</span>
                                <span className={`route-status-pill ${entry.ok ? "status-ok" : "status-fail"}`}>
                                  {entry.ok ? "可用" : "不可用"}
                                </span>
                                {routeProbeResult.recommendedProtocolTarget === entry.protocolTarget && entry.ok && (
                                  <span className="route-status-pill status-recommended">推荐</span>
                                )}
                              </div>
                              {entry.notes?.map((note) => (
                                <div key={`${entry.protocolTarget}-${note}`} className="route-detail-note">
                                  {note}
                                </div>
                              ))}
                              {entry.reason && (
                                <div className="route-detail-error">{entry.reason}</div>
                              )}
                            </div>
                            <div className="route-detail-latency">
                              {entry.latencyMs != null ? `${entry.latencyMs}ms` : "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </label>
            </div>
          </section>

          {/* 高级参数区 */}
          <section className="form-section flex-fill">
            <div className="section-header">
              <span className="dot-icon blue" />
              {managedBrMiniMax ? "托管参数" : "高级负载 (JSON)"}
            </div>
            {managedBrMiniMax ? (
              <div className="managed-profile-card">
                <div className="managed-kv-grid">
                  <div className="managed-kv">
                    <span className="managed-kv-label">模型 ID</span>
                    <span className="managed-kv-value mono">{BR_MINIMAX_MODEL}</span>
                  </div>
                  <div className="managed-kv">
                    <span className="managed-kv-label">固定网关</span>
                    <span className="managed-kv-value mono">{BR_MINIMAX_BASE_URL}</span>
                  </div>
                  <div className="managed-kv">
                    <span className="managed-kv-label">Thinking</span>
                    <span className="managed-kv-value">默认开启，运行时兼容降级</span>
                  </div>
                  <div className="managed-kv">
                    <span className="managed-kv-label">Thinking 路径</span>
                    <span className={`managed-kv-value managed-status ${brMiniMaxDiagnostics.thinkingPath === "unverified" ? "status-pending" : "status-ok"}`}>
                      {brMiniMaxDiagnostics.thinkingPath}
                    </span>
                  </div>
                  <div className="managed-kv">
                    <span className="managed-kv-label">验证状态</span>
                    <span className={`managed-kv-value managed-status ${brMiniMaxDiagnostics.lastCheckedAt ? "status-ok" : "status-pending"}`}>
                      {brMiniMaxDiagnostics.lastCheckedAt ? "已验证" : "待验证"}
                    </span>
                  </div>
                </div>
                <div className="managed-params-block">
                  <span className="managed-params-title">推荐参数</span>
                  <div className="managed-param-tags">
                    <span className="managed-param-tag">temperature=1.0</span>
                    <span className="managed-param-tag">top_p=0.95</span>
                    <span className="managed-param-tag">top_k=40</span>
                    <span className="managed-param-tag">enable_thinking=true</span>
                  </div>
                </div>
                <div className="managed-params-block">
                  <span className="managed-params-title">RequestBody</span>
                  <pre className="managed-json">{JSON.stringify(BR_MINIMAX_REQUEST_BODY, null, 2)}</pre>
                </div>
              </div>
            ) : (
            <div className="editor-row">
              <div className="native-tool-card">
                <div className="native-tool-card-header">
                  <div>
                    <div className="label">模型级高级参数</div>
                    <div className="field-hint">
                      这里维护默认推理强度、上下文/输出覆盖、压缩阈值，以及 Responses API 的存储与后台执行参数。
                    </div>
                  </div>
                </div>
                <div className="compact-field-grid">
                  <label className="field">
                    <span className="label">默认推理强度</span>
                    <div className="select-wrapper">
                      <select
                        value={defaultReasoningEffortValue}
                        data-testid="model-default-reasoning-effort"
                        onChange={(e) => setDefaultReasoningEffortValue(e.target.value as typeof defaultReasoningEffortValue)}
                      >
                        <option value="">跟随会话 / 模型默认</option>
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                        <option value="xhigh">xhigh</option>
                      </select>
                      <div className="select-arrow">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                          <path
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 9l6 6 6-6"
                          />
                        </svg>
                      </div>
                    </div>
                    <div className="field-hint">会话未显式指定时，运行时会回退到这个默认值。</div>
                  </label>
                  <label className="field">
                    <span className="label">上下文窗口覆盖</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={contextWindowOverrideText}
                      data-testid="model-context-window-override"
                      onChange={(e) => setContextWindowOverrideText(e.target.value)}
                      placeholder="1000000"
                    />
                    <div className="field-hint">留空时使用能力目录或服务商探测结果。</div>
                  </label>
                  <label className="field">
                    <span className="label">最大输出 Tokens 覆盖</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={maxOutputTokensOverrideText}
                      data-testid="model-max-output-tokens-override"
                      onChange={(e) => setMaxOutputTokensOverrideText(e.target.value)}
                      placeholder="32768"
                    />
                    <div className="field-hint">写入 `capabilityOverrides.maxOutputTokens`。</div>
                  </label>
                  <label className="field">
                    <span className="label">自动压缩触发阈值</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={compactTriggerTokensText}
                      data-testid="model-compact-trigger-tokens"
                      onChange={(e) => setCompactTriggerTokensText(e.target.value)}
                      placeholder="900000"
                    />
                    <div className="field-hint">达到阈值后优先触发上下文压缩，而不是继续堆积历史消息。</div>
                  </label>
                  <label className="field">
                    <span className="label">Responses 后台模式</span>
                    <div className="select-wrapper">
                      <select
                        value={backgroundModeValue}
                        data-testid="model-background-mode"
                        onChange={(e) => setBackgroundModeValue(e.target.value as typeof backgroundModeValue)}
                      >
                        <option value="">默认 / 自动判断</option>
                        <option value="off">off</option>
                        <option value="auto">auto</option>
                        <option value="always">always</option>
                      </select>
                      <div className="select-arrow">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                          <path
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 9l6 6 6-6"
                          />
                        </svg>
                      </div>
                    </div>
                    <div className="field-hint">仅对 `openai-responses` 路线生效。</div>
                  </label>
                  <label className="field">
                    <span className="label">后台轮询间隔 (ms)</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={backgroundPollIntervalText}
                      data-testid="model-background-poll-interval"
                      onChange={(e) => setBackgroundPollIntervalText(e.target.value)}
                      placeholder="4500"
                    />
                    <div className="field-hint">留空时使用运行时默认值。</div>
                  </label>
                </div>
                <div className="compact-field-grid">
                  <label className="inline-toggle checkbox-label">
                    <input
                      type="checkbox"
                      checked={disableResponseStorageEnabled}
                      data-testid="model-disable-response-storage"
                      onChange={(e) => setDisableResponseStorageEnabled(e.target.checked)}
                    />
                    <span>禁用 Responses 服务端存储 (`store=false`)</span>
                  </label>
                  <label className="inline-toggle checkbox-label">
                    <input
                      type="checkbox"
                      checked={useServerStateEnabled}
                      data-testid="model-use-server-state"
                      onChange={(e) => setUseServerStateEnabled(e.target.checked)}
                    />
                    <span>启用服务端状态连续体 (`previous_response_id`)</span>
                  </label>
                </div>
              </div>
              {supportsStructuredFileSearch && (
                <div className="native-tool-card">
                  <div className="native-tool-card-header">
                    <div>
                      <div className="label">OpenAI 原生 File Search</div>
                      <div className="field-hint">
                        用结构化表单维护向量库检索参数，保存时会自动写入 `responsesApiConfig.fileSearch`。
                      </div>
                    </div>
                    <label className="inline-toggle">
                      <input
                        type="checkbox"
                        checked={nativeFileSearchEnabled}
                        data-testid="native-file-search-enabled"
                        onChange={(e) => {
                          invalidateRouteState();
                          setNativeFileSearchEnabled(e.target.checked);
                        }}
                      />
                      <span>启用</span>
                    </label>
                  </div>
                  <div className="compact-field-grid">
                    <label className="field">
                      <span className="label">Vector Store IDs</span>
                      <input
                        value={nativeFileSearchVectorStoresText}
                        data-testid="native-file-search-vector-stores"
                        onChange={(e) => {
                          invalidateRouteState();
                          setNativeFileSearchVectorStoresText(e.target.value);
                        }}
                        placeholder="vs_knowledge, vs_docs"
                      />
                      <div className="field-hint">多个 ID 用英文逗号或换行分隔。</div>
                    </label>
                    <label className="field">
                      <span className="label">最大结果数</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={nativeFileSearchMaxResultsText}
                        data-testid="native-file-search-max-results"
                        onChange={(e) => {
                          invalidateRouteState();
                          setNativeFileSearchMaxResultsText(e.target.value);
                        }}
                        placeholder="8"
                      />
                      <div className="field-hint">留空时沿用 OpenAI 默认值。</div>
                    </label>
                  </div>
                  <label className="inline-toggle checkbox-label">
                    <input
                      type="checkbox"
                      checked={nativeFileSearchIncludeResults}
                      data-testid="native-file-search-include-results"
                      onChange={(e) => {
                        invalidateRouteState();
                        setNativeFileSearchIncludeResults(e.target.checked);
                      }}
                    />
                    <span>在 trace 中附带原始检索结果，便于调试与引用回放</span>
                  </label>
                </div>
              )}
              <div className="editor-col">
                <div className="field">
                  <span className="label">自定义 Headers</span>
                  <textarea
                    value={headersText}
                    onChange={(e) => {
                      invalidateRouteState();
                      setHeadersText(e.target.value);
                    }}
                    placeholder='{"x-custom-header": "value"}'
                  />
                  <div className="field-hint">附加到每个 HTTP 请求头的 JSON 对象。</div>
                </div>
              </div>
              <div className="editor-col">
                <div className="field">
                  <span className="label">额外请求体 (RequestBody)</span>
                  <textarea
                    value={requestBodyText}
                    onChange={(e) => {
                      invalidateRouteState();
                      setRequestBodyText(e.target.value);
                    }}
                    placeholder='{"temperature": 0.7}'
                  />
                  <div className="field-hint">合并到模型请求 payload 中的 JSON 参数。</div>
                </div>
              </div>
            </div>
            )}
          </section>

          {/* 模型能力信息区（只读诊断） */}
          {!isNew && profile.model && (
            <section className="form-section">
              <div className="section-header">
                <span className="dot-icon green" />
                模型能力（自动解析）
              </div>
              {(() => {
                const resolved = resolveModelCapability(profile);
                const eff = resolved.effective;
                return (
                  <div className="capability-card">
                    <div className="cap-grid">
                      <div className="cap-item">
                        <span className="cap-label">上下文窗口</span>
                        <span className="cap-value">{formatTokenCount(eff.contextWindowTokens)}</span>
                      </div>
                      <div className="cap-item">
                        <span className="cap-label">最大输入</span>
                        <span className="cap-value">{formatTokenCount(eff.maxInputTokens)}</span>
                      </div>
                      <div className="cap-item">
                        <span className="cap-label">最大输出</span>
                        <span className="cap-value">{formatTokenCount(eff.maxOutputTokens)}</span>
                      </div>
                      <div className="cap-item">
                        <span className="cap-label">能力来源</span>
                        <span className="cap-value cap-source">{formatCapabilitySource(eff.source)}</span>
                      </div>
                    </div>
                    <div className="cap-features">
                      {eff.thinkingControlKind && <span className="feature-tag">thinking:{eff.thinkingControlKind}</span>}
                      {eff.toolChoiceConstraint && <span className="feature-tag">tool_choice:{eff.toolChoiceConstraint}</span>}
                      {eff.nativeToolStackId && eff.nativeToolStackId !== "none" && <span className="feature-tag">tool-stack:{eff.nativeToolStackId}</span>}
                      {eff.supportsTools && <span className="feature-tag">工具调用</span>}
                      {eff.supportsStreaming && <span className="feature-tag">流式输出</span>}
                      {eff.supportsReasoning && <span className="feature-tag">推理</span>}
                      {eff.supportsVision && <span className="feature-tag">视觉</span>}
                      {eff.supportsPromptCaching && <span className="feature-tag">提示缓存</span>}
                    </div>
                    {(() => {
                      const TOOL_RESTRICTIONS: Record<string, string[]> = {
                        qwen: ["browser_evaluate", "exec_command", "git_commit", "ppt_generate"],
                        moonshot: ["browser_evaluate", "git_commit", "ppt_generate"],
                        "volcengine-ark": ["browser_evaluate", "ppt_generate"],
                        "br-minimax": ["browser_evaluate", "exec_command", "git_commit", "ppt_generate"],
                      };
                      const flavor = profile.providerFlavor ?? selectedPresetId;
                      const restricted = TOOL_RESTRICTIONS[flavor] ?? [];
                      if (restricted.length === 0) return null;
                      return (
                        <div className="cap-restrictions">
                          <span className="cap-label">受限工具</span>
                          <span className="cap-value" style={{ color: "var(--color-text-muted, #888)" }}>
                            {restricted.join(", ")}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </section>
          )}
        </div>
      </main>

      <style>{`
        .model-detail-layout {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #0d0d0f;
          color: #fff;
          overflow: hidden;
        }

        .detail-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 56px;
          padding: 0 24px;
          background: #161618;
          border-bottom: 1px solid #27272a;
          flex-shrink: 0;
        }

        .topbar-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .icon-back-btn {
          background: transparent;
          border: 0;
          color: #a1a1aa;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          transition: all 0.2s;
        }

        .icon-back-btn:hover { background: #27272a; color: #fff; }

        .divider {
          width: 1px;
          height: 20px;
          background: #3f3f46;
        }

        .eyebrow {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          color: #71717a;
          letter-spacing: 0.05em;
          display: block;
        }

        .title {
          font-size: 16px;
          font-weight: 600;
          margin: 0;
          color: #f4f4f5;
        }

        .topbar-right {
          display: flex;
          gap: 12px;
        }

        .primary-save-btn, .danger-ghost-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 16px;
          height: 32px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .primary-save-btn {
          background: #fff;
          color: #000;
          border: 0;
        }

        .primary-save-btn:hover:not(:disabled) { opacity: 0.9; }
        .primary-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .danger-ghost-btn {
          background: transparent;
          border: 1px solid #451a1a;
          color: #f87171;
        }

        .danger-ghost-btn:hover { background: #451a1a; }

        .detail-content {
          flex: 1;
          padding: 24px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .error-banner {
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.2);
          color: #f87171;
          padding: 10px 16px;
          border-radius: 6px;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .main-form {
          display: flex;
          flex-direction: column;
          gap: 24px;
          max-width: 900px;
          width: 100%;
          margin: 0 auto;
        }

        .form-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .section-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 700;
          color: #a1a1aa;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .dot-icon {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #eab308;
          display: inline-block;
        }

        .dot-icon.blue { background: #3b82f6; }

        .field-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field.full-width { grid-column: span 2; }

        .label {
          font-size: 12px;
          color: #71717a;
          font-weight: 500;
        }

        .field input, .field select, .field textarea {
          background: #161618;
          border: 1px solid #27272a;
          border-radius: 6px;
          color: #f4f4f5;
          padding: 8px 12px;
          font-size: 14px;
          outline: none;
          transition: all 0.2s;
          width: 100%;
          font: inherit;
        }

        .field select {
          appearance: none;
          cursor: pointer;
          padding-right: 32px;
        }

        .select-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .select-wrapper select {
          width: 100%;
        }

        .select-arrow {
          position: absolute;
          right: 12px;
          pointer-events: none;
          color: #71717a;
          display: flex;
          align-items: center;
        }

        .field input:focus, .field select:focus, .field textarea:focus {
          border-color: #3f3f46;
          background: #09090b;
        }

        .editor-row {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }

        .native-tool-card {
          grid-column: 1 / -1;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 16px;
          border-radius: 12px;
          border: 1px solid #27272a;
          background: linear-gradient(180deg, rgba(24, 24, 27, 0.96) 0%, rgba(14, 14, 18, 0.96) 100%);
        }

        .native-tool-card-header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
        }

        .inline-toggle {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #e4e4e7;
          font-size: 13px;
        }

        .inline-toggle input {
          width: 16px;
          height: 16px;
        }

        .checkbox-label {
          padding-top: 4px;
          border-top: 1px solid #27272a;
        }

        .compact-field-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .editor-col {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .password-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .password-input-wrapper input { padding-right: 40px; }

        .toggle-password {
          position: absolute;
          right: 8px;
          background: transparent;
          border: 0;
          color: #71717a;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          border-radius: 4px;
          transition: all 0.2s;
        }

        .toggle-password:hover { color: #fff; background: rgba(255,255,255,0.05); }

        .field textarea {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          min-height: 180px;
          line-height: 1.5;
          resize: none;
        }

        .field-hint {
          font-size: 11px;
          color: #52525b;
          margin-top: 4px;
        }

        .field-inline { margin-top: 10px; display: flex; gap: 8px; align-items: center; }

        .catalog-preview-list {
          margin-top: 12px;
          display: grid;
          gap: 10px;
        }

        .catalog-preview-card {
          padding: 12px;
          border-radius: 12px;
          border: 1px solid #2a2a31;
          background: rgba(255, 255, 255, 0.03);
        }

        .catalog-preview-title-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .catalog-preview-meta {
          margin-top: 4px;
          font-size: 12px;
          color: #71717a;
          font-family: monospace;
        }

        .catalog-preview-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid #3b82f633;
          color: #60a5fa;
          font-family: monospace;
        }

        .catalog-preview-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }

        .catalog-tag {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid #303038;
          color: #a1a1aa;
        }

        .secondary-action-btn {
          height: 36px;
          padding: 0 14px;
          border-radius: 10px;
          border: 1px solid #303038;
          background: #1b1b1f;
          color: #f4f4f5;
          cursor: pointer;
          font: inherit;
        }

        .secondary-action-btn:disabled { cursor: not-allowed; opacity: 0.6; }

        .error-hint { color: #fca5a5; }
        .success-hint { color: #86efac; }

        .flex-fill { flex: 1; }

        .route-diagnostics-card {
          margin-top: 12px;
          padding: 14px;
          border-radius: 10px;
          border: 1px solid #2f2f35;
          background: #141418;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .route-diagnostics-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .route-diagnostics-copy {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .route-diagnostics-label {
          font-size: 11px;
          color: #71717a;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-weight: 700;
        }

        .route-recommendation {
          font-size: 13px;
          color: #d4d4d8;
        }

        .route-detail-btn {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          border: 1px solid #303038;
          background: #1b1b1f;
          color: #d4d4d8;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .route-detail-btn:hover {
          border-color: #3f3f46;
          background: #202026;
        }

        .route-details-panel {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding-top: 4px;
        }

        .route-detail-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid #26262b;
          background: #101014;
        }

        .route-detail-main {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }

        .route-detail-title-line {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .route-detail-title {
          font-size: 13px;
          font-weight: 600;
          color: #f4f4f5;
        }

        .route-status-pill {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid #303038;
          color: #a1a1aa;
        }

        .route-status-pill.status-ok {
          border-color: #22c55e33;
          color: #4ade80;
          background: #22c55e12;
        }

        .route-status-pill.status-fail {
          border-color: #ef444433;
          color: #fca5a5;
          background: #ef444412;
        }

        .route-status-pill.status-recommended {
          border-color: #10a37f55;
          color: #34d399;
          background: #10a37f12;
        }

        .route-detail-note {
          font-size: 12px;
          color: #a1a1aa;
        }

        .route-detail-error {
          font-size: 12px;
          color: #fca5a5;
        }

        .route-detail-latency {
          font-size: 12px;
          font-family: monospace;
          color: #71717a;
          flex-shrink: 0;
        }

        .dot-icon.green { background: #22c55e; }

        .capability-card {
          background: #161618;
          border: 1px solid #27272a;
          border-radius: 8px;
          padding: 16px;
        }

        .cap-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 12px;
        }

        .cap-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .cap-label {
          font-size: 11px;
          color: #71717a;
        }

        .cap-value {
          font-size: 16px;
          font-weight: 600;
          color: #f4f4f5;
          font-family: monospace;
        }

        .cap-source {
          font-size: 13px;
          font-family: inherit;
          color: #a1a1aa;
        }

        .cap-features {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .feature-tag {
          font-size: 11px;
          padding: 2px 10px;
          border-radius: 999px;
          background: #22c55e15;
          border: 1px solid #22c55e33;
          color: #4ade80;
        }

        .managed-profile-card {
          background: #161618;
          border: 1px solid #27272a;
          border-radius: 8px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .managed-kv-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .managed-kv {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .managed-kv-label {
          font-size: 11px;
          color: #71717a;
        }

        .managed-kv-value {
          font-size: 13px;
          color: #e4e4e7;
        }

        .managed-kv-value.mono {
          font-family: monospace;
          color: #a1a1aa;
        }

        .managed-status {
          font-weight: 500;
        }

        .managed-status.status-ok {
          color: #4ade80;
        }

        .managed-status.status-pending {
          color: #facc15;
        }

        .managed-params-block {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .managed-params-title {
          font-size: 11px;
          color: #71717a;
        }

        .managed-param-tags {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .managed-param-tag {
          font-size: 11px;
          font-family: monospace;
          padding: 2px 10px;
          border-radius: 999px;
          background: #3b82f615;
          border: 1px solid #3b82f633;
          color: #60a5fa;
        }

        .managed-json {
          margin: 0;
          padding: 12px;
          border-radius: 6px;
          background: #0d0d0f;
          border: 1px solid #27272a;
          font-size: 12px;
          font-family: monospace;
          color: #a1a1aa;
          line-height: 1.6;
          overflow-x: auto;
        }

        .detail-content::-webkit-scrollbar { width: 6px; }
        .detail-content::-webkit-scrollbar-thumb { background: #27272a; border-radius: 10px; }
      `}</style>
    </div>
  );
}

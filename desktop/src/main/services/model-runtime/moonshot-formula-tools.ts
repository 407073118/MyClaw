import type { CapabilityExecutionRoute, CanonicalToolSpec } from "@shared/contracts";

const MOONSHOT_FORMULA_NATIVE_TOOL_NAMES = new Set(["$web_search", "code_runner"]);
const MOONSHOT_FORMULA_MANAGED_LOCAL_TOOL_NAMES = new Set([
  "web_search",
  "http_fetch",
  "browser_open",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "exec_command",
]);

/** 判断当前 capability routes 是否真的启用了 Moonshot Formula 原生工具栈。 */
export function isMoonshotFormulaToolStackActive(
  capabilityRoutes: CapabilityExecutionRoute[] | undefined,
): boolean {
  return capabilityRoutes?.some((route) =>
    route.providerFamily === "moonshot-native"
    && route.routeType === "vendor-native"
    && route.nativeToolStackId === "moonshot-formula",
  ) ?? false;
}

/** 供诊断面板复用的 Moonshot 原生工具名集合。 */
export function listMoonshotFormulaNativeToolNames(): string[] {
  return [...MOONSHOT_FORMULA_NATIVE_TOOL_NAMES];
}

/** 检查当前 registry 是否已经注入了 Moonshot Formula 官方工具，避免在桥接未落地前误删本地回退工具。 */
function hasMoonshotFormulaNativeTools(registry: CanonicalToolSpec[]): boolean {
  return registry.some((tool) => MOONSHOT_FORMULA_NATIVE_TOOL_NAMES.has(tool.name));
}

/** Formula 栈启用时优先隐藏本地重复工具，避免同能力同时暴露 vendor-native 与本地实现。 */
export function filterRegistryForMoonshotFormula(
  registry: CanonicalToolSpec[],
  capabilityRoutes: CapabilityExecutionRoute[] | undefined,
): CanonicalToolSpec[] {
  if (!isMoonshotFormulaToolStackActive(capabilityRoutes)) {
    return registry;
  }

  if (!hasMoonshotFormulaNativeTools(registry)) {
    console.info("[moonshot:formula] 未检测到已加载的官方 Formula 工具，保留本地 web 回退工具");
    return registry;
  }

  console.info("[moonshot:formula] 已检测到官方 Formula 工具，隐藏重叠的本地 web 工具");
  return registry.filter((tool) => !MOONSHOT_FORMULA_MANAGED_LOCAL_TOOL_NAMES.has(tool.name));
}

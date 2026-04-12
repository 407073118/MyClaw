export type DevtoolsPolicyInput = {
  isDev: boolean;
  env?: Record<string, string | undefined>;
};

/**
 * 判断当前是否应该自动打开 DevTools。
 * 默认仅在开发环境且显式开启时返回 true。
 */
export function shouldAutoOpenDevTools(input: DevtoolsPolicyInput): boolean {
  if (!input.isDev) {
    return false;
  }
  const raw = input.env?.MYCLAW_OPEN_DEVTOOLS?.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(raw);
}

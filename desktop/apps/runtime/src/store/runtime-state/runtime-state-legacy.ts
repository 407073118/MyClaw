import { sanitizeRuntimeState } from "./runtime-state-bootstrap";
import type { RuntimeState } from "./runtime-state-types";

/** 解析 legacy JSON 版本的 runtime-state；失败时返回 null。 */
export function parseLegacyJsonState(raw: Buffer, stateFilePath?: string): RuntimeState | null {
  const text = raw.toString("utf8").trim();
  if (!text.startsWith("{")) {
    return null;
  }

  try {
    return sanitizeRuntimeState(JSON.parse(text) as Partial<RuntimeState>, stateFilePath);
  } catch {
    return null;
  }
}

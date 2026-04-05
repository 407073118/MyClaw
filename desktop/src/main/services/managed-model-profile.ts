import type { ModelProfile } from "@shared/contracts";
import { createBrMiniMaxProfile, isBrMiniMaxProfile } from "@shared/br-minimax";

/** 对受管控模型类型做写入归一化，避免 UI 外部改坏锁定字段。 */
export function coerceManagedProfileWrite(
  existing: ModelProfile | null,
  input: Partial<Omit<ModelProfile, "id">>,
): Partial<Omit<ModelProfile, "id">> {
  const shouldManageAsBrMiniMax = isBrMiniMaxProfile(existing)
    || input.providerFlavor === "br-minimax";

  if (!shouldManageAsBrMiniMax) {
    return input;
  }

  const apiKey = (input.apiKey ?? existing?.apiKey ?? "").trim();
  return createBrMiniMaxProfile({ apiKey });
}

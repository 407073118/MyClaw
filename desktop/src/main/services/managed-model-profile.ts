import type { ModelProfile } from "@shared/contracts";
import { createBrMiniMaxProfile, isBrMiniMaxProfile } from "@shared/br-minimax";

/** 对受管控模型类型做写入归一化，避免 UI 外部改坏锁定字段。 */
export function coerceManagedProfileWrite(
  existing: ModelProfile | null,
  input: Partial<Omit<ModelProfile, "id">>,
): Partial<Omit<ModelProfile, "id">> {
  // 如果用户显式切换了 provider 或 providerFlavor，说明意图是变更供应商类型，
  // 此时应放行整个 input，不再强制归一化为原有托管类型。
  const isExistingBrMiniMax = isBrMiniMaxProfile(existing);
  const isInputBrMiniMax = input.providerFlavor === "br-minimax";

  if (isExistingBrMiniMax && !isInputBrMiniMax && input.provider !== undefined) {
    // 用户正在把 BR MiniMax 切换到其他供应商，放行变更
    return input;
  }

  const shouldManageAsBrMiniMax = isExistingBrMiniMax || isInputBrMiniMax;

  if (!shouldManageAsBrMiniMax) {
    return input;
  }

  const apiKey = (input.apiKey ?? existing?.apiKey ?? "").trim();
  return createBrMiniMaxProfile({ apiKey });
}

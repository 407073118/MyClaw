import { aliasProviderAdapter } from "./base";
import { openAiCompatibleAdapter } from "./openai-compatible";

/** Qwen 当前先走兼容 adapter 主链，但拥有独立 adapter id，便于后续补专用策略。 */
export const qwenAdapter = aliasProviderAdapter("qwen", openAiCompatibleAdapter);

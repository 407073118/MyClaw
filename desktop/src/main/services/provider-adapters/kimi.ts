import { aliasProviderAdapter } from "./base";
import { openAiCompatibleAdapter } from "./openai-compatible";

/** Kimi 当前先复用兼容 adapter，但通过独立 id 进入一梯队 vendor 主链。 */
export const kimiAdapter = aliasProviderAdapter("kimi", openAiCompatibleAdapter);

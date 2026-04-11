import { aliasProviderAdapter } from "./base";
import { openAiCompatibleAdapter } from "./openai-compatible";

/** Anthropic 原生适配器入口，先保持现有兼容重放逻辑，后续再补专用消息结构。 */
export const anthropicNativeAdapter = aliasProviderAdapter("anthropic-native", openAiCompatibleAdapter);

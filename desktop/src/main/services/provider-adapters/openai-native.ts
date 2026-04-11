import { aliasProviderAdapter } from "./base";
import { openAiCompatibleAdapter } from "./openai-compatible";

/** OpenAI 原生适配器入口，当前先复用兼容适配器行为，后续再接专用 request/replay 细节。 */
export const openAiNativeAdapter = aliasProviderAdapter("openai-native", openAiCompatibleAdapter);

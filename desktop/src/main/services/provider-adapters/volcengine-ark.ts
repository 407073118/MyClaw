import { aliasProviderAdapter } from "./base";
import { openAiCompatibleAdapter } from "./openai-compatible";

/** 火山方舟当前先复用兼容 adapter，后续在此处接 Ark 专用 request/replay 语义。 */
export const volcengineArkAdapter = aliasProviderAdapter("volcengine-ark", openAiCompatibleAdapter);

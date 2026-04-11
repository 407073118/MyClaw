import { aliasProviderAdapter } from "./base";
import { openAiCompatibleAdapter } from "./openai-compatible";

/** 公开 MiniMax adapter 先复用兼容主链；BR 私有部署继续由 br-minimax 专用 adapter 处理。 */
export const minimaxCompatibleAdapter = aliasProviderAdapter("minimax", openAiCompatibleAdapter);

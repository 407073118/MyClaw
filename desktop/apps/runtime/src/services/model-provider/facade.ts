import { runAnthropicConversation, performAnthropicConnectivityTest } from "./anthropic";
import {
  createOpenAiCompatibleReply as createOpenAiCompatibleReplyInternal,
  performOpenAiConnectivityTest,
  runOpenAiCompatibleConversation,
  testOpenAiCompatibleProfile as testOpenAiCompatibleProfileInternal,
} from "./openai-compatible";
import { assertProfileHasApiKey } from "./shared";
import { MYCLAW_MODEL_TOOLS } from "./tool-definitions";
import type {
  ChatCompletionInput,
  ChatCompletionOutput,
  ModelConversationInput,
  ProfileConnectivityInput,
  ProfileConnectivityOutput,
} from "./types";

export { MYCLAW_MODEL_TOOLS };

/** 稳定门面：单轮 OpenAI-compatible 对话。 */
export async function createOpenAiCompatibleReply(
  input: ChatCompletionInput,
): Promise<ChatCompletionOutput> {
  assertProfileHasApiKey(input.profile);
  return createOpenAiCompatibleReplyInternal(input);
}

/** 稳定门面：多轮模型对话，按 provider 分发。 */
export async function runModelConversation(input: ModelConversationInput): Promise<ChatCompletionOutput> {
  assertProfileHasApiKey(input.profile);

  if (input.profile.provider === "anthropic") {
    return runAnthropicConversation(input);
  }

  return runOpenAiCompatibleConversation(input);
}

/** 稳定门面：模型连通性测试。 */
export async function testModelProfileConnectivity(
  input: ProfileConnectivityInput,
): Promise<ProfileConnectivityOutput> {
  assertProfileHasApiKey(input.profile);

  if (input.profile.provider === "anthropic") {
    return performAnthropicConnectivityTest(input);
  }

  return performOpenAiConnectivityTest(input);
}

/** 稳定门面：OpenAI-compatible 连通性测试兼容别名。 */
export async function testOpenAiCompatibleProfile(
  input: ProfileConnectivityInput,
): Promise<ProfileConnectivityOutput> {
  assertProfileHasApiKey(input.profile);
  return testOpenAiCompatibleProfileInternal(input);
}

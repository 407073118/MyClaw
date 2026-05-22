import type { MemoryContextPack } from "@shared/contracts";
import type { MemoryVaultService } from "./memory-vault/service";

type MemoryContextProvider = Pick<MemoryVaultService, "getContextPack">;

type BuildMemoryWorkingMemoryInput = {
  memoryVault?: MemoryContextProvider | null;
  enabled: boolean;
  query: string;
  limit?: number;
  tokenBudget?: number;
};

const SECRET_PATTERNS = [
  /\bpassword\s*[:=]/i,
  /\bapi[_-]?key\s*[:=]/i,
  /\bsecret\s*[:=]/i,
  /\btoken\s*[:=]/i,
  /\bsk-[A-Za-z0-9_-]{16,}/,
];

const MEMORY_CONTEXT_DEBUG_LOGGING = process.env.MYCLAW_DEBUG_MEMORY_CONTEXT === "1";

/** 输出记忆注入调试日志，默认关闭以避免每轮会话在未开启记忆时刷屏。 */
function logMemoryContextDebug(message: string, detail?: Record<string, unknown>): void {
  if (!MEMORY_CONTEXT_DEBUG_LOGGING) {
    return;
  }
  console.debug(message, detail);
}

/** 检查证据包是否含有明显密钥或口令，命中时拒绝注入模型上下文。 */
function containsObviousSecret(promptBlock: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(promptBlock));
}

/** 判断 context pack 是否有可注入内容，避免把空证据包塞入系统提示。 */
function hasUsableEvidence(pack: MemoryContextPack): boolean {
  return pack.enabled === true && pack.promptBlock.trim().length > 0;
}

/**
 * 构建可传给 assembleContext 的记忆库 workingMemory。
 *
 * 默认关闭；开启后只注入带引用的 evidence pack，并在进 prompt 前做二次敏感内容检查。
 */
export async function buildMemoryWorkingMemory(input: BuildMemoryWorkingMemoryInput): Promise<string | null> {
  if (!input.enabled) {
    logMemoryContextDebug("[memory-context] AI 记忆注入未开启，跳过记忆库检索");
    return null;
  }
  if (!input.memoryVault) {
    logMemoryContextDebug("[memory-context] 记忆库服务不可用，跳过记忆库检索");
    return null;
  }

  const query = input.query.trim();
  if (!query) {
    logMemoryContextDebug("[memory-context] 当前用户消息为空，跳过记忆库检索");
    return null;
  }

  const request = {
    query,
    limit: input.limit ?? 8,
    tokenBudget: input.tokenBudget ?? 4096,
  };
  const pack = await input.memoryVault.getContextPack(request);
  if (!hasUsableEvidence(pack)) {
    logMemoryContextDebug("[memory-context] 未检索到可注入记忆证据", { query });
    return null;
  }
  if (containsObviousSecret(pack.promptBlock)) {
    console.warn("[memory-context] 记忆证据包包含疑似敏感凭据，已拒绝注入", { query });
    return null;
  }

  logMemoryContextDebug("[memory-context] 已构建 AI 记忆证据包", {
    query,
    evidenceCount: pack.evidence?.length ?? 0,
    tokenEstimate: pack.tokenEstimate ?? null,
  });
  return pack.promptBlock;
}

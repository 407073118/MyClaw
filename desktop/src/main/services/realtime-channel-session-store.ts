import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  RealtimeBridgeConversationType,
  RealtimeBridgeProvider,
} from "../../../shared/contracts/realtime-bridge";

export type RealtimeChannelSessionMapping = {
  localSessionKey: string;
  localSessionId: string;
  provider: RealtimeBridgeProvider;
  externalConversationId: string;
  conversationType: RealtimeBridgeConversationType;
  updatedAt: string;
};

type RealtimeChannelSessionStoreFile = {
  mappings: RealtimeChannelSessionMapping[];
};

const STORE_FILE_NAME = "realtime-channel-sessions.json";

/** 解析实时渠道会话映射文件路径，确保数据集中落在 MyClaw 数据目录下。 */
export function resolveRealtimeChannelSessionStorePath(myClawDir: string): string {
  const filePath = join(myClawDir, STORE_FILE_NAME);
  console.info("[realtime-channel-session-store] 解析渠道会话映射路径", { filePath });
  return filePath;
}

export class RealtimeChannelSessionStore {
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /** 根据渠道会话 key 查询本地 session 映射，读取失败时安全返回空结果。 */
  async get(localSessionKey: string): Promise<RealtimeChannelSessionMapping | null> {
    await this.waitForPendingOperation();
    const mappings = await this.readMappings();
    const mapping = mappings.find((item) => item.localSessionKey === localSessionKey) ?? null;
    console.info("[realtime-channel-session-store] 查询渠道会话映射完成", {
      localSessionKey,
      found: Boolean(mapping),
    });
    return mapping;
  }

  /** 新增或更新渠道会话映射，并使用 UTF-8 JSON 持久化到磁盘。 */
  async upsert(mapping: RealtimeChannelSessionMapping): Promise<RealtimeChannelSessionMapping> {
    const operation = this.operationQueue.then(
      () => this.upsertLocked(mapping),
      () => this.upsertLocked(mapping),
    );
    this.operationQueue = operation.catch(() => undefined);
    return operation;
  }

  /** 在串行队列内执行读改写，避免并发 upsert 覆盖彼此的数据。 */
  private async upsertLocked(mapping: RealtimeChannelSessionMapping): Promise<RealtimeChannelSessionMapping> {
    const mappings = await this.readMappings();
    const nextMapping = { ...mapping, updatedAt: mapping.updatedAt || new Date().toISOString() };
    const existingIndex = mappings.findIndex((item) => item.localSessionKey === mapping.localSessionKey);
    if (existingIndex >= 0) {
      mappings[existingIndex] = nextMapping;
    } else {
      mappings.push(nextMapping);
    }
    await this.writeMappings(mappings);
    console.info("[realtime-channel-session-store] 渠道会话映射已持久化", {
      localSessionKey: nextMapping.localSessionKey,
      localSessionId: nextMapping.localSessionId,
    });
    return nextMapping;
  }

  /** 等待前序写操作完成，保证读取结果不落后于当前进程内已提交的 upsert。 */
  private async waitForPendingOperation(): Promise<void> {
    try {
      await this.operationQueue;
    } catch (error) {
      console.warn("[realtime-channel-session-store] 前序映射操作失败，读取继续使用磁盘状态", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 读取映射文件并过滤无效记录，避免坏数据影响实时消息执行。 */
  private async readMappings(): Promise<RealtimeChannelSessionMapping[]> {
    if (!existsSync(this.filePath)) {
      console.info("[realtime-channel-session-store] 映射文件不存在，使用空映射", { filePath: this.filePath });
      return [];
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RealtimeChannelSessionStoreFile> | RealtimeChannelSessionMapping[];
      const mappings = Array.isArray(parsed) ? parsed : parsed.mappings;
      if (!Array.isArray(mappings)) {
        console.warn("[realtime-channel-session-store] 映射文件格式无效，使用空映射", { filePath: this.filePath });
        return [];
      }
      return mappings.filter(isRealtimeChannelSessionMapping);
    } catch (error) {
      console.error("[realtime-channel-session-store] 读取映射文件失败，使用空映射", {
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /** 写回映射文件，保持稳定缩进和 UTF-8 编码。 */
  private async writeMappings(mappings: RealtimeChannelSessionMapping[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify({ mappings }, null, 2)}\n`, "utf8");
    console.info("[realtime-channel-session-store] 映射文件写入完成", {
      filePath: this.filePath,
      count: mappings.length,
    });
  }
}

/** 校验磁盘映射记录的最小结构，避免异常 JSON 进入执行链路。 */
function isRealtimeChannelSessionMapping(input: unknown): input is RealtimeChannelSessionMapping {
  const item = input as Partial<RealtimeChannelSessionMapping> | null;
  return Boolean(
    item
      && typeof item.localSessionKey === "string"
      && typeof item.localSessionId === "string"
      && item.provider === "dingtalk"
      && typeof item.externalConversationId === "string"
      && (item.conversationType === "direct" || item.conversationType === "group")
      && typeof item.updatedAt === "string",
  );
}

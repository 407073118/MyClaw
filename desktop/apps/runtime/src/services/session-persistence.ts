import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ChatMessage, ChatSession } from "@myclaw-desktop/shared";

type PersistedSessionMetadata = {
  id: string;
  title: string;
  modelProfileId: string;
  attachedDirectory: string | null;
  createdAt: string;
  position: number;
};

const SESSION_METADATA_FILE_NAME = "session.json";
const SESSION_MESSAGES_FILE_NAME = "messages.json";

/** 解析单个会话目录路径，确保所有会话都落到统一根目录下。 */
function resolveSessionDirectoryPath(sessionsRootPath: string, sessionId: string): string {
  return join(sessionsRootPath, sessionId);
}

/** 将会话拆分为元数据与消息文件，便于单独查看和维护。 */
function toPersistedSessionFiles(
  session: ChatSession,
  position: number,
): { metadata: PersistedSessionMetadata; messages: ChatMessage[] } {
  return {
    metadata: {
      id: session.id,
      title: session.title,
      modelProfileId: session.modelProfileId,
      attachedDirectory: session.attachedDirectory ?? null,
      createdAt: session.createdAt,
      position,
    },
    messages: session.messages,
  };
}

/** 将磁盘中的拆分文件重新还原为运行时会话对象。 */
function toChatSession(metadata: PersistedSessionMetadata, messages: ChatMessage[]): ChatSession {
  return {
    id: metadata.id,
    title: metadata.title,
    modelProfileId: metadata.modelProfileId,
    attachedDirectory: metadata.attachedDirectory,
    createdAt: metadata.createdAt,
    messages,
  };
}

/** 从 JSON 文件读取数据，并保持 UTF-8 文本格式。 */
async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

/** 将对象写入 JSON 文件，统一使用可读缩进，方便用户排查。 */
async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

/** 从会话根目录恢复所有会话，并按落盘顺序还原列表。 */
export async function loadSessionsSnapshot(sessionsRootPath: string): Promise<ChatSession[]> {
  await mkdir(sessionsRootPath, { recursive: true });
  const entries = await readdir(sessionsRootPath, { withFileTypes: true });
  const sessions = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const sessionDirectoryPath = resolveSessionDirectoryPath(sessionsRootPath, entry.name);
        const metadata = await readJsonFile<PersistedSessionMetadata>(
          join(sessionDirectoryPath, SESSION_METADATA_FILE_NAME),
        );
        const messages = await readJsonFile<ChatMessage[]>(join(sessionDirectoryPath, SESSION_MESSAGES_FILE_NAME));
        return {
          position: metadata.position,
          session: toChatSession(metadata, messages),
        };
      }),
  );

  return sessions
    .sort((left, right) => left.position - right.position)
    .map((entry) => entry.session);
}

/** 将当前内存会话快照完整同步到磁盘，并清理已删除的旧目录。 */
export async function saveSessionsSnapshot(sessionsRootPath: string, sessions: ChatSession[]): Promise<void> {
  await mkdir(sessionsRootPath, { recursive: true });
  const activeSessionIds = new Set(sessions.map((session) => session.id));

  await Promise.all(
    sessions.map(async (session, index) => {
      const sessionDirectoryPath = resolveSessionDirectoryPath(sessionsRootPath, session.id);
      const persistedFiles = toPersistedSessionFiles(session, index);
      await mkdir(sessionDirectoryPath, { recursive: true });
      await writeJsonFile(join(sessionDirectoryPath, SESSION_METADATA_FILE_NAME), persistedFiles.metadata);
      await writeJsonFile(join(sessionDirectoryPath, SESSION_MESSAGES_FILE_NAME), persistedFiles.messages);
    }),
  );

  const entries = await readdir(sessionsRootPath, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !activeSessionIds.has(entry.name))
      .map((entry) => rm(resolveSessionDirectoryPath(sessionsRootPath, entry.name), { recursive: true, force: true })),
  );
}

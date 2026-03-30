import type { ChatMessage, ChatSession } from "@myclaw-desktop/shared";

import { parseMessageUi, selectRows } from "../runtime-state-shared-parsers";
import type { SqlDatabase } from "../runtime-state-types";

/** 写入会话与消息记录。 */
export function writeSessionsToDatabase(db: SqlDatabase, sessions: ChatSession[]): void {
  sessions.forEach((session, sessionIndex) => {
    db.run(
      `
        INSERT INTO sessions(
          position,
          id,
          title,
          model_profile_id,
          attached_directory,
          created_at
        ) VALUES(?, ?, ?, ?, ?, ?)
      `,
      [
        sessionIndex,
        session.id,
        session.title,
        session.modelProfileId,
        session.attachedDirectory,
        session.createdAt,
      ],
    );

    session.messages.forEach((message, messageIndex) => {
      db.run(
        `
        INSERT INTO messages(
          session_id,
          position,
          id,
          role,
          content,
          created_at,
          reasoning,
          ui_json
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          session.id,
          messageIndex,
          message.id,
          message.role,
          message.content,
          message.createdAt,
          typeof message.reasoning === "string" ? message.reasoning : null,
          message.ui ? JSON.stringify(message.ui) : null,
        ],
      );
    });
  });
}

/** 读取会话与消息记录。 */
export function readSessionsFromDatabase(db: SqlDatabase): ChatSession[] {
  const sessionRows = selectRows(
    db,
    `
      SELECT
        id,
        title,
        model_profile_id,
        attached_directory,
        created_at
      FROM sessions
      ORDER BY position ASC
    `,
  );
  const messageRows = selectRows(
    db,
    `
      SELECT
        session_id,
        id,
        role,
        content,
        created_at,
        reasoning,
        ui_json
      FROM messages
      ORDER BY session_id ASC, position ASC
    `,
  );

  const messagesBySession = new Map<string, ChatMessage[]>();
  messageRows.forEach((row) => {
    const sessionId = String(row.session_id ?? "");
    const sessionMessages = messagesBySession.get(sessionId) ?? [];
    const ui = parseMessageUi(row.ui_json);
    const message: ChatMessage = {
      id: String(row.id ?? ""),
      role: String(row.role ?? "") as ChatMessage["role"],
      content: String(row.content ?? ""),
      createdAt: String(row.created_at ?? ""),
    };
    if (typeof row.reasoning === "string" && row.reasoning.trim()) {
      message.reasoning = String(row.reasoning);
    }
    if (ui) {
      message.ui = ui;
    }

    sessionMessages.push(message);
    messagesBySession.set(sessionId, sessionMessages);
  });

  return sessionRows.map((row) => ({
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    modelProfileId: String(row.model_profile_id ?? ""),
    attachedDirectory: typeof row.attached_directory === "string" ? row.attached_directory : null,
    createdAt: String(row.created_at ?? ""),
    messages: messagesBySession.get(String(row.id ?? "")) ?? [],
  }));
}

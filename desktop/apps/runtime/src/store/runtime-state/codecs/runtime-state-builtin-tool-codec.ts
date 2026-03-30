import type { BuiltinToolPreference } from "@myclaw-desktop/shared";

import { parseBuiltinToolApprovalMode, selectRows } from "../runtime-state-shared-parsers";
import type { SqlDatabase } from "../runtime-state-types";

/** 写入内置工具偏好列表。 */
export function writeBuiltinToolPreferencesToDatabase(
  db: SqlDatabase,
  preferences: BuiltinToolPreference[],
): void {
  preferences.forEach((preference) => {
    db.run(
      `
        INSERT INTO builtin_tool_preferences(
          tool_id,
          enabled,
          exposed_to_model,
          approval_mode_override,
          updated_at
        ) VALUES(?, ?, ?, ?, ?)
      `,
      [
        preference.toolId,
        preference.enabled ? 1 : 0,
        preference.exposedToModel ? 1 : 0,
        preference.approvalModeOverride,
        preference.updatedAt,
      ],
    );
  });
}

/** 读取内置工具偏好列表。 */
export function readBuiltinToolPreferencesFromDatabase(db: SqlDatabase): BuiltinToolPreference[] {
  return selectRows(
    db,
    `
      SELECT
        tool_id,
        enabled,
        exposed_to_model,
        approval_mode_override,
        updated_at
      FROM builtin_tool_preferences
      ORDER BY tool_id ASC
    `,
  ).map((row) => ({
    toolId: String(row.tool_id ?? ""),
    enabled: row.enabled === 1,
    exposedToModel: row.exposed_to_model === 1,
    approvalModeOverride: parseBuiltinToolApprovalMode(row.approval_mode_override),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

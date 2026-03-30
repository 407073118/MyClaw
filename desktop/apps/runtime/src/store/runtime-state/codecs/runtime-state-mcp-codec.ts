import type { McpServerConfig, McpToolPreference } from "@myclaw-desktop/shared";

import {
  parseBuiltinToolApprovalMode,
  parseStringArray,
  parseStringMap,
  selectRows,
} from "../runtime-state-shared-parsers";
import type { SqlDatabase } from "../runtime-state-types";

/** 写入 MCP 服务配置列表。 */
export function writeMcpServerConfigsToDatabase(db: SqlDatabase, configs: McpServerConfig[]): void {
  configs.forEach((config, index) => {
    db.run(
      `
        INSERT INTO mcp_server_configs(
          position,
          id,
          name,
          source,
          transport,
          enabled,
          command,
          args_json,
          cwd,
          env_json,
          url,
          headers_json
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        index,
        config.id,
        config.name,
        config.source,
        config.transport,
        config.enabled ? 1 : 0,
        config.transport === "stdio" ? config.command : null,
        config.transport === "stdio" && config.args ? JSON.stringify(config.args) : null,
        config.transport === "stdio" ? config.cwd ?? null : null,
        config.transport === "stdio" && config.env ? JSON.stringify(config.env) : null,
        config.transport === "http" ? config.url : null,
        config.transport === "http" && config.headers ? JSON.stringify(config.headers) : null,
      ],
    );
  });
}

/** 写入 MCP 工具偏好列表。 */
export function writeMcpToolPreferencesToDatabase(db: SqlDatabase, preferences: McpToolPreference[]): void {
  preferences.forEach((preference) => {
    db.run(
      `
        INSERT INTO mcp_tool_preferences(
          tool_id,
          server_id,
          enabled,
          exposed_to_model,
          approval_mode_override,
          updated_at
        ) VALUES(?, ?, ?, ?, ?, ?)
      `,
      [
        preference.toolId,
        preference.serverId,
        preference.enabled ? 1 : 0,
        preference.exposedToModel ? 1 : 0,
        preference.approvalModeOverride,
        preference.updatedAt,
      ],
    );
  });
}

/** 读取 MCP 服务配置列表。 */
export function readMcpServerConfigsFromDatabase(db: SqlDatabase): McpServerConfig[] {
  const rows = selectRows(
    db,
    `
      SELECT
        id,
        name,
        source,
        transport,
        enabled,
        command,
        args_json,
        cwd,
        env_json,
        url,
        headers_json
      FROM mcp_server_configs
      ORDER BY position ASC, id ASC
    `,
  );
  const configs: McpServerConfig[] = [];

  rows.forEach((row) => {
    const id = String(row.id ?? "");
    const name = String(row.name ?? "");
    const source = String(row.source ?? "") as McpServerConfig["source"];
    const enabled = row.enabled === 1;
    const transport = String(row.transport ?? "");

    if (!id || !name) {
      return;
    }

    if (transport === "stdio") {
      const command = String(row.command ?? "");
      if (!command) {
        return;
      }

      const config: McpServerConfig = {
        id,
        name,
        source,
        transport: "stdio",
        command,
        enabled,
      };
      const args = parseStringArray(row.args_json);
      const cwd = typeof row.cwd === "string" && row.cwd.trim() ? row.cwd : undefined;
      const env = parseStringMap(row.env_json);
      if (args.length > 0) {
        config.args = args;
      }
      if (cwd) {
        config.cwd = cwd;
      }
      if (env && Object.keys(env).length > 0) {
        config.env = env;
      }
      configs.push(config);
      return;
    }

    if (transport === "http") {
      const url = String(row.url ?? "");
      if (!url) {
        return;
      }

      const config: McpServerConfig = {
        id,
        name,
        source,
        transport: "http",
        url,
        enabled,
      };
      const headers = parseStringMap(row.headers_json);
      if (headers && Object.keys(headers).length > 0) {
        config.headers = headers;
      }
      configs.push(config);
    }
  });

  return configs;
}

/** 读取 MCP 工具偏好列表。 */
export function readMcpToolPreferencesFromDatabase(db: SqlDatabase): McpToolPreference[] {
  return selectRows(
    db,
    `
      SELECT
        tool_id,
        server_id,
        enabled,
        exposed_to_model,
        approval_mode_override,
        updated_at
      FROM mcp_tool_preferences
      ORDER BY tool_id ASC
    `,
  ).map((row) => ({
    toolId: String(row.tool_id ?? ""),
    serverId: String(row.server_id ?? ""),
    enabled: row.enabled === 1,
    exposedToModel: row.exposed_to_model === 1,
    approvalModeOverride: parseBuiltinToolApprovalMode(row.approval_mode_override),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

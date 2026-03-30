import { describe, expect, it } from "vitest";
import initSqlJsType from "sql.js";

import { initializeRuntimeStateSchema } from "../../../src/store/runtime-state/runtime-state-schema";
import {
  readMcpServerConfigsFromDatabase,
  writeMcpServerConfigsToDatabase,
} from "../../../src/store/runtime-state/codecs/runtime-state-mcp-codec";
import {
  readWorkflowsFromDatabase,
  writeWorkflowsToDatabase,
} from "../../../src/store/runtime-state/codecs/runtime-state-workflow-codec";

describe("runtime state domain codecs", () => {
  it("roundtrips mcp server configs by transport shape", async () => {
    const initSqlJsAsm = (await import("sql.js/dist/sql-asm.js")).default as typeof initSqlJsType;
    const sql = await initSqlJsAsm();
    const db = new sql.Database();
    initializeRuntimeStateSchema(db);

    writeMcpServerConfigsToDatabase(db, [
      {
        id: "mcp-stdio",
        name: "Filesystem",
        source: "manual",
        transport: "stdio",
        command: "npx",
        args: ["@modelcontextprotocol/server-filesystem"],
        enabled: true,
      },
      {
        id: "mcp-http",
        name: "Docs",
        source: "cursor",
        transport: "http",
        url: "http://127.0.0.1:3001/mcp",
        headers: { Authorization: "Bearer token" },
        enabled: false,
      },
    ]);

    const rows = readMcpServerConfigsFromDatabase(db);
    db.close();

    expect(rows).toEqual([
      {
        id: "mcp-stdio",
        name: "Filesystem",
        source: "manual",
        transport: "stdio",
        command: "npx",
        args: ["@modelcontextprotocol/server-filesystem"],
        enabled: true,
      },
      {
        id: "mcp-http",
        name: "Docs",
        source: "cursor",
        transport: "http",
        url: "http://127.0.0.1:3001/mcp",
        headers: { Authorization: "Bearer token" },
        enabled: false,
      },
    ]);
  });

  it("normalizes workflow graph fields while decoding", async () => {
    const initSqlJsAsm = (await import("sql.js/dist/sql-asm.js")).default as typeof initSqlJsType;
    const sql = await initSqlJsAsm();
    const db = new sql.Database();
    initializeRuntimeStateSchema(db);

    db.run(
      `
        INSERT INTO workflows(
          position,
          id,
          name,
          description,
          status,
          source,
          updated_at,
          version,
          node_count,
          edge_count,
          library_root_id
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        0,
        "workflow-a",
        "Workflow A",
        "test",
        "draft",
        "personal",
        "2026-03-26T00:00:00.000Z",
        "not-a-number",
        "not-a-number",
        "not-a-number",
        "",
      ],
    );

    const rows = readWorkflowsFromDatabase(db);
    db.close();

    expect(rows[0]).toMatchObject({
      id: "workflow-a",
      version: 1,
      nodeCount: 0,
      edgeCount: 0,
      libraryRootId: "personal",
    });
  });
});

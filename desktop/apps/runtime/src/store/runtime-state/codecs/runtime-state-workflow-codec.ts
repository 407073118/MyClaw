import type { WorkflowDefinitionSummary } from "@myclaw-desktop/shared";

import { toFiniteNumber, selectRows } from "../runtime-state-shared-parsers";
import type { SqlDatabase } from "../runtime-state-types";

/** 写入工作流摘要记录。 */
export function writeWorkflowsToDatabase(db: SqlDatabase, workflows: WorkflowDefinitionSummary[]): void {
  workflows.forEach((workflow, index) => {
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
        index,
        workflow.id,
        workflow.name,
        workflow.description,
        workflow.status,
        workflow.source,
        workflow.updatedAt,
        workflow.version ?? 1,
        workflow.nodeCount ?? 0,
        workflow.edgeCount ?? 0,
        workflow.libraryRootId ?? "personal",
      ],
    );
  });
}

/** 读取工作流摘要记录。 */
export function readWorkflowsFromDatabase(db: SqlDatabase): WorkflowDefinitionSummary[] {
  return selectRows(
    db,
    `
      SELECT
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
      FROM workflows
      ORDER BY position ASC
    `,
  ).map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    status: String(row.status ?? "") as WorkflowDefinitionSummary["status"],
    source: String(row.source ?? "") as WorkflowDefinitionSummary["source"],
    updatedAt: String(row.updated_at ?? ""),
    version: toFiniteNumber(row.version, 1),
    nodeCount: toFiniteNumber(row.node_count, 0),
    edgeCount: toFiniteNumber(row.edge_count, 0),
    libraryRootId: String(row.library_root_id ?? "personal") || "personal",
  }));
}

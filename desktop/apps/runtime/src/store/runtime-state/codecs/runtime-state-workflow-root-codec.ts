import type { WorkflowLibraryRootRecord } from "../../workflow-library-root-store";
import { parseWorkflowLibraryRootKind, selectRows } from "../runtime-state-shared-parsers";
import type { SqlDatabase } from "../runtime-state-types";

/** 写入工作流根目录记录。 */
export function writeWorkflowLibraryRootsToDatabase(
  db: SqlDatabase,
  roots: WorkflowLibraryRootRecord[],
): void {
  roots.forEach((root, index) => {
    db.run(
      `
        INSERT INTO workflow_library_roots(
          position,
          id,
          name,
          path,
          writable,
          kind,
          created_at,
          updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        index,
        root.id,
        root.name,
        root.path,
        root.writable ? 1 : 0,
        root.kind,
        root.createdAt,
        root.updatedAt,
      ],
    );
  });
}

/** 读取工作流根目录记录。 */
export function readWorkflowLibraryRootsFromDatabase(db: SqlDatabase): WorkflowLibraryRootRecord[] {
  return selectRows(
    db,
    `
      SELECT
        id,
        name,
        path,
        writable,
        kind,
        created_at,
        updated_at
      FROM workflow_library_roots
      ORDER BY position ASC
    `,
  ).map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    path: String(row.path ?? ""),
    writable: row.writable === 1,
    kind: parseWorkflowLibraryRootKind(row.kind, String(row.id ?? "")),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

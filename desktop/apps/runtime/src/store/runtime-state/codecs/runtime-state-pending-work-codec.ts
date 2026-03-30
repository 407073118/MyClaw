import type { PendingWorkItem } from "../../pending-work-store";
import { parsePendingWorkResumePolicy, selectRows } from "../runtime-state-shared-parsers";
import type { SqlDatabase } from "../runtime-state-types";

/** 写入待办工作记录。 */
export function writePendingWorkItemsToDatabase(db: SqlDatabase, items: PendingWorkItem[]): void {
  items.forEach((item, index) => {
    db.run(
      `
        INSERT INTO pending_work_items(
          position,
          id,
          employee_id,
          workflow_id,
          title,
          status,
          due_at,
          expires_at,
          attempt_count,
          max_attempts,
          resume_policy_json,
          updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        index,
        item.id,
        item.employeeId,
        item.workflowId,
        item.title,
        item.status,
        item.dueAt,
        item.expiresAt ?? null,
        item.attemptCount,
        item.maxAttempts,
        JSON.stringify(item.resumePolicy),
        item.updatedAt,
      ],
    );
  });
}

/** 读取待办工作记录。 */
export function readPendingWorkItemsFromDatabase(db: SqlDatabase): PendingWorkItem[] {
  return selectRows(
    db,
    `
      SELECT
        id,
        employee_id,
        workflow_id,
        title,
        status,
        due_at,
        expires_at,
        attempt_count,
        max_attempts,
        resume_policy_json,
        updated_at
      FROM pending_work_items
      ORDER BY position ASC
    `,
  ).map((row) => ({
    id: String(row.id ?? ""),
    employeeId: String(row.employee_id ?? ""),
    workflowId: typeof row.workflow_id === "string" ? row.workflow_id : null,
    title: String(row.title ?? ""),
    status: String(row.status ?? "") as PendingWorkItem["status"],
    dueAt: typeof row.due_at === "string" ? row.due_at : null,
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    resumePolicy: parsePendingWorkResumePolicy(row.resume_policy_json),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

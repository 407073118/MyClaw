import type { MemoryRecord } from "../../memory-store";
import { selectRows } from "../runtime-state-shared-parsers";
import type { SqlDatabase } from "../runtime-state-types";

/** 写入记忆记录。 */
export function writeMemoryRecordsToDatabase(db: SqlDatabase, records: MemoryRecord[]): void {
  records.forEach((record, index) => {
    db.run(
      `
        INSERT INTO memory_records(
          position,
          id,
          employee_id,
          kind,
          subject,
          content,
          updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?)
      `,
      [
        index,
        record.id,
        record.employeeId,
        record.kind,
        record.subject,
        record.content,
        record.updatedAt,
      ],
    );
  });
}

/** 读取记忆记录。 */
export function readMemoryRecordsFromDatabase(db: SqlDatabase): MemoryRecord[] {
  return selectRows(
    db,
    `
      SELECT
        id,
        employee_id,
        kind,
        subject,
        content,
        updated_at
      FROM memory_records
      ORDER BY position ASC
    `,
  ).map((row) => ({
    id: String(row.id ?? ""),
    employeeId: String(row.employee_id ?? ""),
    kind: String(row.kind ?? "") as MemoryRecord["kind"],
    subject: String(row.subject ?? ""),
    content: String(row.content ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

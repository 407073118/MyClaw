import type { LocalEmployeeSummary } from "@myclaw-desktop/shared";

import { parseStringArray, selectRows } from "../runtime-state-shared-parsers";
import type { SqlDatabase } from "../runtime-state-types";

/** 写入员工摘要记录。 */
export function writeEmployeesToDatabase(db: SqlDatabase, employees: LocalEmployeeSummary[]): void {
  employees.forEach((employee, index) => {
    db.run(
      `
        INSERT INTO employees(
          position,
          id,
          name,
          description,
          status,
          source,
          workflow_ids_json,
          updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        index,
        employee.id,
        employee.name,
        employee.description,
        employee.status,
        employee.source,
        JSON.stringify(employee.workflowIds),
        employee.updatedAt,
      ],
    );
  });
}

/** 读取员工摘要记录。 */
export function readEmployeesFromDatabase(db: SqlDatabase): LocalEmployeeSummary[] {
  return selectRows(
    db,
    `
      SELECT
        id,
        name,
        description,
        status,
        source,
        workflow_ids_json,
        updated_at
      FROM employees
      ORDER BY position ASC
    `,
  ).map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    status: String(row.status ?? "") as LocalEmployeeSummary["status"],
    source: String(row.source ?? "") as LocalEmployeeSummary["source"],
    workflowIds: parseStringArray(row.workflow_ids_json),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

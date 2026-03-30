import type { ApprovalPolicy, ApprovalRequest } from "@myclaw-desktop/shared";

import { parseJsonRecord, parseStringArray, selectRows } from "../runtime-state-shared-parsers";
import type { SqlDatabase } from "../runtime-state-types";

/** 写入审批策略记录。 */
export function writeApprovalPolicyToDatabase(db: SqlDatabase, policy: ApprovalPolicy): void {
  db.run(
    `
      INSERT INTO approval_policy(
        id,
        mode,
        auto_approve_read_only,
        auto_approve_skills,
        always_allowed_tools_json
      ) VALUES(1, ?, ?, ?, ?)
    `,
    [
      policy.mode,
      policy.autoApproveReadOnly ? 1 : 0,
      policy.autoApproveSkills ? 1 : 0,
      JSON.stringify(policy.alwaysAllowedTools),
    ],
  );
}

/** 写入审批请求列表。 */
export function writeApprovalRequestsToDatabase(db: SqlDatabase, requests: ApprovalRequest[]): void {
  requests.forEach((request, index) => {
    db.run(
      `
        INSERT INTO approval_requests(
          position,
          id,
          session_id,
          source,
          tool_id,
          label,
          risk,
          detail,
          arguments_json,
          resume_conversation
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        index,
        request.id,
        request.sessionId,
        request.source,
        request.toolId,
        request.label,
        request.risk,
        request.detail,
        request.arguments ? JSON.stringify(request.arguments) : null,
        request.resumeConversation ? 1 : 0,
      ],
    );
  });
}

/** 读取审批策略记录。 */
export function readApprovalPolicyFromDatabase(db: SqlDatabase): ApprovalPolicy | undefined {
  const row = selectRows(
    db,
    `
      SELECT
        mode,
        auto_approve_read_only,
        auto_approve_skills,
        always_allowed_tools_json
      FROM approval_policy
      WHERE id = 1
      LIMIT 1
    `,
  )[0];

  if (!row) {
    return undefined;
  }

  return {
    mode: String(row.mode ?? "") as ApprovalPolicy["mode"],
    autoApproveReadOnly: row.auto_approve_read_only === 1,
    autoApproveSkills: row.auto_approve_skills === 1,
    alwaysAllowedTools: parseStringArray(row.always_allowed_tools_json),
  };
}

/** 读取审批请求列表。 */
export function readApprovalRequestsFromDatabase(db: SqlDatabase): ApprovalRequest[] {
  return selectRows(
    db,
    `
      SELECT
        id,
        session_id,
        source,
        tool_id,
        label,
        risk,
        detail,
        arguments_json,
        resume_conversation
      FROM approval_requests
      ORDER BY position ASC
    `,
  ).map((row) => ({
    id: String(row.id ?? ""),
    sessionId: String(row.session_id ?? ""),
    source: String(row.source ?? "") as ApprovalRequest["source"],
    toolId: String(row.tool_id ?? ""),
    label: String(row.label ?? ""),
    risk: String(row.risk ?? "") as ApprovalRequest["risk"],
    detail: String(row.detail ?? ""),
    arguments: parseJsonRecord(row.arguments_json),
    resumeConversation: row.resume_conversation === 1,
  }));
}

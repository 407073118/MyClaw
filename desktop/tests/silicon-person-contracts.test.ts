import { describe, expect, it } from "vitest";

import type { SiliconPerson } from "@shared/contracts";
import {
  SILICON_PERSON_APPROVAL_MODE_VALUES,
  SILICON_PERSON_SOURCE_VALUES,
  SILICON_PERSON_STATUS_VALUES,
} from "@shared/contracts";

describe("Silicon person contracts", () => {
  it("exports stable silicon person contract vocabularies", () => {
    expect(SILICON_PERSON_APPROVAL_MODE_VALUES).toEqual(
      expect.arrayContaining(["inherit", "always_ask", "auto_approve"]),
    );
    expect(SILICON_PERSON_SOURCE_VALUES).toEqual(
      expect.arrayContaining(["personal", "enterprise", "hub"]),
    );
    expect(SILICON_PERSON_STATUS_VALUES).toEqual(
      expect.arrayContaining(["idle", "running", "needs_approval", "done", "error"]),
    );
  });

  it("supports a serializable silicon person summary with currentSession and multi-session metadata", () => {
    const siliconPerson: SiliconPerson = {
      id: "sp-1",
      name: "Ada",
      title: "研究搭档",
      description: "负责承接主聊天分发的任务。",
      status: "running",
      source: "personal",
      approvalMode: "inherit",
      currentSessionId: "session-2",
      sessions: [
        {
          id: "session-1",
          title: "默认会话",
          status: "done",
          unreadCount: 1,
          hasUnread: true,
          needsApproval: false,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
        {
          id: "session-2",
          title: "当前会话",
          status: "running",
          unreadCount: 0,
          hasUnread: false,
          needsApproval: false,
          updatedAt: "2026-04-08T00:01:00.000Z",
        },
      ],
      unreadCount: 1,
      hasUnread: true,
      needsApproval: false,
      workflowIds: ["wf-1"],
      updatedAt: "2026-04-08T00:01:00.000Z",
    };

    const parsed = JSON.parse(JSON.stringify(siliconPerson)) as SiliconPerson;

    expect(parsed.currentSessionId).toBe("session-2");
    expect(parsed.sessions).toHaveLength(2);
    expect(parsed.sessions[0]?.status).toBe("done");
    expect(parsed.approvalMode).toBe("inherit");
  });
});

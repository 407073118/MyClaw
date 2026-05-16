import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { TimeOrchestrationDatabase } from "../src/main/services/time-orchestration-database";
import { createLongRunLedger } from "../src/main/services/long-run-ledger";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

/** 创建临时长任务台账，避免测试污染用户数据。 */
async function createLedger() {
  const dir = mkdtempSync(join(tmpdir(), "myclaw-long-run-ledger-"));
  tempDirs.push(dir);
  const db = await TimeOrchestrationDatabase.create(join(dir, "time.db"));
  return { db, ledger: createLongRunLedger(db) };
}

describe("long run ledger awareness integration", () => {
  it("creates awareness records with source title and delivery metadata", async () => {
    const { db, ledger } = await createLedger();
    try {
      const record = ledger.createRecord("awareness_routine", "routine-1", { kind: "personal" }, "running", {
        sourceTitle: "个人值守",
        notifyPolicy: "state_changes",
        deliveryTarget: "today_catchup",
      });

      await ledger.upsertRecord(record);
      const stored = await ledger.getRecord(record.id);

      expect(stored?.sourceTitle).toBe("个人值守");
      expect(stored?.notifyPolicy).toBe("state_changes");
      expect(stored?.deliveryTarget).toBe("today_catchup");
    } finally {
      db.close();
    }
  });

  it("lists pending delivery records for catch-up surfaces", async () => {
    const { db, ledger } = await createLedger();
    try {
      const record = ledger.createRecord("awareness_routine", "routine-1", { kind: "personal" }, "running");
      await ledger.upsertRecord(record);
      await ledger.finishRecord(record.id, "succeeded", { summary: "值守完成" });

      const pending = await ledger.listRecords({ deliveryStatus: "pending" });

      expect(pending).toHaveLength(1);
      expect(pending[0]?.resultSummary).toBe("值守完成");
    } finally {
      db.close();
    }
  });

  it("marks delivered records so they do not reappear as pending", async () => {
    const { db, ledger } = await createLedger();
    try {
      const record = ledger.createRecord("awareness_routine", "routine-1", { kind: "personal" }, "running");
      await ledger.upsertRecord(record);
      await ledger.finishRecord(record.id, "succeeded", { summary: "值守完成" });
      await ledger.markDelivered(record.id);

      const pending = await ledger.listRecords({ deliveryStatus: "pending" });
      const delivered = await ledger.getRecord(record.id);

      expect(pending).toHaveLength(0);
      expect(delivered?.deliveryStatus).toBe("delivered");
    } finally {
      db.close();
    }
  });
});

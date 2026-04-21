/**
 * 外部路径访问审计日志（JSONL 日滚动，保留 30 天）。
 *
 * 事件格式：
 * {
 *   ts: ISO-8601,
 *   sessionId, toolId, operation,
 *   path, tier, decision: "granted"|"denied",
 *   reason, vendor?, modelProfileId?
 * }
 */

import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "./logger";

const log = createLogger("path-audit");

export type PathAccessAuditEvent = {
  ts: string;
  sessionId: string;
  toolId: string;
  operation: "read" | "write" | "delete" | "exec";
  path: string;
  tier: number;
  decision: "granted" | "denied";
  reason: string;
  vendor?: string;
  modelProfileId?: string;
};

export class PathAccessAudit {
  private retentionDays = 30;
  private initialized = false;

  constructor(private auditDir: string) {}

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    try {
      await mkdir(this.auditDir, { recursive: true });
      this.initialized = true;
    } catch (err) {
      log.warn("审计目录创建失败", { auditDir: this.auditDir, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private fileForDay(dayIso: string): string {
    return join(this.auditDir, `path-access-${dayIso}.jsonl`);
  }

  async record(event: PathAccessAuditEvent): Promise<void> {
    await this.ensureDir();
    const day = event.ts.slice(0, 10);
    const line = JSON.stringify(event) + "\n";
    try {
      await appendFile(this.fileForDay(day), line, "utf8");
    } catch (err) {
      log.warn("写入审计日志失败", {
        auditFile: this.fileForDay(day),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 删除超过保留期的日志文件。调用方自行定时。 */
  async pruneOld(): Promise<void> {
    await this.ensureDir();
    try {
      const files = await readdir(this.auditDir);
      const cutoff = Date.now() - this.retentionDays * 86400 * 1000;
      for (const f of files) {
        const m = /path-access-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
        if (!m) continue;
        const ts = Date.parse(m[1]);
        if (Number.isNaN(ts) || ts >= cutoff) continue;
        try {
          await unlink(join(this.auditDir, f));
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
}

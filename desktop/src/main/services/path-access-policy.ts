/**
 * 桌面端外部路径访问五层信任体系（PathAccessPolicy）。
 *
 * T0 workspace → allow
 * T1 用户本轮消息里提到的路径 → allow + audit
 * T2 会话级已授权 → allow + audit
 * T3 持久授权目录 → allow + audit
 * T4 首次外部 / 需重确认 → prompt
 * T5 拒绝（session / persistent） → deny
 *
 * 决策结果在 session 范围内按 canonical path 缓存，保证 thinking-mode replay
 * 不会对同一路径重复弹框（Phase 16）。
 */

import { resolve as resolvePath, dirname, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { existsSync } from "node:fs";

export type PathOperation = "read" | "write" | "delete" | "exec";

export type PathAccessTier = 0 | 1 | 2 | 3 | 4 | 5;

export type PathAccessDecision = {
  tier: PathAccessTier;
  granted: boolean;
  needsPrompt: boolean;
  /** 机读原因码，供 audit / error message 拼装。 */
  reason: string;
  canonicalPath: string;
};

export type PathGrants = {
  /** T3 持久允许的目录（及其子路径）。 */
  allowedDirs: string[];
  /** T5 持久拒绝路径（及其子路径）。 */
  deniedPaths: string[];
};

export type PathApprovalInput = {
  canonicalPath: string;
  userPath: string;
  operation: PathOperation;
  toolId: string;
  sessionId: string;
  fileSize?: number;
  isBinary?: boolean;
};

export type PathApprovalResponse =
  | { kind: "allow-once" }
  | { kind: "allow-session" }
  | { kind: "allow-directory"; directory?: string }
  | { kind: "deny" }
  | { kind: "deny-persistent" }
  | { kind: "timeout" };

export type PathPolicyApprovalCallback = (
  input: PathApprovalInput,
) => Promise<PathApprovalResponse>;

/** NFC 归一 + canonical（文件存在则 realpath，否则 resolve）。 */
export async function canonicalize(p: string): Promise<string> {
  const norm = p.normalize("NFC");
  try {
    if (existsSync(norm)) {
      const r = await realpath(norm);
      return r.normalize("NFC");
    }
  } catch {
    // fall through
  }
  return resolvePath(norm).normalize("NFC");
}

/**
 * 判断 child 是否等于或位于 ancestor 下面。要求已 resolve。
 * 兼容 POSIX `/` 与 Windows `\\` 两种分隔符（跨平台路径测试用）。
 */
export function isInsidePath(ancestor: string, child: string): boolean {
  if (!ancestor || !child) return false;
  if (child === ancestor) return true;
  // 尝试 ancestor + 当前平台 sep
  const primary = ancestor.endsWith(sep) ? ancestor : ancestor + sep;
  if (child.startsWith(primary)) return true;
  // 补尝另一方向的 sep（便于跨平台测试 / POSIX 路径混用场景）
  const altSep = sep === "/" ? "\\" : "/";
  const alt = ancestor.endsWith(altSep) ? ancestor : ancestor + altSep;
  return child.startsWith(alt);
}

export class PathAccessPolicy {
  private workspaceRoot: string;
  private persistentGrants: PathGrants;
  private approvalCallback: PathPolicyApprovalCallback | null = null;

  private allowedSessionPaths = new Set<string>();
  private allowedSessionDirs = new Set<string>();
  private writeReconfirmedPaths = new Set<string>();
  private deniedSessionPaths = new Set<string>();

  /** T1：本轮用户消息里抽出的路径（NFC canonical）。 */
  private turnUserReferencedPaths = new Set<string>();

  /** Phase 16 replay 缓存：`${op}:${canonicalPath}` → 决策。 */
  private replayCache = new Map<string, PathAccessDecision>();

  /** 同一 canonicalPath 并发请求合并到同一 promise（Phase 14）。 */
  private pendingPrompts = new Map<string, Promise<PathAccessDecision>>();

  constructor(
    workspaceRoot: string,
    persistentGrants: PathGrants = { allowedDirs: [], deniedPaths: [] },
    approvalCallback: PathPolicyApprovalCallback | null = null,
  ) {
    this.workspaceRoot = resolvePath(workspaceRoot).normalize("NFC");
    this.persistentGrants = persistentGrants;
    this.approvalCallback = approvalCallback;
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = resolvePath(root).normalize("NFC");
  }

  setApprovalCallback(cb: PathPolicyApprovalCallback | null): void {
    this.approvalCallback = cb;
  }

  updatePersistentGrants(grants: PathGrants): void {
    this.persistentGrants = grants;
  }

  setTurnUserReferencedPaths(paths: string[]): void {
    this.turnUserReferencedPaths = new Set(
      paths.map((p) => resolvePath(p).normalize("NFC")),
    );
  }

  /** 重置会话级状态（新会话 / 会话重启时调）。 */
  resetSessionState(): void {
    this.allowedSessionPaths.clear();
    this.allowedSessionDirs.clear();
    this.writeReconfirmedPaths.clear();
    this.deniedSessionPaths.clear();
    this.replayCache.clear();
    this.pendingPrompts.clear();
  }

  getCachedDecision(canonicalPath: string, op: PathOperation): PathAccessDecision | null {
    return this.replayCache.get(`${op}:${canonicalPath}`) ?? null;
  }

  /** 主入口：检查 + （必要时）异步征询用户。 */
  async checkOrPrompt(input: PathApprovalInput): Promise<PathAccessDecision> {
    const cached = this.getCachedDecision(input.canonicalPath, input.operation);
    if (cached) return cached;

    const sync = this.checkSync(input.canonicalPath, input.operation);
    if (!sync.needsPrompt) {
      this.replayCache.set(`${input.operation}:${input.canonicalPath}`, sync);
      return sync;
    }

    if (!this.approvalCallback) {
      const noCb: PathAccessDecision = {
        tier: 4,
        granted: false,
        needsPrompt: false,
        reason: "no_approval_callback",
        canonicalPath: input.canonicalPath,
      };
      this.replayCache.set(`${input.operation}:${input.canonicalPath}`, noCb);
      return noCb;
    }

    // 并发合并：同一路径 + 同一操作的并行请求共享一个 promise
    const key = `${input.operation}:${input.canonicalPath}`;
    const existing = this.pendingPrompts.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const response = await this.approvalCallback!(input);
        const result = this.applyDecision(input, response);
        this.replayCache.set(key, result);
        return result;
      } finally {
        this.pendingPrompts.delete(key);
      }
    })();
    this.pendingPrompts.set(key, promise);
    return promise;
  }

  /** 同步判断（给调试 / 审计层做只读查询用）。 */
  checkSyncOnly(canonicalPath: string, op: PathOperation): PathAccessDecision {
    return this.checkSync(canonicalPath, op);
  }

  private checkSync(canonicalPath: string, op: PathOperation): PathAccessDecision {
    const p = canonicalPath.normalize("NFC");

    // T0 workspace 内
    if (isInsidePath(this.workspaceRoot, p)) {
      return { tier: 0, granted: true, needsPrompt: false, reason: "workspace", canonicalPath: p };
    }

    // T5 session 拒绝（优先于任何放行查询）
    if (this.deniedSessionPaths.has(p)) {
      return { tier: 5, granted: false, needsPrompt: false, reason: "session_denied", canonicalPath: p };
    }

    // T5 持久拒绝
    for (const deny of this.persistentGrants.deniedPaths) {
      const d = resolvePath(deny).normalize("NFC");
      if (d === p || isInsidePath(d, p)) {
        return { tier: 5, granted: false, needsPrompt: false, reason: "persistent_denied", canonicalPath: p };
      }
    }

    // T1 用户本轮消息里提到的路径
    for (const ref of this.turnUserReferencedPaths) {
      if (ref === p || isInsidePath(ref, p) || isInsidePath(p, ref)) {
        return { tier: 1, granted: true, needsPrompt: false, reason: "user_referenced", canonicalPath: p };
      }
    }

    // T3 持久授权目录
    for (const dir of this.persistentGrants.allowedDirs) {
      const d = resolvePath(dir).normalize("NFC");
      if (isInsidePath(d, p)) {
        if ((op === "write" || op === "delete") && !this.writeReconfirmedPaths.has(p)) {
          return { tier: 4, granted: false, needsPrompt: true, reason: "write_reconfirm_persistent", canonicalPath: p };
        }
        return { tier: 3, granted: true, needsPrompt: false, reason: "persistent_dir", canonicalPath: p };
      }
    }

    // T2 会话级授权路径 / 目录
    if (this.allowedSessionPaths.has(p)) {
      if ((op === "write" || op === "delete") && !this.writeReconfirmedPaths.has(p)) {
        return { tier: 4, granted: false, needsPrompt: true, reason: "write_reconfirm_session", canonicalPath: p };
      }
      return { tier: 2, granted: true, needsPrompt: false, reason: "session_path", canonicalPath: p };
    }
    for (const d of this.allowedSessionDirs) {
      if (isInsidePath(d, p)) {
        if ((op === "write" || op === "delete") && !this.writeReconfirmedPaths.has(p)) {
          return { tier: 4, granted: false, needsPrompt: true, reason: "write_reconfirm_session_dir", canonicalPath: p };
        }
        return { tier: 2, granted: true, needsPrompt: false, reason: "session_dir", canonicalPath: p };
      }
    }

    // T4 首次外部
    return { tier: 4, granted: false, needsPrompt: true, reason: "first_external", canonicalPath: p };
  }

  private applyDecision(
    input: PathApprovalInput,
    response: PathApprovalResponse,
  ): PathAccessDecision {
    const p = input.canonicalPath;
    const isWrite = input.operation === "write" || input.operation === "delete";

    switch (response.kind) {
      case "allow-once":
        if (isWrite) this.writeReconfirmedPaths.add(p);
        return { tier: 4, granted: true, needsPrompt: false, reason: "user_approved_once", canonicalPath: p };
      case "allow-session":
        this.allowedSessionPaths.add(p);
        if (isWrite) this.writeReconfirmedPaths.add(p);
        return { tier: 4, granted: true, needsPrompt: false, reason: "user_approved_session", canonicalPath: p };
      case "allow-directory": {
        const dir = (response.directory ?? dirname(p)).normalize("NFC");
        this.allowedSessionDirs.add(dir);
        if (isWrite) this.writeReconfirmedPaths.add(p);
        return { tier: 4, granted: true, needsPrompt: false, reason: "user_approved_directory", canonicalPath: p };
      }
      case "deny":
        this.deniedSessionPaths.add(p);
        return { tier: 4, granted: false, needsPrompt: false, reason: "user_denied_once", canonicalPath: p };
      case "deny-persistent":
        // persistent 更新由 caller 负责（写进 ApprovalPolicy.pathGrants），这里只更新 session 侧
        this.deniedSessionPaths.add(p);
        return { tier: 4, granted: false, needsPrompt: false, reason: "user_denied_persistent", canonicalPath: p };
      case "timeout":
        return { tier: 4, granted: false, needsPrompt: false, reason: "approval_timeout", canonicalPath: p };
    }
  }
}

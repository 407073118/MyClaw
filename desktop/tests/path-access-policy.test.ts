import { describe, it, expect, beforeEach } from "vitest";
import {
  PathAccessPolicy,
  isInsidePath,
  type PathApprovalResponse,
} from "../src/main/services/path-access-policy";

const WIN_WORKSPACE = "F:\\work\\my-project";
const WIN_EXTERNAL = "F:\\面试录音\\百融测试工单交付流程.xlsx";
const WIN_EXTERNAL_DIR = "F:\\面试录音";

describe("PathAccessPolicy — 五层信任体系", () => {
  let policy: PathAccessPolicy;

  beforeEach(() => {
    policy = new PathAccessPolicy(WIN_WORKSPACE, { allowedDirs: [], deniedPaths: [] });
  });

  it("T0: 工作区内路径直接放行", async () => {
    const d = await policy.checkOrPrompt({
      canonicalPath: "F:\\work\\my-project\\src\\foo.ts",
      userPath: "src/foo.ts",
      operation: "read",
      toolId: "fs.read",
      sessionId: "s1",
    });
    expect(d.tier).toBe(0);
    expect(d.granted).toBe(true);
  });

  it("T1: 用户本轮消息里提到的路径自动放行", async () => {
    policy.setTurnUserReferencedPaths([WIN_EXTERNAL]);
    const d = await policy.checkOrPrompt({
      canonicalPath: WIN_EXTERNAL,
      userPath: WIN_EXTERNAL,
      operation: "read",
      toolId: "fs.read",
      sessionId: "s1",
    });
    expect(d.tier).toBe(1);
    expect(d.granted).toBe(true);
    expect(d.reason).toBe("user_referenced");
  });

  it("T1: 用户提到目录，子文件自动放行", async () => {
    policy.setTurnUserReferencedPaths([WIN_EXTERNAL_DIR]);
    const d = await policy.checkOrPrompt({
      canonicalPath: WIN_EXTERNAL,
      userPath: WIN_EXTERNAL,
      operation: "read",
      toolId: "fs.read",
      sessionId: "s1",
    });
    expect(d.tier).toBe(1);
    expect(d.granted).toBe(true);
  });

  it("T3: 持久授权目录放行", async () => {
    const p = new PathAccessPolicy(WIN_WORKSPACE, {
      allowedDirs: [WIN_EXTERNAL_DIR],
      deniedPaths: [],
    });
    const d = await p.checkOrPrompt({
      canonicalPath: WIN_EXTERNAL,
      userPath: WIN_EXTERNAL,
      operation: "read",
      toolId: "fs.read",
      sessionId: "s1",
    });
    expect(d.tier).toBe(3);
    expect(d.granted).toBe(true);
  });

  it("T5 persistent: 拒绝先于放行", async () => {
    const p = new PathAccessPolicy(WIN_WORKSPACE, {
      allowedDirs: [WIN_EXTERNAL_DIR],
      deniedPaths: [WIN_EXTERNAL],
    });
    const d = await p.checkOrPrompt({
      canonicalPath: WIN_EXTERNAL,
      userPath: WIN_EXTERNAL,
      operation: "read",
      toolId: "fs.read",
      sessionId: "s1",
    });
    expect(d.tier).toBe(5);
    expect(d.granted).toBe(false);
  });

  it("T4: 首次外部路径无 callback 时拒绝", async () => {
    const d = await policy.checkOrPrompt({
      canonicalPath: WIN_EXTERNAL,
      userPath: WIN_EXTERNAL,
      operation: "read",
      toolId: "fs.read",
      sessionId: "s1",
    });
    expect(d.tier).toBe(4);
    expect(d.granted).toBe(false);
    expect(d.reason).toBe("no_approval_callback");
  });

  it("T4 → T2: callback 返回 allow-session 后同路径第二次命中缓存", async () => {
    const p = new PathAccessPolicy(
      WIN_WORKSPACE,
      { allowedDirs: [], deniedPaths: [] },
      async (): Promise<PathApprovalResponse> => ({ kind: "allow-session" }),
    );
    const first = await p.checkOrPrompt({
      canonicalPath: WIN_EXTERNAL,
      userPath: WIN_EXTERNAL,
      operation: "read",
      toolId: "fs.read",
      sessionId: "s1",
    });
    expect(first.granted).toBe(true);
    expect(first.reason).toBe("user_approved_session");

    // 第二次：命中 replay cache（不再调 callback）
    let secondCallbackFired = false;
    p.setApprovalCallback(async () => {
      secondCallbackFired = true;
      return { kind: "deny" };
    });
    const second = await p.checkOrPrompt({
      canonicalPath: WIN_EXTERNAL,
      userPath: WIN_EXTERNAL,
      operation: "read",
      toolId: "fs.read",
      sessionId: "s1",
    });
    expect(second.granted).toBe(true);
    expect(secondCallbackFired).toBe(false);
  });

  it("写操作即使 T2 read-allowed 仍走 prompt 重确认", async () => {
    let promptCount = 0;
    const p = new PathAccessPolicy(
      WIN_WORKSPACE,
      { allowedDirs: [], deniedPaths: [] },
      async (): Promise<PathApprovalResponse> => {
        promptCount++;
        return { kind: "allow-once" };
      },
    );
    // 先批准读
    await p.checkOrPrompt({
      canonicalPath: WIN_EXTERNAL,
      userPath: WIN_EXTERNAL,
      operation: "read",
      toolId: "fs.read",
      sessionId: "s1",
    });
    expect(promptCount).toBe(1);
    // 写操作要再 prompt（replay cache 是 op-specific）
    const writeD = await p.checkOrPrompt({
      canonicalPath: WIN_EXTERNAL,
      userPath: WIN_EXTERNAL,
      operation: "write",
      toolId: "fs.write",
      sessionId: "s1",
    });
    expect(promptCount).toBe(2);
    expect(writeD.granted).toBe(true);
  });

  it("超时决策：callback 返回 timeout → 不缓存为 granted", async () => {
    const p = new PathAccessPolicy(
      WIN_WORKSPACE,
      { allowedDirs: [], deniedPaths: [] },
      async (): Promise<PathApprovalResponse> => ({ kind: "timeout" }),
    );
    const d = await p.checkOrPrompt({
      canonicalPath: WIN_EXTERNAL,
      userPath: WIN_EXTERNAL,
      operation: "read",
      toolId: "fs.read",
      sessionId: "s1",
    });
    expect(d.granted).toBe(false);
    expect(d.reason).toBe("approval_timeout");
  });

  it("并发同一路径只触发一次 callback（pendingPrompts 合并）", async () => {
    let callCount = 0;
    const p = new PathAccessPolicy(
      WIN_WORKSPACE,
      { allowedDirs: [], deniedPaths: [] },
      async (): Promise<PathApprovalResponse> => {
        callCount++;
        await new Promise((r) => setTimeout(r, 10));
        return { kind: "allow-once" };
      },
    );
    const input = {
      canonicalPath: WIN_EXTERNAL,
      userPath: WIN_EXTERNAL,
      operation: "read" as const,
      toolId: "fs.read",
      sessionId: "s1",
    };
    const [a, b, c] = await Promise.all([
      p.checkOrPrompt(input),
      p.checkOrPrompt(input),
      p.checkOrPrompt(input),
    ]);
    expect(callCount).toBe(1);
    expect(a.granted && b.granted && c.granted).toBe(true);
  });
});

describe("isInsidePath 边界", () => {
  it("相等和子路径", () => {
    expect(isInsidePath("/a/b", "/a/b")).toBe(true);
    expect(isInsidePath("/a/b", "/a/b/c")).toBe(true);
    expect(isInsidePath("/a/b", "/a/bc")).toBe(false); // 前缀相同但不是子路径
    expect(isInsidePath("/a/b", "/a")).toBe(false);
  });
});

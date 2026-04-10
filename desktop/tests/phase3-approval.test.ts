/**
 * Phase 3: Tool Approval
 *
 * 测试内容：
 * - APPR-01: High-risk tools require approval
 * - APPR-04: Approval mode configurable (always-ask / always-allow / inherit)
 * - APPR-05: Read-only tools auto-approved
 */

import { describe, it, expect } from "vitest";
import {
  shouldRequestApproval,
  createDefaultApprovalPolicy,
} from "../shared/contracts/approval";
import { ToolRiskCategory } from "../shared/contracts/events";
import type { ApprovalPolicy } from "../shared/contracts/approval";

// ---------------------------------------------------------------------------
// APPR-05: Read-only tools auto-approved
// ---------------------------------------------------------------------------

describe("Phase 3: Read-only tools auto-approved", () => {
  it("should NOT request approval for read-only tools with default policy", () => {
    const policy = createDefaultApprovalPolicy();
    // Default policy: mode=prompt, autoApproveReadOnly=true

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "fs.read",
      risk: ToolRiskCategory.Read,
    })).toBe(false);

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "fs.list",
      risk: ToolRiskCategory.Read,
    })).toBe(false);

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "git.status",
      risk: ToolRiskCategory.Read,
    })).toBe(false);

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "git.diff",
      risk: ToolRiskCategory.Read,
    })).toBe(false);

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "git.log",
      risk: ToolRiskCategory.Read,
    })).toBe(false);

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "fs.search",
      risk: ToolRiskCategory.Read,
    })).toBe(false);

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "fs.find",
      risk: ToolRiskCategory.Read,
    })).toBe(false);

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "git.status",
      risk: ToolRiskCategory.Read,
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// APPR-01: High-risk tools require approval
// ---------------------------------------------------------------------------

describe("Phase 3: High-risk tools require approval", () => {
  it("should request approval for write tools", () => {
    const policy = createDefaultApprovalPolicy();

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "fs.write",
      risk: ToolRiskCategory.Write,
    })).toBe(true);

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "fs.edit",
      risk: ToolRiskCategory.Write,
    })).toBe(true);

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "git.commit",
      risk: ToolRiskCategory.Write,
    })).toBe(true);
  });

  it("should request approval for exec tools", () => {
    const policy = createDefaultApprovalPolicy();

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "exec.command",
      risk: ToolRiskCategory.Exec,
    })).toBe(true);
  });

  it("should request approval for network tools", () => {
    const policy = createDefaultApprovalPolicy();

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "http.fetch",
      risk: ToolRiskCategory.Network,
    })).toBe(true);

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "web.search",
      risk: ToolRiskCategory.Network,
    })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// APPR-04: Approval mode configurable
// ---------------------------------------------------------------------------

describe("Phase 3: Approval mode configurable", () => {
  it("auto-allow-all should never request approval", () => {
    const policy: ApprovalPolicy = {
      mode: "auto-allow-all",
      autoApproveReadOnly: true,
      autoApproveSkills: true,
      alwaysAllowedTools: [],
    };

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "fs.write",
      risk: ToolRiskCategory.Write,
    })).toBe(false);

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "exec.command",
      risk: ToolRiskCategory.Exec,
    })).toBe(false);
  });

  it("alwaysAllowedTools should bypass approval", () => {
    const policy: ApprovalPolicy = {
      mode: "prompt",
      autoApproveReadOnly: true,
      autoApproveSkills: false,
      alwaysAllowedTools: ["fs.write", "exec.command"],
    };

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "fs.write",
      risk: ToolRiskCategory.Write,
    })).toBe(false);

    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "exec.command",
      risk: ToolRiskCategory.Exec,
    })).toBe(false);

    // But git.commit not in list — still needs approval
    expect(shouldRequestApproval({
      policy,
      source: "builtin-tool",
      toolId: "git.commit",
      risk: ToolRiskCategory.Write,
    })).toBe(true);
  });

  it("skills should auto-approve when autoApproveSkills=true", () => {
    const policy = createDefaultApprovalPolicy();
    // Default has autoApproveSkills: true

    expect(shouldRequestApproval({
      policy,
      source: "skill",
      toolId: "skill_invoke__my-skill",
      risk: ToolRiskCategory.Read,
    })).toBe(false);
  });

  it("skills should require approval when autoApproveSkills=false", () => {
    const policy: ApprovalPolicy = {
      mode: "prompt",
      autoApproveReadOnly: false,
      autoApproveSkills: false,
      alwaysAllowedTools: [],
    };

    expect(shouldRequestApproval({
      policy,
      source: "skill",
      toolId: "skill_invoke__my-skill",
      risk: ToolRiskCategory.Read,
    })).toBe(true);
  });
});

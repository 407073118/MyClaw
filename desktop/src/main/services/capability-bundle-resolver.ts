import { createHash } from "node:crypto";

import type {
  CapabilityBundle,
  CapabilityInstallation,
  McpTool,
  ProjectCapabilityDetail,
  ProjectCapabilityPref,
  ProjectCapabilityRef,
  RuntimeCapabilityRef,
  SkillDefinition,
} from "@shared/contracts";

import { ProjectCapabilityService } from "./project-capability-service";
import { ProjectMcpRuntimeService } from "./project-mcp-runtime-service";

type RuntimeResolvedMcpTool = McpTool & {
  serverId: string;
  enabled?: boolean;
  exposedToModel?: boolean;
};

type ProjectMcpLocalPolicy = {
  localConfirmed?: boolean;
  secretsConfigured?: boolean;
  allowExposeToModel?: boolean;
};

type ProjectMcpRuntimePolicy = {
  requiresLocalConfirmation?: boolean;
  allowAutoExposeToModel?: boolean;
  riskLevel?: "low" | "medium" | "high";
};

/** 将工具名片段收敛为 OpenAI function name 安全字符。 */
function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "capability";
}

/** 保留 MCP legacy 双下划线结构，只替换 function name 不允许的字符。 */
function sanitizeFunctionNamePreserveUnderscore(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_") || "mcp__unknown__tool";
}

/** 生成短 hash，用于同名能力冲突时保持工具名稳定。 */
function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** 解析项目能力偏好是否允许进入模型。 */
function isProjectCapabilityEnabled(ref: ProjectCapabilityRef, pref: ProjectCapabilityPref | undefined): boolean {
  const state = pref?.localState ?? "inherit";
  if (state === "disabled" || state === "hidden") return false;
  if (state === "enabled") return true;
  return ref.defaultEnabled;
}

/** 检查项目是否处于 fail closed 状态。 */
function isProjectUnavailable(detail: ProjectCapabilityDetail): boolean {
  const project = detail.project;
  if (project.revokedAt || project.deletedAt) return true;
  if (project.expiresAt && new Date(project.expiresAt).getTime() <= Date.now()) return true;
  return false;
}

/** 检查项目 Skill 安装状态是否可执行。 */
function isReadySkillInstallation(ref: ProjectCapabilityRef, installation: CapabilityInstallation | undefined): boolean {
  return installation?.installStatus === "ready"
    && Boolean(installation.installDir)
    && installation.installedReleaseId === ref.cloudReleaseId;
}

/** 从 unknown policy 中安全取 MCP 本地确认状态。 */
function readLocalMcpPolicy(pref: ProjectCapabilityPref | undefined): ProjectMcpLocalPolicy {
  const value = pref?.localPolicyJson;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ProjectMcpLocalPolicy
    : {};
}

/** 从 unknown policy 中安全取 MCP runtime 策略。 */
function readRuntimeMcpPolicy(ref: ProjectCapabilityRef): ProjectMcpRuntimePolicy {
  const value = ref.runtimePolicyJson;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ProjectMcpRuntimePolicy
    : {};
}

/** 从 manifest 兼容读取 MCP inputSchema。 */
function readManifestInputSchema(manifestJson: unknown): unknown {
  return manifestJson && typeof manifestJson === "object" && !Array.isArray(manifestJson) && "inputSchema" in manifestJson
    ? (manifestJson as { inputSchema?: unknown }).inputSchema ?? null
    : null;
}

/** 从 SkillDefinition 生成 bundle 中的轻量 manifest，保留 view 和脚本目录信息。 */
function buildSkillManifest(skill: SkillDefinition): Record<string, unknown> {
  return {
    hasViewFile: skill.hasViewFile === true,
    viewFiles: Array.isArray(skill.viewFiles) ? skill.viewFiles : [],
    hasScriptsDirectory: skill.hasScriptsDirectory === true,
  };
}

/** 项目 MCP 暴露给模型前的本地安全门禁。 */
function isProjectMcpAllowed(ref: ProjectCapabilityRef, pref: ProjectCapabilityPref | undefined): boolean {
  if (!isProjectCapabilityEnabled(ref, pref)) return false;
  if (ref.syncStatus !== "synced") return false;
  const localPolicy = readLocalMcpPolicy(pref);
  const runtimePolicy = readRuntimeMcpPolicy(ref);
  return localPolicy.localConfirmed === true
    && localPolicy.allowExposeToModel === true
    && localPolicy.secretsConfigured === true
    && runtimePolicy.allowAutoExposeToModel === true;
}

/** 生成不冲突的函数名，冲突时追加短 hash。 */
function allocateFunctionName(base: string, identity: string, usedNames: Set<string>): string {
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  const withHash = `${base}_${shortHash(identity)}`;
  usedNames.add(withHash);
  return withHash;
}

/** 解析每轮会话运行可见的冻结能力包。 */
export class CapabilityBundleResolver {
  constructor(
    private readonly projectCapabilities: ProjectCapabilityService,
    private readonly projectMcpRuntime: ProjectMcpRuntimeService = new ProjectMcpRuntimeService(),
  ) {}

  /** 解析指定会话本轮运行可见的冻结能力包。 */
  async resolveForSession(input: {
    sessionId: string;
    globalSkills: SkillDefinition[];
    globalMcpTools: RuntimeResolvedMcpTool[];
  }): Promise<CapabilityBundle> {
    const usedNames = new Set<string>();
    const functionNameMap: Record<string, RuntimeCapabilityRef> = {};
    const skills: RuntimeCapabilityRef[] = [];
    const mcpTools: RuntimeCapabilityRef[] = [];
    const localProjectId = this.projectCapabilities.getSessionProjectBinding(input.sessionId);
    const detail = localProjectId ? this.projectCapabilities.getProjectDetail(localProjectId) : null;
    console.info("[capability-bundle-resolver] 开始解析会话能力包", {
      sessionId: input.sessionId,
      localProjectId,
      globalSkillCount: input.globalSkills.length,
      globalMcpToolCount: input.globalMcpTools.length,
      projectRefCount: detail?.refs.length ?? 0,
    });

    for (const skill of input.globalSkills.filter((item) => item.enabled && !item.disableModelInvocation)) {
      if (!skill.path) {
        console.warn("[capability-bundle-resolver] 跳过缺少路径的全局 Skill", { skillId: skill.id });
        continue;
      }
      const functionName = allocateFunctionName(
        `skill_invoke__global_${sanitizeName(skill.id)}`,
        `global:skill:${skill.id}`,
        usedNames,
      );
      const ref: RuntimeCapabilityRef = {
        source: "global",
        kind: "skill",
        id: skill.id,
        installDir: skill.path,
        functionName,
        displayName: skill.name,
        description: skill.description ?? null,
        manifestJson: buildSkillManifest(skill),
      };
      skills.push(ref);
      functionNameMap[functionName] = ref;
    }

    for (const tool of input.globalMcpTools.filter((item) => item.enabled !== false && item.exposedToModel !== false)) {
      const safeToolName = allocateFunctionName(
        sanitizeFunctionNamePreserveUnderscore(tool.id),
        `global:mcp:${tool.id}`,
        usedNames,
      );
      const ref: RuntimeCapabilityRef = {
        source: "global",
        kind: "mcp",
        id: tool.id,
        functionName: safeToolName,
        displayName: tool.name,
        description: tool.description ?? null,
        manifestJson: { inputSchema: tool.inputSchema ?? null },
        serverId: tool.serverId,
        toolName: tool.name,
        inputSchema: tool.inputSchema ?? null,
      };
      mcpTools.push(ref);
      functionNameMap[safeToolName] = ref;
    }

    if (detail && !isProjectUnavailable(detail)) {
      const prefs = new Map(detail.prefs.map((pref) => [pref.capabilityRefId, pref]));
      const installations = new Map(
        detail.installations
          .filter((installation) => installation.capabilityRefId)
          .map((installation) => [installation.capabilityRefId!, installation]),
      );
      for (const ref of detail.refs.filter((item) => item.kind === "skill")) {
        const pref = prefs.get(ref.id);
        const installation = installations.get(ref.id);
        if (!isProjectCapabilityEnabled(ref, pref)) {
          console.info("[capability-bundle-resolver] 跳过本机停用的项目 Skill", { capabilityRefId: ref.id });
          continue;
        }
        if (ref.syncStatus !== "synced") {
          console.warn("[capability-bundle-resolver] 跳过未同步项目 Skill", { capabilityRefId: ref.id, syncStatus: ref.syncStatus });
          continue;
        }
        if (!isReadySkillInstallation(ref, installation)) {
          console.warn("[capability-bundle-resolver] 跳过未就绪项目 Skill", {
            capabilityRefId: ref.id,
            installStatus: installation?.installStatus ?? "missing",
          });
          continue;
        }
        const functionName = allocateFunctionName(
          `skill_invoke__project_${sanitizeName(detail.project.code)}_${sanitizeName(ref.alias ?? ref.displayName ?? ref.cloudCapabilityId)}`,
          `project:skill:${detail.project.id}:${ref.id}:${ref.cloudReleaseId}`,
          usedNames,
        );
        const runtimeRef: RuntimeCapabilityRef = {
          source: "project",
          kind: "skill",
          id: ref.cloudCapabilityId,
          localProjectId: detail.project.id,
          capabilityRefId: ref.id,
          installDir: installation?.installDir ?? null,
          releaseId: ref.cloudReleaseId,
          functionName,
          displayName: ref.displayName,
          description: ref.description,
          manifestJson: ref.manifestJson,
        };
        skills.push(runtimeRef);
        functionNameMap[functionName] = runtimeRef;
      }

      for (const ref of detail.refs.filter((item) => item.kind === "mcp")) {
        const pref = prefs.get(ref.id);
        if (!isProjectMcpAllowed(ref, pref)) {
          console.info("[capability-bundle-resolver] 跳过未通过本地安全门禁的项目 MCP", { capabilityRefId: ref.id });
          continue;
        }
        const baseRuntimeRef: RuntimeCapabilityRef = {
          source: "project",
          kind: "mcp",
          id: ref.cloudCapabilityId,
          localProjectId: detail.project.id,
          capabilityRefId: ref.id,
          releaseId: ref.cloudReleaseId,
          displayName: ref.displayName,
          description: ref.description,
          manifestJson: ref.manifestJson,
          runtimePolicyJson: ref.runtimePolicyJson,
          runtimeConfigJson: ref.cloudConfigJson,
          serverId: ref.id,
          inputSchema: readManifestInputSchema(ref.manifestJson),
        };
        try {
          const tools = await this.projectMcpRuntime.listToolsForCapability(baseRuntimeRef);
          console.info("[capability-bundle-resolver] 项目 MCP 工具枚举成功", {
            capabilityRefId: ref.id,
            toolCount: tools.length,
          });
          for (const tool of tools) {
            const functionName = allocateFunctionName(
              `mcp_project_${sanitizeName(detail.project.code)}_${sanitizeName(ref.alias ?? ref.displayName ?? ref.cloudCapabilityId)}_${sanitizeName(tool.name)}`,
              `project:mcp:${detail.project.id}:${ref.id}:${ref.cloudReleaseId}:${tool.name}`,
              usedNames,
            );
            const runtimeRef: RuntimeCapabilityRef = {
              ...baseRuntimeRef,
              functionName,
              toolName: tool.name,
              displayName: `${ref.displayName} / ${tool.name}`,
              description: tool.description || ref.description,
              inputSchema: tool.inputSchema ?? readManifestInputSchema(ref.manifestJson),
            };
            mcpTools.push(runtimeRef);
            functionNameMap[functionName] = runtimeRef;
          }
        } catch (error) {
          console.warn("[capability-bundle-resolver] 项目 MCP 工具枚举失败，已 fail closed", {
            capabilityRefId: ref.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const hash = this.hashBundle(input.sessionId, localProjectId, functionNameMap);
    const bundle: CapabilityBundle = {
      id: `bundle-${hash.slice(0, 16)}`,
      hash,
      sessionId: input.sessionId,
      project: detail && !isProjectUnavailable(detail) ? detail.project : null,
      skills,
      mcpTools,
      functionNameMap,
      createdAt: new Date().toISOString(),
    };
    console.info("[capability-bundle-resolver] 已解析会话能力包", {
      sessionId: input.sessionId,
      localProjectId: bundle.project?.id ?? null,
      hash: bundle.hash,
      skillCount: skills.length,
      mcpToolCount: mcpTools.length,
    });
    return bundle;
  }

  /** 生成不含时间戳的确定性 bundle hash。 */
  private hashBundle(
    sessionId: string,
    localProjectId: string | null,
    functionNameMap: Record<string, RuntimeCapabilityRef>,
  ): string {
    const stableEntries = Object.entries(functionNameMap)
      .map(([functionName, ref]) => ({
        functionName,
        source: ref.source,
        kind: ref.kind,
        id: ref.id,
        localProjectId: ref.localProjectId ?? null,
        capabilityRefId: ref.capabilityRefId ?? null,
        releaseId: ref.releaseId ?? null,
      }))
      .sort((left, right) => left.functionName.localeCompare(right.functionName));
    return createHash("sha256")
      .update(JSON.stringify({ sessionId, localProjectId, entries: stableEntries }))
      .digest("hex");
  }
}

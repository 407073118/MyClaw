/**
 * 硅基员工独立工作空间管理。
 *
 * 每个硅基员工拥有完全独立的 skills、MCP 服务和 sessions，
 * 就像主助手拥有完整的 `myClaw/` 工作空间一样。
 *
 * 工作空间按需懒加载，缓存在内存中，关闭时释放资源。
 */

import type { SkillDefinition } from "@shared/contracts";
import type { MyClawPaths } from "./directory-service";
import type { SiliconPersonPaths } from "./directory-service";
import { deriveSiliconPersonPaths, ensureSiliconPersonDirectories } from "./directory-service";
import { McpServerManager } from "./mcp-server-manager";
import { loadSkillsFromDisk, seedBuiltinSkills } from "./skill-loader";
import { createLogger } from "./logger";

const log = createLogger("silicon-person-workspace");

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type SiliconPersonWorkspace = {
  personId: string;
  paths: SiliconPersonPaths;
  /** 员工自己的技能列表（从员工 skills/ 目录加载）。 */
  skills: SkillDefinition[];
  /** 员工自己的 MCP 服务管理器（读写员工目录下的 mcp-servers.json）。 */
  mcpManager: McpServerManager;
};

// ---------------------------------------------------------------------------
// 工作空间缓存
// ---------------------------------------------------------------------------

const activeWorkspaces = new Map<string, SiliconPersonWorkspace>();

// ---------------------------------------------------------------------------
// 公开接口
// ---------------------------------------------------------------------------

/**
 * 获取或创建硅基员工的独立工作空间。
 *
 * 首次调用时：
 *   1. 确保员工目录结构存在（skills/、sessions/ 等）
 *   2. 种子内置技能到员工的 skills/ 目录
 *   3. 从员工 skills/ 目录加载技能
 *   4. 为员工创建独立的 McpServerManager
 *   5. 自动连接员工已启用的 MCP 服务
 *
 * 后续调用直接返回缓存的工作空间。
 */
export async function getOrCreateWorkspace(
  paths: MyClawPaths,
  personId: string,
): Promise<SiliconPersonWorkspace> {
  const existing = activeWorkspaces.get(personId);
  if (existing) return existing;

  const personPaths = deriveSiliconPersonPaths(paths, personId);
  ensureSiliconPersonDirectories(personPaths);

  // 种子内置技能到员工自己的 skills 目录
  seedBuiltinSkills(personPaths.skillsDir);

  // 从员工自己的 skills 目录加载技能
  const skills = loadSkillsFromDisk(personPaths.skillsDir);

  // 为员工创建独立的 MCP 管理器（使用 personDir 作为根，读 personDir/mcp-servers.json）
  const mcpManager = new McpServerManager(personPaths.personDir);

  // 自动连接已启用的 MCP 服务
  mcpManager.connectAllEnabled().catch((err) => {
    log.warn("MCP auto-connect failed for silicon person", {
      personId,
      error: String(err),
    });
  });

  const workspace: SiliconPersonWorkspace = {
    personId,
    paths: personPaths,
    skills,
    mcpManager,
  };

  activeWorkspaces.set(personId, workspace);
  log.info("工作空间已创建", {
    personId,
    skillCount: skills.length,
    mcpServerCount: mcpManager.listServers().length,
  });

  return workspace;
}

/** 获取已缓存的工作空间（不创建新的）。 */
export function getActiveWorkspace(personId: string): SiliconPersonWorkspace | undefined {
  return activeWorkspaces.get(personId);
}

/** 刷新员工的技能列表（重新从磁盘加载）。 */
export function refreshWorkspaceSkills(workspace: SiliconPersonWorkspace): SkillDefinition[] {
  const loaded = loadSkillsFromDisk(workspace.paths.skillsDir);
  workspace.skills.splice(0, workspace.skills.length, ...loaded);
  return loaded;
}

/**
 * 初始化员工工作空间的目录结构（不加载资源）。
 *
 * 在 `silicon-person:create` 时调用，确保目录就绪但不立即启动 MCP 连接。
 */
export function initializeWorkspaceDirectories(
  paths: MyClawPaths,
  personId: string,
): SiliconPersonPaths {
  const personPaths = deriveSiliconPersonPaths(paths, personId);
  ensureSiliconPersonDirectories(personPaths);
  seedBuiltinSkills(personPaths.skillsDir);
  return personPaths;
}

/** 关闭并释放硅基员工工作空间的资源。 */
export async function shutdownWorkspace(personId: string): Promise<void> {
  const workspace = activeWorkspaces.get(personId);
  if (!workspace) return;

  try {
    await workspace.mcpManager.disconnectAll();
  } catch (err) {
    log.warn("MCP disconnect failed during workspace shutdown", {
      personId,
      error: String(err),
    });
  }

  activeWorkspaces.delete(personId);
  log.info("工作空间已关闭", { personId });
}

/** 销毁硅基员工工作空间缓存（删除员工时调用，释放内存与 MCP 连接）。 */
export function destroyWorkspace(personId: string): void {
  const workspace = activeWorkspaces.get(personId);
  if (!workspace) return;
  try {
    workspace.mcpManager.disconnectAll().catch(() => {});
  } catch { /* 忽略 */ }
  activeWorkspaces.delete(personId);
  log.info("工作空间已销毁", { personId });
}

/** 关闭所有活跃的硅基员工工作空间（应用退出时调用）。 */
export async function shutdownAllWorkspaces(): Promise<void> {
  const ids = [...activeWorkspaces.keys()];
  await Promise.allSettled(ids.map((id) => shutdownWorkspace(id)));
}

import { ipcMain } from "electron";

import type { ProjectCapabilityLocalState } from "@shared/contracts";
import type { RuntimeContext } from "../services/runtime-context";
import { ProjectRuntimeContextClient } from "../services/project-runtime-context-client";

/** 断言项目能力服务已经在 runtime context 中初始化。 */
function requireProjectService(ctx: RuntimeContext) {
  const service = ctx.services.projectCapabilities;
  if (!service) {
    throw new Error("project_capability_service_unavailable");
  }
  return service;
}

/** 断言项目 Skill 安装器已经在 runtime context 中初始化。 */
function requireProjectInstaller(ctx: RuntimeContext) {
  const installer = ctx.services.projectSkillInstaller;
  if (!installer) {
    throw new Error("project_skill_installer_unavailable");
  }
  return installer;
}

/** 校验必填字符串，避免空输入进入主进程服务层。 */
function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName}_required`);
  }
  return value.trim();
}

/** 校验本地能力状态枚举。 */
function requireLocalState(value: unknown): ProjectCapabilityLocalState {
  if (value === "inherit" || value === "enabled" || value === "disabled" || value === "hidden") {
    return value;
  }
  throw new Error("local_state_invalid");
}

/** 注册项目绑定、同步、偏好与安装相关 IPC。 */
export function registerProjectHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("projects:list-local", async () => {
    console.info("[projects-ipc] 查询本机绑定项目列表");
    return { items: requireProjectService(ctx).listProjects() };
  });

  ipcMain.handle("projects:get-detail", async (_event, localProjectId: string) => {
    const projectId = requireString(localProjectId, "localProjectId");
    console.info("[projects-ipc] 查询本机项目能力详情", { localProjectId: projectId });
    return requireProjectService(ctx).getProjectDetail(projectId);
  });

  ipcMain.handle("projects:bind-session", async (_event, input: { sessionId?: unknown; localProjectId?: unknown }) => {
    const sessionId = requireString(input?.sessionId, "sessionId");
    const rawProjectId = input?.localProjectId;
    const localProjectId = rawProjectId === null ? null : requireString(rawProjectId, "localProjectId");
    console.info("[projects-ipc] 绑定会话项目", { sessionId, localProjectId });
    requireProjectService(ctx).bindSessionProject(sessionId, localProjectId);
    return { ok: true, localProjectId };
  });

  ipcMain.handle("projects:get-session-binding", async (_event, sessionIdInput: unknown) => {
    const sessionId = requireString(sessionIdInput, "sessionId");
    console.info("[projects-ipc] 查询会话项目绑定", { sessionId });
    const localProjectId = requireProjectService(ctx).getSessionProjectBinding(sessionId);
    return { localProjectId };
  });

  ipcMain.handle("projects:set-capability-state", async (_event, input: { capabilityRefId?: unknown; localState?: unknown }) => {
    const capabilityRefId = requireString(input?.capabilityRefId, "capabilityRefId");
    const localState = requireLocalState(input?.localState);
    console.info("[projects-ipc] 更新项目能力本地状态", { capabilityRefId, localState });
    requireProjectService(ctx).setCapabilityLocalState(capabilityRefId, localState);
    const ref = requireProjectService(ctx).getCapabilityRef(capabilityRefId);
    return ref ? requireProjectService(ctx).getProjectDetail(ref.localProjectId) : { ok: true };
  });

  ipcMain.handle("projects:bind-cloud-project", async (_event, input: {
    cloudProjectId?: unknown;
    sessionId?: unknown;
    accessToken?: unknown;
    accountId?: unknown;
  }) => {
    const cloudProjectId = requireString(input?.cloudProjectId, "cloudProjectId");
    const sessionId = typeof input?.sessionId === "string" && input.sessionId.trim() ? input.sessionId.trim() : null;
    const accessToken = typeof input?.accessToken === "string" ? input.accessToken : undefined;
    const accountId = typeof input?.accountId === "string" ? input.accountId : undefined;
    console.info("[projects-ipc] 绑定 Cloud 项目到本地", { cloudProjectId, sessionId });
    const client = new ProjectRuntimeContextClient();
    const context = await client.fetchRuntimeContext(cloudProjectId, accessToken);
    const detail = requireProjectService(ctx).syncRuntimeContext(context, { accountId });
    if (sessionId) {
      requireProjectService(ctx).bindSessionProject(sessionId, detail.project.id);
    }
    return detail;
  });

  ipcMain.handle("projects:sync", async (_event, input: {
    localProjectId?: unknown;
    accessToken?: unknown;
    accountId?: unknown;
  }) => {
    const localProjectId = requireString(input?.localProjectId, "localProjectId");
    const service = requireProjectService(ctx);
    const project = service.getProjectDetail(localProjectId).project;
    console.info("[projects-ipc] 同步本机绑定项目", {
      localProjectId,
      cloudProjectId: project.cloudProjectId,
    });
    const client = new ProjectRuntimeContextClient();
    const context = await client.fetchRuntimeContext(project.cloudProjectId, typeof input?.accessToken === "string" ? input.accessToken : undefined);
    return service.syncRuntimeContext(context, {
      accountId: typeof input?.accountId === "string" ? input.accountId : project.accountId,
    });
  });

  ipcMain.handle("projects:install-capability", async (_event, input: { capabilityRefId?: unknown }) => {
    const capabilityRefId = requireString(input?.capabilityRefId, "capabilityRefId");
    const service = requireProjectService(ctx);
    const ref = service.getCapabilityRef(capabilityRefId);
    const project = service.findProjectByCapabilityRefId(capabilityRefId);
    if (!ref || !project) {
      throw new Error("project_capability_ref_not_found");
    }
    if (ref.kind !== "skill") {
      throw new Error("Project MCP installation is not supported yet");
    }
    console.info("[projects-ipc] 安装项目能力", { capabilityRefId, kind: ref.kind });
    const installation = await requireProjectInstaller(ctx).installProjectSkill(project, ref);
    return { installation };
  });

  ipcMain.handle("projects:confirm-mcp-capability", async (_event, input: {
    capabilityRefId?: unknown;
    localConfirmed?: unknown;
    secretsConfigured?: unknown;
    allowExposeToModel?: unknown;
  }) => {
    const capabilityRefId = requireString(input?.capabilityRefId, "capabilityRefId");
    const payload = {
      localConfirmed: input?.localConfirmed === true,
      secretsConfigured: input?.secretsConfigured === true,
      allowExposeToModel: input?.allowExposeToModel === true,
    };
    console.info("[projects-ipc] 确认项目 MCP 能力", { capabilityRefId, ...payload });
    requireProjectService(ctx).confirmMcpCapability(capabilityRefId, payload);
    const ref = requireProjectService(ctx).getCapabilityRef(capabilityRefId);
    return ref ? requireProjectService(ctx).getProjectDetail(ref.localProjectId) : { ok: true };
  });
}

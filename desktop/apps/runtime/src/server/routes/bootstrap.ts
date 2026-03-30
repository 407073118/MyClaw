import { createBootstrapResponse } from "../../routes";
import type { HttpRouter } from "../http/router";
import type { RuntimeContext } from "../runtime-context";

/**
 * 注册 bootstrap 域路由。
 * 当前先迁移 `/api/bootstrap`，其他域后续逐步并入同一套路由注册机制。
 */
export function registerBootstrapRoutes(router: HttpRouter, context: RuntimeContext): void {
  router.register("GET", "/api/bootstrap", async ({ response }) => {
    const skills = await context.services.refreshSkills();

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        createBootstrapResponse({
          services: ["desktop-ui", "runtime-api", "shared-contracts", "tauri-shell"],
          defaultModelProfileId: context.state.getDefaultModelProfileId(),
          sessions: context.state.sessions.sessions,
          models: context.state.models,
          myClawRootPath: context.runtime.runtimeLayout.rootDir,
          skillsRootPath: context.runtime.runtimeLayout.skillsDir,
          sessionsRootPath: context.runtime.runtimeLayout.sessionsDir,
          runtimeStateFilePath: context.runtime.runtimeStateFilePath,
          requiresInitialSetup: context.guards.shouldRequireInitialSetup(),
          isFirstLaunch: context.runtime.isFirstLaunch,
          mcp: { servers: context.services.listMcpServers() },
          tools: {
            builtin: context.tools.resolveBuiltinTools(),
            mcp: context.tools.resolveMcpTools(),
          },
          skills: { items: skills },
          employees: context.state.getEmployees(),
          workflows: context.state.getWorkflows(),
          approvals: context.state.getApprovals(),
          approvalRequests: context.state.getApprovalRequests(),
        }),
      ),
    );

    return true;
  });
}

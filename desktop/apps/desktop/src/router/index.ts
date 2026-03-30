import type { RouteLocationNormalized, RouteLocationRaw, Router, RouterHistory } from "vue-router";
import { createRouter, createWebHistory } from "vue-router";

import ChatView from "@/views/ChatView.vue";
import EmployeeStudioView from "@/views/EmployeeStudioView.vue";
import EmployeesView from "@/views/EmployeesView.vue";
import HubView from "@/views/HubView.vue";
import LoginView from "@/views/LoginView.vue";
import McpDetailView from "@/views/McpDetailView.vue";
import McpView from "@/views/McpView.vue";
import ModelDetailView from "@/views/ModelDetailView.vue";
import ModelsView from "@/views/ModelsView.vue";
import PublishDraftView from "@/views/PublishDraftView.vue";
import SettingsView from "@/views/SettingsView.vue";
import SkillsView from "@/views/SkillsView.vue";
import ToolsView from "@/views/ToolsView.vue";
import WorkflowStudioView from "@/views/WorkflowStudioView.vue";
import WorkflowsView from "@/views/WorkflowsView.vue";
import { useShellStore } from "@/stores/shell";
import { useDesktopAuthStore } from "@/stores/auth";

export const routes = [
  { path: "/login", name: "login", component: LoginView, meta: { requiresAuth: false } },
  { path: "/", name: "chat", component: ChatView },
  { path: "/hub", name: "hub", component: HubView },
  { path: "/tools", name: "tools", component: ToolsView },
  { path: "/mcp", name: "mcp", component: McpView },
  { path: "/mcp/new", name: "mcp-create", component: McpDetailView },
  { path: "/mcp/:id", name: "mcp-detail", component: McpDetailView },
  { path: "/skills", name: "skills", component: SkillsView },
  { path: "/employees", name: "employees", component: EmployeesView },
  { path: "/employees/:id", name: "employee-studio", component: EmployeeStudioView },
  { path: "/workflows", name: "workflows", component: WorkflowsView },
  { path: "/workflows/:id", name: "workflow-studio", component: WorkflowStudioView },
  { path: "/publish-drafts", name: "publish-drafts", component: PublishDraftView },
  { path: "/settings", name: "settings", component: SettingsView },
  { path: "/settings/models/new", name: "model-create", component: ModelDetailView },
  { path: "/settings/models/:id", name: "model-edit", component: ModelDetailView },
  { path: "/settings/models", name: "models", component: ModelsView },
];

/** 归一化登录跳转地址，避免把外部地址注入桌面端路由。 */
function normalizeRedirect(value: unknown): string {
  const target = Array.isArray(value) ? value[0] : value;
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) {
    return "";
  }

  return target;
}

/** 根据目标路由和当前会话状态计算桌面端的下一步导航行为。 */
async function resolveDesktopAuthRedirect(to: RouteLocationNormalized): Promise<RouteLocationRaw | true> {
  const auth = useDesktopAuthStore();
  const shell = useShellStore();
  const redirect = normalizeRedirect(to.query.redirect);

  if (to.meta.requiresAuth === false) {
    const isAuthenticated = await auth.ensureAuthenticated(shell.runtimeBaseUrl);
    if (isAuthenticated) {
      console.info("[desktop-router] 已登录用户访问登录页，跳转回应用", {
        redirect: redirect || "/",
      });
      return redirect || "/";
    }

    console.info("[desktop-router] 允许匿名访问公开路由", {
      path: to.fullPath,
    });
    return true;
  }

  const isAuthenticated = await auth.ensureAuthenticated(shell.runtimeBaseUrl);
  if (isAuthenticated) {
    console.info("[desktop-router] 会话校验通过，允许进入受保护路由", {
      path: to.fullPath,
    });
    return true;
  }

  console.info("[desktop-router] 当前未登录，跳转到登录页", {
    path: to.fullPath,
  });
  return {
    path: "/login",
    query: to.fullPath && to.fullPath !== "/login" ? { redirect: to.fullPath } : undefined,
  };
}

/** 为任意 router 实例挂载统一的桌面登录守卫，供生产和测试复用。 */
export function applyDesktopRouteGuards(router: Router): Router {
  router.beforeEach(async (to) => {
    try {
      return await resolveDesktopAuthRedirect(to);
    } catch (error) {
      console.warn("[desktop-router] 路由鉴权失败，回退到登录页", {
        path: to.fullPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        path: "/login",
        query: to.fullPath && to.fullPath !== "/login" ? { redirect: to.fullPath } : undefined,
      };
    }
  });

  return router;
}

/** 创建桌面应用 router，并默认附加登录守卫。 */
export function createAppRouter(history: RouterHistory = createWebHistory()) {
  return applyDesktopRouteGuards(createRouter({
    history,
    routes,
  }));
}

export const router = createAppRouter();

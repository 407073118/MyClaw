import React from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import AppShell from "../layouts/AppShell";
import { useAuthStore } from "../stores/auth";

// Electron 桌面端直接静态导入页面，避免本地文件场景下的额外懒加载闪烁。
import SetupPage from "../pages/SetupPage";
import LoginPage from "../pages/LoginPage";
import ChatPage from "../pages/ChatPage";
import HubPage from "../pages/HubPage";
import ToolsPage from "../pages/ToolsPage";
import McpPage from "../pages/McpPage";
import McpDetailPage from "../pages/McpDetailPage";
import SkillsPage from "../pages/SkillsPage";
import SkillDetailPage from "../pages/SkillDetailPage";
import EmployeesPage from "../pages/EmployeesPage";
import EmployeeStudioPage from "../pages/EmployeeStudioPage";
import WorkflowsPage from "../pages/WorkflowsPage";
import WorkflowStudioPage from "../pages/WorkflowStudioPage";
import PublishDraftPage from "../pages/PublishDraftPage";
import SettingsPage from "../pages/SettingsPage";
import ModelsPage from "../pages/ModelsPage";
import ModelDetailPage from "../pages/ModelDetailPage";
import PersonalPromptPage from "../pages/PersonalPromptPage";

/** 认证守卫：未登录时跳转到 `/login`，并保留原目标地址。 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    const redirect = location.pathname !== "/" ? location.pathname + location.search : undefined;
    return (
      <Navigate
        to={redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : "/login"}
        replace
      />
    );
  }

  return <>{children}</>;
}

/** 注册渲染层全部路由。 */
export function AppRoutes() {
  return (
    <Routes>
      {/* 首次启动且尚未配置模型时的初始化页 */}
      <Route path="/setup" element={<SetupPage />} />

      {/* 登录页，不需要经过初始化守卫 */}
      <Route path="/login" element={<LoginPage />} />

      {/* 需要鉴权的主应用路由，统一包裹在 AppShell 中 */}
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<ChatPage />} />
        <Route path="/hub" element={<HubPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/mcp" element={<McpPage />} />
        <Route path="/mcp/new" element={<McpDetailPage />} />
        <Route path="/mcp/:id" element={<McpDetailPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/skills/:id" element={<SkillDetailPage />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/employees/:id" element={<EmployeeStudioPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/:id" element={<WorkflowStudioPage />} />
        <Route path="/publish-drafts" element={<PublishDraftPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/me/prompt" element={<PersonalPromptPage />} />
        <Route path="/settings/models" element={<ModelsPage />} />
        <Route path="/settings/models/new" element={<ModelDetailPage />} />
        <Route path="/settings/models/:id" element={<ModelDetailPage />} />
      </Route>

      {/* 兜底跳转 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

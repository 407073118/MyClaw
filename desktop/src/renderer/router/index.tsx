import React from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import AppShell from "../layouts/AppShell";
import { useAuthStore } from "../stores/auth";

// Direct imports — no lazy loading for Electron desktop app.
// All pages are served from local filesystem; code-splitting adds latency
// (Suspense fallback flash) with zero network benefit.
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

/**
 * Auth guard that redirects to /login when the user is not authenticated.
 * Preserves the intended destination in the `redirect` query param.
 */
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

export function AppRoutes() {
  return (
    <Routes>
      {/* Initial model setup (first launch — no model configured yet) */}
      <Route path="/setup" element={<SetupPage />} />

      {/* Login — no setup guard needed; directory is auto-configured */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected routes wrapped in AppShell layout */}
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
        <Route path="/settings/models" element={<ModelsPage />} />
        <Route path="/settings/models/new" element={<ModelDetailPage />} />
        <Route path="/settings/models/:id" element={<ModelDetailPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

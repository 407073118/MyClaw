import { createRouter, createWebHistory } from "vue-router";

import ChatView from "@/views/ChatView.vue";
import EmployeeStudioView from "@/views/EmployeeStudioView.vue";
import EmployeesView from "@/views/EmployeesView.vue";
import HubView from "@/views/HubView.vue";
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

export const routes = [
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
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

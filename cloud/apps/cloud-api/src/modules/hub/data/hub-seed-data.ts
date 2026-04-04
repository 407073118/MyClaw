import type { HubItemDetail } from "@myclaw-cloud/shared";

export const HUB_SEED_ITEMS: HubItemDetail[] = [
  {
    id: "mcp-filesystem-managed",
    type: "mcp",
    name: "Filesystem MCP",
    summary: "Managed filesystem connector",
    description: "Injects a managed MCP connector for local filesystem tooling.",
    latestVersion: "1.0.0",
    releases: [
      {
        id: "release-mcp-filesystem-managed-1.0.0",
        version: "1.0.0",
        releaseNotes: "Initial release",
      },
    ],
  },
  {
    id: "employee-onboarding-assistant",
    type: "employee-package",
    name: "Onboarding Assistant",
    summary: "Reusable silicon employee package for onboarding",
    description: "Includes role card, baseline SOP, and workflow bindings for onboarding.",
    latestVersion: "1.0.0",
    releases: [
      {
        id: "release-employee-onboarding-assistant-1.0.0",
        version: "1.0.0",
        releaseNotes: "Initial employee package release",
      },
    ],
  },
  {
    id: "workflow-onboarding",
    type: "workflow-package",
    name: "Onboarding Workflow",
    summary: "Reusable onboarding workflow package",
    description: "Covers setup steps, checks, and follow-up for first-week onboarding.",
    latestVersion: "1.0.0",
    releases: [
      {
        id: "release-workflow-onboarding-1.0.0",
        version: "1.0.0",
        releaseNotes: "Initial workflow package release",
      },
    ],
  },
];

import type { RuntimeContext } from "../services/runtime-context";
import { registerAgentTaskHandlers } from "./agent-tasks";
import { registerAwarenessHandlers } from "./awareness";
import { registerApprovalHandlers } from "./approvals";
import { registerArtifactHandlers } from "./artifacts";
import { registerBootstrapHandlers } from "./bootstrap";
import { registerCloudHandlers } from "./cloud";
import { registerFileViewerHandlers } from "./file-viewer";
import { registerMcpHandlers } from "./mcp";
import { registerMeetingHandlers } from "./meetings";
import { registerMemoryHandlers } from "./memory";
import { registerModelHandlers } from "./models";
import { registerPersonalPromptHandlers } from "./personal-prompt";
import { registerSessionHandlers } from "./sessions";
import { registerSiliconPersonHandlers } from "./silicon-persons";
import { registerToolHandlers } from "./tools";
import { registerSkillFileHandlers } from "./skill-files";
import { registerTimeOrchestrationHandlers } from "./time-orchestration";
import { registerUpdateHandlers } from "./update";
import { registerWebPanelHandlers } from "./web-panel";
import { registerWorkflowHandlers } from "./workflows";

/**
 * Register all IPC handlers with the Electron main process.
 * Call once after the runtime context has been initialized.
 */
export function registerAllIpcHandlers(ctx: RuntimeContext): void {
  registerBootstrapHandlers(ctx);
  registerAgentTaskHandlers(ctx);
  registerArtifactHandlers(ctx);
  registerSessionHandlers(ctx);
  registerModelHandlers(ctx);
  registerPersonalPromptHandlers(ctx);
  registerToolHandlers(ctx);
  registerMcpHandlers(ctx);
  registerApprovalHandlers(ctx);
  registerWorkflowHandlers(ctx);
  registerCloudHandlers(ctx);
  registerFileViewerHandlers();
  registerUpdateHandlers(ctx);
  registerSiliconPersonHandlers(ctx);
  registerWebPanelHandlers(ctx);
  registerSkillFileHandlers(ctx);
  registerMeetingHandlers(ctx);
  registerMemoryHandlers(ctx);
  registerTimeOrchestrationHandlers(ctx);
  registerAwarenessHandlers(ctx);
}

import type { RuntimeContext } from "../services/runtime-context";
import { registerApprovalHandlers } from "./approvals";
import { registerBootstrapHandlers } from "./bootstrap";
import { registerCloudHandlers } from "./cloud";
import { registerMcpHandlers } from "./mcp";
import { registerModelHandlers } from "./models";
import { registerPersonalPromptHandlers } from "./personal-prompt";
import { registerSessionHandlers } from "./sessions";
import { registerSiliconPersonHandlers } from "./silicon-persons";
import { registerToolHandlers } from "./tools";
import { registerSkillFileHandlers } from "./skill-files";
import { registerWebPanelHandlers } from "./web-panel";
import { registerWorkflowHandlers } from "./workflows";

/**
 * Register all IPC handlers with the Electron main process.
 * Call once after the runtime context has been initialized.
 */
export function registerAllIpcHandlers(ctx: RuntimeContext): void {
  registerBootstrapHandlers(ctx);
  registerSessionHandlers(ctx);
  registerModelHandlers(ctx);
  registerPersonalPromptHandlers(ctx);
  registerToolHandlers(ctx);
  registerMcpHandlers(ctx);
  registerApprovalHandlers(ctx);
  registerWorkflowHandlers(ctx);
  registerCloudHandlers(ctx);
  registerSiliconPersonHandlers(ctx);
  registerWebPanelHandlers(ctx);
  registerSkillFileHandlers(ctx);
}

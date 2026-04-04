import { ipcMain } from "electron";

import type { ApprovalPolicy } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import { saveSettings } from "../services/state-persistence";

export function registerApprovalHandlers(ctx: RuntimeContext): void {
  // Get the current approval policy
  ipcMain.handle("approval:get-policy", async (): Promise<ApprovalPolicy> => {
    return ctx.state.getApprovals();
  });

  // Update the approval policy
  ipcMain.handle(
    "approval:set-policy",
    async (_event, policy: Partial<ApprovalPolicy>): Promise<ApprovalPolicy> => {
      const current = ctx.state.getApprovals();
      // Mutate in place so all references to getApprovals() see the update
      Object.assign(current, policy);
      const updated: ApprovalPolicy = { ...current };

      saveSettings(ctx.runtime.paths, {
        defaultModelProfileId: ctx.state.getDefaultModelProfileId(),
        approvalPolicy: updated,
        personalPrompt: ctx.state.getPersonalPromptProfile(),
      }).catch((err) => {
        console.error("[approval:set-policy] failed to persist settings", err);
      });

      return updated;
    },
  );

}

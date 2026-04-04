import { ipcMain } from "electron";

import type { PersonalPromptProfile } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import { saveSettings } from "../services/state-persistence";
import { derivePersonalPromptProfile } from "../services/personal-prompt-profile";

type SetPersonalPromptInput = {
  prompt: string;
};

/** 注册个人长期 Prompt 的读取与保存 IPC。 */
export function registerPersonalPromptHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("personal-prompt:get", async (): Promise<PersonalPromptProfile> => {
    console.info("[personal-prompt:get] 读取当前个人长期 Prompt 档案");
    return ctx.state.getPersonalPromptProfile();
  });

  ipcMain.handle(
    "personal-prompt:set",
    async (_event, input: SetPersonalPromptInput): Promise<PersonalPromptProfile> => {
      const nextProfile = derivePersonalPromptProfile(input?.prompt ?? "");
      console.info("[personal-prompt:set] 更新个人长期 Prompt 档案", {
        promptLength: nextProfile.prompt.length,
        tagCount: nextProfile.tags.length,
      });

      ctx.state.setPersonalPromptProfile(nextProfile);

      saveSettings(ctx.runtime.paths, {
        defaultModelProfileId: ctx.state.getDefaultModelProfileId(),
        approvalPolicy: ctx.state.getApprovals(),
        personalPrompt: nextProfile,
      }).catch((err) => {
        console.error("[personal-prompt:set] 保存个人长期 Prompt 失败", err);
      });

      return nextProfile;
    },
  );
}

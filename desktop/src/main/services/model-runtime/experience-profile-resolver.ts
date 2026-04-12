import type {
  ExperienceProfileId,
  ModelCapability,
  ModelProfile,
  ProviderFamily,
} from "@shared/contracts";
import { resolveDefaultExperienceProfileId } from "./vendor-policy-registry";

export type ExperienceProfileResolutionInput = {
  requestedProfileId?: ExperienceProfileId | null;
  providerFamily?: ProviderFamily | null;
  role?: "plan" | "execute" | "review" | "fast" | "long-context" | "balanced";
  capability?: Pick<ModelCapability, "supportsReasoning" | "contextWindowTokens"> | null;
  profile?: Pick<ModelProfile, "experienceProfileId"> | null;
};

/** 解析桌面端体验档位。 */
export function resolveExperienceProfileId(input: ExperienceProfileResolutionInput): ExperienceProfileId {
  if (input.requestedProfileId) return input.requestedProfileId;
  if (input.profile?.experienceProfileId) return input.profile.experienceProfileId;
  if (input.role === "plan") return "planner-strong";
  if (input.role === "fast") return "fast";
  if (input.role === "long-context") return "long-context";
  if ((input.capability?.contextWindowTokens ?? 0) >= 200_000) return "long-context";
  if (input.providerFamily) {
    const registryDefault = resolveDefaultExperienceProfileId(input.providerFamily);
    if (registryDefault) {
      return registryDefault;
    }
  }
  return "balanced";
}

import type { ModelProfile } from "@shared/contracts";

export type ReasoningControlSpec = {
  kind: "effort" | "budget" | "boolean" | "always_on" | "unsupported";
  title: string;
  description: string;
  supportsToggle: boolean;
  supportsEffort: boolean;
};

/** 根据模型能力统一推断 renderer 应展示哪种 thinking 控件。 */
export function resolveReasoningControlSpec(
  profile: Pick<ModelProfile, "discoveredCapabilities"> | null | undefined,
): ReasoningControlSpec {
  const thinkingControlKind = profile?.discoveredCapabilities?.thinkingControlKind ?? "effort";

  if (thinkingControlKind === "budget") {
    return {
      kind: "budget",
      title: "Thinking 预算",
      description: "支持开关与预算档位，关闭后回到普通回答路径。",
      supportsToggle: true,
      supportsEffort: true,
    };
  }

  if (thinkingControlKind === "boolean") {
    return {
      kind: "boolean",
      title: "Thinking 开关",
      description: "支持按需开启或关闭，关闭后不再请求原生思考链路。",
      supportsToggle: true,
      supportsEffort: false,
    };
  }

  if (thinkingControlKind === "always_on") {
    return {
      kind: "always_on",
      title: "Thinking 常开",
      description: "当前模型为 always-on thinking，页面只展示状态，不提供关闭入口。",
      supportsToggle: false,
      supportsEffort: false,
    };
  }

  if (thinkingControlKind === "unsupported") {
    return {
      kind: "unsupported",
      title: "Thinking 不可调",
      description: "当前模型不支持手动 thinking 控制，将始终走普通回答路径。",
      supportsToggle: false,
      supportsEffort: false,
    };
  }

  return {
    kind: "effort",
    title: "推理等级",
    description: "使用通用 effort 档位控制推理深度。",
    supportsToggle: false,
    supportsEffort: true,
  };
}

type ExampleDescriptor = {
  title: string;
  preview: string;
};

type SaveShortcutLike = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
};

function clipText(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

/** 从示例原文中提炼紧凑标题和预览，避免页面展示整段大块文本。 */
export function buildExampleDescriptor(example: string): ExampleDescriptor {
  const normalized = example.trim();
  if (!normalized) {
    return { title: "个性示例", preview: "" };
  }

  if (normalized.includes("黑盒测试")) {
    return {
      title: "黑盒测试",
      preview: clipText("负责需求测试、回归测试、上线验证，输出测试点、测试用例和缺陷单。", 72),
    };
  }
  if (normalized.includes("产品经理")) {
    return {
      title: "产品经理",
      preview: clipText("负责需求梳理、方案评审和推进，偏好目标、风险、纪要和清单输出。", 72),
    };
  }
  if (normalized.includes("前端开发")) {
    return {
      title: "前端开发",
      preview: clipText("负责桌面端和后台页面开发，偏好结合现有代码与组件约束给出落地方案。", 72),
    };
  }

  const firstLine = normalized.split(/[。\n]/).map((item) => item.trim()).find(Boolean) ?? normalized;
  return {
    title: clipText(firstLine, 14),
    preview: clipText(normalized, 72),
  };
}

/** 判断当前键盘事件是否为保存快捷键。 */
export function isSaveShortcut(input: SaveShortcutLike): boolean {
  if (!input.key) return false;
  const key = input.key.toLowerCase();
  return key === "s" && Boolean(input.metaKey || input.ctrlKey);
}

/** 在套用示例前决定是否允许覆盖当前草稿。 */
export function shouldApplyExamplePrompt(
  isDirty: boolean,
  confirmFn: () => boolean,
): boolean {
  if (!isDirty) return true;
  return confirmFn();
}

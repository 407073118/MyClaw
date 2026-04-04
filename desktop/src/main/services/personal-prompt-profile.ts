import type { PersonalPromptProfile } from "@shared/contracts";
import { createDefaultPersonalPromptProfile } from "@shared/contracts";

const TAG_PATTERNS: Array<{ tag: string; patterns: string[] }> = [
  { tag: "黑盒测试", patterns: ["黑盒测试"] },
  { tag: "白盒测试", patterns: ["白盒测试"] },
  { tag: "自动化测试", patterns: ["自动化测试"] },
  { tag: "回归测试", patterns: ["回归测试"] },
  { tag: "需求测试", patterns: ["需求测试"] },
  { tag: "上线验证", patterns: ["上线验证"] },
  { tag: "测试用例", patterns: ["测试用例"] },
  { tag: "缺陷单", patterns: ["缺陷单", "bug 单", "缺陷"] },
  { tag: "测试", patterns: ["测试", "QA"] },
  { tag: "PRD", patterns: ["PRD", "prd"] },
  { tag: "接口文档", patterns: ["接口文档", "API 文档"] },
  { tag: "产品经理", patterns: ["产品经理"] },
  { tag: "前端", patterns: ["前端"] },
  { tag: "后端", patterns: ["后端"] },
  { tag: "研发", patterns: ["研发", "开发"] },
  { tag: "运营", patterns: ["运营"] },
  { tag: "周报", patterns: ["周报"] },
  { tag: "工时", patterns: ["工时"] },
];

function normalizePrompt(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function clipText(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function deriveSummary(prompt: string): string {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return "";

  const sentence = normalized
    .split(/[\n。！？!?\r]+/)
    .map((item) => item.trim())
    .find(Boolean);

  return clipText(sentence ?? normalized, 140);
}

function deriveTags(prompt: string): string[] {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return [];

  const matched = TAG_PATTERNS
    .filter(({ patterns }) => patterns.some((pattern) => normalized.includes(pattern)))
    .map(({ tag }) => tag);

  return [...new Set(matched)].slice(0, 8);
}

/** 从用户维护的长期 Prompt 原文中提炼摘要、标签和更新时间。 */
export function derivePersonalPromptProfile(prompt: string): PersonalPromptProfile {
  const normalized = normalizePrompt(prompt);
  if (!normalized) {
    return createDefaultPersonalPromptProfile();
  }

  return {
    prompt: normalized,
    summary: deriveSummary(normalized),
    tags: deriveTags(normalized),
    updatedAt: new Date().toISOString(),
  };
}

/** 构建运行时注入给模型的个人工作画像上下文块。 */
export function buildPersonalPromptContext(profile: PersonalPromptProfile | null | undefined): string {
  if (!profile?.prompt.trim()) return "";

  const lines: string[] = [
    "# User Working Profile",
  ];

  if (profile.summary.trim()) {
    lines.push(`- Summary: ${profile.summary.trim()}`);
  }
  if (profile.tags.length > 0) {
    lines.push(`- Tags: ${profile.tags.join(", ")}`);
  }

  lines.push("", "## User-authored long prompt", clipText(profile.prompt.trim(), 1600));
  return lines.join("\n");
}

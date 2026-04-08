/**
 * 上下文增强器 — 从会话历史中自动提取环境上下文，
 * 注入到系统提示中，让模型获得"当前正在做什么"的视野。
 *
 * 所有提取逻辑都是零成本的（不调模型，只从 session messages 中抽取），
 * 最终产出一个约 200-400 tokens 的上下文块。
 */

import type { ChatSession, ChatMessage, Task } from "@shared/contracts";
import { textOfContent } from "@shared/contracts";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type EnrichedContext = {
  /** 最近被读/写/编辑过的文件（从 tool_calls 中提取） */
  recentFiles: string[];
  /** git 状态一行摘要（从 git_status 工具结果中提取） */
  gitSummary: string | null;
  /** 从最近几条用户消息推断的会话主题 */
  sessionTheme: string | null;
  /** 当前进行中的任务摘要 */
  activeTasksSummary: string | null;
};

// ---------------------------------------------------------------------------
// 提取逻辑
// ---------------------------------------------------------------------------

/** 从 tool_calls 中提取最近操作过的文件路径 */
function extractRecentFiles(messages: ChatMessage[], maxFiles = 8): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  // 从后往前扫描，优先收集最近的文件
  for (let i = messages.length - 1; i >= 0 && result.length < maxFiles; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.tool_calls) continue;

    for (const tc of msg.tool_calls) {
      if (result.length >= maxFiles) break;

      const fnName = tc.function.name;
      // 只关注文件操作工具
      if (!fnName.startsWith("fs_") && !fnName.startsWith("git_")) continue;

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        continue;
      }

      const path = String(args.path ?? args.target ?? "").trim();
      if (path && path !== "." && !seen.has(path)) {
        seen.add(path);
        result.push(path);
      }
    }
  }

  return result;
}

/** 从最近的 git_status 工具结果中提取简要状态 */
function extractGitSummary(messages: ChatMessage[]): string | null {
  // 从后往前找最近一次 git_status 的工具返回
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "tool") continue;

    // 检查前一条 assistant 消息是否包含 git_status 调用
    if (i > 0) {
      const prev = messages[i - 1];
      if (prev.role === "assistant" && prev.tool_calls?.some(tc => tc.function.name === "git_status")) {
        const text = textOfContent(msg.content).trim();
        if (!text || text === "(无输出)") return null;

        // 提取分支行和变更统计
        const lines = text.split("\n").filter(Boolean);
        const branchLine = lines.find(l => l.startsWith("##"));
        const changeCount = lines.filter(l => !l.startsWith("##")).length;

        if (branchLine && changeCount > 0) {
          return `${branchLine.replace("## ", "")} (${changeCount} changes)`;
        }
        if (branchLine) return branchLine.replace("## ", "");
        if (changeCount > 0) return `${changeCount} changed files`;
        return null;
      }
    }
  }
  return null;
}

/** 从最近用户消息推断会话主题 */
function inferSessionTheme(messages: ChatMessage[], maxRecent = 5): string | null {
  const userMessages: string[] = [];

  for (let i = messages.length - 1; i >= 0 && userMessages.length < maxRecent; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    const text = textOfContent(msg.content).trim();
    if (text.length > 5) {
      userMessages.push(text);
    }
  }

  if (userMessages.length === 0) return null;

  // 提取高频关键动词/意图词
  const intentKeywords: Record<string, string[]> = {
    "debugging/fixing": ["bug", "fix", "error", "报错", "修复", "问题", "异常", "crash", "失败"],
    "building/creating": ["创建", "新增", "添加", "实现", "开发", "build", "create", "add", "implement"],
    "understanding/reading": ["理解", "解释", "看看", "了解", "怎么", "explain", "how", "what", "understand"],
    "refactoring/improving": ["重构", "优化", "改进", "refactor", "improve", "optimize", "clean"],
    "testing": ["测试", "test", "verify", "验证"],
    "deploying/releasing": ["部署", "发布", "上线", "deploy", "release"],
  };

  const combined = userMessages.join(" ").toLowerCase();
  const matched: string[] = [];

  for (const [category, keywords] of Object.entries(intentKeywords)) {
    if (keywords.some(kw => combined.includes(kw))) {
      matched.push(category);
    }
  }

  if (matched.length === 0) return null;
  return matched.slice(0, 2).join(", ");
}

/** 从 session tasks 中提取当前活跃任务的摘要 */
function summarizeActiveTasks(tasks: Task[] | undefined): string | null {
  if (!tasks || tasks.length === 0) return null;

  const inProgress = tasks.filter(t => t.status === "in_progress");
  const pending = tasks.filter(t => t.status === "pending");
  const completed = tasks.filter(t => t.status === "completed");

  const parts: string[] = [];
  if (inProgress.length > 0) {
    parts.push(`doing: ${inProgress.map(t => t.activeForm || t.subject).join(", ")}`);
  }
  if (pending.length > 0) {
    parts.push(`${pending.length} pending`);
  }
  if (completed.length > 0) {
    parts.push(`${completed.length} done`);
  }

  return parts.length > 0 ? parts.join(" | ") : null;
}

// ---------------------------------------------------------------------------
// 核心 API
// ---------------------------------------------------------------------------

/** 从当前会话中提取增强上下文 */
export function extractEnrichedContext(session: ChatSession): EnrichedContext {
  return {
    recentFiles: extractRecentFiles(session.messages),
    gitSummary: extractGitSummary(session.messages),
    sessionTheme: inferSessionTheme(session.messages),
    activeTasksSummary: summarizeActiveTasks(session.tasks),
  };
}

/** 将增强上下文构建为注入系统提示的文本块 */
export function buildEnrichedContextBlock(ctx: EnrichedContext): string {
  const lines: string[] = [];
  let hasContent = false;

  if (ctx.recentFiles.length > 0) {
    lines.push(`- Recent files: ${ctx.recentFiles.slice(0, 6).join(", ")}`);
    hasContent = true;
  }
  if (ctx.gitSummary) {
    lines.push(`- Git: ${ctx.gitSummary}`);
    hasContent = true;
  }
  if (ctx.sessionTheme) {
    lines.push(`- Session focus: ${ctx.sessionTheme}`);
    hasContent = true;
  }
  if (ctx.activeTasksSummary) {
    lines.push(`- Tasks: ${ctx.activeTasksSummary}`);
    hasContent = true;
  }

  if (!hasContent) return "";
  return `# Session Context\n${lines.join("\n")}`;
}

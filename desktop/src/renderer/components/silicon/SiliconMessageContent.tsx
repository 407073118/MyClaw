import React, { memo, useMemo } from "react";

import InlineFileReferenceContent from "../InlineFileReferenceContent";
import MarkdownView from "../MarkdownView";

type SiliconMessageContentProps = {
  content: unknown;
  renderedHtml?: string;
};

const SILICON_MESSAGE_CONTENT_DEBUG_LOGGING = resolveSiliconMessageContentDebugLogging();

/** 读取硅基员工消息正文调试日志开关，默认关闭以避免消息列表渲染刷屏。 */
function resolveSiliconMessageContentDebugLogging(): boolean {
  try {
    return globalThis.localStorage?.getItem("MYCLAW_DEBUG_SILICON_MESSAGE_CONTENT") === "1";
  } catch {
    return false;
  }
}

/** 输出硅基员工消息正文调试日志，仅在显式开启时写入 console。 */
function logSiliconMessageContentDebug(message: string, detail: Record<string, unknown>): void {
  if (!SILICON_MESSAGE_CONTENT_DEBUG_LOGGING) {
    return;
  }
  console.debug(message, detail);
}

/** 把富结构消息内容压平成可渲染文本，兼容旧会话中的数组内容。 */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((item): item is { type: string; text?: string } => Boolean(item) && typeof item === "object")
      .map((item) => (item.type === "text" ? item.text ?? "" : ""))
      .join("\n")
      .trim();
  }
  return String(content ?? "");
}

/** 记忆化硅基员工消息正文，避免工作区其他状态更新时重复 Markdown 解析。 */
const SiliconMessageContent = memo(function SiliconMessageContent({
  content,
  renderedHtml,
}: SiliconMessageContentProps): React.JSX.Element {
  const source = useMemo(() => renderedHtml || textOf(content), [content, renderedHtml]);
  const shouldUseRenderedHtml = Boolean(renderedHtml);

  if (!source) {
    return (
      <div className="message-content">
        <p>暂不支持展示的消息内容</p>
      </div>
    );
  }

  if (shouldUseRenderedHtml) {
    logSiliconMessageContentDebug("[silicon-message-content] 复用预渲染 HTML，跳过 Markdown 二次解析", {
      htmlLength: source.length,
    });
    return (
      <InlineFileReferenceContent
        className="message-content"
        html={source}
        baseDirectory={null}
      />
    );
  }

  return <MarkdownView source={source} className="message-content" />;
});

export default SiliconMessageContent;

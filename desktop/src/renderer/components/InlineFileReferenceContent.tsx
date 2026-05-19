import React, { useEffect, useRef } from "react";

import { useWorkspaceStore } from "../stores/workspace";
import {
  findInlineFileCandidateBaseDirectories,
  findInlineFileReferences,
} from "../utils/inline-file-references";

type WebPanelMeta = {
  viewPath: string;
  title: string;
  data: unknown;
};

type InlineFileReferenceContentProps = {
  html: string;
  className?: string;
  baseDirectory?: string | null;
  onOpenWebPanel?: (viewMeta: WebPanelMeta) => void;
};

const SKIP_TAGS = new Set(["A", "BUTTON", "PRE", "SCRIPT", "STYLE", "TEXTAREA", "INPUT"]);

/** 判断当前文本节点是否位于不应增强的代码或交互元素内部。 */
function shouldSkipTextNode(node: Text): boolean {
  let current: Node | null = node.parentElement;
  while (current && current instanceof HTMLElement) {
    if (SKIP_TAGS.has(current.tagName)) return true;
    current = current.parentElement;
  }
  return false;
}

/** 把一个文本节点里的文件名替换成内联按钮，保留其余原文。 */
function replaceTextNodeWithFileRefs(node: Text): void {
  const text = node.nodeValue ?? "";
  const refs = findInlineFileReferences(text);
  if (refs.length === 0 || !node.parentNode) return;

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const ref of refs) {
    if (ref.start > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, ref.start)));
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inline-file-ref";
    button.dataset.filePath = ref.path;
    button.title = `预览 ${ref.path}`;
    button.textContent = ref.path;
    fragment.appendChild(button);
    cursor = ref.end;
  }
  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }
  node.parentNode.replaceChild(fragment, node);
}

/** 遍历消息 HTML 的文本节点，给高置信文件名加上可点击入口。 */
function enhanceFileReferences(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text && !shouldSkipTextNode(current)) {
      nodes.push(current);
    }
    current = walker.nextNode();
  }
  nodes.forEach(replaceTextNodeWithFileRefs);
}

/** 渲染聊天消息正文，并把其中的本地文件名增强为右侧预览入口。 */
export default function InlineFileReferenceContent({
  html,
  className,
  baseDirectory,
  onOpenWebPanel,
}: InlineFileReferenceContentProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    enhanceFileReferences(root);
  }, [html]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    /** 处理内联文件按钮点击：让主进程解析文件并打开右侧预览面板。 */
    const handleClick = async (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement
        ? event.target.closest<HTMLButtonElement>(".inline-file-ref")
        : null;
      if (!target) return;

      const path = target.dataset.filePath;
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();

      target.dataset.state = "loading";
      target.removeAttribute("data-error");
      target.setAttribute("aria-busy", "true");
      try {
        const candidateBaseDirectories = findInlineFileCandidateBaseDirectories(root.textContent ?? "");
        const result = await window.myClawAPI.fileViewerPreview({
          path,
          baseDirectory: baseDirectory ?? null,
          ...(candidateBaseDirectories.length > 0 ? { candidateBaseDirectories } : {}),
        });
        if (result.success && result.viewMeta) {
          const openWebPanel = onOpenWebPanel ?? ((viewMeta: WebPanelMeta) => {
            useWorkspaceStore.getState().openWebPanel(viewMeta.viewPath, viewMeta.title, viewMeta.data);
          });
          openWebPanel(result.viewMeta);
          target.dataset.state = "ready";
          target.removeAttribute("data-error");
          target.setAttribute("aria-label", path);
        } else {
          const errorMessage = result.error ?? "文件不存在或无法预览";
          target.dataset.state = "missing";
          target.dataset.error = "未找到";
          target.title = `${errorMessage}：${path}`;
          target.setAttribute("aria-label", `${path}（未找到）`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        target.dataset.state = "missing";
        target.dataset.error = "未找到";
        target.title = `${errorMessage}：${path}`;
        target.setAttribute("aria-label", `${path}（未找到）`);
      } finally {
        target.removeAttribute("aria-busy");
      }
    };

    root.addEventListener("click", handleClick);
    return () => root.removeEventListener("click", handleClick);
  }, [baseDirectory, onOpenWebPanel]);

  return (
    <div
      ref={rootRef}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

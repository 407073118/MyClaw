import React, { useMemo } from "react";
import { parsePowerShellDirectoryTree } from "../utils/tool-output";

interface ToolLogContentProps {
  content: string;
  messageId: string;
}

export default function ToolLogContent({ content, messageId }: ToolLogContentProps) {
  const directoryTree = useMemo(() => parsePowerShellDirectoryTree(content), [content]);

  if (directoryTree) {
    return (
      <article
        data-testid={`tool-directory-tree-${messageId}`}
        className="tool-directory-tree"
      >
        <header className="tool-directory-root">
          <strong>{directoryTree.root}</strong>
          <span>{directoryTree.entries.length} items</span>
        </header>

        <ul className="tool-directory-entries">
          {directoryTree.entries.map((entry) => (
            <li
              key={`${entry.kind}-${entry.name}-${entry.modifiedAt}`}
              className="tool-directory-entry"
            >
              <span className="tool-directory-kind">{entry.kind}</span>
              <span className="tool-directory-name">{entry.name}</span>
              {entry.size && <span className="tool-directory-meta">{entry.size} B</span>}
              <span className="tool-directory-meta">{entry.modifiedAt}</span>
            </li>
          ))}
        </ul>

        <style>{`
          .tool-log-text {
            word-break: break-all;
          }
          .tool-directory-tree {
            width: 100%;
            display: grid;
            gap: 10px;
            padding: 12px 14px;
            border-radius: 12px;
            border: 1px solid rgba(148, 163, 184, 0.2);
            background:
              linear-gradient(135deg, rgba(14, 116, 144, 0.12), rgba(15, 23, 42, 0.08)),
              rgba(15, 23, 42, 0.18);
          }
          .tool-directory-root {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: 10px;
          }
          .tool-directory-root strong {
            color: var(--text-primary);
            font-size: 13px;
          }
          .tool-directory-root span,
          .tool-directory-meta {
            color: var(--text-muted);
            font-size: 11px;
          }
          .tool-directory-entries {
            list-style: none;
            margin: 0;
            padding: 0 0 0 14px;
            display: grid;
            gap: 8px;
            border-left: 1px solid rgba(148, 163, 184, 0.25);
          }
          .tool-directory-entry {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            position: relative;
            min-height: 22px;
          }
          .tool-directory-entry::before {
            content: "";
            position: absolute;
            left: -14px;
            top: 10px;
            width: 10px;
            border-top: 1px solid rgba(148, 163, 184, 0.25);
          }
          .tool-directory-kind {
            min-width: 34px;
            padding: 1px 6px;
            border-radius: 999px;
            background: rgba(15, 23, 42, 0.45);
            color: #cbd5e1;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            text-align: center;
          }
          .tool-directory-name {
            color: var(--text-primary);
            font-weight: 500;
            word-break: break-word;
          }
        `}</style>
      </article>
    );
  }

  return <span className="tool-log-text">{content}</span>;
}

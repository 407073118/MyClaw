import React from "react";

import type { CitationRecord } from "@shared/contracts";

/** 渲染最近一轮的引用来源列表，帮助用户快速核对来源与摘要。 */
export function CitationList({ citations }: { citations: CitationRecord[] }) {
  if (citations.length === 0) {
    return null;
  }

  return (
    <section className="capability-card" data-testid="citation-list">
      <div className="capability-card-eyebrow">来源引用</div>
      <div className="capability-card-title">本轮使用了 {citations.length} 个来源</div>
      <div className="citation-list">
        {citations.map((citation) => (
          citation.url ? (
            <a
              key={citation.id}
              className="citation-item"
              href={citation.url}
              target="_blank"
              rel="noreferrer"
            >
              <div className="citation-item-title">{citation.title || citation.filename || citation.url}</div>
              <div className="citation-item-meta">
                <span>{citation.domain || citation.fileId || "未知来源"}</span>
                <span>{citation.sourceType}</span>
              </div>
              {citation.snippet && <div className="citation-item-snippet">{citation.snippet}</div>}
            </a>
          ) : (
            <div key={citation.id} className="citation-item">
              <div className="citation-item-title">{citation.title || citation.filename || citation.fileId || "未知文件"}</div>
              <div className="citation-item-meta">
                <span>{citation.fileId || "OpenAI file"}</span>
                <span>{citation.sourceType}</span>
              </div>
              {citation.snippet && <div className="citation-item-snippet">{citation.snippet}</div>}
            </div>
          )
        ))}
      </div>
    </section>
  );
}

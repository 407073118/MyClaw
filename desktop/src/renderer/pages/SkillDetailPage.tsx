import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import { marked } from "marked";
import type { FileTreeNode } from "@shared/contracts";

// ── Types ────────────────────────────────────────────────────────────────────

type ViewMode = "source" | "preview";

// ── Helpers ──────────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"]);
const PREVIEW_EXTS = new Set([".md", ".html"]);
const SOURCE_DEFAULT_EXTS = new Set([".json", ".ts", ".js", ".css", ".yaml", ".yml"]);

function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

function isImageFile(name: string): boolean {
  return IMAGE_EXTS.has(getExtension(name));
}

function defaultViewMode(name: string): ViewMode {
  const ext = getExtension(name);
  if (PREVIEW_EXTS.has(ext)) return "preview";
  if (SOURCE_DEFAULT_EXTS.has(ext)) return "source";
  return "source";
}

function canToggleView(name: string): boolean {
  return PREVIEW_EXTS.has(getExtension(name));
}

/** Find SKILL.md node in tree (breadth-first). */
function findSkillMd(nodes: FileTreeNode[]): FileTreeNode | null {
  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.type === "file" && node.name === "SKILL.md") return node;
    if (node.children) queue.push(...node.children);
  }
  return null;
}

// ── TreeNode component ───────────────────────────────────────────────────────

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  defaultExpanded: boolean;
  onSelect: (node: FileTreeNode) => void;
}

function TreeNode({ node, depth, selectedPath, defaultExpanded, onSelect }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (node.type === "directory") {
    return (
      <div className="tree-node">
        <div
          className="tree-item tree-dir"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="tree-icon">{expanded ? "\u25BC" : "\u25B6"}</span>
          <span className="tree-label">{node.name}</span>
        </div>
        {expanded && node.children && (
          <div className="tree-children">
            {node.children.map((child) => (
              <TreeNode
                key={child.relativePath}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                defaultExpanded={false}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedPath === node.relativePath;
  return (
    <div
      className={`tree-item tree-file${isSelected ? " selected" : ""}`}
      style={{ paddingLeft: `${12 + depth * 16}px` }}
      onClick={() => onSelect(node)}
    >
      <span className="tree-icon file-icon">{"\uD83D\uDCC4"}</span>
      <span className="tree-label">{node.name}</span>
    </div>
  );
}

// ── SkillDetailPage ──────────────────────────────────────────────────────────

export default function SkillDetailPage() {
  const { id: skillId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const skills = useWorkspaceStore((s) => s.skills);

  const skill = useMemo(() => skills.find((s) => s.id === skillId) ?? null, [skills, skillId]);

  // File tree
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);

  // Selected file
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileLoading, setFileLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("source");

  // Load file tree
  useEffect(() => {
    if (!skillId) return;
    let cancelled = false;
    setTreeLoading(true);
    window.myClawAPI
      .skillReadTree(skillId)
      .then((nodes) => {
        if (cancelled) return;
        setTree(nodes);
        // Auto-select SKILL.md
        const skillMd = findSkillMd(nodes);
        if (skillMd) {
          setSelectedPath(skillMd.relativePath);
        }
      })
      .catch((err) => {
        if (!cancelled) console.error("[skill-detail] Failed to load tree", err);
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false);
      });
    return () => { cancelled = true; };
  }, [skillId]);

  // Load file content when selection changes
  useEffect(() => {
    if (!skillId || !selectedPath) {
      setFileContent("");
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setViewMode(defaultViewMode(selectedPath));
    window.myClawAPI
      .skillReadFile(skillId, selectedPath)
      .then((content) => {
        if (!cancelled) setFileContent(content);
      })
      .catch((err) => {
        if (!cancelled) {
          setFileContent("");
          console.error("[skill-detail] Failed to load file", err);
        }
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => { cancelled = true; };
  }, [skillId, selectedPath]);

  const handleSelectFile = useCallback((node: FileTreeNode) => {
    if (node.type === "file") {
      setSelectedPath(node.relativePath);
    }
  }, []);

  // ── Not found ──────────────────────────────────────────────────────────────
  if (!skill) {
    return (
      <main className="page-container">
        <div className="not-found">
          <p>Skill 未找到</p>
          <button type="button" className="btn-back" onClick={() => navigate("/skills")}>
            &larr; 返回列表
          </button>
        </div>
        <style>{styles}</style>
      </main>
    );
  }

  // ── Render content area ────────────────────────────────────────────────────
  const selectedFileName = selectedPath?.split("/").pop() ?? "";
  const ext = getExtension(selectedFileName);
  const showToggle = canToggleView(selectedFileName);

  let contentElement: React.ReactNode = null;
  if (!selectedPath) {
    contentElement = <p className="content-hint">请从左侧文件树中选择文件</p>;
  } else if (fileLoading) {
    contentElement = <p className="content-hint">加载中...</p>;
  } else if (isImageFile(selectedFileName)) {
    contentElement = (
      <div className="image-preview">
        <img src={fileContent} alt={selectedFileName} />
      </div>
    );
  } else if (viewMode === "preview" && ext === ".md") {
    const html = marked.parse(fileContent) as string;
    contentElement = (
      <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />
    );
  } else if (viewMode === "preview" && ext === ".html") {
    contentElement = (
      <iframe
        className="html-preview"
        sandbox="allow-scripts allow-same-origin"
        srcDoc={fileContent}
        title={selectedFileName}
      />
    );
  } else {
    // Source mode with line numbers
    const lines = fileContent.split("\n");
    contentElement = (
      <pre className="source-code">
        <code>
          {lines.map((line, i) => (
            <div key={i} className="code-line">
              <span className="line-number">{i + 1}</span>
              <span className="line-content">{line}</span>
            </div>
          ))}
        </code>
      </pre>
    );
  }

  return (
    <main className="skill-detail-page">
      {/* Top bar */}
      <header className="top-bar">
        <button type="button" className="btn-back" onClick={() => navigate("/skills")}>
          &larr; 返回列表
        </button>
        <h2 className="skill-name">{skill.name}</h2>
        <span className={`status-badge${skill.enabled ? " enabled" : ""}`}>
          {skill.enabled ? "已启用" : "已停用"}
        </span>
      </header>

      {/* Main body */}
      <div className="main-body">
        {/* File tree sidebar */}
        <aside className="file-tree-sidebar">
          {treeLoading ? (
            <p className="tree-loading">加载中...</p>
          ) : tree.length === 0 ? (
            <p className="tree-loading">无文件</p>
          ) : (
            tree.map((node) => (
              <TreeNode
                key={node.relativePath}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                defaultExpanded={true}
                onSelect={handleSelectFile}
              />
            ))
          )}
        </aside>

        {/* Content area */}
        <section className="content-area">
          {/* Toolbar */}
          <div className="content-toolbar">
            <span className="file-path-label">
              {selectedPath ?? "..."}
            </span>
            {showToggle && (
              <button
                type="button"
                className="btn-toggle-view"
                onClick={() => setViewMode((v) => (v === "source" ? "preview" : "source"))}
              >
                {viewMode === "source" ? "预览" : "源码"}
              </button>
            )}
          </div>

          {/* File content */}
          <div className="content-body">
            {contentElement}
          </div>
        </section>
      </div>

      <style>{styles}</style>
    </main>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = `
  .skill-detail-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ---- Not found ---- */
  .not-found {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    height: 100%;
    color: var(--text-secondary, #b0b0b8);
    font-size: 15px;
  }

  /* ---- Top bar ---- */
  .top-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--glass-border, #333338);
    background: var(--bg-card, #1e1e24);
    flex-shrink: 0;
  }

  .btn-back {
    background: transparent;
    border: 1px solid var(--glass-border, #3f3f46);
    color: var(--text-secondary, #a1a1aa);
    cursor: pointer;
    padding: 4px 12px;
    border-radius: var(--radius-md, 6px);
    font-size: 13px;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .btn-back:hover {
    color: var(--text-primary, #fff);
    border-color: var(--text-primary, #fff);
  }

  .skill-name {
    flex: 1;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary, #fff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-badge {
    flex-shrink: 0;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: var(--bg-base, #121214);
    border: 1px solid var(--glass-border, #333338);
    color: var(--text-muted, #71717a);
  }

  .status-badge.enabled {
    background: rgba(46, 160, 67, 0.1);
    border-color: rgba(46, 160, 67, 0.2);
    color: #2ea043;
  }

  /* ---- Main body (sidebar + content) ---- */
  .main-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  /* ---- File tree sidebar ---- */
  .file-tree-sidebar {
    width: 240px;
    flex-shrink: 0;
    overflow-y: auto;
    background: var(--bg-sidebar, #161618);
    border-right: 1px solid var(--glass-border, #333338);
    padding: 8px 0;
  }

  .tree-loading {
    padding: 20px 16px;
    color: var(--text-muted, #71717a);
    font-size: 13px;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary, #b0b0b8);
    transition: background 0.1s;
    user-select: none;
  }

  .tree-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .tree-file.selected {
    background: var(--bg-card, #1e1e24);
    color: var(--text-primary, #fff);
    border-left: 2px solid var(--accent-cyan, #67e8f9);
  }

  .tree-icon {
    flex-shrink: 0;
    font-size: 10px;
    width: 14px;
    text-align: center;
    color: var(--text-muted, #71717a);
  }

  .tree-icon.file-icon {
    font-size: 13px;
  }

  .tree-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- Content area ---- */
  .content-area {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-base, #121214);
  }

  .content-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--glass-border, #333338);
    background: var(--bg-card, #1e1e24);
    flex-shrink: 0;
  }

  .file-path-label {
    font-size: 12px;
    color: var(--text-muted, #71717a);
    font-family: "Cascadia Code", "Fira Code", monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-toggle-view {
    background: transparent;
    border: 1px solid var(--glass-border, #3f3f46);
    color: var(--accent-cyan, #67e8f9);
    cursor: pointer;
    padding: 3px 10px;
    border-radius: var(--radius-md, 6px);
    font-size: 12px;
    font-weight: 600;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .btn-toggle-view:hover {
    background: rgba(103, 232, 249, 0.08);
  }

  .content-body {
    flex: 1;
    overflow: auto;
    padding: 0;
  }

  .content-hint {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-muted, #71717a);
    font-size: 14px;
  }

  /* ---- Source code ---- */
  .source-code {
    margin: 0;
    padding: 12px 0;
    font-family: "Cascadia Code", "Fira Code", monospace;
    font-size: 13px;
    line-height: 1.6;
  }

  .code-line {
    display: flex;
    padding: 0 16px;
  }

  .code-line:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .line-number {
    flex-shrink: 0;
    width: 48px;
    text-align: right;
    padding-right: 16px;
    color: var(--text-muted, #71717a);
    user-select: none;
  }

  .line-content {
    white-space: pre;
    color: var(--text-primary, #fff);
  }

  /* ---- Image preview ---- */
  .image-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    height: 100%;
  }

  .image-preview img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: var(--radius-md, 6px);
  }

  /* ---- HTML preview ---- */
  .html-preview {
    width: 100%;
    height: 100%;
    border: none;
    background: #fff;
  }

  /* ---- Markdown preview ---- */
  .markdown-preview {
    padding: 24px 32px;
    color: var(--text-primary, #fff);
    font-size: 14px;
    line-height: 1.7;
    overflow-wrap: break-word;
  }

  .markdown-preview h1 {
    font-size: 26px;
    font-weight: 700;
    margin: 0 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--glass-border, #333338);
  }

  .markdown-preview h2 {
    font-size: 20px;
    font-weight: 600;
    margin: 28px 0 12px;
  }

  .markdown-preview h3 {
    font-size: 16px;
    font-weight: 600;
    margin: 24px 0 8px;
  }

  .markdown-preview p {
    margin: 0 0 12px;
  }

  .markdown-preview a {
    color: var(--accent-cyan, #67e8f9);
    text-decoration: none;
  }

  .markdown-preview a:hover {
    text-decoration: underline;
  }

  .markdown-preview code {
    font-family: "Cascadia Code", "Fira Code", monospace;
    font-size: 0.9em;
    background: rgba(255, 255, 255, 0.06);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .markdown-preview pre {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--glass-border, #333338);
    border-radius: var(--radius-md, 6px);
    padding: 14px 16px;
    overflow-x: auto;
    margin: 0 0 16px;
  }

  .markdown-preview pre code {
    background: none;
    padding: 0;
    font-size: 13px;
    line-height: 1.6;
  }

  .markdown-preview ul, .markdown-preview ol {
    margin: 0 0 12px;
    padding-left: 24px;
  }

  .markdown-preview li {
    margin-bottom: 4px;
  }

  .markdown-preview blockquote {
    margin: 0 0 12px;
    padding: 8px 16px;
    border-left: 3px solid var(--accent-cyan, #67e8f9);
    background: rgba(255, 255, 255, 0.02);
    color: var(--text-secondary, #b0b0b8);
  }

  .markdown-preview table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 16px;
  }

  .markdown-preview th, .markdown-preview td {
    border: 1px solid var(--glass-border, #333338);
    padding: 8px 12px;
    text-align: left;
    font-size: 13px;
  }

  .markdown-preview th {
    background: rgba(255, 255, 255, 0.04);
    font-weight: 600;
  }

  .markdown-preview hr {
    border: none;
    border-top: 1px solid var(--glass-border, #333338);
    margin: 20px 0;
  }

  .markdown-preview img {
    max-width: 100%;
    border-radius: var(--radius-md, 6px);
  }
`;

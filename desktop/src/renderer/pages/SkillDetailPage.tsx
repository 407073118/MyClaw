import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import type { FileTreeNode } from "@shared/contracts";
import { renderSafeSkillMarkdown, shouldShowSkillPreviewToggle } from "../utils/skill-preview";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

type ViewMode = "source" | "preview";

// ── 辅助方法 ──────────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"]);
const PREVIEW_EXTS = new Set([".md"]);
const SOURCE_DEFAULT_EXTS = new Set([".json", ".ts", ".js", ".css", ".yaml", ".yml"]);

/** 提取文件扩展名，统一转成小写便于后续判断。 */
function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

/** 判断当前文件是否属于图片资源。 */
function isImageFile(name: string): boolean {
  return IMAGE_EXTS.has(getExtension(name));
}

/** 判断当前文件是否为可在 WebPanel 中加载的 HTML 页面。 */
function isHtmlFile(name: string): boolean {
  return getExtension(name) === ".html";
}

/** 根据文件扩展名推断默认展示模式。 */
function defaultViewMode(name: string): ViewMode {
  const ext = getExtension(name);
  if (PREVIEW_EXTS.has(ext)) return "preview";
  if (SOURCE_DEFAULT_EXTS.has(ext)) return "source";
  return "source";
}

/** 在文件树中按广度优先查找 `SKILL.md` 节点。 */
function findSkillMd(nodes: FileTreeNode[]): FileTreeNode | null {
  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.type === "file" && node.name === "SKILL.md") return node;
    if (node.children) queue.push(...node.children);
  }
  return null;
}

/** 按相对路径查找文件节点，便于恢复当前面板对应的 HTML 选中态。 */
function findFileByRelativePath(nodes: FileTreeNode[], relativePath: string): FileTreeNode | null {
  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.type === "file" && node.relativePath === relativePath) return node;
    if (node.children) queue.push(...node.children);
  }
  return null;
}

/** 提取 WebPanel 中当前文件的相对路径，用来判断是否需要跟随切换。 */
function extractPanelRelativePath(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const relativePath = (data as { relativePath?: unknown }).relativePath;
  return typeof relativePath === "string" ? relativePath : null;
}

// ── 文件树节点组件 ────────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  defaultExpanded: boolean;
  onSelect: (node: FileTreeNode) => void;
}

/** 渲染文件树节点，并负责目录展开和文件选择。 */
function TreeNode({ node, depth, selectedPath, defaultExpanded, onSelect }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (node.type === "directory") {
    return (
      <div className="tree-node">
        <button
          type="button"
          className="tree-item tree-dir"
          aria-label={node.name}
          aria-expanded={expanded}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="tree-icon">{expanded ? "\u25BC" : "\u25B6"}</span>
          <span className="tree-label">{node.name}</span>
        </button>
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
    <button
      type="button"
      className={`tree-item tree-file${isSelected ? " selected" : ""}`}
      aria-label={node.name}
      aria-current={isSelected ? "true" : undefined}
      style={{ paddingLeft: `${12 + depth * 16}px` }}
      onClick={() => onSelect(node)}
    >
      <span className="tree-icon file-icon">{"\uD83D\uDCC4"}</span>
      <span className="tree-label">{node.name}</span>
    </button>
  );
}

// ── SkillDetailPage 页面 ─────────────────────────────────────────────────────

/** 展示 Skill 的文件树、源码内容与预览结果。 */
export default function SkillDetailPage() {
  const { id: skillId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const skills = useWorkspaceStore((s) => s.skills);
  const webPanel = useWorkspaceStore((s) => s.webPanel);
  const openWebPanel = useWorkspaceStore((s) => s.openWebPanel);
  const closeWebPanel = useWorkspaceStore((s) => s.closeWebPanel);

  const skill = useMemo(() => skills.find((s) => s.id === skillId) ?? null, [skills, skillId]);

  // 文件树状态。
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);

  // 当前选中文件状态。
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileLoading, setFileLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("source");

  // 加载 Skill 文件树，并默认选中 `SKILL.md`。
  useEffect(() => {
    if (!skillId) return;
    let cancelled = false;
    setTreeLoading(true);
    window.myClawAPI
      .skillReadTree(skillId)
      .then((nodes) => {
        if (cancelled) return;
        setTree(nodes);
        // 优先自动选中 `SKILL.md`，让详情页首屏更聚焦。
        const panelPath = extractPanelRelativePath(webPanel.data);
        const initialFile = panelPath ? findFileByRelativePath(nodes, panelPath) : findSkillMd(nodes);
        const fallbackFile = initialFile ?? findSkillMd(nodes);
        if (fallbackFile) {
          setSelectedPath(fallbackFile.relativePath);
        }
      })
      .catch((err) => {
        if (!cancelled) console.error("[skill-detail] Failed to load tree", err);
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false);
      });
    return () => { cancelled = true; };
  }, [skillId, webPanel.data]);

  // 文件选择变化后，重新加载文件内容与视图模式。
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

  const currentPanelRelativePath = extractPanelRelativePath(webPanel.data);

  /** 显式打开当前选中的 HTML 页面，并同步面板标题与上下文数据。 */
  const handleOpenHtmlPanel = useCallback(async () => {
    if (!skillId || !selectedPath || !isHtmlFile(selectedPath)) return;
    const viewPath = await window.myClawAPI.webPanelResolvePage(skillId, selectedPath);
    if (!viewPath) {
      console.warn("[skill-detail] HTML 页面解析失败", { skillId, relativePath: selectedPath });
      return;
    }
    const fileName = selectedPath.split("/").pop() ?? selectedPath;
    openWebPanel(viewPath, `${skill?.name ?? ""} / ${fileName}`, {
      skillId,
      skillName: skill?.name ?? "",
      relativePath: selectedPath,
    });
  }, [openWebPanel, selectedPath, skill?.name, skillId]);

  useEffect(() => {
    if (!selectedPath) return;
    if (!isHtmlFile(selectedPath)) {
      if (webPanel.isOpen) {
        console.info("[skill-detail] 当前文件不是 HTML，关闭 WebPanel", { selectedPath });
        closeWebPanel();
      }
      return;
    }
    if (!webPanel.isOpen) return;
    if (currentPanelRelativePath === selectedPath) return;
    console.info("[skill-detail] 当前 HTML 已切换，刷新 WebPanel", { selectedPath });
    void handleOpenHtmlPanel();
  }, [closeWebPanel, currentPanelRelativePath, handleOpenHtmlPanel, selectedPath, webPanel.isOpen]);

  /** 处理文件节点点击，仅允许选择文件类型节点。 */
  const handleSelectFile = useCallback((node: FileTreeNode) => {
    if (node.type === "file") {
      setSelectedPath(node.relativePath);
    }
  }, []);

  // ── 未找到 Skill ───────────────────────────────────────────────────────────
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

  // ── 渲染内容区域 ───────────────────────────────────────────────────────────
  const selectedFileName = selectedPath?.split("/").pop() ?? "";
  const ext = getExtension(selectedFileName);
  const selectedHtmlFile = selectedPath && isHtmlFile(selectedFileName) ? selectedPath : null;
  const panelTracksSelectedHtml = Boolean(selectedHtmlFile && currentPanelRelativePath === selectedHtmlFile);
  const showToggle = shouldShowSkillPreviewToggle(selectedFileName);
  const fileKindLabel = !selectedPath
    ? "未选择"
    : selectedHtmlFile
      ? "HTML 页面"
      : ext === ".md"
        ? "Markdown"
        : isImageFile(selectedFileName)
          ? "图片"
          : ext
            ? ext.slice(1).toUpperCase()
            : "文件";

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
    contentElement = (
      <div className="markdown-preview">
        <article
          className="markdown-preview__surface"
          data-testid="skill-detail-content"
          dangerouslySetInnerHTML={{ __html: renderSafeSkillMarkdown(fileContent) }}
        />
      </div>
    );
  } else {
    // 源码模式下展示带行号的只读视图。
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
      {/* 顶部栏 */}
      <header className="top-bar">
        <button type="button" className="btn-back" onClick={() => navigate("/skills")}>
          &larr; 返回列表
        </button>
        <h2 className="skill-name">{skill.name}</h2>
        <span className={`status-badge${skill.enabled ? " enabled" : ""}`}>
          {skill.enabled ? "已启用" : "已停用"}
        </span>
      </header>

      {/* 主体区域 */}
      <div className="main-body">
        {/* 文件树侧栏 */}
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

        {/* 内容区域 */}
        <section className="content-area">
          {/* 内容工具栏 */}
          <div className="content-toolbar">
            <div className="content-toolbar-meta">
              <span className={`glass-pill ${selectedHtmlFile ? "glass-pill--green" : showToggle ? "glass-pill--accent" : "glass-pill--muted"}`}>
                {fileKindLabel}
              </span>
              <span className="file-path-label">
              {selectedPath ? `${fileKindLabel} · ${selectedPath}` : "..."}
              </span>
            </div>
            {showToggle && (
              <button
                type="button"
                className="btn-toggle-view"
                onClick={() => setViewMode((v) => (v === "source" ? "preview" : "source"))}
              >
                {viewMode === "source" ? "预览" : "源码"}
              </button>
            )}
            {selectedHtmlFile && (
              <button
                type="button"
                className={`btn-toggle-view${panelTracksSelectedHtml ? " btn-toggle-view--active" : ""}`}
                onClick={() => void handleOpenHtmlPanel()}
              >
                {panelTracksSelectedHtml ? "已展示" : "展示"}
              </button>
            )}
          </div>

          {/* 文件内容区 */}
          <div className="content-body">
            {contentElement}
          </div>
        </section>
      </div>

      <style>{styles}</style>
    </main>
  );
}

// ── 样式 ──────────────────────────────────────────────────────────────────────

const styles = `
  .skill-detail-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ---- 未找到状态 ---- */
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

  /* ---- 顶部栏 ---- */
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

  /* ---- 主体布局（侧栏 + 内容区） ---- */
  .main-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  /* ---- 文件树侧栏 ---- */
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

  .tree-item {
    width: 100%;
    border: none;
    background: transparent;
    text-align: left;
    appearance: none;
    font: inherit;
  }

  .tree-item:focus-visible {
    outline: 2px solid rgba(103, 232, 249, 0.65);
    outline-offset: -2px;
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

  /* ---- 内容区域 ---- */
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
    padding: 10px 16px;
    border-bottom: 1px solid var(--glass-border, #333338);
    background: var(--bg-card, #1e1e24);
    flex-shrink: 0;
  }

  .file-path-label {
    font-size: 12px;
    color: var(--text-secondary, #b0b0b8);
    font-family: "Cascadia Code", "Fira Code", monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .btn-toggle-view {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(16, 163, 127, 0.22);
    color: var(--accent-cyan, #67e8f9);
    cursor: pointer;
    padding: 5px 12px;
    border-radius: var(--radius-md, 6px);
    font-size: 12px;
    font-weight: 600;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .btn-toggle-view:hover {
    background: rgba(103, 232, 249, 0.08);
  }

  .btn-toggle-view--active {
    background: rgba(103, 232, 249, 0.12);
    border-color: rgba(103, 232, 249, 0.32);
    color: #ffffff;
  }

  .content-body {
    flex: 1;
    overflow: auto;
    padding: 0;
    scrollbar-width: thin;
    scrollbar-color: hsla(0, 0%, 100%, 0.15) transparent;
  }

  .content-body::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  .content-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .content-body::-webkit-scrollbar-thumb {
    background: hsla(0, 0%, 100%, 0.15);
    border-radius: 999px;
  }

  .content-body::-webkit-scrollbar-thumb:hover {
    background: hsla(0, 0%, 100%, 0.26);
  }

  .content-hint {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-muted, #71717a);
    font-size: 14px;
  }

  .html-panel-callout {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: space-between;
    gap: 16px;
    margin: 24px;
    padding: 20px 22px 18px;
    border: 1px solid var(--glass-border, #333338);
    border-radius: 12px;
    background:
      linear-gradient(180deg, rgba(16, 163, 127, 0.08), rgba(16, 163, 127, 0) 56%),
      rgba(255, 255, 255, 0.03);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .html-panel-callout__header {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .html-panel-callout h3 {
    margin: 0;
    color: var(--text-primary, #fff);
    font-size: 18px;
    line-height: 1.2;
  }

  .html-panel-callout p {
    margin: 0;
    color: var(--text-secondary, #b0b0b8);
    font-size: 13px;
    line-height: 1.6;
    max-width: 66ch;
  }

  .html-panel-callout__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .html-panel-callout__meta {
    color: var(--text-muted, #71717a);
    font-size: 12px;
  }

  .btn-open-html-panel {
    flex-shrink: 0;
    min-width: 112px;
    justify-content: center;
  }

  .btn-open-html-panel:hover {
    transform: translateY(-1px);
  }

  @media (max-width: 900px) {
    .content-toolbar {
      flex-direction: column;
      align-items: flex-start;
    }

    .file-path-label {
      width: 100%;
    }

    .html-panel-callout {
      margin: 16px;
      padding: 18px;
    }

    .html-panel-callout__footer {
      flex-direction: column;
      align-items: stretch;
    }

    .btn-open-html-panel {
      width: 100%;
    }
  }

  /* ---- 源码视图 ---- */
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

  /* ---- 图片预览 ---- */
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

  /* ---- Markdown 预览 ---- */
  .markdown-preview {
    min-height: 100%;
    padding: 24px;
    background:
      radial-gradient(circle at top left, rgba(16, 163, 127, 0.08), transparent 36%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 28%),
      var(--bg-base, #121214);
    color: var(--text-primary, #fff);
    font-size: 14px;
    line-height: 1.7;
    overflow-wrap: break-word;
  }

  .markdown-preview__surface {
    width: min(100%, 880px);
    margin: 0 auto;
    padding: clamp(24px, 4vw, 40px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(16, 163, 127, 0.08), rgba(16, 163, 127, 0) 120px),
      rgba(18, 18, 22, 0.78);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 20px 48px rgba(0, 0, 0, 0.24);
  }

  .markdown-preview__surface > :first-child {
    margin-top: 0;
  }

  .markdown-preview__surface > :last-child {
    margin-bottom: 0;
  }

  .markdown-preview h1 {
    font-size: clamp(28px, 4vw, 36px);
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.03em;
    margin: 0 0 20px;
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .markdown-preview h2 {
    font-size: clamp(22px, 3vw, 28px);
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.02em;
    margin: 36px 0 14px;
  }

  .markdown-preview h3 {
    font-size: 18px;
    font-weight: 700;
    line-height: 1.3;
    margin: 28px 0 10px;
  }

  .markdown-preview h4,
  .markdown-preview h5,
  .markdown-preview h6 {
    font-size: 15px;
    font-weight: 700;
    margin: 22px 0 8px;
    color: var(--text-primary, #fff);
  }

  .markdown-preview p,
  .markdown-preview li,
  .markdown-preview td {
    color: var(--text-secondary, #b0b0b8);
  }

  .markdown-preview p {
    margin: 0 0 16px;
  }

  .markdown-preview a {
    color: var(--accent-cyan, #67e8f9);
    text-decoration-color: rgba(103, 232, 249, 0.38);
    text-underline-offset: 0.18em;
  }

  .markdown-preview a:hover {
    text-decoration-color: currentColor;
  }

  .markdown-preview code {
    font-family: "Cascadia Code", "Fira Code", monospace;
    font-size: 0.9em;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.06);
    padding: 2px 7px;
    border-radius: 6px;
    color: var(--text-primary, #fff);
  }

  .markdown-preview pre {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 22%),
      rgba(9, 12, 14, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 16px 18px;
    overflow-x: auto;
    margin: 0 0 20px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    scrollbar-width: thin;
    scrollbar-color: hsla(0, 0%, 100%, 0.16) transparent;
  }

  .markdown-preview pre::-webkit-scrollbar {
    height: 6px;
  }

  .markdown-preview pre::-webkit-scrollbar-track {
    background: transparent;
  }

  .markdown-preview pre::-webkit-scrollbar-thumb {
    background: hsla(0, 0%, 100%, 0.16);
    border-radius: 999px;
  }

  .markdown-preview pre code {
    background: none;
    border: none;
    padding: 0;
    font-size: 13px;
    line-height: 1.6;
    color: #d4d4d8;
  }

  .markdown-preview ul, .markdown-preview ol {
    margin: 0 0 18px;
    padding-left: 26px;
  }

  .markdown-preview li {
    margin-bottom: 8px;
  }

  .markdown-preview blockquote {
    margin: 0 0 20px;
    padding: 14px 18px;
    border-left: 3px solid var(--accent-cyan, #67e8f9);
    border-radius: 0 12px 12px 0;
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-secondary, #b0b0b8);
  }

  .markdown-preview table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 20px;
    overflow: hidden;
    border-radius: 12px;
    border-style: hidden;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
  }

  .markdown-preview th, .markdown-preview td {
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 10px 12px;
    text-align: left;
    font-size: 13px;
  }

  .markdown-preview th {
    background: rgba(255, 255, 255, 0.05);
    font-weight: 600;
    color: var(--text-primary, #fff);
  }

  .markdown-preview hr {
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    margin: 28px 0;
  }

  .markdown-preview img {
    max-width: 100%;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 16px 30px rgba(0, 0, 0, 0.22);
  }

  @media (max-width: 900px) {
    .markdown-preview {
      padding: 16px;
    }

    .markdown-preview__surface {
      padding: 22px 18px 26px;
      border-radius: 14px;
    }
  }
`;

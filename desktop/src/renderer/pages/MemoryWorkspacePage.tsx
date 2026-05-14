import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Database,
  File,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import type {
  MemoryCandidate,
  MemoryContextPack,
  MemoryDocument,
  MemoryFileNode,
  MemoryFileTree,
  MemoryRoot,
  MemoryRootMode,
  MemorySearchResult,
} from "@shared/contracts";

import { useWorkspaceStore } from "../stores/workspace";

const EMPTY_CONTEXT: MemoryContextPack = {
  enabled: false,
  query: "",
  promptBlock: "",
  evidence: [],
  tokenEstimate: 0,
};

const SAVE_DEBOUNCE_MS = 800;

type MemoryRuntimeIntent = {
  memoryContextEnabled?: boolean;
};

type SelectedMemoryFile = {
  rootId: string;
  relativePath: string;
};

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "readonly" | "error";

type CreateTarget = {
  rootId: string;
  parentRelativePath: string;
};

type PendingCreateKind = "file" | "folder";

type PendingCreate = {
  kind: PendingCreateKind;
  rootId: string;
  parentRelativePath: string;
  name: string;
};

/** 将记忆根目录模式映射成 UI 标签，保持 managed/reference 的用户语义清晰。 */
function rootModeLabel(mode: MemoryRootMode): string {
  return mode === "managed" ? "托管" : "引用";
}

/** 统计文件树中的文件数量，让左侧状态不依赖额外渲染遍历。 */
function countTreeFiles(nodes: MemoryFileNode[]): number {
  return nodes.reduce((sum, node) => {
    if (node.kind === "file") {
      return sum + 1;
    }
    return sum + countTreeFiles(node.children ?? []);
  }, 0);
}

/** 将保存状态翻译为短标签，给 Markdown 编辑器右上角展示。 */
function saveStatusLabel(status: SaveStatus): string {
  const labels: Record<SaveStatus, string> = {
    idle: "未选择",
    dirty: "有修改",
    saving: "保存中",
    saved: "已保存",
    readonly: "只读",
    error: "保存失败",
  };
  return labels[status];
}

/** 判断当前文件节点是否就是右侧正在打开的文档。 */
function isSelectedFile(node: MemoryFileNode, selectedFile: SelectedMemoryFile | null): boolean {
  return selectedFile?.rootId === node.rootId && selectedFile.relativePath === node.relativePath;
}

/** 从文件相对路径中取出父目录，供新建文件默认落在当前文档旁边。 */
function parentPathOf(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

/** 把当前新建位置展示成短路径标签，降低误建到根目录的概率。 */
function createTargetLabel(root: MemoryRoot | undefined, parentRelativePath: string): string {
  if (!root) {
    return "请选择托管根目录";
  }
  return parentRelativePath ? `${root.displayName}/${parentRelativePath}` : root.displayName;
}

/** 记忆库工作台页面：左侧文件树，右侧 Markdown 点开即编辑，检索作为辅助能力保留。 */
export default function MemoryWorkspacePage() {
  const currentSession = useWorkspaceStore((state) => state.currentSession);
  const updateSessionRuntimeIntent = useWorkspaceStore((state) => state.updateSessionRuntimeIntent);
  const [roots, setRoots] = useState<MemoryRoot[]>([]);
  const [fileTrees, setFileTrees] = useState<MemoryFileTree[]>([]);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [contextPack, setContextPack] = useState<MemoryContextPack>(EMPTY_CONTEXT);
  const [activeDocument, setActiveDocument] = useState<MemoryDocument | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedMemoryFile | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [rootPath, setRootPath] = useState("");
  const [rootMode, setRootMode] = useState<MemoryRootMode>("managed");
  const [createTarget, setCreateTarget] = useState<CreateTarget>({ rootId: "", parentRelativePath: "" });
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const managedRoots = useMemo(() => roots.filter((root) => root.mode === "managed"), [roots]);
  const createTargetRoot = useMemo(
    () => managedRoots.find((root) => root.id === createTarget.rootId),
    [createTarget.rootId, managedRoots],
  );
  const memoryContextEnabled = (currentSession?.runtimeIntent as MemoryRuntimeIntent | null | undefined)?.memoryContextEnabled === true;
  const totalFiles = useMemo(() => fileTrees.reduce((sum, tree) => sum + countTreeFiles(tree.children), 0), [fileTrees]);
  const totalChunks = useMemo(() => roots.reduce((sum, root) => sum + root.chunkCount, 0), [roots]);
  const pendingCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.status === "pending"),
    [candidates],
  );

  /** 从 preload 加载根目录、文件树和候选统计，文件树是页面第一信息架构。 */
  const loadMemoryState = useCallback(async () => {
    console.info("[memory-page] 加载记忆库根目录、文件树与候选统计");
    setLoading(true);
    setError(null);
    try {
      const [rootResponse, treeResponse, candidateResponse] = await Promise.all([
        window.myClawAPI.memory.listRoots(),
        window.myClawAPI.memory.listFiles(),
        window.myClawAPI.memory.listCandidates(),
      ]);
      setRoots(rootResponse.items);
      setFileTrees(treeResponse.items);
      setCandidates(candidateResponse.items);
      const firstManagedRoot = rootResponse.items.find((root) => root.mode === "managed");
      setCreateTarget((current) => {
        const stillWritable = rootResponse.items.some((root) => root.id === current.rootId && root.mode === "managed");
        return stillWritable ? current : { rootId: firstManagedRoot?.id || "", parentRelativePath: "" };
      });
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      console.error("[memory-page] 加载记忆库文件工作台失败", { error: message });
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMemoryState();
  }, [loadMemoryState]);

  /** 添加 managed/reference 根目录，并立即触发一次重扫来刷新左侧文件树。 */
  const handleAddRoot = useCallback(async () => {
    const path = rootPath.trim();
    if (!path) return;
    console.info("[memory-page] 添加记忆库根目录", { path, mode: rootMode });
    setBusy("add-root");
    setError(null);
    setNotice(null);
    try {
      const response = await window.myClawAPI.memory.addRoot({ path, mode: rootMode });
      await window.myClawAPI.memory.rescanRoot(response.item.id);
      setRootPath("");
      setNotice("根目录已添加，文件树已刷新");
      await loadMemoryState();
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : String(addError);
      console.error("[memory-page] 添加记忆库根目录失败", { error: message });
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [loadMemoryState, rootMode, rootPath]);

  /** 删除 sidecar 中的根目录索引记录，绝不删除用户真实文件。 */
  const handleRemoveRoot = useCallback(async (rootId: string) => {
    console.info("[memory-page] 移除记忆库根目录索引记录", { rootId });
    setBusy(`remove-${rootId}`);
    setError(null);
    setNotice(null);
    try {
      await window.myClawAPI.memory.removeRoot(rootId);
      if (activeDocument?.rootId === rootId) {
        setActiveDocument(null);
        setSelectedFile(null);
        setEditorContent("");
        setLastSavedContent("");
        setSaveStatus("idle");
      }
      setNotice("根目录索引记录已移除，原始文件未删除");
      await loadMemoryState();
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : String(removeError);
      console.error("[memory-page] 移除记忆库根目录失败", { rootId, error: message });
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [activeDocument?.rootId, loadMemoryState]);

  /** 手动重扫根目录，补齐 watcher 可能漏掉的文件变化并刷新文件树。 */
  const handleRescanRoot = useCallback(async (rootId: string) => {
    console.info("[memory-page] 手动重扫记忆库根目录", { rootId });
    setBusy(`rescan-${rootId}`);
    setError(null);
    setNotice(null);
    try {
      await window.myClawAPI.memory.rescanRoot(rootId);
      setNotice("重扫完成，文件树与索引已刷新");
      await loadMemoryState();
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : String(scanError);
      console.error("[memory-page] 重扫记忆库根目录失败", { rootId, error: message });
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [loadMemoryState]);

  /** 选择左侧树中的托管目录作为新建目标，引用根目录只读所以不允许作为目标。 */
  const handleSelectCreateTarget = useCallback((rootId: string, parentRelativePath: string) => {
    const root = roots.find((item) => item.id === rootId);
    if (!root) return;
    if (root.mode !== "managed") {
      console.info("[memory-page] 尝试选择引用根目录作为新建目标，已拦截", { rootId, parentRelativePath });
      setNotice("引用根目录只读，不能在里面新建文件或文件夹");
      return;
    }
    console.info("[memory-page] 选择记忆库新建目标目录", { rootId, parentRelativePath });
    setCreateTarget({ rootId, parentRelativePath });
    setNotice(null);
  }, [roots]);

  /** 打开左侧文件树中的文档；Markdown 会在右侧直接进入编辑面板。 */
  const handleOpenFile = useCallback(async (node: MemoryFileNode) => {
    if (node.kind !== "file") return;
    console.info("[memory-page] 打开记忆库文件", { rootId: node.rootId, relativePath: node.relativePath });
    setSelectedFile({ rootId: node.rootId, relativePath: node.relativePath });
    setDocumentLoading(true);
    setError(null);
    setSaveError(null);
    try {
      const response = await window.myClawAPI.memory.readDocument({
        rootId: node.rootId,
        relativePath: node.relativePath,
      });
      setActiveDocument(response.item);
      setEditorContent(response.item.content);
      setLastSavedContent(response.item.content);
      setSaveStatus(response.item.editable ? "saved" : "readonly");
      if (response.item.editable) {
        setCreateTarget({ rootId: response.item.rootId, parentRelativePath: parentPathOf(response.item.relativePath) });
      }
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : String(openError);
      console.error("[memory-page] 打开记忆库文件失败", {
        rootId: node.rootId,
        relativePath: node.relativePath,
        error: message,
      });
      setError(message);
    } finally {
      setDocumentLoading(false);
    }
  }, []);

  /** 从文件树工具栏发起就地新建，输入框会出现在当前选中目录下。 */
  const startInlineCreate = useCallback((kind: PendingCreateKind) => {
    if (!createTargetRoot) {
      console.info("[memory-page] 未选择托管目录，拒绝启动树内新建", { kind });
      setNotice("请先在左侧选择一个托管目录，再新建文件或文件夹");
      return;
    }
    console.info("[memory-page] 启动树内就地新建", {
      kind,
      rootId: createTargetRoot.id,
      parentRelativePath: createTarget.parentRelativePath,
    });
    setPendingCreate({
      kind,
      rootId: createTargetRoot.id,
      parentRelativePath: createTarget.parentRelativePath,
      name: "",
    });
    setError(null);
    setNotice(null);
  }, [createTarget.parentRelativePath, createTargetRoot]);

  /** 取消树内就地新建，保持当前目录选择不变，避免误改目标位置。 */
  const cancelInlineCreate = useCallback(() => {
    if (pendingCreate) {
      console.info("[memory-page] 取消树内就地新建", {
        kind: pendingCreate.kind,
        rootId: pendingCreate.rootId,
        parentRelativePath: pendingCreate.parentRelativePath,
      });
    }
    setPendingCreate(null);
  }, [pendingCreate]);

  /** 提交树内就地新建；文件创建后直接打开，文件夹创建后刷新树。 */
  const submitInlineCreate = useCallback(async () => {
    if (!pendingCreate) return;
    const name = pendingCreate.name.trim();
    if (!name) return;

    const root = roots.find((item) => item.id === pendingCreate.rootId);
    if (!root || root.mode !== "managed") {
      console.info("[memory-page] 树内新建目标不是托管根目录，已拒绝", {
        kind: pendingCreate.kind,
        rootId: pendingCreate.rootId,
        parentRelativePath: pendingCreate.parentRelativePath,
      });
      setNotice("引用根目录只读，不能在里面新建文件或文件夹");
      setPendingCreate(null);
      return;
    }

    const busyKey = pendingCreate.kind === "folder" ? "create-folder" : "create-file";
    console.info("[memory-page] 提交树内就地新建", {
      kind: pendingCreate.kind,
      rootId: pendingCreate.rootId,
      parentRelativePath: pendingCreate.parentRelativePath,
      name,
    });
    setBusy(busyKey);
    setError(null);
    setNotice(null);
    try {
      if (pendingCreate.kind === "folder") {
        const response = await window.myClawAPI.memory.createFolder({
          rootId: pendingCreate.rootId,
          parentRelativePath: pendingCreate.parentRelativePath,
          name,
        });
        setNotice(`文件夹已创建：${response.item.relativePath}`);
      } else {
        const response = await window.myClawAPI.memory.createFile({
          rootId: pendingCreate.rootId,
          parentRelativePath: pendingCreate.parentRelativePath,
          title: name,
          content: "",
        });
        setSelectedFile({ rootId: response.item.rootId, relativePath: response.item.relativePath });
        setActiveDocument(response.item);
        setEditorContent(response.item.content);
        setLastSavedContent(response.item.content);
        setSaveStatus(response.item.editable ? "saved" : "readonly");
        setCreateTarget({ rootId: response.item.rootId, parentRelativePath: parentPathOf(response.item.relativePath) });
        setNotice("Markdown 文件已创建并打开");
      }
      setPendingCreate(null);
      await loadMemoryState();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : String(createError);
      console.error("[memory-page] 树内就地新建失败", {
        kind: pendingCreate.kind,
        rootId: pendingCreate.rootId,
        parentRelativePath: pendingCreate.parentRelativePath,
        error: message,
      });
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [loadMemoryState, pendingCreate, roots]);

  /** Markdown 内容变化后自动防抖保存，保持“点开就是编辑”的 Notion 式体验。 */
  useEffect(() => {
    if (!activeDocument || !activeDocument.editable || activeDocument.documentKind !== "markdown") {
      return undefined;
    }
    if (editorContent === lastSavedContent) {
      return undefined;
    }

    setSaveStatus("dirty");
    const contentToSave = editorContent;
    const timer = window.setTimeout(() => {
      void (async () => {
        console.info("[memory-page] 自动保存记忆库 Markdown 文档", {
          rootId: activeDocument.rootId,
          relativePath: activeDocument.relativePath,
        });
        setSaveStatus("saving");
        setSaveError(null);
        try {
          const response = await window.myClawAPI.memory.updateDocument({
            rootId: activeDocument.rootId,
            relativePath: activeDocument.relativePath,
            content: contentToSave,
          });
          setActiveDocument(response.item);
          setLastSavedContent(response.item.content);
          setEditorContent((current) => (current === contentToSave ? response.item.content : current));
          setSaveStatus("saved");
        } catch (saveFailure) {
          const message = saveFailure instanceof Error ? saveFailure.message : String(saveFailure);
          console.error("[memory-page] 自动保存记忆库 Markdown 文档失败", {
            rootId: activeDocument.rootId,
            relativePath: activeDocument.relativePath,
            error: message,
          });
          setSaveError(message);
          setSaveStatus("error");
        }
      })();
    }, SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [activeDocument, editorContent, lastSavedContent]);

  /** 执行记忆检索，并同步构建可注入模型的 evidence pack 预览。 */
  const handleSearch = useCallback(async () => {
    const nextQuery = query.trim();
    if (!nextQuery) return;
    console.info("[memory-page] 搜索记忆库并构建证据包", { query: nextQuery });
    setBusy("search");
    setError(null);
    try {
      const [searchResponse, pack] = await Promise.all([
        window.myClawAPI.memory.search({ query: nextQuery, limit: 10 }),
        window.myClawAPI.memory.getContextPack({ query: nextQuery, limit: 8, tokenBudget: 4096 }),
      ]);
      setResults(searchResponse.items);
      setContextPack(pack);
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message : String(searchError);
      console.error("[memory-page] 搜索记忆库失败", { error: message });
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [query]);

  /** 切换当前会话是否允许 AI 使用记忆库 evidence pack。 */
  const handleToggleMemoryContext = useCallback(async () => {
    const nextEnabled = !memoryContextEnabled;
    console.info("[memory-page] 切换当前会话 AI 记忆库注入", {
      sessionId: currentSession?.id ?? null,
      enabled: nextEnabled,
    });
    setBusy("memory-ai");
    setError(null);
    try {
      await updateSessionRuntimeIntent({ memoryContextEnabled: nextEnabled });
      setNotice(nextEnabled ? "AI 记忆库已对当前会话开启" : "AI 记忆库已对当前会话关闭");
    } catch (toggleError) {
      const message = toggleError instanceof Error ? toggleError.message : String(toggleError);
      console.error("[memory-page] 切换 AI 记忆库注入失败", { error: message });
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [currentSession?.id, memoryContextEnabled, updateSessionRuntimeIntent]);

  /** 渲染树内新建输入行，让用户能在目标目录原地确认文件落点。 */
  const renderInlineCreateRow = (rootId: string, parentRelativePath: string, depth = 0): JSX.Element | null => {
    if (!pendingCreate || pendingCreate.rootId !== rootId || pendingCreate.parentRelativePath !== parentRelativePath) {
      return null;
    }

    const creatingFolder = pendingCreate.kind === "folder";
    const busyKey = creatingFolder ? "create-folder" : "create-file";
    return (
      <div
        className="memory-inline-create-row"
        style={{ paddingLeft: 10 + depth * 14 }}
        data-testid="memory-inline-create-row"
      >
        {creatingFolder ? <Folder size={15} /> : <FileText size={15} />}
        <input
          data-testid="memory-inline-create-input"
          autoFocus
          value={pendingCreate.name}
          placeholder={creatingFolder ? "文件夹名称" : "Markdown 文件名"}
          onChange={(event) => setPendingCreate({ ...pendingCreate, name: event.target.value })}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              void submitInlineCreate();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelInlineCreate();
            }
          }}
        />
        <div className="memory-inline-actions">
          <button
            data-testid="memory-inline-create-confirm"
            type="button"
            className="memory-inline-icon"
            title="确认创建"
            disabled={!pendingCreate.name.trim() || busy === busyKey}
            onClick={() => void submitInlineCreate()}
          >
            <Check size={13} />
          </button>
          <button
            data-testid="memory-inline-create-cancel"
            type="button"
            className="memory-inline-icon"
            title="取消"
            onClick={cancelInlineCreate}
          >
            <X size={13} />
          </button>
        </div>
      </div>
    );
  };

  /** 渲染左侧文件树节点，文件点击后立即在右侧打开，目录只提供层级结构。 */
  const renderFileNode = (node: MemoryFileNode, depth = 0): JSX.Element => {
    if (node.kind === "directory") {
      const targetSelected = createTarget.rootId === node.rootId && createTarget.parentRelativePath === node.relativePath;
      return (
        <div key={node.id} className="memory-tree-node">
          <button
            type="button"
            className={`memory-tree-row memory-tree-row--directory${targetSelected ? " is-target" : ""}`}
            style={{ paddingLeft: 10 + depth * 14 }}
            data-testid={`memory-dir-${node.relativePath}`}
            title={node.relativePath}
            onClick={() => handleSelectCreateTarget(node.rootId, node.relativePath)}
          >
            <Folder size={15} />
            <span title={node.relativePath}>{node.name}</span>
          </button>
          {renderInlineCreateRow(node.rootId, node.relativePath, depth + 1)}
          <div className="memory-tree-children">
            {(node.children ?? []).map((child) => renderFileNode(child, depth + 1))}
          </div>
        </div>
      );
    }

    const selected = isSelectedFile(node, selectedFile);
    const Icon = node.documentKind === "markdown" ? FileText : File;
    return (
      <button
        key={node.id}
        type="button"
        className={`memory-tree-row memory-tree-row--file${selected ? " is-selected" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        data-testid={`memory-file-${node.relativePath}`}
        title={node.relativePath}
        onClick={() => void handleOpenFile(node)}
      >
        <Icon size={15} />
        <span>{node.name}</span>
        {!node.editable && <small>{node.documentKind === "markdown" ? "只读" : "预览"}</small>}
      </button>
    );
  };

  return (
    <main data-testid="memory-workspace-view" className="page-shell memory-page">
      <header className="page-header page-header--sticky memory-header">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <Database size={14} />
            <span>Memory Vault</span>
          </div>
          <h2 className="page-header__title">记忆库</h2>
          <p className="page-header__subtitle">左侧是文件结构树，右侧 Markdown 点开即编辑；文件夹仍是唯一真相源。</p>
        </div>
        <div className="page-header__actions memory-stats" aria-label="记忆库统计">
          <span><strong>{roots.length}</strong> 根目录</span>
          <span><strong>{totalFiles}</strong> 文件</span>
          <span><strong>{totalChunks}</strong> 片段</span>
          <span><strong>{pendingCandidates.length}</strong> 候选</span>
        </div>
      </header>

      <div className="page-content memory-content">
        {loading && <div className="memory-banner">正在加载记忆库</div>}
        {error && <div className="memory-banner memory-banner--error">{error}</div>}
        {notice && <div className="memory-banner memory-banner--ok">{notice}</div>}

        <section className="memory-workbench" aria-label="记忆库文件编辑工作台">
          <aside className="memory-sidebar" aria-label="记忆库文件树">
            <div className="memory-add-root">
              <label htmlFor="memory-root-path">根目录路径</label>
              <div className="memory-add-root__row">
                <input
                  id="memory-root-path"
                  value={rootPath}
                  onChange={(event) => setRootPath(event.target.value)}
                  placeholder="F:\\Work\\Memory"
                />
                <button
                  type="button"
                  className="memory-icon-button"
                  title="添加根目录"
                  disabled={busy === "add-root" || !rootPath.trim()}
                  onClick={() => void handleAddRoot()}
                >
                  <FolderPlus size={16} />
                </button>
              </div>
              <div className="memory-segment" role="group" aria-label="根目录模式">
                <button
                  type="button"
                  className={rootMode === "managed" ? "is-active" : ""}
                  onClick={() => setRootMode("managed")}
                >
                  托管
                </button>
                <button
                  type="button"
                  className={rootMode === "reference" ? "is-active" : ""}
                  onClick={() => setRootMode("reference")}
                >
                  引用
                </button>
              </div>
            </div>

            <div className="memory-tree-header">
              <div className="memory-tree-heading">
                <h3>文件</h3>
                <span className="memory-tree-location" title={createTarget.parentRelativePath}>
                  当前目录：{createTargetLabel(createTargetRoot, createTarget.parentRelativePath)}
                </span>
              </div>
              <div className="memory-tree-actions">
                <button
                  data-testid="memory-new-file-button"
                  type="button"
                  className="memory-icon-button"
                  title={createTargetRoot ? `在 ${createTargetLabel(createTargetRoot, createTarget.parentRelativePath)} 新建 Markdown 文件` : "请选择托管目录"}
                  disabled={!createTargetRoot || busy === "create-file"}
                  onClick={() => startInlineCreate("file")}
                >
                  <FilePlus2 size={15} />
                </button>
                <button
                  data-testid="memory-new-folder-button"
                  type="button"
                  className="memory-icon-button"
                  title={createTargetRoot ? `在 ${createTargetLabel(createTargetRoot, createTarget.parentRelativePath)} 新建文件夹` : "请选择托管目录"}
                  disabled={!createTargetRoot || busy === "create-folder"}
                  onClick={() => startInlineCreate("folder")}
                >
                  <FolderPlus size={15} />
                </button>
                <button type="button" className="memory-icon-button" title="刷新文件树" onClick={() => void loadMemoryState()}>
                  <RefreshCw size={15} />
                </button>
              </div>
            </div>

            <div className="memory-tree">
              {fileTrees.length === 0 ? (
                <div className="memory-empty">暂无根目录，添加托管或引用文件夹后会在这里出现文件树。</div>
              ) : fileTrees.map((tree) => {
                const rootInlineCreateActive = pendingCreate?.rootId === tree.root.id && pendingCreate.parentRelativePath === "";
                return (
                  <div key={tree.root.id} className="memory-root-group">
                    <div className="memory-root-heading">
                      <button
                        type="button"
                        className={`memory-root-heading__main memory-root-heading__button${
                          createTarget.rootId === tree.root.id && createTarget.parentRelativePath === "" ? " is-target" : ""
                        }`}
                        data-testid={`memory-root-target-${tree.root.id}`}
                        title={tree.root.path}
                        onClick={() => handleSelectCreateTarget(tree.root.id, "")}
                      >
                        <strong>{tree.root.displayName}</strong>
                        <span className={`memory-chip memory-chip--${tree.root.mode}`}>{rootModeLabel(tree.root.mode)}</span>
                        <span className={`memory-chip memory-chip--${tree.root.status}`}>{tree.root.status}</span>
                      </button>
                      <div className="memory-root-actions">
                        <button
                          type="button"
                          className="memory-icon-button"
                          title="重扫根目录"
                          disabled={busy === `rescan-${tree.root.id}`}
                          onClick={() => void handleRescanRoot(tree.root.id)}
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          type="button"
                          className="memory-icon-button"
                          title="移除索引"
                          disabled={busy === `remove-${tree.root.id}`}
                          onClick={() => void handleRemoveRoot(tree.root.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <code className="memory-root-path">{tree.root.path}</code>
                    <div className="memory-tree-list">
                      {renderInlineCreateRow(tree.root.id, "", 0)}
                      {tree.children.length === 0 && !rootInlineCreateActive ? (
                        <div className="memory-empty memory-empty--compact">这个根目录还没有可展示文件。</div>
                      ) : tree.children.map((node) => renderFileNode(node))}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          <section className="memory-editor-pane" aria-label="记忆库文档编辑器">
            <div className="memory-editor-topbar">
              <div className="memory-document-title">
                <FileText size={17} />
                <div>
                  <strong>{activeDocument?.title ?? "选择一个 Markdown 文件"}</strong>
                  <span>{activeDocument?.relativePath ?? "从左侧文件树打开文档"}</span>
                </div>
              </div>
              <div className="memory-editor-actions">
                <span className={`memory-save-status memory-save-status--${saveStatus}`}>{saveStatusLabel(saveStatus)}</span>
                <label className="memory-ai-toggle">
                  <input
                    data-testid="memory-ai-toggle"
                    type="checkbox"
                    checked={memoryContextEnabled}
                    disabled={!currentSession || busy === "memory-ai"}
                    onChange={() => void handleToggleMemoryContext()}
                  />
                  <span>AI 使用记忆库</span>
                </label>
              </div>
            </div>

            <div className="memory-editor-surface">
              {documentLoading ? (
                <div className="memory-editor-empty">正在打开文档</div>
              ) : activeDocument?.documentKind === "markdown" ? (
                <textarea
                  data-testid="memory-document-editor"
                  aria-label="Markdown 记忆文档编辑器"
                  value={editorContent}
                  readOnly={!activeDocument.editable}
                  spellCheck={false}
                  onChange={(event) => setEditorContent(event.target.value)}
                />
              ) : activeDocument ? (
                <div className="memory-editor-empty">
                  <File size={26} />
                  <strong>暂只支持 Markdown 直接编辑</strong>
                  <span>{activeDocument.relativePath}</span>
                </div>
              ) : (
                <div className="memory-editor-empty">
                  <FileText size={28} />
                  <strong>从左侧文件树选择 Markdown</strong>
                  <span>托管根目录中的 Markdown 会直接进入可编辑状态，引用根目录保持只读。</span>
                </div>
              )}
            </div>

            {saveError && <div className="memory-banner memory-banner--error">{saveError}</div>}

            <div className="memory-search-strip">
              <div className="memory-search-box">
                <Search size={17} />
                <input
                  data-testid="memory-search-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleSearch();
                  }}
                  placeholder="搜索备忘录、工作文件、中文短语或路径"
                />
                <button
                  data-testid="memory-search-button"
                  type="button"
                  disabled={!query.trim() || busy === "search"}
                  onClick={() => void handleSearch()}
                >
                  检索
                </button>
              </div>

              <div className="memory-search-results">
                <div className="memory-result-list" aria-label="记忆库检索结果">
                  {results.length === 0 ? (
                    <div className="memory-empty memory-empty--compact">暂无检索结果</div>
                  ) : results.map((item) => (
                    <article key={item.id} className="memory-result-row">
                      <div className="memory-result-row__title">
                        <strong>{item.title}</strong>
                        <span>{Math.round(item.score * 100)}%</span>
                      </div>
                      <code>{item.relativePath}</code>
                      <p>{item.snippet}</p>
                    </article>
                  ))}
                </div>
                <pre data-testid="memory-context-preview" className="memory-context-preview">
                  {contextPack.promptBlock || "等待检索后生成 evidence pack"}
                </pre>
              </div>
            </div>
          </section>
        </section>
      </div>

      <style>{`
        .memory-page { color: var(--text-primary); }
        .memory-header { gap: 18px; }
        .memory-stats { display: grid; grid-template-columns: repeat(4, minmax(82px, 1fr)); gap: 8px; min-width: 420px; }
        .memory-stats span { display: flex; flex-direction: column; gap: 3px; padding: 9px 10px; border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text-muted); font-size: 11px; background: rgba(255,255,255,0.025); }
        .memory-stats strong { color: var(--text-primary); font-size: 17px; }
        .memory-content { min-height: 0; display: flex; flex-direction: column; gap: 12px; }
        .memory-banner { padding: 10px 12px; border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text-secondary); background: rgba(255,255,255,0.03); }
        .memory-banner--error { border-color: rgba(248,113,113,0.32); color: #fca5a5; background: rgba(127,29,29,0.14); }
        .memory-banner--ok { border-color: rgba(34,197,94,0.24); color: #86efac; background: rgba(20,83,45,0.12); }
        .memory-workbench { min-height: 720px; display: grid; grid-template-columns: minmax(290px, 360px) minmax(0, 1fr); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; overflow: hidden; background: rgba(255,255,255,0.018); }
        .memory-sidebar { min-width: 0; display: flex; flex-direction: column; border-right: 1px solid rgba(255,255,255,0.07); background: rgba(0,0,0,0.14); }
        .memory-add-root { display: flex; flex-direction: column; gap: 9px; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.07); }
        .memory-add-root label { color: var(--text-secondary); font-size: 12px; font-weight: 800; }
        .memory-add-root__row { display: grid; grid-template-columns: minmax(0, 1fr) 34px; gap: 8px; align-items: center; }
        .memory-add-root input, .memory-inline-create-row input, .memory-search-box input { width: 100%; height: 34px; border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.18); color: var(--text-primary); outline: none; padding: 0 10px; }
        .memory-add-root input:focus, .memory-inline-create-row input:focus, .memory-search-box input:focus, .memory-editor-surface textarea:focus { border-color: rgba(125,211,252,0.45); box-shadow: 0 0 0 2px rgba(125,211,252,0.08); }
        .memory-segment { display: inline-flex; height: 34px; padding: 3px; border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.16); }
        .memory-segment button { flex: 1; min-width: 68px; border: 0; border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer; font-weight: 800; }
        .memory-segment button.is-active { background: rgba(125,211,252,0.12); color: #bae6fd; }
        .memory-tree-header { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.07); color: var(--text-secondary); background: rgba(0,0,0,0.12); }
        .memory-tree-heading { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .memory-tree-header h3 { margin: 0; color: var(--text-primary); font-size: 13px; font-weight: 900; }
        .memory-tree-location { max-width: 190px; color: var(--text-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .memory-tree-actions { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .memory-tree { min-height: 0; flex: 1; overflow: auto; padding: 10px; }
        .memory-root-group { display: flex; flex-direction: column; gap: 6px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .memory-root-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .memory-root-heading__main { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
        .memory-root-heading__button { border: 0; border-radius: 7px; background: transparent; color: inherit; cursor: pointer; text-align: left; padding: 3px 5px; }
        .memory-root-heading__button:hover, .memory-root-heading__button.is-target { background: rgba(125,211,252,0.1); }
        .memory-root-heading__main strong { color: var(--text-primary); font-size: 13px; overflow-wrap: anywhere; }
        .memory-root-actions { display: inline-flex; gap: 5px; flex-shrink: 0; }
        .memory-root-path { color: var(--text-muted); font-size: 11px; line-height: 1.35; white-space: pre-wrap; word-break: break-all; }
        .memory-tree-list, .memory-tree-children { display: flex; flex-direction: column; gap: 2px; }
        .memory-tree-row { min-height: 30px; width: 100%; display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 6px; border: 0; border-radius: 7px; background: transparent; color: var(--text-secondary); text-align: left; font-size: 13px; }
        .memory-tree-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .memory-tree-row small { color: var(--text-muted); font-size: 10px; }
        .memory-tree-row--directory { font-weight: 800; color: var(--text-muted); cursor: pointer; }
        .memory-tree-row--file { cursor: pointer; }
        .memory-tree-row--file:hover, .memory-tree-row--file.is-selected, .memory-tree-row--directory:hover, .memory-tree-row--directory.is-target { color: var(--text-primary); background: rgba(125,211,252,0.1); }
        .memory-inline-create-row { min-height: 34px; display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 6px; margin: 2px 0; border: 1px solid rgba(125,211,252,0.24); border-radius: 7px; background: rgba(125,211,252,0.075); color: var(--text-primary); }
        .memory-inline-create-row input { height: 28px; border-radius: 6px; font-size: 12px; }
        .memory-inline-actions { display: inline-flex; align-items: center; gap: 4px; padding-right: 5px; }
        .memory-inline-icon { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.09); border-radius: 6px; background: rgba(0,0,0,0.16); color: var(--text-secondary); cursor: pointer; }
        .memory-inline-icon:hover { color: var(--text-primary); background: rgba(255,255,255,0.07); }
        .memory-inline-icon:disabled { opacity: 0.45; cursor: not-allowed; }
        .memory-editor-pane { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(360px, 1fr) auto auto; background: rgba(0,0,0,0.08); }
        .memory-editor-topbar { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.07); }
        .memory-document-title { min-width: 0; display: flex; align-items: center; gap: 10px; }
        .memory-document-title div { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .memory-document-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; color: var(--text-primary); }
        .memory-document-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-size: 12px; }
        .memory-editor-actions { display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .memory-ai-toggle { height: 34px; display: inline-flex; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text-secondary); font-size: 12px; font-weight: 800; background: rgba(0,0,0,0.16); white-space: nowrap; }
        .memory-ai-toggle input { width: 16px; height: 16px; accent-color: #38bdf8; }
        .memory-save-status { display: inline-flex; align-items: center; height: 26px; padding: 0 9px; border-radius: 999px; border: 1px solid var(--glass-border); color: var(--text-muted); font-size: 11px; font-weight: 900; }
        .memory-save-status--dirty, .memory-save-status--saving { color: #fde68a; border-color: rgba(250,204,21,0.25); background: rgba(250,204,21,0.08); }
        .memory-save-status--saved { color: #86efac; border-color: rgba(34,197,94,0.25); background: rgba(34,197,94,0.08); }
        .memory-save-status--readonly { color: #bae6fd; border-color: rgba(56,189,248,0.25); background: rgba(56,189,248,0.08); }
        .memory-save-status--error { color: #fca5a5; border-color: rgba(248,113,113,0.25); background: rgba(248,113,113,0.08); }
        .memory-editor-surface { min-height: 0; display: flex; padding: 0; }
        .memory-editor-surface textarea { width: 100%; min-height: 100%; resize: none; border: 0; border-radius: 0; outline: none; padding: 22px 24px 34px; background: rgba(255,255,255,0.012); color: var(--text-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 14px; line-height: 1.7; }
        .memory-editor-surface textarea[readonly] { color: var(--text-secondary); background: rgba(255,255,255,0.018); }
        .memory-editor-empty { width: 100%; min-height: 360px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 28px; color: var(--text-muted); text-align: center; }
        .memory-editor-empty strong { color: var(--text-primary); font-size: 15px; }
        .memory-editor-empty span { max-width: 420px; color: var(--text-muted); font-size: 13px; line-height: 1.55; }
        .memory-search-strip { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px 14px; border-top: 1px solid rgba(255,255,255,0.07); background: rgba(0,0,0,0.12); }
        .memory-search-box { display: grid; grid-template-columns: auto minmax(180px, 1fr) auto; align-items: center; gap: 9px; }
        .memory-search-box button { display: inline-flex; align-items: center; justify-content: center; height: 34px; border: 1px solid rgba(125,211,252,0.24); border-radius: 8px; background: rgba(14,116,144,0.28); color: #e0f2fe; font-weight: 800; cursor: pointer; padding: 0 13px; }
        .memory-search-box button:disabled, .memory-icon-button:disabled { opacity: 0.48; cursor: not-allowed; }
        .memory-search-results { display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(280px, 1.05fr); gap: 10px; align-items: stretch; }
        .memory-result-list { min-height: 120px; max-height: 220px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
        .memory-result-row { display: flex; flex-direction: column; gap: 5px; padding: 10px; border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; background: rgba(255,255,255,0.025); }
        .memory-result-row__title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .memory-result-row__title strong { color: var(--text-primary); font-size: 13px; overflow-wrap: anywhere; }
        .memory-result-row__title span, .memory-result-row code { color: var(--text-muted); font-size: 11px; }
        .memory-result-row p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
        .memory-context-preview { min-height: 120px; max-height: 220px; overflow: auto; margin: 0; padding: 10px; border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; background: rgba(0,0,0,0.24); color: var(--text-secondary); white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.55; }
        .memory-icon-button { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--glass-border); border-radius: 8px; background: transparent; color: var(--text-secondary); cursor: pointer; }
        .memory-icon-button:hover { background: rgba(255,255,255,0.06); color: var(--text-primary); }
        .memory-chip { display: inline-flex; align-items: center; min-height: 19px; padding: 2px 6px; border-radius: 999px; border: 1px solid var(--glass-border); color: var(--text-muted); font-size: 10px; font-weight: 900; }
        .memory-chip--managed, .memory-chip--ready, .memory-chip--approved { color: #86efac; border-color: rgba(34,197,94,0.25); background: rgba(34,197,94,0.08); }
        .memory-chip--reference, .memory-chip--indexing, .memory-chip--pending { color: #bae6fd; border-color: rgba(56,189,248,0.25); background: rgba(56,189,248,0.08); }
        .memory-chip--error, .memory-chip--rejected { color: #fca5a5; border-color: rgba(248,113,113,0.25); background: rgba(248,113,113,0.08); }
        .memory-chip--idle { color: #d8b4fe; border-color: rgba(168,85,247,0.24); background: rgba(168,85,247,0.07); }
        .memory-empty { padding: 12px; border: 1px dashed var(--glass-border); border-radius: 8px; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
        .memory-empty--compact { padding: 9px; }
        @media (max-width: 1180px) {
          .memory-stats { min-width: 0; width: 100%; grid-template-columns: repeat(2, minmax(110px, 1fr)); }
          .memory-workbench { grid-template-columns: 1fr; }
          .memory-sidebar { border-right: 0; border-bottom: 1px solid rgba(255,255,255,0.07); max-height: 520px; }
          .memory-search-results { grid-template-columns: 1fr; }
          .memory-editor-topbar { align-items: flex-start; flex-direction: column; }
          .memory-editor-actions { width: 100%; justify-content: space-between; }
        }
      `}</style>
    </main>
  );
}

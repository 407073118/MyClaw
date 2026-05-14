import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Database,
  FilePlus2,
  FolderPlus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";

import type {
  MemoryCandidate,
  MemoryContextPack,
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

type MemoryRuntimeIntent = {
  memoryContextEnabled?: boolean;
};

/** 将记忆根目录模式映射成 UI 标签，确保 managed/reference 语义稳定展示。 */
function rootModeLabel(mode: MemoryRootMode): string {
  return mode === "managed" ? "托管" : "引用";
}

/** 将候选记忆类型映射成更短的收件箱标签，便于密集列表扫描。 */
function candidateTypeLabel(type: MemoryCandidate["type"]): string {
  return ({
    TodoCandidate: "TODO",
    TagCandidate: "标签",
    SummaryCandidate: "摘要",
    LongTermFactCandidate: "事实",
  } as Record<MemoryCandidate["type"], string>)[type] ?? type;
}

/** 记忆库工作台页面，集中管理文件夹根、备忘录、检索和可审批候选记忆。 */
export default function MemoryWorkspacePage() {
  const currentSession = useWorkspaceStore((state) => state.currentSession);
  const updateSessionRuntimeIntent = useWorkspaceStore((state) => state.updateSessionRuntimeIntent);
  const [roots, setRoots] = useState<MemoryRoot[]>([]);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [contextPack, setContextPack] = useState<MemoryContextPack>(EMPTY_CONTEXT);
  const [rootPath, setRootPath] = useState("");
  const [rootMode, setRootMode] = useState<MemoryRootMode>("managed");
  const [memoRootId, setMemoRootId] = useState("");
  const [memoTitle, setMemoTitle] = useState("");
  const [memoContent, setMemoContent] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const managedRoots = useMemo(() => roots.filter((root) => root.mode === "managed"), [roots]);
  const memoryContextEnabled = (currentSession?.runtimeIntent as MemoryRuntimeIntent | null | undefined)?.memoryContextEnabled === true;
  const totalFiles = useMemo(() => roots.reduce((sum, root) => sum + root.fileCount, 0), [roots]);
  const totalChunks = useMemo(() => roots.reduce((sum, root) => sum + root.chunkCount, 0), [roots]);
  const pendingCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.status === "pending"),
    [candidates],
  );

  /** 从 preload 读取记忆库状态，渲染根目录与候选收件箱。 */
  const loadMemoryState = useCallback(async () => {
    console.info("[memory-page] 加载记忆库根目录与候选记忆");
    setLoading(true);
    setError(null);
    try {
      const [rootResponse, candidateResponse] = await Promise.all([
        window.myClawAPI.memory.listRoots(),
        window.myClawAPI.memory.listCandidates(),
      ]);
      setRoots(rootResponse.items);
      setCandidates(candidateResponse.items);
      const firstManagedRoot = rootResponse.items.find((root) => root.mode === "managed");
      setMemoRootId((current) => current || firstManagedRoot?.id || "");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      console.error("[memory-page] 加载记忆库状态失败", { error: message });
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMemoryState();
  }, [loadMemoryState]);

  /** 添加 managed/reference 根目录，并立即触发一次补账式重扫。 */
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
      setNotice("根目录已添加并完成索引");
      await loadMemoryState();
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : String(addError);
      console.error("[memory-page] 添加记忆库根目录失败", { error: message });
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [loadMemoryState, rootMode, rootPath]);

  /** 删除 sidecar 中的根目录记录，用户原始文件不会被删除。 */
  const handleRemoveRoot = useCallback(async (rootId: string) => {
    console.info("[memory-page] 删除记忆库根目录索引记录", { rootId });
    setBusy(`remove-${rootId}`);
    setError(null);
    setNotice(null);
    try {
      await window.myClawAPI.memory.removeRoot(rootId);
      setNotice("根目录索引记录已移除");
      await loadMemoryState();
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : String(removeError);
      console.error("[memory-page] 删除记忆库根目录失败", { rootId, error: message });
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [loadMemoryState]);

  /** 手动重扫根目录，保证 watcher 丢事件后仍能补齐索引。 */
  const handleRescanRoot = useCallback(async (rootId: string) => {
    console.info("[memory-page] 手动重扫记忆库根目录", { rootId });
    setBusy(`rescan-${rootId}`);
    setError(null);
    setNotice(null);
    try {
      await window.myClawAPI.memory.rescanRoot(rootId);
      setNotice("重扫完成");
      await loadMemoryState();
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : String(scanError);
      console.error("[memory-page] 重扫记忆库根目录失败", { rootId, error: message });
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [loadMemoryState]);

  /** 在 managed 根目录下创建 Markdown 备忘录，并刷新索引状态。 */
  const handleCreateMemo = useCallback(async () => {
    if (!memoRootId || !memoTitle.trim()) return;
    console.info("[memory-page] 创建托管备忘录", { rootId: memoRootId, title: memoTitle });
    setBusy("create-memo");
    setError(null);
    setNotice(null);
    try {
      await window.myClawAPI.memory.createMemo({
        rootId: memoRootId,
        title: memoTitle,
        content: memoContent,
      });
      await window.myClawAPI.memory.rescanRoot(memoRootId);
      setMemoTitle("");
      setMemoContent("");
      setNotice("备忘录已写入 notes/inbox");
      await loadMemoryState();
    } catch (memoError) {
      const message = memoError instanceof Error ? memoError.message : String(memoError);
      console.error("[memory-page] 创建备忘录失败", { error: message });
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [loadMemoryState, memoContent, memoRootId, memoTitle]);

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

  /** 切换当前会话的 AI 记忆库注入开关，默认关闭且只影响下一次发送。 */
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

  /** 审批候选记忆，V1 只更新候选状态。 */
  const handleApproveCandidate = useCallback(async (candidateId: string) => {
    console.info("[memory-page] 审批通过候选记忆", { candidateId });
    setBusy(`approve-${candidateId}`);
    try {
      await window.myClawAPI.memory.approveCandidate(candidateId);
      await loadMemoryState();
    } finally {
      setBusy(null);
    }
  }, [loadMemoryState]);

  /** 拒绝候选记忆，保留审计状态但不写入长期记忆。 */
  const handleRejectCandidate = useCallback(async (candidateId: string) => {
    console.info("[memory-page] 拒绝候选记忆", { candidateId });
    setBusy(`reject-${candidateId}`);
    try {
      await window.myClawAPI.memory.rejectCandidate(candidateId);
      await loadMemoryState();
    } finally {
      setBusy(null);
    }
  }, [loadMemoryState]);

  return (
    <main data-testid="memory-workspace-view" className="page-shell memory-page">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <Database size={14} />
            <span>Memory Vault</span>
          </div>
          <h2 className="page-header__title">记忆库</h2>
          <p className="page-header__subtitle">文件夹驱动的个人记忆、备忘录、检索证据与候选记忆收件箱。</p>
        </div>
        <div className="page-header__actions memory-stats" aria-label="记忆库统计">
          <span><strong>{roots.length}</strong> 根目录</span>
          <span><strong>{totalFiles}</strong> 文件</span>
          <span><strong>{totalChunks}</strong> 片段</span>
          <span><strong>{pendingCandidates.length}</strong> 待审</span>
        </div>
      </header>

      <div className="page-content memory-content">
        {loading && <div className="memory-banner">正在加载记忆库</div>}
        {error && <div className="memory-banner memory-banner--error">{error}</div>}
        {notice && <div className="memory-banner memory-banner--ok">{notice}</div>}

        <section className="memory-toolbar" aria-label="添加记忆根目录">
          <div className="memory-root-input">
            <label htmlFor="memory-root-path">根目录路径</label>
            <input
              id="memory-root-path"
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
              placeholder="F:\\Work\\Memory"
            />
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
          <button
            type="button"
            className="memory-primary"
            disabled={busy === "add-root" || !rootPath.trim()}
            onClick={() => void handleAddRoot()}
          >
            <FolderPlus size={16} />
            添加
          </button>
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
        </section>

        <section className="memory-grid">
          <div className="memory-panel memory-panel--roots">
            <div className="memory-section-title">
              <h3>根目录</h3>
              <button type="button" className="memory-icon-button" title="刷新" onClick={() => void loadMemoryState()}>
                <RefreshCw size={15} />
              </button>
            </div>
            <div className="memory-root-list">
              {roots.length === 0 ? (
                <div className="memory-empty">暂无根目录</div>
              ) : roots.map((root) => (
                <article key={root.id} className="memory-root-row">
                  <div className="memory-root-row__main">
                    <div className="memory-root-row__title">
                      <strong>{root.displayName}</strong>
                      <span className={`memory-chip memory-chip--${root.mode}`}>{rootModeLabel(root.mode)}</span>
                      <span className={`memory-chip memory-chip--${root.status}`}>{root.status}</span>
                    </div>
                    <code>{root.path}</code>
                    <div className="memory-muted">{root.fileCount} files · {root.chunkCount} chunks</div>
                  </div>
                  <div className="memory-row-actions">
                    <button
                      type="button"
                      className="memory-icon-button"
                      title="重扫"
                      disabled={busy === `rescan-${root.id}`}
                      onClick={() => void handleRescanRoot(root.id)}
                    >
                      <RefreshCw size={15} />
                    </button>
                    <button
                      type="button"
                      className="memory-icon-button"
                      title="移除索引"
                      disabled={busy === `remove-${root.id}`}
                      onClick={() => void handleRemoveRoot(root.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="memory-panel">
            <div className="memory-section-title">
              <h3>新备忘录</h3>
              <FilePlus2 size={16} />
            </div>
            <div className="memory-memo-form">
              <label>
                托管根目录
                <select value={memoRootId} onChange={(event) => setMemoRootId(event.target.value)}>
                  <option value="">选择根目录</option>
                  {managedRoots.map((root) => (
                    <option key={root.id} value={root.id}>{root.displayName}</option>
                  ))}
                </select>
              </label>
              <label>
                标题
                <input value={memoTitle} onChange={(event) => setMemoTitle(event.target.value)} placeholder="项目复盘" />
              </label>
              <label>
                内容
                <textarea value={memoContent} onChange={(event) => setMemoContent(event.target.value)} rows={7} />
              </label>
              <button
                type="button"
                className="memory-primary"
                disabled={!memoRootId || !memoTitle.trim() || busy === "create-memo"}
                onClick={() => void handleCreateMemo()}
              >
                <FilePlus2 size={16} />
                写入 notes/inbox
              </button>
            </div>
          </div>
        </section>

        <section className="memory-search-band">
          <div className="memory-search-box">
            <Search size={17} />
            <input
              data-testid="memory-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSearch();
              }}
              placeholder="搜索备忘录、工作文件、中文短词或路径"
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
        </section>

        <section className="memory-grid memory-grid--wide">
          <div className="memory-panel">
            <div className="memory-section-title">
              <h3>检索结果</h3>
              <span>{results.length}</span>
            </div>
            <div className="memory-result-list">
              {results.length === 0 ? (
                <div className="memory-empty">暂无结果</div>
              ) : results.map((item) => (
                <article key={item.id} className="memory-result-row">
                  <div className="memory-result-row__title">
                    <strong>{item.title}</strong>
                    <span>{Math.round(item.score * 100)}%</span>
                  </div>
                  <code>{item.relativePath}</code>
                  <p>{item.snippet}</p>
                  <div className="memory-muted">{item.locator} · {item.sha256.slice(0, 10)}</div>
                </article>
              ))}
            </div>
          </div>

          <div className="memory-panel">
            <div className="memory-section-title">
              <h3>Context Pack</h3>
              <Sparkles size={16} />
            </div>
            <pre data-testid="memory-context-preview" className="memory-context-preview">
              {contextPack.promptBlock || "等待检索"}
            </pre>
          </div>
        </section>

        <section className="memory-panel">
          <div className="memory-section-title">
            <h3>候选记忆收件箱</h3>
            <span>{pendingCandidates.length} pending</span>
          </div>
          <div className="memory-candidate-list">
            {candidates.length === 0 ? (
              <div className="memory-empty">暂无候选记忆</div>
            ) : candidates.map((candidate) => (
              <article key={candidate.id} className="memory-candidate-row">
                <div className="memory-candidate-row__main">
                  <div className="memory-root-row__title">
                    <strong>{candidate.title}</strong>
                    <span className="memory-chip">{candidateTypeLabel(candidate.type)}</span>
                    <span className={`memory-chip memory-chip--${candidate.status}`}>{candidate.status}</span>
                  </div>
                  <p>{candidate.body}</p>
                  <div className="memory-muted">confidence {Math.round(candidate.confidence * 100)}%</div>
                </div>
                {candidate.status === "pending" && (
                  <div className="memory-row-actions">
                    <button
                      type="button"
                      className="memory-icon-button"
                      title="通过"
                      disabled={busy === `approve-${candidate.id}`}
                      onClick={() => void handleApproveCandidate(candidate.id)}
                    >
                      <CheckCircle2 size={15} />
                    </button>
                    <button
                      type="button"
                      className="memory-icon-button"
                      title="拒绝"
                      disabled={busy === `reject-${candidate.id}`}
                      onClick={() => void handleRejectCandidate(candidate.id)}
                    >
                      <XCircle size={15} />
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>

      <style>{`
        .memory-page { color: var(--text-primary); }
        .memory-stats { display: grid; grid-template-columns: repeat(4, minmax(86px, 1fr)); gap: 8px; min-width: 440px; }
        .memory-stats span { display: flex; flex-direction: column; gap: 3px; padding: 9px 10px; border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text-muted); font-size: 11px; background: rgba(255,255,255,0.025); }
        .memory-stats strong { color: var(--text-primary); font-size: 17px; }
        .memory-content { display: flex; flex-direction: column; gap: 18px; }
        .memory-banner { padding: 10px 12px; border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text-secondary); background: rgba(255,255,255,0.03); }
        .memory-banner--error { border-color: rgba(248,113,113,0.32); color: #fca5a5; background: rgba(127,29,29,0.14); }
        .memory-banner--ok { border-color: rgba(34,197,94,0.24); color: #86efac; background: rgba(20,83,45,0.12); }
        .memory-toolbar { display: grid; grid-template-columns: minmax(260px, 1fr) auto auto auto; gap: 10px; align-items: end; padding: 14px; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.025); }
        .memory-root-input, .memory-memo-form label { display: flex; flex-direction: column; gap: 7px; color: var(--text-secondary); font-size: 12px; font-weight: 700; }
        .memory-root-input input, .memory-memo-form input, .memory-memo-form textarea, .memory-memo-form select, .memory-search-box input { width: 100%; border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.18); color: var(--text-primary); outline: none; }
        .memory-root-input input, .memory-memo-form input, .memory-memo-form select, .memory-search-box input { height: 36px; padding: 0 11px; }
        .memory-memo-form textarea { min-height: 144px; padding: 10px 11px; resize: vertical; line-height: 1.45; }
        .memory-root-input input:focus, .memory-memo-form input:focus, .memory-memo-form textarea:focus, .memory-memo-form select:focus, .memory-search-box input:focus { border-color: rgba(125,211,252,0.45); box-shadow: 0 0 0 2px rgba(125,211,252,0.08); }
        .memory-segment { display: inline-flex; height: 36px; padding: 3px; border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.16); }
        .memory-segment button { min-width: 68px; border: 0; border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer; font-weight: 700; }
        .memory-segment button.is-active { background: rgba(125,211,252,0.12); color: #bae6fd; }
        .memory-ai-toggle { height: 36px; display: inline-flex; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text-secondary); font-size: 12px; font-weight: 800; background: rgba(0,0,0,0.16); white-space: nowrap; }
        .memory-ai-toggle input { width: 16px; height: 16px; accent-color: #38bdf8; }
        .memory-primary, .memory-search-box button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 36px; border: 1px solid rgba(125,211,252,0.24); border-radius: 8px; background: rgba(14,116,144,0.28); color: #e0f2fe; font-weight: 800; cursor: pointer; padding: 0 13px; }
        .memory-primary:disabled, .memory-search-box button:disabled, .memory-icon-button:disabled { opacity: 0.48; cursor: not-allowed; }
        .memory-grid { display: grid; grid-template-columns: minmax(320px, 1.25fr) minmax(300px, 0.75fr); gap: 18px; align-items: start; }
        .memory-grid--wide { grid-template-columns: minmax(360px, 1fr) minmax(360px, 1fr); }
        .memory-panel { display: flex; flex-direction: column; gap: 13px; min-width: 0; }
        .memory-panel--roots { min-height: 260px; }
        .memory-section-title { min-height: 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 9px; }
        .memory-section-title h3 { margin: 0; font-size: 14px; font-weight: 800; color: var(--text-primary); }
        .memory-section-title span, .memory-muted { color: var(--text-muted); font-size: 12px; }
        .memory-root-list, .memory-result-list, .memory-candidate-list, .memory-memo-form { display: flex; flex-direction: column; gap: 10px; }
        .memory-root-row, .memory-result-row, .memory-candidate-row { display: flex; justify-content: space-between; gap: 14px; padding: 13px; border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; background: rgba(255,255,255,0.025); }
        .memory-root-row__main, .memory-candidate-row__main { display: flex; flex-direction: column; min-width: 0; gap: 7px; }
        .memory-root-row__title, .memory-result-row__title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
        .memory-root-row__title strong, .memory-result-row__title strong { color: var(--text-primary); font-size: 14px; overflow-wrap: anywhere; }
        .memory-root-row code, .memory-result-row code { color: var(--text-muted); font-size: 12px; white-space: pre-wrap; word-break: break-all; }
        .memory-row-actions { display: flex; gap: 6px; align-items: flex-start; flex-shrink: 0; }
        .memory-icon-button { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--glass-border); border-radius: 8px; background: transparent; color: var(--text-secondary); cursor: pointer; }
        .memory-icon-button:hover { background: rgba(255,255,255,0.06); color: var(--text-primary); }
        .memory-chip { display: inline-flex; align-items: center; min-height: 20px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--glass-border); color: var(--text-muted); font-size: 11px; font-weight: 800; }
        .memory-chip--managed, .memory-chip--ready, .memory-chip--approved { color: #86efac; border-color: rgba(34,197,94,0.25); background: rgba(34,197,94,0.08); }
        .memory-chip--reference, .memory-chip--indexing, .memory-chip--pending { color: #bae6fd; border-color: rgba(56,189,248,0.25); background: rgba(56,189,248,0.08); }
        .memory-chip--error, .memory-chip--rejected { color: #fca5a5; border-color: rgba(248,113,113,0.25); background: rgba(248,113,113,0.08); }
        .memory-chip--idle { color: #d8b4fe; border-color: rgba(168,85,247,0.24); background: rgba(168,85,247,0.07); }
        .memory-empty { padding: 14px; border: 1px dashed var(--glass-border); border-radius: 8px; color: var(--text-muted); }
        .memory-search-band { padding: 4px 0; }
        .memory-search-box { display: grid; grid-template-columns: auto minmax(220px, 1fr) auto; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.16); }
        .memory-result-row { flex-direction: column; }
        .memory-result-row p, .memory-candidate-row p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
        .memory-context-preview { min-height: 250px; max-height: 420px; overflow: auto; margin: 0; padding: 13px; border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; background: rgba(0,0,0,0.24); color: var(--text-secondary); white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.55; }
        @media (max-width: 1180px) {
          .memory-stats { min-width: 0; width: 100%; grid-template-columns: repeat(2, minmax(110px, 1fr)); }
          .memory-grid, .memory-grid--wide { grid-template-columns: 1fr; }
          .memory-toolbar { grid-template-columns: 1fr; }
        }
      `}</style>
    </main>
  );
}

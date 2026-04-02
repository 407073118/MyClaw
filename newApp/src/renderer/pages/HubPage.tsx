import React, { useState, useMemo, useEffect, useRef } from "react";
import { useWorkspaceStore, type CloudSkillCategory } from "@/stores/workspace";
import { useShellStore } from "@/stores/shell";

type CloudHubItemType = "skill" | "mcp" | "employee-package" | "workflow-package";

const SKILL_CATEGORIES: { value: CloudSkillCategory; label: string }[] = [
  { value: "productivity", label: "效率工具" },
  { value: "development", label: "开发工具" },
  { value: "data", label: "数据分析" },
  { value: "communication", label: "沟通协作" },
  { value: "other", label: "其他" },
];

function getCategoryLabel(cat: string): string {
  return SKILL_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;
}

function getAvatarColor(name: string): string {
  const colors = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#84cc16"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatDownloads(count: number): string {
  if (count >= 10000) return (count / 10000).toFixed(1) + "w";
  if (count >= 1000) return (count / 1000).toFixed(1) + "k";
  return String(count);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function hubTypeLabel(type: string) {
  if (type === "skill") return "技能";
  if (type === "mcp") return "MCP";
  if (type === "employee-package") return "员工包";
  return "工作流包";
}

function installActionLabel(type: string) {
  if (type === "mcp") return "安装到本地 MCP 配置";
  if (type === "employee-package") return "导入到本地员工列表";
  return "导入到本地工作流列表";
}

export default function HubPage() {
  const workspace = useWorkspaceStore();
  const shell = useShellStore();

  const [activeTab, setActiveTab] = useState<CloudHubItemType>("skill");
  const [selectedCategory, setSelectedCategory] = useState<CloudSkillCategory | "">("");
  const [selectedTag, setSelectedTag] = useState("");
  const [keyword, setKeyword] = useState("");
  const [sortBy, setSortBy] = useState<"latest" | "downloads" | "name">("latest");
  const [loading, setLoading] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState("");
  const [importError, setImportError] = useState("");
  const [cloudError, setCloudError] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 5;

  const displayedSkills = useMemo(() => {
    let items: any[] = workspace.cloudSkills ?? [];
    if (selectedCategory) items = items.filter((s: any) => s.category === selectedCategory);
    if (selectedTag) items = items.filter((s: any) => s.tags?.includes(selectedTag));
    return items;
  }, [workspace.cloudSkills, selectedCategory, selectedTag]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const skill of workspace.cloudSkills ?? []) {
      if ((skill as any).tags) for (const tag of (skill as any).tags) tagSet.add(tag);
    }
    return Array.from(tagSet).sort();
  }, [workspace.cloudSkills]);

  const filteredHubItems = useMemo(
    () => (workspace.cloudHubItems ?? []).filter((item: any) => item.type === activeTab),
    [workspace.cloudHubItems, activeTab]
  );

  const cloudManifest = (workspace as any).cloudHubManifest;

  function scheduleRetry() {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (retryCountRef.current >= MAX_RETRIES) return;
    retryCountRef.current += 1;
    const delay = Math.min(3000 * Math.pow(2, retryCountRef.current - 1), 30000);
    retryTimerRef.current = setTimeout(() => void loadData(), delay);
  }

  async function loadSkills() {
    setLoading(true);
    try {
      await workspace.loadCloudSkills({
        ...(selectedCategory ? { category: selectedCategory } : {}),
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        ...(sortBy !== "latest" ? { sort: sortBy } : {}),
        ...(selectedTag ? { tag: selectedTag } : {}),
      });
      setCloudError(false);
      retryCountRef.current = 0;
    } catch {
      setCloudError(true);
      scheduleRetry();
    } finally {
      setLoading(false);
    }
  }

  async function loadData() {
    if (activeTab === "skill") {
      await loadSkills();
    } else {
      setLoading(true);
      setCloudError(false);
      try {
        await workspace.loadCloudHubItems(activeTab);
        retryCountRef.current = 0;
      } catch {
        setCloudError(true);
        scheduleRetry();
      } finally {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadData();
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === "skill") void loadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, sortBy]);

  useEffect(() => {
    setSelectedTag("");
    if (activeTab === "skill") void loadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  useEffect(() => {
    function onWindowFocus() { if (cloudError) void loadData(); }
    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudError]);

  async function switchTab(tab: CloudHubItemType) {
    setActiveTab(tab);
    setDetailVisible(false);
    setImportFeedback("");
    setImportError("");
    setLoading(true);
    setCloudError(false);
    try {
      if (tab === "skill") await workspace.loadCloudSkills({});
      else await workspace.loadCloudHubItems(tab);
    } catch {
      setCloudError(true);
      scheduleRetry();
    } finally {
      setLoading(false);
    }
  }

  async function openSkillDetail(skillId: string) {
    setDetailVisible(true);
    setImportFeedback("");
    setImportError("");
    workspace.clearCloudSkillDetail();
    try { await workspace.loadCloudSkillDetail(skillId); } catch { /* handled */ }
  }

  async function openHubItemDetail(itemId: string) {
    setDetailVisible(true);
    setImportFeedback("");
    setImportError("");
    workspace.clearCloudHubDetail();
    try {
      const detail = await workspace.loadCloudHubDetail(itemId);
      const releaseId = (detail as any).releases[0]?.id;
      if (releaseId) await workspace.loadCloudHubManifest(releaseId);
    } catch { /* handled */ }
  }

  function closeDetail() {
    setDetailVisible(false);
    setImportFeedback("");
    setImportError("");
  }

  async function installSkill() {
    const detail = (workspace as any).cloudSkillDetail;
    if (!detail || isImporting) return;
    const releaseId = detail.releases?.[0]?.id;
    if (!releaseId) { setImportError("无可用版本。"); return; }
    setIsImporting(true); setImportFeedback(""); setImportError("");
    try {
      await workspace.importCloudSkill({ releaseId, skillName: detail.name });
      setImportFeedback("已安装到本地技能目录。");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "安装失败。");
    } finally { setIsImporting(false); }
  }

  async function installHubItem() {
    const detail = (workspace as any).cloudHubDetail;
    const manifest = cloudManifest;
    if (!detail || !manifest || isImporting) return;
    setIsImporting(true); setImportFeedback(""); setImportError("");
    try {
      if (detail.type === "mcp") {
        await workspace.importCloudMcp(manifest);
        setImportFeedback("已安装到本地 MCP 配置。");
      } else {
        const releaseId = detail.releases[0]?.id;
        if (!releaseId) throw new Error("无可用版本。");
        if (detail.type === "employee-package") {
          await workspace.importCloudEmployeePackage({ itemId: detail.id, releaseId, name: detail.name, summary: detail.summary, manifest });
          setImportFeedback("已导入到本地员工列表。");
        } else {
          await workspace.importCloudWorkflowPackage({ itemId: detail.id, releaseId, name: detail.name, summary: detail.summary, manifest });
          setImportFeedback("已导入到本地工作流列表。");
        }
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "导入失败。");
    } finally { setIsImporting(false); }
  }

  const skillDetail = (workspace as any).cloudSkillDetail as any;
  const hubDetail = (workspace as any).cloudHubDetail as any;

  return (
    <main className="page-container">
      <header className="page-header">
        <div className="header-text">
          <h2 className="page-title">云端 Hub <span className="dim">市场</span></h2>
          <p className="page-subtitle">发现、安装和管理云端 Skills 和 MCP 资源</p>
        </div>
      </header>

      {/* Tab bar */}
      <div className="hub-tabs">
        <button data-testid="hub-tab-skills" className={`tab-item${activeTab === "skill" ? " active" : ""}`} onClick={() => void switchTab("skill")}>技能</button>
        <button data-testid="hub-tab-mcp" className={`tab-item${activeTab === "mcp" ? " active" : ""}`} onClick={() => void switchTab("mcp")}>MCP</button>
        <button data-testid="hub-tab-employee-packages" className={`tab-item${activeTab === "employee-package" ? " active" : ""}`} onClick={() => void switchTab("employee-package")}>员工包</button>
        <button data-testid="hub-tab-workflow-packages" className={`tab-item${activeTab === "workflow-package" ? " active" : ""}`} onClick={() => void switchTab("workflow-package")}>工作流包</button>
      </div>

      {/* Error state */}
      {cloudError && !loading ? (
        <div className="state-container error-state">
          <p>云端Hub暂时不可用</p>
          <p className="error-detail">{shell.runtimeBaseUrl}/api/cloud-hub/items</p>
          <button className="secondary" onClick={() => void loadData()}>重试</button>
        </div>
      ) : activeTab === "skill" ? (
        <>
          <div className="category-tabs">
            <button className={`cat-item${selectedCategory === "" ? " active" : ""}`} onClick={() => setSelectedCategory("")}>全部</button>
            {SKILL_CATEGORIES.map((cat) => (
              <button key={cat.value} className={`cat-item${selectedCategory === cat.value ? " active" : ""}`} onClick={() => setSelectedCategory(cat.value)}>{cat.label}</button>
            ))}
          </div>

          <div className="toolbar">
            <div className="search-bar">
              <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" />
              </svg>
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} type="text" placeholder="搜索 Skills..." />
            </div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="sort-select">
              <option value="latest">最新更新</option>
              <option value="downloads">最多下载</option>
              <option value="name">名称排序</option>
            </select>
          </div>

          {allTags.length > 0 && (
            <div className="tag-cloud">
              {allTags.map((tag) => (
                <button key={tag} className={`tag-chip${selectedTag === tag ? " active" : ""}`} onClick={() => setSelectedTag(selectedTag === tag ? "" : tag)}>#{tag}</button>
              ))}
            </div>
          )}

          <div className="stats-row">
            <span className="stats-count">{displayedSkills.length} 个 Skills</span>
            {(selectedCategory || selectedTag || keyword) && <span className="filter-hint">(已筛选)</span>}
          </div>

          {loading ? (
            <div className="state-container"><div className="pulse-loader"></div><p>正在加载 Skills 列表...</p></div>
          ) : displayedSkills.length === 0 ? (
            <div className="state-container">
              <p>没有找到匹配的 Skills。</p>
              {(selectedCategory || selectedTag || keyword) && (
                <button className="secondary" onClick={() => { setKeyword(""); setSelectedCategory(""); setSelectedTag(""); }}>清除筛选</button>
              )}
            </div>
          ) : (
            <div className="skills-grid">
              {displayedSkills.map((skill: any) => (
                <button key={skill.id} data-testid={`hub-item-${skill.id}`} className="skill-card" onClick={() => void openSkillDetail(skill.id)}>
                  <div className="card-top">
                    <div className="skill-avatar" style={skill.icon ? {} : { background: getAvatarColor(skill.name) }}>
                      {skill.icon ? <img src={skill.icon} alt={skill.name} onError={(e) => { const el = e.target as HTMLImageElement; el.style.display = "none"; el.parentElement!.style.background = getAvatarColor(skill.name); const s = document.createElement("span"); s.textContent = skill.name.charAt(0).toUpperCase(); el.parentElement!.appendChild(s); }} /> : <span>{skill.name.charAt(0).toUpperCase()}</span>}
                    </div>
                    <div className="card-title-block"><h4>{skill.name}</h4><span className="author">{skill.author || "anonymous"}</span></div>
                  </div>
                  <p className="text-clamp">{skill.summary || skill.description || "暂无说明。"}</p>
                  <div className="card-tags">
                    {skill.category && <span className="category-badge">{getCategoryLabel(skill.category)}</span>}
                    {(skill.tags || []).slice(0, 3).map((tag: string) => <span key={tag} className="mini-tag">{tag}</span>)}
                  </div>
                  <div className="card-foot">
                    <span className="foot-item">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                      {formatDownloads(skill.downloadCount || 0)}
                    </span>
                    <span className="foot-item">{skill.latestVersion ? `v${skill.latestVersion}` : "草稿"}</span>
                    <span className="foot-item">{formatDate(skill.updatedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {loading ? (
            <div className="state-container"><div className="pulse-loader"></div><p>正在加载...</p></div>
          ) : filteredHubItems.length === 0 ? (
            <div className="state-container"><p>当前分类暂无资源。</p></div>
          ) : (
            <div className="skills-grid">
              {filteredHubItems.map((item: any) => (
                <button key={item.id} data-testid={`hub-item-${item.id}`} className="skill-card" onClick={() => void openHubItemDetail(item.id)}>
                  <div className="card-top">
                    {item.iconUrl ? (
                      <div className="skill-avatar"><img src={item.iconUrl} alt={item.name} onError={(e) => { const el = e.target as HTMLImageElement; el.style.display = "none"; el.parentElement!.style.background = getAvatarColor(item.name); const s = document.createElement("span"); s.textContent = item.name.charAt(0).toUpperCase(); el.parentElement!.appendChild(s); }} /></div>
                    ) : (
                      <div className="skill-avatar" style={{ background: getAvatarColor(item.name) }}><span>{item.name.charAt(0).toUpperCase()}</span></div>
                    )}
                    <div className="card-title-block"><h4>{item.name}</h4><span className="author">{hubTypeLabel(item.type)}</span></div>
                  </div>
                  <p className="text-clamp">{item.summary || "暂无说明。"}</p>
                  <div className="card-foot"><span className="foot-item">{item.latestVersion ? `v${item.latestVersion}` : "—"}</span></div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Detail overlay */}
      {detailVisible && (
        <div className="detail-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeDetail(); }}>
          <article className="detail-panel">
            {skillDetail && activeTab === "skill" ? (
              <>
                <div className="detail-header">
                  <div className="skill-avatar lg" style={skillDetail.icon ? {} : { background: getAvatarColor(skillDetail.name) }}>
                    {skillDetail.icon ? <img src={skillDetail.icon} alt={skillDetail.name} onError={(e) => { const el = e.target as HTMLImageElement; el.style.display = "none"; el.parentElement!.style.background = getAvatarColor(skillDetail.name); const s = document.createElement("span"); s.textContent = skillDetail.name.charAt(0).toUpperCase(); el.parentElement!.appendChild(s); }} /> : <span>{skillDetail.name.charAt(0).toUpperCase()}</span>}
                  </div>
                  <div>
                    <h3>{skillDetail.name}</h3>
                    <p className="detail-author">{skillDetail.author || "anonymous"} · {getCategoryLabel(skillDetail.category)}</p>
                  </div>
                  <button className="close-btn" onClick={closeDetail}>&times;</button>
                </div>
                <p className="detail-desc">{skillDetail.description}</p>
                <div className="detail-info-grid">
                  <div className="info-item"><span className="info-label">最新版本</span><span className="info-value">{skillDetail.latestVersion || "草稿"}</span></div>
                  <div className="info-item"><span className="info-label">下载量</span><span className="info-value">{formatDownloads(skillDetail.downloadCount || 0)}</span></div>
                  <div className="info-item"><span className="info-label">版本数</span><span className="info-value">{skillDetail.releases?.length || 0}</span></div>
                </div>
                {skillDetail.releases?.length > 0 && (
                  <div className="detail-releases">
                    <p className="section-title">版本历史</p>
                    {skillDetail.releases.slice(0, 5).map((r: any) => (
                      <div key={r.id} className="release-item"><span className="release-version">{r.version}</span><span className="release-notes">{r.releaseNotes || "无说明"}</span></div>
                    ))}
                  </div>
                )}
                <div className="detail-actions">
                  <button data-testid="hub-action-import" className="primary" disabled={isImporting} onClick={() => void installSkill()}>
                    {isImporting ? "安装中..." : "安装到本地技能目录"}
                  </button>
                </div>
                {importFeedback && <p data-testid="hub-import-feedback" className="feedback success">{importFeedback}</p>}
                {importError && <p className="feedback error">{importError}</p>}
              </>
            ) : hubDetail ? (
              <>
                <div className="detail-header">
                  <div className="skill-avatar lg" style={{ background: getAvatarColor(hubDetail.name) }}><span>{hubDetail.name.charAt(0).toUpperCase()}</span></div>
                  <div>
                    <h3>{hubDetail.name}</h3>
                    <p className="detail-author">{hubTypeLabel(hubDetail.type)}</p>
                  </div>
                  <button className="close-btn" onClick={closeDetail}>&times;</button>
                </div>
                <p className="detail-desc">{hubDetail.description}</p>
                <div className="detail-info-grid">
                  <div className="info-item"><span className="info-label">最新版本</span><span className="info-value">{hubDetail.latestVersion}</span></div>
                  <div className="info-item"><span className="info-label">版本数</span><span className="info-value">{hubDetail.releases.length}</span></div>
                  <div className="info-item"><span className="info-label">清单类型</span><span className="info-value">{cloudManifest ? hubTypeLabel((cloudManifest as any).kind) : "加载中..."}</span></div>
                </div>
                {hubDetail.releases.length > 0 && (
                  <div className="detail-releases">
                    <p className="section-title">版本历史</p>
                    {hubDetail.releases.slice(0, 5).map((r: any) => (
                      <div key={r.id} className="release-item"><span className="release-version">{r.version}</span><span className="release-notes">{r.releaseNotes || "无说明"}</span></div>
                    ))}
                  </div>
                )}
                <div className="detail-actions">
                  <button data-testid="hub-action-import" className="primary" disabled={isImporting || !cloudManifest} onClick={() => void installHubItem()}>
                    {isImporting ? "导入中..." : installActionLabel(hubDetail.type)}
                  </button>
                </div>
                {importFeedback && <p data-testid="hub-import-feedback" className="feedback success">{importFeedback}</p>}
                {importError && <p className="feedback error">{importError}</p>}
              </>
            ) : (
              <div className="state-container"><div className="pulse-loader"></div><p>加载详情中...</p></div>
            )}
          </article>
        </div>
      )}

      <style>{`
        .page-container { overflow-y: auto; padding: 32px; }
        .page-header { margin-bottom: 28px; }
        .page-title { font-size: 1.75rem; font-weight: 900; color: var(--text-primary); letter-spacing: -0.01em; margin: 0; }
        .page-title .dim { color: var(--text-muted); }
        .page-subtitle { margin: 6px 0 0; font-size: 0.9rem; color: var(--text-muted); }
        .hub-tabs { display: flex; gap: 8px; margin-bottom: 24px; }
        .tab-item { padding: 8px 18px; background: var(--bg-card); border: 1px solid var(--glass-border); border-radius: 999px; color: var(--text-secondary); font-size: 0.85rem; font-weight: 700; cursor: pointer; transition: 0.2s; }
        .tab-item:hover { border-color: var(--text-muted); color: var(--text-primary); }
        .tab-item.active { background: var(--accent-primary); color: var(--accent-text, var(--text-primary)); border-color: transparent; }
        .category-tabs { display: flex; gap: 4px; margin-bottom: 20px; overflow-x: auto; scrollbar-width: none; }
        .category-tabs::-webkit-scrollbar { display: none; }
        .cat-item { padding: 6px 14px; background: transparent; border: 1px solid var(--glass-border); border-radius: 20px; color: var(--text-muted); font-size: 0.78rem; font-weight: 700; cursor: pointer; transition: 0.2s; white-space: nowrap; }
        .cat-item:hover { border-color: rgba(45,212,191,0.3); color: var(--text-primary); }
        .cat-item.active { background: rgba(45,212,191,0.12); border-color: var(--accent-cyan, #2dd4bf); color: var(--accent-cyan, #2dd4bf); }
        .toolbar { display: flex; gap: 14px; align-items: center; margin-bottom: 18px; }
        .search-bar { position: relative; display: flex; align-items: center; flex: 1; max-width: 400px; }
        .search-icon { position: absolute; left: 14px; width: 16px; height: 16px; color: var(--text-muted); }
        .search-bar input { width: 100%; height: 38px; padding: 0 16px 0 40px; background: var(--bg-card); border: 1px solid var(--glass-border); border-radius: 10px; color: var(--text-primary); font-family: inherit; font-size: 0.85rem; transition: 0.2s; }
        .search-bar input:focus { outline: none; border-color: var(--accent-cyan, #2dd4bf); }
        .sort-select { height: 38px; padding: 0 12px; background: var(--bg-card); border: 1px solid var(--glass-border); border-radius: 10px; color: var(--text-primary); font-family: inherit; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
        .sort-select:focus { outline: none; border-color: var(--accent-cyan, #2dd4bf); }
        .tag-cloud { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
        .tag-chip { padding: 4px 12px; background: var(--bg-card); border: 1px solid var(--glass-border); border-radius: 14px; color: var(--text-muted); font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: 0.2s; }
        .tag-chip:hover { border-color: rgba(45,212,191,0.3); color: var(--text-primary); }
        .tag-chip.active { background: rgba(45,212,191,0.1); border-color: var(--accent-cyan, #2dd4bf); color: var(--accent-cyan, #2dd4bf); }
        .stats-row { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--glass-border); }
        .stats-count { color: var(--accent-cyan, #2dd4bf); font-size: 0.8rem; font-weight: 800; letter-spacing: 0.04em; }
        .filter-hint { color: var(--text-muted); font-size: 0.75rem; font-weight: 600; }
        .state-container { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 60px 20px; color: var(--text-muted); text-align: center; }
        .error-detail { font-size: 0.75rem; }
        .pulse-loader { width: 32px; height: 32px; border: 3px solid var(--glass-border); border-top-color: var(--accent-cyan, #2dd4bf); border-radius: 50%; animation: hub-spin 0.8s linear infinite; }
        @keyframes hub-spin { to { transform: rotate(360deg); } }
        .skills-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
        .skill-card { text-align: left; padding: 22px; border-radius: 14px; transition: 0.3s cubic-bezier(0.4,0,0.2,1); display: flex; flex-direction: column; gap: 12px; background: var(--bg-card); border: 1px solid var(--glass-border); cursor: pointer; position: relative; overflow: hidden; color: var(--text-primary); }
        .skill-card::before { content: ""; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(45,212,191,0.08) 0%, transparent 100%); opacity: 0; transition: 0.3s; }
        .skill-card:hover { transform: translateY(-3px); border-color: rgba(45,212,191,0.4); box-shadow: 0 10px 25px rgba(0,0,0,0.12); }
        .skill-card:hover::before { opacity: 1; }
        .card-top { display: flex; align-items: center; gap: 12px; position: relative; z-index: 2; }
        .skill-avatar { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; background: rgba(45,212,191,0.15); }
        .skill-avatar img { width: 100%; height: 100%; object-fit: contain; padding: 5px; }
        .skill-avatar span { font-size: 1.1rem; font-weight: 900; color: #fff; }
        .skill-avatar.lg { width: 56px; height: 56px; border-radius: 14px; }
        .skill-avatar.lg span { font-size: 1.4rem; }
        .card-title-block { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .card-title-block h4 { margin: 0; font-size: 1rem; font-weight: 800; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .author { font-size: 0.72rem; color: var(--text-muted); font-weight: 600; }
        .text-clamp { margin: 0; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; position: relative; z-index: 2; }
        .card-tags { display: flex; flex-wrap: wrap; gap: 6px; position: relative; z-index: 2; }
        .category-badge { font-size: 0.65rem; font-weight: 800; background: rgba(45,212,191,0.12); color: var(--accent-cyan, #2dd4bf); padding: 3px 8px; border-radius: 4px; }
        .mini-tag { font-size: 0.65rem; font-weight: 600; color: var(--text-muted); background: var(--bg-base, var(--glass-reflection)); padding: 3px 8px; border-radius: 4px; }
        .card-foot { display: flex; justify-content: space-between; border-top: 1px solid var(--glass-border); padding-top: 12px; margin-top: auto; font-size: 0.72rem; font-weight: 700; color: var(--text-muted); position: relative; z-index: 2; }
        .foot-item { display: flex; align-items: center; gap: 4px; }
        .detail-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 32px; }
        .detail-panel { background: var(--bg-card, #1a1a2e); border: 1px solid var(--glass-border); border-radius: 16px; padding: 28px; max-width: 600px; width: 100%; max-height: 80vh; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; }
        .detail-header { display: flex; align-items: center; gap: 16px; }
        .detail-header h3 { margin: 0; font-size: 1.3rem; font-weight: 800; }
        .detail-author { margin: 4px 0 0; font-size: 0.8rem; color: var(--text-muted); font-weight: 600; }
        .close-btn { margin-left: auto; background: none; border: none; color: var(--text-muted); font-size: 1.5rem; cursor: pointer; padding: 0 8px; line-height: 1; }
        .close-btn:hover { color: var(--text-primary); }
        .detail-desc { margin: 0; font-size: 0.9rem; color: var(--text-secondary); line-height: 1.6; }
        .detail-info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .info-item { display: flex; flex-direction: column; gap: 4px; padding: 12px; background: var(--bg-base, rgba(0,0,0,0.2)); border-radius: 8px; border: 1px solid var(--glass-border); }
        .info-label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.03em; }
        .info-value { font-size: 0.9rem; font-weight: 700; color: var(--text-primary); }
        .section-title { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.03em; margin: 0 0 8px; }
        .detail-releases { display: flex; flex-direction: column; gap: 6px; }
        .release-item { display: flex; align-items: baseline; gap: 12px; padding: 8px 12px; background: var(--bg-base, rgba(0,0,0,0.2)); border-radius: 6px; border: 1px solid var(--glass-border); font-size: 0.82rem; }
        .release-version { font-family: monospace; font-weight: 700; color: var(--accent-cyan, #2dd4bf); white-space: nowrap; }
        .release-notes { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .detail-actions { display: flex; gap: 12px; }
        .primary, .secondary { border: 1px solid var(--glass-border); border-radius: 10px; padding: 10px 20px; background: var(--bg-base); color: var(--text-primary); cursor: pointer; font-weight: 700; font-size: 0.85rem; transition: 0.2s; }
        .primary { background: var(--accent-primary, var(--accent-cyan, #2dd4bf)); color: var(--accent-text, #000); border-color: transparent; }
        .primary:hover:not(:disabled) { filter: brightness(1.1); }
        .primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .feedback { margin: 0; font-size: 0.85rem; font-weight: 600; }
        .feedback.success { color: #10b981; }
        .feedback.error { color: #ef4444; }
      `}</style>
    </main>
  );
}

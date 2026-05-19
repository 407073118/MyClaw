import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import FallbackAvatar from "../components/FallbackAvatar";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { useWorkspaceStore, type CloudProjectSummary, type CloudSkillCategory } from "../stores/workspace";
import { useShellStore } from "../stores/shell";
import { AlertCircle, Cloud, Download, Search, X } from "lucide-react";

type CloudHubItemType = "skill" | "mcp" | "employee-package" | "workflow-package" | "project";

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
  if (type === "project") return "项目";
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
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const queryTab = searchParams.get("tab");
  const scopedSiliconPersonId = searchParams.get("siliconPersonId")?.trim() ?? "";
  const initialActiveTab: CloudHubItemType =
    queryTab === "mcp" || queryTab === "employee-package" || queryTab === "workflow-package" || queryTab === "project"
      ? queryTab
      : "skill";

  const [activeTab, setActiveTab] = useState<CloudHubItemType>(initialActiveTab);
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
  const [selectedProject, setSelectedProject] = useState<CloudProjectSummary | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const detailPanelRef = useRef<HTMLElement>(null);
  const MAX_RETRIES = 5;

  useEffect(() => {
    if (!scopedSiliconPersonId) return;
    console.info("[hub-page] 使用硅基员工安装上下文", {
      siliconPersonId: scopedSiliconPersonId,
      activeTab,
    });
  }, [activeTab, scopedSiliconPersonId]);

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

  /** 查找 Cloud 项目在本机已同步的绑定记录。 */
  function findLocalProject(project: CloudProjectSummary) {
    return workspace.projects.find((item) => item.cloudProjectId === String(project.id)) ?? null;
  }

  /** 判断本机项目是否落后于 Cloud 最新运行时版本。 */
  function isProjectOutdated(project: CloudProjectSummary) {
    const localProject = findLocalProject(project);
    if (!localProject) return false;
    return localProject.cloudVersion < project.version || localProject.lastSyncStatus === "stale" || localProject.lastSyncStatus === "failed";
  }

  /** 生成项目卡片状态，帮助用户理解下载、绑定和更新动作。 */
  function projectStatusLabel(project: CloudProjectSummary) {
    const localProject = findLocalProject(project);
    if (!localProject) return "未下载";
    if (isProjectOutdated(project)) return "可更新";
    return "已同步";
  }

  /** 根据当前会话和本地项目状态决定项目主按钮文案。 */
  function projectActionLabel(project: CloudProjectSummary) {
    const localProject = findLocalProject(project);
    if (!localProject) return "下载并绑定当前会话";
    if (isProjectOutdated(project)) return "更新并绑定当前会话";
    if (workspace.currentProjectBinding?.id === localProject.id) return "已绑定当前会话";
    return "绑定当前会话";
  }

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
    } else if (activeTab === "project") {
      setLoading(true);
      setCloudError(false);
      try {
        await workspace.loadCloudProjects();
        await workspace.loadProjects();
        retryCountRef.current = 0;
      } catch {
        setCloudError(true);
        scheduleRetry();
      } finally {
        setLoading(false);
      }
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

  // 保持 loadData 最新引用，供 focus handler 等异步场景使用
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  // 初始加载（tab 切换由 switchTab 自行处理）
  useEffect(() => {
    void loadData();
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在挂载时触发初始加载，tab 切换由 switchTab 处理
  }, []);

  // keyword/sortBy 变化时重新加载 skill 列表
  useEffect(() => {
    if (activeTab === "skill") void loadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadSkills 随 keyword/sortBy 变化重建，此处仅关注这两个触发源
  }, [keyword, sortBy]);

  // selectedCategory 变化时重置 tag 并重新加载
  useEffect(() => {
    setSelectedTag("");
    if (activeTab === "skill") void loadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 selectedCategory 变化时触发
  }, [selectedCategory]);

  // 窗口获焦时重试（使用 ref 避免闭包过期）
  useEffect(() => {
    function onWindowFocus() { if (cloudError) void loadDataRef.current(); }
    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, [cloudError]);

  async function switchTab(tab: CloudHubItemType) {
    setActiveTab(tab);
    setDetailVisible(false);
    setSelectedProject(null);
    setImportFeedback("");
    setImportError("");
    setLoading(true);
    setCloudError(false);
    try {
      if (tab === "skill") await workspace.loadCloudSkills({});
      else if (tab === "project") {
        await workspace.loadCloudProjects();
        await workspace.loadProjects();
      }
      else await workspace.loadCloudHubItems(tab);
    } catch {
      setCloudError(true);
      scheduleRetry();
    } finally {
      setLoading(false);
    }
  }

  /** 关闭云端详情弹层，并清理导入反馈。 */
  const closeDetail = useCallback(() => {
    setDetailVisible(false);
    setSelectedProject(null);
    setImportFeedback("");
    setImportError("");
  }, []);

  const { captureTrigger: captureDialogTrigger } = useDialogA11y({
    isOpen: detailVisible,
    onClose: closeDetail,
    initialFocusRef: detailPanelRef,
    dialogName: "hub-detail",
  });

  async function openSkillDetail(skillId: string, trigger?: HTMLElement | null) {
    captureDialogTrigger(trigger);
    setDetailVisible(true);
    setSelectedProject(null);
    setImportFeedback("");
    setImportError("");
    workspace.clearCloudSkillDetail();
    try {
      await workspace.loadCloudSkillDetail(skillId);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "加载详情失败");
    }
  }

  async function openHubItemDetail(itemId: string, trigger?: HTMLElement | null) {
    captureDialogTrigger(trigger);
    setDetailVisible(true);
    setSelectedProject(null);
    setImportFeedback("");
    setImportError("");
    workspace.clearCloudHubDetail();
    try {
      const detail = await workspace.loadCloudHubDetail(itemId);
      const releaseId = (detail as any).releases[0]?.id;
      if (releaseId) await workspace.loadCloudHubManifest(releaseId);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "加载详情失败");
    }
  }

  /** 打开 Cloud 项目详情弹层，不额外请求详情，直接使用摘要与本地绑定状态。 */
  function openProjectDetail(project: CloudProjectSummary, trigger?: HTMLElement | null) {
    console.info("[hub-page] 打开 Cloud 项目详情", { cloudProjectId: project.id, version: project.version });
    captureDialogTrigger(trigger);
    workspace.clearCloudSkillDetail();
    workspace.clearCloudHubDetail();
    setSelectedProject(project);
    setDetailVisible(true);
    setImportFeedback("");
    setImportError("");
  }

  /** 下载或更新 Cloud 项目，并把本地项目绑定到当前会话。 */
  async function handleProjectAction(project: CloudProjectSummary) {
    const sessionId = workspace.currentSession?.id;
    if (!sessionId) {
      setImportError("请先创建或选择一个会话。");
      return;
    }
    if (isImporting) return;

    const localProject = findLocalProject(project);
    const needsUpdate = isProjectOutdated(project);
    console.info("[hub-page] 处理 Cloud 项目绑定动作", {
      cloudProjectId: project.id,
      sessionId,
      localProjectId: localProject?.id ?? null,
      needsUpdate,
    });
    if (localProject && !needsUpdate && workspace.currentProjectBinding?.id === localProject.id) {
      setImportFeedback("当前会话已绑定该项目。");
      return;
    }

    setIsImporting(true);
    setImportFeedback("");
    setImportError("");
    try {
      if (!localProject) {
        await workspace.bindCloudProject({ cloudProjectId: String(project.id), sessionId });
        setImportFeedback("已下载项目并绑定当前会话。");
        return;
      }

      const targetProject = needsUpdate
        ? (await workspace.syncProjectRuntimeContext(localProject.id)).project
        : localProject;
      await workspace.bindSessionProject(sessionId, targetProject.id);
      setImportFeedback(needsUpdate ? "已更新项目并绑定当前会话。" : "已绑定当前会话。");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "项目同步或绑定失败。");
    } finally {
      setIsImporting(false);
    }
  }

  async function installSkill() {
    const detail = (workspace as any).cloudSkillDetail;
    if (!detail || isImporting) return;
    const releaseId = detail.releases?.[0]?.id;
    if (!releaseId) { setImportError("无可用版本。"); return; }
    setIsImporting(true); setImportFeedback(""); setImportError("");
    try {
      await workspace.importCloudSkill({
        releaseId,
        skillName: detail.name,
        ...(scopedSiliconPersonId ? { siliconPersonId: scopedSiliconPersonId } : {}),
      });
      setImportFeedback(scopedSiliconPersonId ? "已安装到该员工技能目录。" : "已安装到本地技能目录。");
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
        await workspace.importCloudMcp({
          manifest,
          ...(scopedSiliconPersonId ? { siliconPersonId: scopedSiliconPersonId } : {}),
        });
        setImportFeedback(scopedSiliconPersonId ? "已安装到该员工 MCP 配置。" : "已安装到本地 MCP 配置。");
      } else {
        const releaseId = detail.releases[0]?.id;
        if (!releaseId) throw new Error("无可用版本。");
        if (detail.type === "employee-package") {
          await workspace.importCloudSiliconPersonPackage({ itemId: detail.id, releaseId, name: detail.name, summary: detail.summary, manifest });
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
    <div className="page-shell" data-testid="hub-page">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <Cloud size={14} />
            <span>Cloud Hub</span>
          </div>
          <h2 className="page-header__title">云端市场</h2>
          <p className="page-header__subtitle">发现、安装和管理云端 Skills、MCP 与项目能力。</p>
        </div>
      </header>

      <main className="page-content hub-content">
        {/* Tab bar */}
        <div className="hub-tabs">
        <button data-testid="hub-tab-skills" className={`tab-item${activeTab === "skill" ? " active" : ""}`} onClick={() => void switchTab("skill")}>技能</button>
        <button data-testid="hub-tab-mcp" className={`tab-item${activeTab === "mcp" ? " active" : ""}`} onClick={() => void switchTab("mcp")}>MCP</button>
        <button data-testid="hub-tab-employee-packages" className={`tab-item${activeTab === "employee-package" ? " active" : ""}`} onClick={() => void switchTab("employee-package")}>员工包</button>
        <button data-testid="hub-tab-workflow-packages" className={`tab-item${activeTab === "workflow-package" ? " active" : ""}`} onClick={() => void switchTab("workflow-package")}>工作流包</button>
        <button data-testid="hub-tab-projects" className={`tab-item${activeTab === "project" ? " active" : ""}`} onClick={() => void switchTab("project")}>项目</button>
      </div>

      {/* Error state */}
      {cloudError && !loading ? (
        <div className="banner banner--error hub-error-state">
          <AlertCircle size={16} />
          <div>
            <p>云端Hub暂时不可用</p>
            <p className="error-detail">{shell.runtimeBaseUrl}/api/cloud-hub/items</p>
          </div>
          <button className="btn-toolbar" onClick={() => void loadData()}>重试</button>
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
              <Search className="search-icon" size={16} />
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
                <button className="btn-toolbar" onClick={() => { setKeyword(""); setSelectedCategory(""); setSelectedTag(""); }}>清除筛选</button>
              )}
            </div>
          ) : (
            <div className="list-rows hub-list">
              {displayedSkills.map((skill: any) => (
                <button key={skill.id} data-testid={`hub-item-${skill.id}`} className="list-row list-row--with-avatar list-row--with-description hub-resource-row" onClick={(event) => void openSkillDetail(skill.id, event.currentTarget)}>
                  <div className="list-row__lead">
                    <FallbackAvatar
                      name={skill.name}
                      src={skill.icon}
                      className="skill-avatar"
                      background={getAvatarColor(skill.name)}
                    />
                  </div>
                  <div className="list-row__main">
                    <div className="list-row__title-row">
                      <span className="list-row__title">{skill.name}</span>
                      {skill.category && <span className="tag tag--accent">{getCategoryLabel(skill.category)}</span>}
                      {(skill.tags || []).slice(0, 2).map((tag: string) => <span key={tag} className="tag tag--muted">{tag}</span>)}
                    </div>
                    <div className="list-row__description">{skill.summary || skill.description || "暂无说明。"}</div>
                    <div className="list-row__meta-row">
                      <span className="list-row__meta">{skill.author || "anonymous"}</span>
                      <span className="list-row__meta-sep" />
                      <span className="list-row__meta">{formatDate(skill.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="list-row__trailing">
                    <span className="tag tag--green"><Download size={11} /> {formatDownloads(skill.downloadCount || 0)}</span>
                    <span className="tag tag--muted">{skill.latestVersion ? `v${skill.latestVersion}` : "草稿"}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : activeTab === "project" ? (
        <>
          {loading ? (
            <div className="state-container"><div className="pulse-loader"></div><p>正在加载项目列表...</p></div>
          ) : (workspace.cloudProjects ?? []).length === 0 ? (
            <div className="state-container"><p>云端暂无可绑定项目。</p></div>
          ) : (
            <div className="list-rows hub-list">
              {(workspace.cloudProjects ?? []).map((project) => {
                const localProject = findLocalProject(project);
                const status = projectStatusLabel(project);
                return (
                  <button key={project.id} data-testid={`hub-project-${project.id}`} className="list-row list-row--with-avatar list-row--with-description hub-resource-row" onClick={(event) => openProjectDetail(project, event.currentTarget)}>
                    <div className="list-row__lead">
                      <FallbackAvatar
                        name={project.name}
                        className="skill-avatar"
                        background={getAvatarColor(project.name)}
                      />
                    </div>
                    <div className="list-row__main">
                      <div className="list-row__title-row">
                        <span className="list-row__title">{project.name}</span>
                        <span className={`tag tag--${status === "可更新" ? "yellow" : status === "已同步" ? "green" : "accent"}`}>{status}</span>
                      </div>
                      <div className="list-row__description">{project.description || "暂无说明。"}</div>
                      <div className="list-row__meta-row">
                        <span className="list-row__meta list-row__meta--mono">{project.code}</span>
                        <span className="list-row__meta-sep" />
                        <span className="list-row__meta">{project.ownerAccount}</span>
                        <span className="list-row__meta-sep" />
                        <span className="list-row__meta">云端 v{project.version}</span>
                        <span className="list-row__meta-sep" />
                        <span className="list-row__meta">{localProject ? `本地 v${localProject.cloudVersion}` : "本地未下载"}</span>
                      </div>
                    </div>
                    <div className="list-row__trailing">
                      <span className="tag tag--muted">{project.repositoryCount} 仓库</span>
                      <span className="tag tag--accent">{project.skillCount} 技能</span>
                      <span className="tag tag--green">{project.mcpCount} MCP</span>
                    </div>
                  </button>
                );
              })}
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
            <div className="list-rows hub-list">
              {filteredHubItems.map((item: any) => (
                <button key={item.id} data-testid={`hub-item-${item.id}`} className="list-row list-row--with-avatar list-row--with-description hub-resource-row" onClick={(event) => void openHubItemDetail(item.id, event.currentTarget)}>
                  <div className="list-row__lead">
                    <FallbackAvatar
                      name={item.name}
                      src={item.iconUrl}
                      className="skill-avatar"
                      background={getAvatarColor(item.name)}
                    />
                  </div>
                  <div className="list-row__main">
                    <div className="list-row__title-row">
                      <span className="list-row__title">{item.name}</span>
                      <span className="tag tag--accent">{hubTypeLabel(item.type)}</span>
                    </div>
                    <div className="list-row__description">{item.summary || "暂无说明。"}</div>
                    <div className="list-row__meta-row">
                      <span className="list-row__meta">{item.latestVersion ? `v${item.latestVersion}` : "暂无版本"}</span>
                    </div>
                  </div>
                  <div className="list-row__trailing">
                    <span className="tag tag--muted">详情</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      </main>

      {/* Detail overlay */}
      {detailVisible && (
        <div className="detail-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeDetail(); }}>
          <article
            ref={detailPanelRef}
            className="detail-panel"
            role="dialog"
            aria-modal="true"
            aria-label="云端资源详情"
            tabIndex={-1}
          >
            {selectedProject && activeTab === "project" ? (() => {
              const localProject = findLocalProject(selectedProject);
              const status = projectStatusLabel(selectedProject);
              const alreadyBound = Boolean(localProject && workspace.currentProjectBinding?.id === localProject.id && !isProjectOutdated(selectedProject));
              return (
              <>
                <div className="detail-header">
                  <FallbackAvatar
                    name={selectedProject.name}
                    className="skill-avatar lg"
                    background={getAvatarColor(selectedProject.name)}
                  />
                  <div>
                    <h3>{selectedProject.name}</h3>
                    <p className="detail-author">{selectedProject.code} · {selectedProject.ownerAccount} · {status}</p>
                  </div>
                  <button type="button" className="icon-btn" aria-label="关闭详情" onClick={closeDetail}>
                    <X size={16} />
                  </button>
                </div>
                <p className="detail-desc">{selectedProject.description || "暂无说明。"}</p>
                <div className="detail-info-grid">
                  <div className="info-item"><span className="info-label">云端版本</span><span className="info-value">云端 v{selectedProject.version}</span></div>
                  <div className="info-item"><span className="info-label">本地版本</span><span className="info-value">{localProject ? `本地 v${localProject.cloudVersion}` : "本地未下载"}</span></div>
                  <div className="info-item"><span className="info-label">绑定状态</span><span className="info-value">{alreadyBound ? "当前会话已绑定" : status}</span></div>
                </div>
                <div className="detail-info-grid">
                  <div className="info-item"><span className="info-label">仓库</span><span className="info-value">{selectedProject.repositoryCount}</span></div>
                  <div className="info-item"><span className="info-label">技能</span><span className="info-value">{selectedProject.skillCount}</span></div>
                  <div className="info-item"><span className="info-label">MCP</span><span className="info-value">{selectedProject.mcpCount}</span></div>
                </div>
                <div className="detail-actions">
                  <button data-testid="hub-project-action" className="btn-primary" disabled={isImporting || !workspace.currentSession || alreadyBound} onClick={() => void handleProjectAction(selectedProject)}>
                    {isImporting ? "处理中..." : projectActionLabel(selectedProject)}
                  </button>
                </div>
                {importFeedback && <p data-testid="hub-import-feedback" className="feedback success">{importFeedback}</p>}
                {importError && <p className="feedback error">{importError}</p>}
              </>
              );
            })() : skillDetail && activeTab === "skill" ? (
              <>
                <div className="detail-header">
                  <FallbackAvatar
                    name={skillDetail.name}
                    src={skillDetail.icon}
                    className="skill-avatar lg"
                    background={getAvatarColor(skillDetail.name)}
                  />
                  <div>
                    <h3>{skillDetail.name}</h3>
                    <p className="detail-author">{skillDetail.author || "anonymous"} · {getCategoryLabel(skillDetail.category)}</p>
                  </div>
                  <button type="button" className="icon-btn" aria-label="关闭详情" onClick={closeDetail}>
                    <X size={16} />
                  </button>
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
                  <button data-testid="hub-action-import" className="btn-primary" disabled={isImporting} onClick={() => void installSkill()}>
                    {isImporting ? "安装中..." : scopedSiliconPersonId ? "安装到该员工技能目录" : "安装到本地技能目录"}
                  </button>
                </div>
                {importFeedback && <p data-testid="hub-import-feedback" className="feedback success">{importFeedback}</p>}
                {importError && <p className="feedback error">{importError}</p>}
              </>
            ) : hubDetail ? (
              <>
                <div className="detail-header">
                  <FallbackAvatar
                    name={hubDetail.name}
                    className="skill-avatar lg"
                    background={getAvatarColor(hubDetail.name)}
                  />
                  <div>
                    <h3>{hubDetail.name}</h3>
                    <p className="detail-author">{hubTypeLabel(hubDetail.type)}</p>
                  </div>
                  <button type="button" className="icon-btn" aria-label="关闭详情" onClick={closeDetail}>
                    <X size={16} />
                  </button>
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
                  <button data-testid="hub-action-import" className="btn-primary" disabled={isImporting || !cloudManifest} onClick={() => void installHubItem()}>
                    {isImporting
                      ? "导入中..."
                      : scopedSiliconPersonId && hubDetail.type === "mcp"
                        ? "安装到该员工 MCP 配置"
                        : installActionLabel(hubDetail.type)}
                  </button>
                </div>
                {importFeedback && <p data-testid="hub-import-feedback" className="feedback success">{importFeedback}</p>}
                {importError && <p className="feedback error">{importError}</p>}
              </>
            ) : importError ? (
              <div className="state-container">
                <p className="feedback error">{importError}</p>
                <button type="button" className="btn-toolbar" onClick={closeDetail}>
                  关闭
                </button>
              </div>
            ) : (
              <div className="state-container"><div className="pulse-loader"></div><p>加载详情中...</p></div>
            )}
          </article>
        </div>
      )}

      <style>{`
        .hub-content { display: flex; flex-direction: column; }
        .hub-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
        .tab-item { padding: 8px 18px; background: var(--bg-surface); border: 1px solid var(--row-border); border-radius: var(--radius-md); color: var(--text-secondary); font-size: 0.85rem; font-weight: 700; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease; }
        .tab-item:hover { background: var(--bg-surface-hover); border-color: var(--row-border-hover); color: var(--text-primary); }
        .tab-item.active { background: rgba(16, 163, 127, 0.14); color: var(--accent-cyan); border-color: rgba(16, 163, 127, 0.26); }
        .category-tabs { display: flex; gap: 6px; margin-bottom: 18px; overflow-x: auto; scrollbar-width: none; }
        .category-tabs::-webkit-scrollbar { display: none; }
        .cat-item { padding: 7px 12px; background: transparent; border: 1px solid var(--row-border); border-radius: var(--radius-md); color: var(--text-muted); font-size: 12px; font-weight: 700; cursor: pointer; transition: 0.15s ease; white-space: nowrap; }
        .cat-item:hover { border-color: var(--row-border-hover); color: var(--text-primary); }
        .cat-item.active { background: rgba(16, 163, 127, 0.10); border-color: rgba(16, 163, 127, 0.24); color: var(--accent-cyan); }
        .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
        .search-bar { position: relative; display: flex; align-items: center; flex: 1; max-width: 420px; }
        .search-icon { position: absolute; left: 14px; color: var(--text-muted); pointer-events: none; }
        .search-bar input { width: 100%; height: 38px; padding: 0 16px 0 40px; background: var(--bg-surface); border: 1px solid var(--row-border); border-radius: var(--radius-md); color: var(--text-primary); font-family: inherit; font-size: 13px; transition: 0.15s ease; }
        .search-bar input:focus { outline: none; border-color: var(--accent-cyan); box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.14); }
        .sort-select { height: 38px; padding: 0 12px; background: var(--bg-surface); border: 1px solid var(--row-border); border-radius: var(--radius-md); color: var(--text-primary); font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
        .sort-select:focus { outline: none; border-color: var(--accent-cyan); box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.14); }
        .tag-cloud { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
        .tag-chip { padding: 4px 10px; background: var(--bg-surface); border: 1px solid var(--row-border); border-radius: var(--radius-sm); color: var(--text-muted); font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.15s ease; }
        .tag-chip:hover { border-color: var(--row-border-hover); color: var(--text-primary); }
        .tag-chip.active { background: rgba(16, 163, 127, 0.10); border-color: rgba(16, 163, 127, 0.24); color: var(--accent-cyan); }
        .stats-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--row-border); }
        .stats-count { color: var(--accent-cyan); font-size: 12px; font-weight: 800; letter-spacing: 0.04em; }
        .filter-hint { color: var(--text-muted); font-size: 12px; font-weight: 600; }
        .state-container { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 60px 20px; color: var(--text-muted); text-align: center; }
        .hub-error-state { align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
        .hub-error-state p { margin: 0; }
        .error-detail { margin-top: 4px !important; font-size: 12px; color: var(--text-muted); }
        .pulse-loader { width: 32px; height: 32px; border: 3px solid var(--glass-border); border-top-color: var(--accent-cyan); border-radius: 50%; animation: hub-spin 0.8s linear infinite; }
        @keyframes hub-spin { to { transform: rotate(360deg); } }
        .hub-resource-row { width: 100%; appearance: none; text-align: left; font: inherit; color: inherit; cursor: pointer; }
        .hub-resource-row:focus-visible { outline: 2px solid var(--accent-cyan); outline-offset: 2px; }
        .hub-list .tag { gap: 4px; }
        .hub-list .tag svg { flex-shrink: 0; }
        .skill-avatar { width: 32px; height: 32px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; background: rgba(45,212,191,0.15); }
        .skill-avatar img { width: 100%; height: 100%; object-fit: contain; padding: 4px; }
        .skill-avatar span { font-size: 14px; font-weight: 900; color: #fff; }
        .skill-avatar.lg { width: 56px; height: 56px; border-radius: var(--radius-lg); }
        .skill-avatar.lg span { font-size: 22px; }
        .detail-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.62); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 32px; }
        .detail-panel { background: var(--bg-card, #1a1a2e); border: 1px solid var(--glass-border); border-radius: var(--radius-2xl); padding: 28px; max-width: 640px; width: 100%; max-height: 80vh; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; box-shadow: var(--shadow-modal); }
        .detail-header { display: flex; align-items: center; gap: 16px; }
        .detail-header h3 { margin: 0; font-size: 1.3rem; font-weight: 800; }
        .detail-author { margin: 4px 0 0; font-size: 0.8rem; color: var(--text-muted); font-weight: 600; }
        .detail-header .icon-btn { margin-left: auto; }
        .detail-desc { margin: 0; font-size: 0.9rem; color: var(--text-secondary); line-height: 1.6; }
        .detail-info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .info-item { display: flex; flex-direction: column; gap: 4px; padding: 12px; background: var(--bg-base, rgba(0,0,0,0.2)); border-radius: 8px; border: 1px solid var(--glass-border); transition: border-color 0.2s, background 0.2s; }
        .info-item:hover { border-color: var(--text-muted); background: rgba(255,255,255,0.03); }
        .info-label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.03em; }
        .info-value { font-size: 0.9rem; font-weight: 700; color: var(--text-primary); }
        .section-title { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.03em; margin: 0 0 8px; }
        .detail-releases { display: flex; flex-direction: column; gap: 6px; }
        .release-item { display: flex; align-items: baseline; gap: 12px; padding: 8px 12px; background: var(--bg-base, rgba(0,0,0,0.2)); border-radius: 6px; border: 1px solid var(--glass-border); font-size: 0.82rem; }
        .release-version { font-family: monospace; font-weight: 700; color: var(--accent-cyan, #2dd4bf); white-space: nowrap; }
        .release-notes { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .detail-actions { display: flex; gap: 12px; }
        .feedback { margin: 0; font-size: 0.85rem; font-weight: 600; }
        .feedback.success { color: var(--status-green); }
        .feedback.error { color: var(--status-red); }
        @media (max-width: 760px) {
          .toolbar { flex-direction: column; align-items: stretch; }
          .search-bar { max-width: none; }
          .list-row__trailing { display: none; }
          .detail-info-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

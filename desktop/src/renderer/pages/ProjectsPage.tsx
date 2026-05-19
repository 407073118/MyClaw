import React, { useEffect, useMemo, useState } from "react";
import { Boxes, CheckCircle2, CloudCog, Download, FolderKanban, Link2, Plug, RefreshCw, ShieldCheck } from "lucide-react";

import { useWorkspaceStore } from "../stores/workspace";
import type {
  CapabilityInstallation,
  CloudProjectBinding,
  ProjectCapabilityDetail,
  ProjectCapabilityLocalState,
  ProjectCapabilityPref,
  ProjectCapabilityRef,
  ProjectSyncStatus,
} from "@shared/contracts";

const LOCAL_STATE_OPTIONS: Array<{ value: ProjectCapabilityLocalState; label: string }> = [
  { value: "inherit", label: "继承" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "停用" },
  { value: "hidden", label: "隐藏" },
];

/** 将同步状态转为中文标签，保证项目页状态一致。 */
function syncStatusLabel(status: ProjectSyncStatus): string {
  switch (status) {
    case "synced":
      return "已同步";
    case "stale":
      return "待同步";
    case "failed":
      return "同步失败";
    case "revoked":
      return "已撤销";
    case "deleted":
      return "已删除";
    case "never":
    default:
      return "未同步";
  }
}

/** 根据同步状态选择全局 tag 风格。 */
function syncStatusVariant(status: ProjectSyncStatus): "green" | "yellow" | "red" | "muted" {
  if (status === "synced") return "green";
  if (status === "stale" || status === "never") return "yellow";
  if (status === "failed" || status === "revoked" || status === "deleted") return "red";
  return "muted";
}

/** 将本地安装状态转为中文标签。 */
function installStatusLabel(status: CapabilityInstallation["installStatus"] | "missing"): string {
  switch (status) {
    case "ready":
      return "已安装";
    case "installing":
      return "安装中";
    case "failed":
      return "安装失败";
    case "revoked":
      return "已撤销";
    case "missing":
    default:
      return "未安装";
  }
}

/** 根据安装状态选择全局 tag 风格。 */
function installStatusVariant(status: CapabilityInstallation["installStatus"] | "missing"): "green" | "yellow" | "red" | "muted" {
  if (status === "ready") return "green";
  if (status === "installing" || status === "missing") return "yellow";
  if (status === "failed" || status === "revoked") return "red";
  return "muted";
}

/** 在详情中查找能力的本地偏好。 */
function findPref(detail: ProjectCapabilityDetail | null, refId: string): ProjectCapabilityPref | null {
  return detail?.prefs.find((pref) => pref.capabilityRefId === refId) ?? null;
}

/** 在详情中查找能力的安装记录。 */
function findInstallation(detail: ProjectCapabilityDetail | null, refId: string): CapabilityInstallation | null {
  return detail?.installations.find((installation) => installation.capabilityRefId === refId) ?? null;
}

/** 判断 unknown 是否可按普通对象读取。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 读取项目 MCP 的本地确认策略。 */
function readMcpPolicy(pref: ProjectCapabilityPref | null): { localConfirmed: boolean; secretsConfigured: boolean; allowExposeToModel: boolean } {
  const policy = isRecord(pref?.localPolicyJson) ? pref.localPolicyJson : {};
  return {
    localConfirmed: policy.localConfirmed === true,
    secretsConfigured: policy.secretsConfigured === true,
    allowExposeToModel: policy.allowExposeToModel === true,
  };
}

/** 计算能力在本机的有效开关状态。 */
function isCapabilityEnabled(ref: ProjectCapabilityRef, pref: ProjectCapabilityPref | null): boolean {
  const state = pref?.localState ?? "inherit";
  if (state === "enabled") return true;
  if (state === "disabled" || state === "hidden") return false;
  return ref.defaultEnabled;
}

/** 统计当前详情中被本机停用或隐藏的能力数量。 */
function countDisabledCapabilities(detail: ProjectCapabilityDetail | null): number {
  if (!detail) return 0;
  return detail.refs.filter((ref) => {
    const state = findPref(detail, ref.id)?.localState ?? "inherit";
    return state === "disabled" || state === "hidden";
  }).length;
}

/** 统计项目同步、安装和引用层面的警告数量。 */
function countProjectWarnings(detail: ProjectCapabilityDetail | null): number {
  if (!detail) return 0;
  let count = detail.project.lastSyncStatus === "synced" ? 0 : 1;
  for (const ref of detail.refs) {
    if (ref.syncStatus !== "synced") count += 1;
    if (ref.kind === "skill") {
      const installation = findInstallation(detail, ref.id);
      if (installation?.installStatus !== "ready") count += 1;
    }
  }
  return count;
}

/** 把时间字符串压成适合列表展示的短格式。 */
function formatDateTime(value: string | null): string {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

/** 判断指定项目是否是当前会话绑定项目。 */
function isCurrentSessionProject(project: CloudProjectBinding, current: CloudProjectBinding | null): boolean {
  return current?.id === project.id;
}

/** 渲染项目能力页，管理 Cloud 项目绑定、能力开关和本机运行策略。 */
export default function ProjectsPage() {
  const projects = useWorkspaceStore((state) => state.projects);
  const projectDetails = useWorkspaceStore((state) => state.projectDetails);
  const currentSession = useWorkspaceStore((state) => state.currentSession);
  const currentProjectBinding = useWorkspaceStore((state) => state.currentProjectBinding);
  const loadProjects = useWorkspaceStore((state) => state.loadProjects);
  const loadProjectDetail = useWorkspaceStore((state) => state.loadProjectDetail);
  const bindCloudProject = useWorkspaceStore((state) => state.bindCloudProject);
  const bindSessionProject = useWorkspaceStore((state) => state.bindSessionProject);
  const setProjectCapabilityState = useWorkspaceStore((state) => state.setProjectCapabilityState);
  const syncProjectRuntimeContext = useWorkspaceStore((state) => state.syncProjectRuntimeContext);
  const installProjectCapability = useWorkspaceStore((state) => state.installProjectCapability);
  const confirmProjectMcpCapability = useWorkspaceStore((state) => state.confirmProjectMcpCapability);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => projects[0]?.id ?? null);
  const [cloudProjectId, setCloudProjectId] = useState("");
  const [bindToCurrentSession, setBindToCurrentSession] = useState(true);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const selectedDetail = selectedProjectId ? projectDetails[selectedProjectId] ?? null : null;
  const skillRefs = useMemo(
    () => selectedDetail?.refs.filter((ref) => ref.kind === "skill") ?? [],
    [selectedDetail],
  );
  const mcpRefs = useMemo(
    () => selectedDetail?.refs.filter((ref) => ref.kind === "mcp") ?? [],
    [selectedDetail],
  );
  const disabledCount = countDisabledCapabilities(selectedDetail);
  const warningCount = countProjectWarnings(selectedDetail);

  useEffect(() => {
    void loadProjects().then((items) => {
      if (!selectedProjectId && items[0]) {
        setSelectedProjectId(items[0].id);
      }
    }).catch((error) => {
      console.error("[projects-page] 加载本机项目失败", { error: error instanceof Error ? error.message : String(error) });
      setErrorMessage("加载本机项目失败");
    });
  }, [loadProjects]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedProjectId && !projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0]?.id ?? null);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || projectDetails[selectedProjectId]) return;
    void loadProjectDetail(selectedProjectId).catch((error) => {
      console.error("[projects-page] 加载项目能力详情失败", {
        localProjectId: selectedProjectId,
        error: error instanceof Error ? error.message : String(error),
      });
      setErrorMessage("加载项目能力详情失败");
    });
  }, [loadProjectDetail, projectDetails, selectedProjectId]);

  /** 重新加载本机项目列表。 */
  async function handleRefreshProjects() {
    setBusyLabel("刷新项目");
    setErrorMessage(null);
    try {
      const items = await loadProjects();
      if (!selectedProjectId && items[0]) {
        setSelectedProjectId(items[0].id);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "刷新项目失败");
    } finally {
      setBusyLabel(null);
    }
  }

  /** 绑定 Cloud 项目并按需绑定当前会话。 */
  async function handleBindCloudProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = cloudProjectId.trim();
    if (!id) return;
    setBusyLabel("绑定项目");
    setErrorMessage(null);
    try {
      const detail = await bindCloudProject({
        cloudProjectId: id,
        ...(bindToCurrentSession && currentSession?.id ? { sessionId: currentSession.id } : {}),
      });
      setCloudProjectId("");
      setSelectedProjectId(detail.project.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "绑定 Cloud 项目失败");
    } finally {
      setBusyLabel(null);
    }
  }

  /** 选择项目并触发详情懒加载。 */
  function handleSelectProject(projectId: string) {
    console.info("[projects-page] 选择本机项目", { projectId });
    setSelectedProjectId(projectId);
  }

  /** 手动同步当前选中的项目运行上下文。 */
  async function handleSyncSelectedProject() {
    if (!selectedProjectId) return;
    setBusyLabel("同步项目");
    setErrorMessage(null);
    try {
      const detail = await syncProjectRuntimeContext(selectedProjectId);
      setSelectedProjectId(detail.project.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "同步项目失败");
    } finally {
      setBusyLabel(null);
    }
  }

  /** 将当前会话绑定到所选项目。 */
  async function handleBindCurrentSession() {
    if (!currentSession?.id || !selectedProjectId) return;
    setBusyLabel("绑定会话");
    setErrorMessage(null);
    try {
      await bindSessionProject(currentSession.id, selectedProjectId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "绑定当前会话失败");
    } finally {
      setBusyLabel(null);
    }
  }

  /** 解除当前会话上的项目绑定。 */
  async function handleUnbindCurrentSession() {
    if (!currentSession?.id) return;
    setBusyLabel("解绑会话");
    setErrorMessage(null);
    try {
      await bindSessionProject(currentSession.id, null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "解绑当前会话失败");
    } finally {
      setBusyLabel(null);
    }
  }

  /** 更新项目能力本地启停偏好。 */
  async function handleCapabilityState(ref: ProjectCapabilityRef, state: ProjectCapabilityLocalState) {
    setBusyLabel("更新能力状态");
    setErrorMessage(null);
    try {
      await setProjectCapabilityState(ref.id, state);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "更新能力状态失败");
    } finally {
      setBusyLabel(null);
    }
  }

  /** 安装项目 Skill 到项目能力缓存目录。 */
  async function handleInstallCapability(ref: ProjectCapabilityRef) {
    setBusyLabel("安装能力");
    setErrorMessage(null);
    try {
      await installProjectCapability(ref.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "安装项目 Skill 失败");
    } finally {
      setBusyLabel(null);
    }
  }

  /** 更新项目 MCP 的本地确认策略。 */
  async function handleMcpPolicyChange(
    ref: ProjectCapabilityRef,
    patch: Partial<{ localConfirmed: boolean; secretsConfigured: boolean; allowExposeToModel: boolean }>,
  ) {
    const pref = findPref(selectedDetail, ref.id);
    const current = readMcpPolicy(pref);
    setBusyLabel("更新 MCP 策略");
    setErrorMessage(null);
    try {
      await confirmProjectMcpCapability({
        capabilityRefId: ref.id,
        ...current,
        ...patch,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "更新项目 MCP 策略失败");
    } finally {
      setBusyLabel(null);
    }
  }

  /** 渲染一行项目能力及其本地策略。 */
  function renderCapabilityRow(ref: ProjectCapabilityRef) {
    const pref = findPref(selectedDetail, ref.id);
    const installation = findInstallation(selectedDetail, ref.id);
    const installStatus = ref.kind === "skill" ? installation?.installStatus ?? "missing" : "ready";
    const localState = pref?.localState ?? "inherit";
    const enabled = isCapabilityEnabled(ref, pref);
    const mcpPolicy = readMcpPolicy(pref);
    const skillMissingHash = ref.kind === "skill" && !ref.artifactHash;

    return (
      <article key={ref.id} className="list-row list-row--with-description" data-testid={`project-capability-${ref.id}`}>
        <div className="list-row__lead">
          <span className={`status-dot status-dot--${enabled ? "green" : "muted"}`} title={enabled ? "有效启用" : "本机不暴露"} />
        </div>
        <div className="list-row__main">
          <div className="list-row__title-row">
            <span className="list-row__title">{ref.displayName}</span>
            <span className={`tag tag--${ref.kind === "skill" ? "accent" : "yellow"}`}>{ref.kind === "skill" ? "Skill" : "MCP"}</span>
            <span className={`tag tag--${syncStatusVariant(ref.syncStatus)}`}>{syncStatusLabel(ref.syncStatus)}</span>
            {ref.kind === "skill" && (
              <span className={`tag tag--${installStatusVariant(installStatus)}`}>{installStatusLabel(installStatus)}</span>
            )}
          </div>
          <div className="list-row__description">{ref.description ?? "该能力没有描述。"}</div>
          {skillMissingHash && (
            <div className="list-row__description" data-testid={`project-capability-hash-warning-${ref.id}`}>
              缺少 hash，无法安装
            </div>
          )}
          <div className="list-row__meta-row">
            <span className="list-row__meta list-row__meta--mono">{ref.cloudCapabilityId}</span>
            {ref.alias && (
              <>
                <span className="list-row__meta-sep" />
                <span className="list-row__meta">别名 {ref.alias}</span>
              </>
            )}
            <span className="list-row__meta-sep" />
            <span className="list-row__meta">默认{ref.defaultEnabled ? "启用" : "停用"}</span>
          </div>
          {ref.kind === "mcp" && (
            <div className="project-mcp-policy" data-testid={`project-mcp-policy-${ref.id}`}>
              <label>
                <input
                  type="checkbox"
                  checked={mcpPolicy.localConfirmed}
                  onChange={(event) => void handleMcpPolicyChange(ref, { localConfirmed: event.currentTarget.checked })}
                />
                本机确认
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={mcpPolicy.secretsConfigured}
                  onChange={(event) => void handleMcpPolicyChange(ref, { secretsConfigured: event.currentTarget.checked })}
                />
                密钥就绪
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={mcpPolicy.allowExposeToModel}
                  onChange={(event) => void handleMcpPolicyChange(ref, { allowExposeToModel: event.currentTarget.checked })}
                />
                允许暴露给模型
              </label>
            </div>
          )}
        </div>
        <div className="list-row__trailing project-capability-actions">
          <select
            aria-label={`设置 ${ref.displayName} 的本地状态`}
            className="project-state-select"
            value={localState}
            onChange={(event) => void handleCapabilityState(ref, event.currentTarget.value as ProjectCapabilityLocalState)}
          >
            {LOCAL_STATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {ref.kind === "skill" && installStatus !== "ready" && (
            <button type="button" className="btn-toolbar" disabled={skillMissingHash} onClick={() => void handleInstallCapability(ref)}>
              <Download size={14} />
              安装
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="page-shell projects-page" data-testid="projects-page">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <FolderKanban size={14} />
            <span>Project Runtime</span>
          </div>
          <h2 className="page-header__title">项目能力</h2>
          <p className="page-header__subtitle">
            管理绑定到本机的 Cloud 项目，并让项目 Skills/MCP 与我的全局能力保持隔离。
          </p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn-toolbar" disabled={Boolean(busyLabel)} onClick={() => void handleRefreshProjects()}>
            <RefreshCw size={14} />
            刷新
          </button>
          <button type="button" className="btn-toolbar" disabled={!selectedProjectId || Boolean(busyLabel)} onClick={() => void handleSyncSelectedProject()}>
            <CloudCog size={14} />
            同步
          </button>
        </div>
      </header>

      <main className="page-content projects-content">
        {errorMessage && <div className="project-error" role="alert">{errorMessage}</div>}
        {busyLabel && <div className="project-busy" role="status">{busyLabel}中...</div>}

        <section className="projects-section" aria-labelledby="bound-projects-title">
          <div className="projects-section-header">
            <div>
              <h3 id="bound-projects-title">已绑定项目</h3>
              <p>本机只保存项目能力引用和安装状态，不写入全局 Skills/MCP。</p>
            </div>
            <form className="project-bind-form" onSubmit={(event) => void handleBindCloudProject(event)}>
              <input
                value={cloudProjectId}
                onChange={(event) => setCloudProjectId(event.currentTarget.value)}
                placeholder="Cloud Project ID"
                aria-label="Cloud Project ID"
              />
              <label className="project-form-check">
                <input
                  type="checkbox"
                  checked={bindToCurrentSession}
                  onChange={(event) => setBindToCurrentSession(event.currentTarget.checked)}
                />
                同时绑定当前会话
              </label>
              <button type="submit" className="btn-toolbar" disabled={!cloudProjectId.trim() || Boolean(busyLabel)}>
                <Link2 size={14} />
                绑定
              </button>
            </form>
          </div>

          {projects.length === 0 ? (
            <section className="empty-state empty-state--minimal">
              <Boxes size={32} className="empty-state__icon" />
              <h3 className="empty-state__title">还没有本机项目</h3>
              <p className="empty-state__body">输入 Cloud Project ID 后同步运行上下文。</p>
            </section>
          ) : (
            <div className="list-rows">
              {projects.map((project) => {
                const detail = projectDetails[project.id] ?? null;
                return (
                  <article
                    key={project.id}
                    className={`list-row list-row--with-description${selectedProjectId === project.id ? " is-selected" : ""}`}
                    data-testid={`project-row-${project.id}`}
                  >
                    <div className="list-row__lead">
                      <span className={`status-dot status-dot--${project.lastSyncStatus === "synced" ? "green" : "yellow"}`} />
                    </div>
                    <button type="button" className="project-row-button" onClick={() => handleSelectProject(project.id)}>
                      <div className="list-row__main">
                        <div className="list-row__title-row">
                          <span className="list-row__title">{project.name}</span>
                          {isCurrentSessionProject(project, currentProjectBinding) && <span className="tag tag--accent">当前会话</span>}
                          <span className={`tag tag--${syncStatusVariant(project.lastSyncStatus)}`} data-testid="project-sync-status">
                            {syncStatusLabel(project.lastSyncStatus)}
                          </span>
                        </div>
                        <div className="list-row__description">{project.description ?? "该项目没有描述。"}</div>
                        <div className="list-row__meta-row">
                          <span className="list-row__meta list-row__meta--mono">{project.cloudProjectId}</span>
                          <span className="list-row__meta-sep" />
                          <span className="list-row__meta">同步 {formatDateTime(project.syncedAt)}</span>
                        </div>
                      </div>
                    </button>
                    <div className="list-row__trailing">
                      <span className="tag tag--muted" data-testid="project-disabled-count">
                        停用 {countDisabledCapabilities(detail)}
                      </span>
                      <span className={`tag tag--${countProjectWarnings(detail) > 0 ? "yellow" : "green"}`}>
                        警告 {countProjectWarnings(detail)}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="projects-section" aria-labelledby="current-capabilities-title">
          <div className="projects-section-header">
            <div>
              <h3 id="current-capabilities-title">当前项目能力</h3>
              <p data-testid="project-global-skills-note">项目 Skills 不会写入我的 Skills 列表；运行时按会话能力包合并。</p>
            </div>
            {selectedDetail && (
              <div className="project-section-stats">
                <span className="tag tag--accent">Skills {skillRefs.length}</span>
                <span className="tag tag--yellow">MCP {mcpRefs.length}</span>
                <span className={`tag tag--${warningCount > 0 ? "yellow" : "green"}`}>警告 {warningCount}</span>
                <span className="tag tag--muted">本机停用 {disabledCount}</span>
              </div>
            )}
          </div>

          {!selectedProject ? (
            <section className="empty-state empty-state--minimal">
              <ShieldCheck size={32} className="empty-state__icon" />
              <h3 className="empty-state__title">请选择项目</h3>
              <p className="empty-state__body">选中项目后可以查看 Skill 与 MCP 引用。</p>
            </section>
          ) : !selectedDetail ? (
            <div className="project-busy" role="status">正在加载项目能力...</div>
          ) : (
            <div className="project-capability-groups">
              <div className="project-capability-group" data-testid="project-skill-group">
                <div className="project-capability-group-title">
                  <Boxes size={15} />
                  <strong>项目 Skills</strong>
                </div>
                {skillRefs.length > 0 ? <div className="list-rows">{skillRefs.map(renderCapabilityRow)}</div> : <p className="project-empty-line">该项目没有 Skill 引用。</p>}
              </div>
              <div className="project-capability-group" data-testid="project-mcp-group">
                <div className="project-capability-group-title">
                  <Plug size={15} />
                  <strong>项目 MCP</strong>
                </div>
                {mcpRefs.length > 0 ? <div className="list-rows">{mcpRefs.map(renderCapabilityRow)}</div> : <p className="project-empty-line">该项目没有 MCP 引用。</p>}
              </div>
            </div>
          )}
        </section>

        <section className="projects-section" aria-labelledby="local-runtime-title">
          <div className="projects-section-header">
            <div>
              <h3 id="local-runtime-title">本机运行设置</h3>
              <p>当前会话绑定只影响后续运行时能力包，不修改项目本身。</p>
            </div>
            <div className="project-session-actions">
              <button type="button" className="btn-toolbar" disabled={!currentSession?.id || !selectedProjectId || Boolean(busyLabel)} onClick={() => void handleBindCurrentSession()}>
                <CheckCircle2 size={14} />
                绑定到当前会话
              </button>
              <button type="button" className="btn-toolbar" disabled={!currentSession?.id || !currentProjectBinding || Boolean(busyLabel)} onClick={() => void handleUnbindCurrentSession()}>
                解绑
              </button>
            </div>
          </div>
          <div className="project-runtime-grid">
            <div className="project-runtime-item">
              <span>当前会话</span>
              <strong>{currentSession?.title ?? "暂无会话"}</strong>
            </div>
            <div className="project-runtime-item">
              <span>会话项目</span>
              <strong>{currentProjectBinding?.name ?? "无项目"}</strong>
            </div>
            <div className="project-runtime-item">
              <span>选中项目</span>
              <strong>{selectedProject?.code ?? selectedProject?.name ?? "未选择"}</strong>
            </div>
            <div className="project-runtime-item">
              <span>租户 / 账号</span>
              <strong>{selectedProject ? `${selectedProject.tenantId} / ${selectedProject.accountId}` : "未选择"}</strong>
            </div>
          </div>
        </section>
      </main>

      <style>{`
        .projects-page { min-width: 0; }
        .projects-content { display: grid; gap: 18px; }
        .projects-section {
          display: grid;
          gap: 14px;
          padding: 18px;
          border: 1px solid var(--glass-border);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.018);
        }
        .projects-section-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
        }
        .projects-section-header h3 {
          margin: 0;
          color: var(--text-primary);
          font-size: 15px;
          font-weight: 700;
        }
        .projects-section-header p {
          margin: 5px 0 0;
          color: var(--text-secondary);
          font-size: 12px;
          line-height: 1.5;
        }
        .project-bind-form,
        .project-section-stats,
        .project-session-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: flex-end;
        }
        .project-bind-form input[type="text"],
        .project-bind-form input:not([type]) {
          width: 190px;
          height: 32px;
          padding: 0 10px;
          border-radius: 7px;
          border: 1px solid var(--glass-border);
          background: var(--bg-base);
          color: var(--text-primary);
          font-size: 12px;
          outline: none;
        }
        .project-bind-form input:focus {
          border-color: rgba(16,163,127,0.42);
          box-shadow: 0 0 0 2px rgba(16,163,127,0.08);
        }
        .project-form-check,
        .project-mcp-policy label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: var(--text-secondary);
          font-size: 12px;
          white-space: nowrap;
        }
        .project-row-button {
          flex: 1;
          min-width: 0;
          display: block;
          padding: 0;
          border: 0;
          background: transparent;
          text-align: left;
          color: inherit;
          cursor: pointer;
        }
        .project-capability-groups {
          display: grid;
          gap: 16px;
        }
        .project-capability-group {
          display: grid;
          gap: 10px;
        }
        .project-capability-group-title {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-primary);
          font-size: 13px;
        }
        .project-capability-actions {
          align-items: center;
          gap: 8px;
        }
        .project-state-select {
          height: 30px;
          border-radius: 7px;
          border: 1px solid var(--glass-border);
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 0 8px;
          font-size: 12px;
        }
        .project-mcp-policy {
          display: flex;
          flex-wrap: wrap;
          gap: 10px 14px;
          margin-top: 8px;
        }
        .project-runtime-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        .project-runtime-item {
          min-width: 0;
          display: grid;
          gap: 4px;
          padding: 10px 12px;
          border: 1px solid var(--glass-border);
          border-radius: 8px;
          background: rgba(255,255,255,0.025);
        }
        .project-runtime-item span {
          color: var(--text-muted);
          font-size: 11px;
        }
        .project-runtime-item strong {
          min-width: 0;
          color: var(--text-primary);
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .project-busy,
        .project-error,
        .project-empty-line {
          margin: 0;
          color: var(--text-secondary);
          font-size: 12px;
        }
        .project-error {
          color: #fca5a5;
          padding: 8px 10px;
          border: 1px solid rgba(248,113,113,0.24);
          border-radius: 8px;
          background: rgba(248,113,113,0.08);
        }
        @media (max-width: 1100px) {
          .projects-section-header { flex-direction: column; }
          .project-bind-form,
          .project-section-stats,
          .project-session-actions { justify-content: flex-start; }
          .project-runtime-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 720px) {
          .project-runtime-grid { grid-template-columns: 1fr; }
          .project-bind-form input[type="text"],
          .project-bind-form input:not([type]) { width: 100%; }
        }
      `}</style>
    </div>
  );
}

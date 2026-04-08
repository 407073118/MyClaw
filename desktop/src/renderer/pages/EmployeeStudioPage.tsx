import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { ApprovalDecision, ApprovalRequest, SiliconPersonApprovalMode, Task } from "@shared/contracts";
import { useWorkspaceStore } from "../stores/workspace";

/** 把消息内容转成可直接展示的文本，兼容字符串和富结构内容。 */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((item): item is { type: string; text?: string } => Boolean(item) && typeof item === "object")
      .map((item) => (item.type === "text" ? item.text ?? "" : ""))
      .join("\n")
      .trim();
  }
  return String(content ?? "");
}

/** 把消息角色映射成更适合私域工作台的中文标签。 */
function roleLabel(role: string): string {
  return ({ user: "你", assistant: "硅基员工", system: "系统", tool: "工具" } as Record<string, string>)[role] ?? role;
}

/** 把硅基员工状态映射成稳定的中文摘要，便于列表和头部统一展示。 */
function siliconPersonStatusLabel(status: string): string {
  return ({
    idle: "待命",
    running: "执行中",
    needs_approval: "待审批",
    done: "已完成",
    error: "异常",
    canceling: "取消中",
    canceled: "已取消",
  } as Record<string, string>)[status] ?? status;
}

/** 把 Task 状态映射成页面上更直观的中文标签。 */
function taskStatusLabel(status: string): string {
  return ({
    pending: "待办",
    in_progress: "进行中",
    completed: "已完成",
  } as Record<string, string>)[status] ?? status;
}

/** 把 workflow run 状态映射成当前工作台可读的中文标签。 */
function workflowRunStatusLabel(status: string): string {
  return ({
    queued: "排队中",
    running: "运行中",
    "waiting-input": "等待输入",
    "waiting-join": "等待汇合",
    "retry-scheduled": "等待重试",
    succeeded: "已成功",
    failed: "已失败",
    canceled: "已取消",
  } as Record<string, string>)[status] ?? status;
}

/** 从松散的 workflowRuns 记录里安全提取可展示的 run。 */
function readWorkflowRunSummary(value: unknown): {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: string;
  currentNodeIds: string[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  totalSteps?: number;
  error?: string;
} | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.workflowId !== "string") return null;
  if (typeof candidate.status !== "string" || typeof candidate.startedAt !== "string" || typeof candidate.updatedAt !== "string") {
    return null;
  }

  return {
    id: candidate.id,
    workflowId: candidate.workflowId,
    workflowVersion: typeof candidate.workflowVersion === "number" ? candidate.workflowVersion : 0,
    status: candidate.status,
    currentNodeIds: Array.isArray(candidate.currentNodeIds)
      ? candidate.currentNodeIds.filter((nodeId): nodeId is string => typeof nodeId === "string")
      : [],
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
    finishedAt: typeof candidate.finishedAt === "string" ? candidate.finishedAt : undefined,
    totalSteps: typeof candidate.totalSteps === "number" ? candidate.totalSteps : undefined,
    error: typeof candidate.error === "string" ? candidate.error : undefined,
  };
}

/** 编辑硅基员工实体，同时承载最小私域会话工作台。 */
export default function EmployeeStudioPage() {
  const { id: siliconPersonId = "" } = useParams<{ id: string }>();
  const workspace = useWorkspaceStore();
  const [viewVersion, setViewVersion] = useState(0);

  const siliconPerson = useMemo(
    () => workspace.siliconPersons.find((item) => item.id === siliconPersonId) ?? null,
    [workspace.siliconPersons, siliconPersonId, viewVersion],
  );
  const sessionMap = useMemo(
    () => new Map(workspace.sessions.map((session) => [session.id, session])),
    [workspace.sessions, viewVersion],
  );
  const currentSessionSummary = useMemo(() => {
    if (!siliconPerson) return null;
    return siliconPerson.sessions.find((item) => item.id === siliconPerson.currentSessionId)
      ?? siliconPerson.sessions[0]
      ?? null;
  }, [siliconPerson, viewVersion]);
  const currentSession = currentSessionSummary
    ? sessionMap.get(currentSessionSummary.id) ?? null
    : null;
  const currentSessionTasks = currentSession?.tasks ?? [];
  const currentSessionApprovalRequests = useMemo(
    () => workspace.approvalRequests.filter((request) => request.sessionId === currentSessionSummary?.id),
    [workspace.approvalRequests, currentSessionSummary?.id, viewVersion],
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [composerDraft, setComposerDraft] = useState("");

  // 草稿状态，与当前硅基员工实体保持同构。
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftStatus, setDraftStatus] = useState<"draft" | "active" | "archived">("draft");
  const [draftSource, setDraftSource] = useState<"personal" | "enterprise" | "hub">("personal");
  const [draftApprovalMode, setDraftApprovalMode] = useState<SiliconPersonApprovalMode>("inherit");
  const [draftWorkflowIds, setDraftWorkflowIds] = useState<string[]>([]);
  const workflowSummaryMap = workspace.workflowSummaries ?? {};
  const workflowRunMap = workspace.workflowRuns ?? {};
  const boundWorkflows = useMemo(
    () =>
      draftWorkflowIds
        .map((workflowId) => {
          const summary = workflowSummaryMap[workflowId] ?? workspace.workflows.find((item) => item.id === workflowId) ?? null;
          return summary ? { workflowId, summary } : null;
        })
        .filter((item): item is { workflowId: string; summary: (typeof workspace.workflows)[number] } => Boolean(item)),
    [draftWorkflowIds, workflowSummaryMap, workspace.workflows],
  );
  const boundWorkflowRuns = useMemo(
    () =>
      Object.values(workflowRunMap)
        .map(readWorkflowRunSummary)
        .filter((run): run is NonNullable<ReturnType<typeof readWorkflowRunSummary>> => Boolean(run))
        .filter((run) => draftWorkflowIds.includes(run.workflowId)),
    [draftWorkflowIds, workflowRunMap],
  );

  // 员工详情变化后，把最新数据同步到本地草稿。
  useEffect(() => {
    if (!siliconPerson) return;
    setDraftName(siliconPerson.name);
    setDraftDescription(siliconPerson.description);
    setDraftStatus(
      siliconPerson.status === "idle" ? "draft" : siliconPerson.status === "done" ? "active" : "archived",
    );
    setDraftSource(siliconPerson.source);
    setDraftApprovalMode(siliconPerson.approvalMode);
    setDraftWorkflowIds([...siliconPerson.workflowIds]);
  }, [siliconPerson?.id, siliconPerson?.updatedAt, siliconPerson?.approvalMode]);

  // 首次进入时补齐硅基员工详情和工作流列表。
  useEffect(() => {
    /** 只在页面挂载时拉取最小必需数据，避免工作台与侧栏各自探测。 */
    async function initStudio(): Promise<void> {
      if (siliconPersonId) {
        console.info("[silicon-person-studio] 加载硅基员工详情", {
          siliconPersonId,
        });
        await workspace.loadSiliconPersonById(siliconPersonId);
      }
      if (workspace.workflows.length === 0) {
        console.info("[silicon-person-studio] 加载工作流列表", {
          siliconPersonId,
        });
        await workspace.loadWorkflows();
      }
    }

    void initStudio().catch((error) => {
      console.error("[silicon-person-studio] 初始化工作台失败", {
        siliconPersonId,
        error: error instanceof Error ? error.message : String(error),
      });
      setSessionError(error instanceof Error ? error.message : "加载硅基员工工作台失败。");
    });
  }, [siliconPersonId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 按当前硅基员工 currentSession 消费未读，避免工作台一进来就留着脏 badge。
  useEffect(() => {
    if (!siliconPersonId || !currentSessionSummary?.id) return;
    if (!currentSessionSummary.hasUnread && currentSessionSummary.unreadCount <= 0) return;
    const markRead = (workspace as {
      markSiliconPersonSessionRead?: (siliconPersonId: string, sessionId: string) => Promise<unknown>;
    }).markSiliconPersonSessionRead;
    if (!markRead) return;

    console.info("[silicon-person-studio] 标记当前会话已读", {
      siliconPersonId,
      sessionId: currentSessionSummary.id,
    });
    void markRead(siliconPersonId, currentSessionSummary.id)
      .then(() => setViewVersion((value) => value + 1))
      .catch((error) => {
        console.error("[silicon-person-studio] 标记会话已读失败", {
          siliconPersonId,
          sessionId: currentSessionSummary.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [siliconPersonId, currentSessionSummary?.id, currentSessionSummary?.hasUnread, currentSessionSummary?.unreadCount]);

  // 订阅会话流事件，把 session、task 和审批请求最小同步到工作台视图。
  useEffect(() => {
    const api = window.myClawAPI;
    if (!api?.onSessionStream) return;
    let disposed = false;
    let refreshing = false;
    let needsAnotherRefresh = false;

    /** 串行刷新硅基员工摘要，避免实时流期间 sidebar summary 和 unread 状态漂移。 */
    function refreshSiliconPersonSummary(): void {
      if (disposed || !siliconPersonId) return;
      if (refreshing) {
        needsAnotherRefresh = true;
        return;
      }

      refreshing = true;
      void useWorkspaceStore.getState().loadSiliconPersonById(siliconPersonId)
        .catch((error) => {
          console.error("[silicon-person-studio] 刷新硅基员工摘要失败", {
            siliconPersonId,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          refreshing = false;
          if (needsAnotherRefresh) {
            needsAnotherRefresh = false;
            refreshSiliconPersonSummary();
          }
        });
    }

    const unsubscribe = api.onSessionStream((event) => {
      const ws = useWorkspaceStore.getState();
      const payload = event as {
        type?: string;
        sessionId?: string;
        session?: { id?: string };
        tasks?: Task[];
        approvalRequest?: ApprovalRequest;
      };
      const type = payload.type ?? "";
      const sessionId = payload.sessionId ?? payload.session?.id ?? payload.approvalRequest?.sessionId ?? "";

      if (type === "session.updated" && payload.session?.id) {
        const belongsToCurrentPerson = ws.siliconPersons.some(
          (person) => person.id === siliconPersonId && person.sessions.some((summary) => summary.id === payload.session?.id),
        );
        if (!belongsToCurrentPerson) return;
        console.info("[silicon-person-studio] 收到会话更新事件", {
          siliconPersonId,
          sessionId: payload.session.id,
        });
        ws.applySessionUpdate(payload.session as never);
        setViewVersion((value) => value + 1);
        refreshSiliconPersonSummary();
      } else if (type === "tasks.updated" && sessionId && Array.isArray(payload.tasks)) {
        const belongsToCurrentPerson = ws.siliconPersons.some(
          (person) => person.id === siliconPersonId && person.sessions.some((summary) => summary.id === sessionId),
        );
        if (!belongsToCurrentPerson) return;
        console.info("[silicon-person-studio] 收到任务更新事件", {
          siliconPersonId,
          sessionId,
          taskCount: payload.tasks.length,
        });
        ws.patchSessionTasks(sessionId, payload.tasks);
        setViewVersion((value) => value + 1);
        refreshSiliconPersonSummary();
      } else if (type === "approval.requested" && payload.approvalRequest) {
        const belongsToCurrentPerson = ws.siliconPersons.some(
          (person) => person.id === siliconPersonId && person.sessions.some((summary) => summary.id === payload.approvalRequest?.sessionId),
        );
        if (!belongsToCurrentPerson) return;
        console.info("[silicon-person-studio] 收到审批请求事件", {
          siliconPersonId,
          approvalId: payload.approvalRequest.id,
          sessionId: payload.approvalRequest.sessionId,
        });
        ws.addApprovalRequest(payload.approvalRequest);
        setViewVersion((value) => value + 1);
        refreshSiliconPersonSummary();
      } else if (type === "approval.resolved" && sessionId) {
        console.info("[silicon-person-studio] 收到审批处理完成事件", {
          siliconPersonId,
          sessionId,
        });
        refreshSiliconPersonSummary();
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [siliconPersonId]);

  /** 绑定当前下拉中选中的工作流，避免重复添加。 */
  function bindWorkflow() {
    if (!selectedWorkflowId || draftWorkflowIds.includes(selectedWorkflowId)) return;
    setDraftWorkflowIds((prev) => [...prev, selectedWorkflowId]);
  }

  /** 启动已绑定工作流的运行入口，页面只负责转发，不自己拼 IPC。 */
  async function handleStartWorkflowRun(workflowId: string) {
    if (!siliconPersonId) return;

    setSessionError("");
    try {
      console.info("[silicon-person-studio] 请求启动工作流运行", {
        siliconPersonId,
        workflowId,
      });
      const action = (workspace as {
        startSiliconPersonWorkflowRun?: (siliconPersonId: string, workflowId: string) => Promise<unknown>;
      }).startSiliconPersonWorkflowRun;
      if (!action) {
        throw new Error("当前工作区没有提供启动工作流运行的能力。");
      }
      await action(siliconPersonId, workflowId);
      setViewVersion((value) => value + 1);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "启动工作流运行失败。");
    }
  }

  /** 保存侧栏中的硅基员工角色卡和 workflow 绑定信息。 */
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!siliconPersonId) return;

    setSaveError("");
    setIsSaving(true);
    try {
      console.info("[silicon-person-studio] 保存硅基员工侧栏配置", {
        siliconPersonId,
        workflowCount: draftWorkflowIds.length,
      });
      await workspace.updateSiliconPerson(siliconPersonId, {
        name: draftName.trim(),
        title: draftName.trim(),
        description: draftDescription.trim(),
        status: draftStatus === "draft" ? "idle" : draftStatus === "active" ? "done" : "error",
        source: draftSource,
        approvalMode: draftApprovalMode,
        workflowIds: [...draftWorkflowIds],
      });
      setViewVersion((value) => value + 1);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存硅基员工失败。");
    } finally {
      setIsSaving(false);
    }
  }

  /** 手动新建硅基员工会话，并让主线程维护新的 currentSession。 */
  async function handleCreateSession() {
    if (!siliconPersonId) return;

    setSessionError("");
    setIsCreatingSession(true);
    try {
      console.info("[silicon-person-studio] 请求手动新建会话", {
        siliconPersonId,
      });
      const createdSession = await workspace.createSiliconPersonSession(siliconPersonId);
      const markRead = (workspace as {
        markSiliconPersonSessionRead?: (siliconPersonId: string, sessionId: string) => Promise<unknown>;
      }).markSiliconPersonSessionRead;
      const createdSessionId = createdSession?.id ?? null;
      if (markRead && createdSessionId) {
        await markRead(siliconPersonId, createdSessionId);
      }
      setViewVersion((value) => value + 1);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "新建硅基员工会话失败。");
    } finally {
      setIsCreatingSession(false);
    }
  }

  /** 显式切换硅基员工 currentSession，保证本页查看与消息路由一致。 */
  async function handleSwitchSession(sessionId: string) {
    if (!siliconPersonId) return;

    setSessionError("");
    try {
      console.info("[silicon-person-studio] 请求切换当前会话", {
        siliconPersonId,
        sessionId,
      });
      await workspace.switchSiliconPersonSession(siliconPersonId, sessionId);
      const markRead = (workspace as {
        markSiliconPersonSessionRead?: (siliconPersonId: string, sessionId: string) => Promise<unknown>;
      }).markSiliconPersonSessionRead;
      if (markRead) {
        await markRead(siliconPersonId, sessionId);
      }
      setViewVersion((value) => value + 1);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "切换硅基员工会话失败。");
    }
  }

  /** 把消息发送到当前硅基员工会话，由主线程继续负责 currentSession 路由。 */
  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!siliconPersonId) return;
    const trimmed = composerDraft.trim();
    if (!trimmed) return;

    setSessionError("");
    setIsSending(true);
    try {
      console.info("[silicon-person-studio] 请求发送私域消息", {
        siliconPersonId,
        contentLength: trimmed.length,
        currentSessionId: siliconPerson?.currentSessionId ?? null,
      });
      await workspace.sendSiliconPersonMessage(siliconPersonId, trimmed);
      setComposerDraft("");
      setViewVersion((value) => value + 1);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "发送硅基员工消息失败。");
    } finally {
      setIsSending(false);
    }
  }

  /** 处理当前会话里的审批请求，按钮只负责把决定转给 workspace。 */
  async function handleResolveApproval(approvalId: string, decision: ApprovalDecision) {
    if (!approvalId) return;

    setApprovalError("");
    try {
      console.info("[silicon-person-studio] 请求处理审批", {
        siliconPersonId,
        approvalId,
        decision,
      });
      await workspace.resolveApproval(approvalId, decision);
      setViewVersion((value) => value + 1);
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "处理审批请求失败。");
    }
  }

  return (
    <main data-testid="silicon-person-studio-view" className="page-container studio-page">
      <header className="page-header">
        <p className="eyebrow">Silicon Workspace</p>
        <h2>{draftName || siliconPerson?.name || "硅基员工工作空间"}</h2>
        <p className="subtitle">
          在这里维护硅基员工的私域会话、角色卡和已绑定工作流。
        </p>
        {siliconPerson && (
          <div className="headline-metrics">
            <span className="meta-pill">{siliconPersonStatusLabel(siliconPerson.status)}</span>
            <span className="meta-pill">会话 {siliconPerson.sessions.length}</span>
            <span className="meta-pill">工作流 {siliconPerson.workflowIds.length}</span>
            {siliconPerson.hasUnread && <span className="meta-pill accent-pill">有未读</span>}
            {siliconPerson.needsApproval && <span className="meta-pill warning-pill">待审批</span>}
          </div>
        )}
      </header>

      <section className="studio-grid">
        <section className="workspace-column">
          <article className="studio-card">
            <div className="card-header">
              <div>
                <h3>私域会话</h3>
                <p>会话切换只会在显式切换或手动新建时改变 currentSession。</p>
              </div>
              <button
                type="button"
                className="secondary"
                data-testid="silicon-person-session-create"
                onClick={handleCreateSession}
                disabled={isCreatingSession}
              >
                新建会话
              </button>
            </div>

            {siliconPerson?.sessions.length ? (
              <div className="session-tabs">
                {siliconPerson.sessions.map((sessionSummary) => (
                  <button
                    key={sessionSummary.id}
                    type="button"
                    data-testid={`silicon-person-session-tab-${sessionSummary.id}`}
                    className={`session-tab${sessionSummary.id === currentSessionSummary?.id ? " active" : ""}`}
                    onClick={() => void handleSwitchSession(sessionSummary.id)}
                  >
                    <span className="session-tab-title">{sessionSummary.title}</span>
                    <span className="session-tab-meta">
                      <span>{siliconPersonStatusLabel(sessionSummary.status)}</span>
                      {sessionSummary.unreadCount > 0 && <span>未读 {sessionSummary.unreadCount}</span>}
                      {sessionSummary.needsApproval && <span>待审批</span>}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-copy">还没有私域会话。可以先手动新建，也可以等第一次发消息时自动创建。</p>
            )}
          </article>

          <article className="studio-card conversation-card">
            <div className="card-header">
              <div>
                <h3>{currentSessionSummary?.title ?? "当前会话"}</h3>
                <p>
                  {currentSessionSummary
                    ? `当前路由：${currentSessionSummary.id}`
                    : "当前还没有可展示的会话。"}
                </p>
              </div>
            </div>

            <div className="message-list">
              {currentSession?.messages?.length ? (
                currentSession.messages.map((message) => (
                  <article key={message.id} className={`message-card role-${message.role}`}>
                    <header className="message-header">
                      <strong>{roleLabel(message.role)}</strong>
                      <span>{message.createdAt}</span>
                    </header>
                    <p>{textOf(message.content) || "当前消息没有可展示文本。"}</p>
                  </article>
                ))
              ) : (
                <p className="empty-copy">当前会话还没有消息。把第一条指令发给这位硅基员工吧。</p>
              )}
            </div>

            <section className="tasklist-card" data-testid="silicon-person-tasklist">
              <div className="card-header">
                <div>
                  <h3>当前会话 Tasklist</h3>
                  <p>这里直接读 session.tasks，用来确认这位硅基员工当前在追什么工作。</p>
                </div>
              </div>

            {currentSessionTasks.length ? (
                <div className="task-list">
                  {currentSessionTasks.map((task) => (
                    <article key={task.id} className="task-card" data-testid={`silicon-person-task-${task.id}`}>
                      <header className="task-header">
                        <div>
                          <strong>{task.subject}</strong>
                          <p>{task.description || "没有补充说明。"}</p>
                        </div>
                        <span className="meta-pill">{taskStatusLabel(task.status)}</span>
                      </header>
                      <div className="task-links">
                        <span>阻塞：{task.blocks.length ? task.blocks.join(", ") : "无"}</span>
                        <span>被阻塞：{task.blockedBy.length ? task.blockedBy.join(", ") : "无"}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">当前会话还没有 tasklist。后续会由执行过程写回这里。</p>
              )}
            </section>

            <section className="approval-panel" data-testid="silicon-person-approval-panel">
              <div className="card-header">
                <div>
                  <h3>当前会话待审批</h3>
                  <p>这里只展示 currentSession 关联的审批请求，允许最小决策闭环。</p>
                </div>
              </div>

              {currentSessionApprovalRequests.length ? (
                <div className="approval-list">
                  {currentSessionApprovalRequests.map((request) => (
                    <article
                      key={request.id}
                      className="approval-card"
                      data-testid={`silicon-person-approval-request-${request.id}`}
                    >
                      <header className="task-header">
                        <div>
                          <strong>{request.label}</strong>
                          <p>{request.detail}</p>
                        </div>
                        <span className="meta-pill">{request.source}</span>
                      </header>
                      <div className="task-links">
                        <span>工具：{request.toolId}</span>
                        <span>风险：{request.risk}</span>
                        {request.resumeConversation && <span>审批后继续对话</span>}
                      </div>
                      <div className="approval-actions">
                        <button
                          type="button"
                          className="secondary"
                          data-testid={`silicon-person-approval-allow-once-${request.id}`}
                          onClick={() => void handleResolveApproval(request.id, "allow-once")}
                        >
                          allow-once
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          data-testid={`silicon-person-approval-deny-${request.id}`}
                          onClick={() => void handleResolveApproval(request.id, "deny")}
                        >
                          deny
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">当前会话还没有待审批请求。</p>
              )}

              {approvalError && <p className="error-copy">{approvalError}</p>}
            </section>

            <form className="composer-card" onSubmit={handleSendMessage}>
              <label className="field">
                <span>发给当前硅基员工</span>
                <textarea
                  value={composerDraft}
                  onChange={(e) => setComposerDraft(e.target.value)}
                  data-testid="silicon-person-composer-input"
                  rows={4}
                  placeholder="例如：请先拆解任务，再给我一个执行顺序。"
                />
              </label>
              <div className="composer-actions">
                <button
                  type="submit"
                  className="primary"
                  data-testid="silicon-person-composer-submit"
                  disabled={isSending}
                >
                  发送到当前会话
                </button>
              </div>
            </form>

            {sessionError && <p className="error-copy">{sessionError}</p>}
          </article>
        </section>

        <aside className="studio-sidebar">
          <form data-testid="employee-studio-save" className="studio-card studio-form" onSubmit={handleSave}>
            <div className="card-header">
              <div>
                <h3>角色卡</h3>
                <p>最小保存范围只覆盖名称、职责、来源和 workflow 绑定。</p>
              </div>
            </div>

            <label className="field">
              <span>名称</span>
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                data-testid="employee-studio-name"
                type="text"
              />
            </label>
            <label className="field">
              <span>职责描述</span>
              <textarea
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                data-testid="employee-studio-description"
                rows={4}
              />
            </label>
            <label className="field">
              <span>状态</span>
              <select
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value as "draft" | "active" | "archived")}
                data-testid="employee-studio-status"
              >
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </select>
            </label>
            <label className="field">
              <span>审批模式</span>
              <select
                value={draftApprovalMode}
                onChange={(e) => setDraftApprovalMode(e.target.value as SiliconPersonApprovalMode)}
                data-testid="employee-studio-approval-mode"
              >
                <option value="inherit">inherit</option>
                <option value="always_ask">always_ask</option>
                <option value="auto_approve">auto_approve</option>
              </select>
            </label>

            <div className="binding-row">
              <label className="field binding-field">
                <span>绑定工作流</span>
                <select
                  value={selectedWorkflowId}
                  onChange={(e) => setSelectedWorkflowId(e.target.value)}
                  data-testid="employee-studio-workflow-select"
                >
                  <option value="">选择工作流</option>
                  {workspace.workflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                data-testid="employee-studio-bind-workflow"
                className="secondary"
                type="button"
                onClick={bindWorkflow}
              >
                绑定
              </button>
            </div>

            {draftWorkflowIds.length > 0 ? (
              <ul className="binding-list">
                  {draftWorkflowIds.map((workflowId) => (
                    <li key={workflowId} data-testid={`silicon-person-workflow-binding-${workflowId}`}>
                      <div className="binding-title">
                      <strong>{boundWorkflows.find((item) => item.workflowId === workflowId)?.summary.name ?? workflowId}</strong>
                      <span>{workflowId}</span>
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        data-testid={`silicon-person-workflow-start-${workflowId}`}
                        onClick={() => void handleStartWorkflowRun(workflowId)}
                      >
                        启动运行
                      </button>
                    </li>
                  ))}
                </ul>
            ) : (
              <p className="empty-copy">还没有绑定工作流，后续可用 workflow 驱动 task，但不会替代 tasklist。</p>
            )}

            <section className="workflow-run-panel">
              <div className="card-header">
                <div>
                  <h3>工作流运行态</h3>
                  <p>只展示和已绑定 workflow 对应的 run，方便对照当前执行进度。</p>
                </div>
              </div>

              {boundWorkflowRuns.length ? (
                <div className="workflow-run-list">
                  {boundWorkflowRuns.map((run) => (
                    <article key={run.id} className="workflow-run-card" data-testid={`silicon-person-workflow-run-${run.id}`}>
                      <header className="task-header">
                        <div>
                          <strong>{run.id}</strong>
                          <p>{run.workflowId} · v{run.workflowVersion}</p>
                        </div>
                        <span className="meta-pill">{workflowRunStatusLabel(run.status)}</span>
                      </header>
                      <div className="task-links">
                        <span>节点：{run.currentNodeIds.length ? run.currentNodeIds.join(", ") : "无"}</span>
                        <span>更新时间：{run.updatedAt}</span>
                      </div>
                      {run.error && <p className="error-copy">{run.error}</p>}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">当前没有可展示的 workflow run。</p>
              )}
            </section>

            {saveError && <p className="error-copy">{saveError}</p>}
            <button className="primary" type="submit" disabled={isSaving}>
              保存硅基员工
            </button>
          </form>

          <section className="studio-card">
            <div className="card-header">
              <div>
                <h3>当前摘要</h3>
                <p>这里展示最小会话路由和审批信号，便于继续推进下一批能力。</p>
              </div>
            </div>
            <dl className="summary-grid">
              <div>
                <dt>currentSession</dt>
                <dd>{siliconPerson?.currentSessionId ?? "未建立"}</dd>
              </div>
              <div>
                <dt>审批模式</dt>
                <dd>{siliconPerson?.approvalMode ?? "inherit"}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>{draftSource}</dd>
              </div>
              <div>
                <dt>待审批</dt>
                <dd>{siliconPerson?.needsApproval ? "是" : "否"}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </section>

      <style>{`
        .studio-page {
          padding: 40px 48px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .page-header {
          max-width: 820px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .eyebrow {
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-size: 11px;
          font-weight: 600;
          margin: 0;
        }

        h2 {
          font-size: 28px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }

        .subtitle {
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.7;
          margin: 0;
        }

        .headline-metrics {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .studio-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.85fr);
          gap: 20px;
          align-items: start;
        }

        .workspace-column, .studio-sidebar, .studio-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .studio-card {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-lg);
          background: var(--bg-card);
          padding: 20px;
          transition: border-color 0.2s, box-shadow 0.2s;
          box-shadow: var(--shadow-card), var(--glass-inner-glow);
        }

        .studio-card:hover {
          border-color: var(--text-muted);
        }

        .card-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 14px;
        }

        .card-header h3 {
          margin: 0 0 6px;
          color: var(--text-primary);
          font-size: 17px;
        }

        .card-header p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.6;
        }

        .session-tabs {
          display: grid;
          gap: 10px;
        }

        .session-tab {
          width: 100%;
          text-align: left;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          cursor: pointer;
          transition: border-color 0.2s, transform 0.2s, background 0.2s;
        }

        .session-tab:hover {
          border-color: var(--text-muted);
          transform: translateY(-1px);
        }

        .session-tab.active {
          border-color: var(--accent-cyan);
          background: rgba(103,232,249,0.08);
        }

        .session-tab-title {
          font-size: 14px;
          font-weight: 600;
        }

        .session-tab-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          color: var(--text-secondary);
          font-size: 12px;
        }

        .conversation-card {
          gap: 0;
        }

        .message-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          max-height: 420px;
          overflow-y: auto;
          padding-right: 4px;
        }

        .tasklist-card, .workflow-run-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid var(--glass-border);
        }

        .message-card {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .message-header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          color: var(--text-secondary);
          font-size: 12px;
        }

        .message-card p {
          margin: 0;
          color: var(--text-primary);
          line-height: 1.7;
          white-space: pre-wrap;
        }

        .task-list, .workflow-run-list, .approval-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .task-card, .workflow-run-card, .approval-card {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .task-header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }

        .task-header strong {
          display: block;
          margin-bottom: 4px;
        }

        .task-header p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.6;
        }

        .approval-card p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.6;
        }

        .task-links {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          color: var(--text-secondary);
          font-size: 12px;
        }

        .composer-card {
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid var(--glass-border);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 8px;
          color: var(--text-secondary);
        }

        .field input, .field textarea, .field select {
          width: 100%;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 10px 12px;
          font: inherit;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .field input:focus, .field textarea:focus, .field select:focus {
          border-color: var(--accent-cyan);
          box-shadow: 0 0 0 3px rgba(16,163,127,0.14);
        }

        .binding-row {
          display: flex;
          gap: 12px;
          align-items: end;
        }

        .binding-field {
          flex: 1;
        }

        .binding-list {
          margin: 0;
          padding-left: 18px;
          color: var(--text-secondary);
        }

        .binding-list li {
          margin-bottom: 10px;
        }

        .binding-title {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .binding-title strong {
          color: var(--text-primary);
        }

        .binding-title span {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin: 0;
        }

        .summary-grid div {
          padding: 12px;
          border-radius: var(--radius-md);
          border: 1px solid var(--glass-border);
          background: var(--bg-base);
        }

        .summary-grid dt {
          margin: 0 0 6px;
          color: var(--text-muted);
          font-size: 12px;
        }

        .summary-grid dd {
          margin: 0;
          color: var(--text-primary);
          font-size: 13px;
          line-height: 1.5;
        }

        .composer-actions {
          display: flex;
          justify-content: flex-end;
        }

        .approval-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .meta-pill {
          border: 1px solid var(--glass-border);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 12px;
          color: var(--text-primary);
        }

        .accent-pill {
          border-color: rgba(103,232,249,0.45);
          color: var(--accent-cyan);
        }

        .warning-pill {
          border-color: rgba(245,158,11,0.45);
          color: #f59e0b;
        }

        .primary, .secondary {
          border-radius: 999px;
          padding: 10px 14px;
          font: inherit;
          cursor: pointer;
          transition: all 0.2s;
        }

        .primary {
          border: none;
          background: var(--accent-primary);
          color: var(--accent-text);
        }

        .primary:hover:not(:disabled) {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }

        .secondary {
          border: 1px solid var(--glass-border);
          background: transparent;
          color: var(--text-primary);
        }

        .secondary:hover:not(:disabled) {
          background: rgba(255,255,255,0.04);
          border-color: var(--text-muted);
        }

        .primary:disabled, .secondary:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .error-copy {
          margin: 0;
          color: var(--status-red);
        }

        .empty-copy {
          margin: 0;
          color: var(--text-secondary);
          line-height: 1.7;
        }

        @media (max-width: 960px) {
          .studio-page {
            padding: 24px;
          }

          .studio-grid {
            grid-template-columns: 1fr;
          }

          .summary-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

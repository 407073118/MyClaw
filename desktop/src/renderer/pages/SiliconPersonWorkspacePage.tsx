import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ApprovalDecision, ApprovalRequest, ArtifactScopeRef, McpServer, ModelProfile, SiliconPersonApprovalMode, SkillDefinition, Task } from "@shared/contracts";
import ReasoningPresetPanel from "../components/ReasoningPresetPanel";
import WorkFilesPanel from "../components/WorkFilesPanel";
import { useWorkspaceStore } from "../stores/workspace";
import { buildModelRuntimeStatusItems } from "../utils/model-profile-display";
import { resolveReasoningControlSpec } from "../utils/reasoning-controls";
import { formatMessageTime, formatFullTime, formatDateSeparator, isDifferentDay } from "../utils/format-time";
import { localDateTimeToUtcIso } from "../../../shared/time/local-time";

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

/** 把工作时段数组压缩成工作台易读摘要，优先展示首个配置窗口。 */
function formatWorkingHoursSummary(workingHours: Array<{ start: string; end: string }>): string {
  if (workingHours.length === 0) {
    return "未配置";
  }
  const primary = workingHours[0];
  return `${primary.start} - ${primary.end}`;
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
export default function SiliconPersonWorkspacePage() {
  const { id: siliconPersonId = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
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
  const workFilesScope = useMemo<ArtifactScopeRef | null>(() => {
    if (currentSessionSummary?.id) {
      return { scopeKind: "session", scopeId: currentSessionSummary.id };
    }
    if (siliconPersonId) {
      return { scopeKind: "siliconPerson", scopeId: siliconPersonId };
    }
    return null;
  }, [currentSessionSummary?.id, siliconPersonId]);
  const currentSessionTasks = currentSession?.tasks ?? [];
  const currentSessionMessages = currentSession?.messages ?? [];
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
  const [activeStudioTab, setActiveStudioTab] = useState<"chat" | "profile" | "tasks" | "capabilities">("chat");
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [scheduledWorkflowId, setScheduledWorkflowId] = useState("");
  const [scheduledStartsAt, setScheduledStartsAt] = useState("2026-04-21T09:00");
  const [scheduledIntervalMinutes, setScheduledIntervalMinutes] = useState("1440");
  const [scheduleMessage, setScheduleMessage] = useState("");

  // 草稿状态，与当前硅基员工实体保持同构。
  const [draftName, setDraftName] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftApprovalMode, setDraftApprovalMode] = useState<SiliconPersonApprovalMode>("inherit");
  const [draftWorkflowIds, setDraftWorkflowIds] = useState<string[]>([]);
  // 员工自己工作空间的 skills 和 MCP 服务（独立目录，非全局引用）
  const [personSkills, setPersonSkills] = useState<SkillDefinition[]>([]);
  const [personMcpServers, setPersonMcpServers] = useState<McpServer[]>([]);
  // 员工工作空间路径
  const [personPaths, setPersonPaths] = useState<{ personDir: string; skillsDir: string; sessionsDir: string }>({ personDir: "", skillsDir: "", sessionsDir: "" });
  const [draftSoul, setDraftSoul] = useState("");
  const [draftModelProfileId, setDraftModelProfileId] = useState("");
  const [draftReasoningEnabled, setDraftReasoningEnabled] = useState(true);
  const [draftReasoningEffort, setDraftReasoningEffort] = useState<"low" | "medium" | "high" | "xhigh">("medium");
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
  const siliconPersonScheduleJobs = useMemo(
    () =>
      workspace.time.scheduleJobs.filter((job) => job.ownerScope === "silicon_person" && job.ownerId === siliconPersonId),
    [workspace.time.scheduleJobs, siliconPersonId, viewVersion],
  );
  const siliconPersonWorkingHoursSummary = useMemo(
    () => formatWorkingHoursSummary(workspace.time.availabilityPolicy?.workingHours ?? []),
    [workspace.time.availabilityPolicy?.workingHours],
  );
  const activeModelProfile = useMemo<ModelProfile | null>(
    () => workspace.models.find((model) => model.id === (draftModelProfileId || workspace.defaultModelProfileId || "")) ?? null,
    [draftModelProfileId, workspace.defaultModelProfileId, workspace.models],
  );
  const reasoningControlSpec = useMemo(
    () => resolveReasoningControlSpec(activeModelProfile),
    [activeModelProfile],
  );
  const runtimeModelStatusItems = useMemo(
    () => buildModelRuntimeStatusItems(activeModelProfile),
    [activeModelProfile],
  );

  // 员工详情变化后，把最新数据同步到本地草稿。
  useEffect(() => {
    if (!siliconPerson) return;
    setDraftName(siliconPerson.name);
    setDraftTitle(siliconPerson.title);
    setDraftApprovalMode(siliconPerson.approvalMode);
    setDraftWorkflowIds([...siliconPerson.workflowIds]);
    setDraftSoul(siliconPerson.soul ?? "");
    setDraftModelProfileId(siliconPerson.modelProfileId ?? "");
    setDraftReasoningEnabled(siliconPerson.reasoningEnabled ?? true);
    setDraftReasoningEffort(siliconPerson.reasoningEffort ?? "medium");
  }, [siliconPerson?.id, siliconPerson?.updatedAt, siliconPerson?.approvalMode]);

  // 默认把首个已绑定 workflow 作为定时任务创建目标，减少重复选择。
  useEffect(() => {
    if (!scheduledWorkflowId && boundWorkflows[0]?.workflowId) {
      setScheduledWorkflowId(boundWorkflows[0].workflowId);
    }
  }, [boundWorkflows, scheduledWorkflowId]);

  // 加载员工独立工作空间的 skills、MCP 服务和路径信息。
  const loadPersonResources = useCallback(async () => {
    if (!siliconPersonId) return;
    const api = window.myClawAPI;
    const [skillsRes, mcpRes, pathsRes] = await Promise.all([
      api.listSiliconPersonSkills(siliconPersonId),
      api.listSiliconPersonMcpServers(siliconPersonId),
      api.getSiliconPersonPaths(siliconPersonId),
    ]);
    setPersonSkills(skillsRes.items ?? []);
    setPersonMcpServers(mcpRes.servers ?? []);
    setPersonPaths(pathsRes);
  }, [siliconPersonId]);

  // 首次进入时补齐硅基员工详情、工作流列表和独立资源。
  useEffect(() => {
    /** 只在页面挂载时拉取最小必需数据，避免工作台与侧栏各自探测。 */
    async function initStudio(): Promise<void> {
      if (siliconPersonId) {
        console.info("[silicon-person-studio] 加载硅基员工详情", {
          siliconPersonId,
        });
        await workspace.loadSiliconPersonById(siliconPersonId);
        await loadPersonResources();
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

  /** 为当前硅基员工创建周期性 workflow 计划任务，统一复用时间规划存储。 */
  async function handleCreateScheduledWorkflowJob() {
    if (!siliconPersonId || !scheduledWorkflowId) {
      setScheduleMessage("请先选择要绑定的工作流。");
      return;
    }

    const timezone = workspace.time.availabilityPolicy?.timezone ?? "Asia/Shanghai";
    const intervalMinutes = Number(scheduledIntervalMinutes);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      setScheduleMessage("周期分钟必须是大于 0 的数字。");
      return;
    }

    const workflow = workspace.workflows.find((item) => item.id === scheduledWorkflowId);
    const startsAt = localDateTimeToUtcIso(scheduledStartsAt, timezone);
    console.info("[silicon-person-studio] 创建硅基员工定时工作流", {
      siliconPersonId,
      workflowId: scheduledWorkflowId,
      startsAt,
      intervalMinutes,
    });

    await workspace.createScheduleJob({
      kind: "schedule_job",
      title: `${workflow?.name ?? scheduledWorkflowId} 定时运行`,
      description: `硅基员工 ${siliconPerson?.name ?? siliconPersonId} 周期执行 ${workflow?.name ?? scheduledWorkflowId}`,
      scheduleKind: "interval",
      timezone,
      ownerScope: "silicon_person",
      ownerId: siliconPersonId,
      status: "scheduled",
      source: "manual",
      startsAt,
      intervalMinutes,
      executor: "workflow",
      executorTargetId: scheduledWorkflowId,
      nextRunAt: startsAt,
    });
    setScheduleMessage("已创建定时工作流。");
  }

  /** 保存侧栏中的硅基员工角色卡和 workflow 绑定信息。 */
  async function handleSave() {
    if (!siliconPersonId) return;

    setShowSaveConfirm(false);
    setSaveError("");
    setIsSaving(true);
    try {
      console.info("[silicon-person-studio] 保存硅基员工侧栏配置", {
        siliconPersonId,
        workflowCount: draftWorkflowIds.length,
      });
      await workspace.updateSiliconPerson(siliconPersonId, {
        name: draftName.trim(),
        title: draftTitle.trim(),
        approvalMode: draftApprovalMode,
        workflowIds: [...draftWorkflowIds],
        soul: draftSoul.trim() || undefined,
        modelProfileId: draftModelProfileId || undefined,
        reasoningEnabled: draftReasoningEnabled,
        reasoningEffort: draftReasoningEffort,
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


  /** 处理当前会话里的审批请求，按钮只负责把决定转给 workspace。 */
  /** 向当前硅基员工的 currentSession 继续发送消息，保持私域会话连续性。 */
  async function handleSendMessage() {
    if (!siliconPersonId) return;
    const content = draftMessage.trim();
    if (!content) return;

    setSessionError("");
    setIsSending(true);
    try {
      console.info("[silicon-person-studio] 请求向当前会话继续发送消息", {
        siliconPersonId,
        sessionId: currentSessionSummary?.id ?? null,
        contentLength: content.length,
      });
      await workspace.sendSiliconPersonMessage(siliconPersonId, content);
      setDraftMessage("");
      setViewVersion((value) => value + 1);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "发送硅基员工消息失败。");
    } finally {
      setIsSending(false);
    }
  }

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

  const statusColor: Record<string, string> = {
    idle: "var(--text-muted)", running: "var(--accent-cyan)", needs_approval: "var(--status-yellow)",
    done: "var(--status-green)", error: "var(--status-red)", canceling: "var(--status-yellow)", canceled: "var(--text-muted)",
  };
  const approvalModeLabel: Record<string, string> = {
    inherit: "继承全局策略", always_ask: "每次都问", auto_approve: "自动批准",
  };
  const sourceLabel: Record<string, string> = {
    personal: "个人创建", enterprise: "企业分发", hub: "Hub 导入",
  };
  const avatarColors = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#84cc16"];
  function pickAvatarColor(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return avatarColors[Math.abs(h) % avatarColors.length];
  }

  return (
    <main data-testid="silicon-person-studio-view" className="ws">
      {/* ── Header ── */}
      <header className="ws-header">
        <div className="ws-header-top">
          <button
            type="button"
            className="glass-action-btn ws-back-btn"
            data-testid="ws-back-btn"
            onClick={() => navigate("/employees")}
            title="返回硅基员工列表"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            返回
          </button>
          <div className="ws-identity">
            <div className="ws-avatar" style={{ background: pickAvatarColor(siliconPerson?.name ?? "?") }}>
              <span>{(siliconPerson?.name ?? "?")[0]}</span>
            </div>
            <div className="ws-identity-text">
              <div className="ws-name-row">
                <h2>{draftName || siliconPerson?.name || "硅基员工"}</h2>
                <span
                  className="ws-status-dot"
                  style={{ background: statusColor[siliconPerson?.status ?? "idle"] }}
                  title={siliconPersonStatusLabel(siliconPerson?.status ?? "idle")}
                />
              </div>
              <span className="ws-title-sub">{draftTitle || siliconPerson?.title || ""}</span>
            </div>
          </div>
          {siliconPerson && (
            <button className="btn-premium accent" type="button" data-testid="profile-tab-save" onClick={() => setShowSaveConfirm(true)} disabled={isSaving} style={{ opacity: isSaving ? 0.55 : undefined, cursor: isSaving ? "not-allowed" : undefined }}>
              {isSaving ? "保存中..." : "保存"}
            </button>
          )}
        </div>
        {saveError && <p className="ws-error">{saveError}</p>}
        {siliconPerson && (
          <div className="ws-meta-row">
            <span className={`glass-pill glass-pill--ws-status-${siliconPerson.status}`}>{siliconPersonStatusLabel(siliconPerson.status)}</span>
            <span className="glass-pill glass-pill--muted">{sourceLabel[siliconPerson.source] ?? siliconPerson.source}</span>
            <span className="glass-pill glass-pill--muted">{siliconPerson.sessions.length} 个会话</span>
            <span className="glass-pill glass-pill--muted">{siliconPerson.workflowIds.length} 个工作流</span>
            {siliconPerson.hasUnread && <span className="glass-pill glass-pill--accent">{siliconPerson.unreadCount} 未读</span>}
            {siliconPerson.needsApproval && <span className="glass-pill glass-pill--yellow">待审批</span>}
          </div>
        )}
      </header>

      {/* ── Tabs ── */}
      <nav className="ws-tabs" data-testid="studio-tab-bar">
        {([
          ["chat", "聊天"],
          ["profile", "资料"],
          ["capabilities", "能力"],
          ["tasks", "任务"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`ws-tab${activeStudioTab === key ? " active" : ""}`}
            data-testid={
              key === "chat"
                ? "studio-tab-chat"
                : key === "profile"
                  ? "studio-tab-profile"
                  : key === "capabilities"
                    ? "studio-tab-capabilities"
                    : key === "tasks"
                      ? "studio-tab-tasks"
                      : undefined
            }
            onClick={() => setActiveStudioTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="ws-body">
        {siliconPerson && (
          <section
            className="ws-col"
            style={{ display: activeStudioTab === "chat" ? undefined : "none" }}
          >
            <article className="ws-card ws-chat-card">
              <div className="ws-chat-header">
                <h3>聊天</h3>
                <p className="ws-card-desc">进入该硅基员工自己的私域会话，查看历史消息并继续追问。</p>
              </div>

              <div className="ws-session-bar">
                <div className="ws-session-pills">
                  {siliconPerson.sessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className={`ws-session-pill${currentSessionSummary?.id === session.id ? " active" : ""}`}
                      data-testid={`silicon-person-session-pill-${session.id}`}
                      onClick={() => void handleSwitchSession(session.id)}
                    >
                      <span>{session.title || "未命名会话"}</span>
                      {session.needsApproval && <span className="ws-session-badge warn">!</span>}
                      {session.unreadCount > 0 && !session.needsApproval && (
                        <span className="ws-session-badge">{session.unreadCount > 9 ? "9+" : session.unreadCount}</span>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="ws-btn-ghost"
                  data-testid="silicon-person-create-session"
                  onClick={() => void handleCreateSession()}
                  disabled={isCreatingSession}
                >
                  {isCreatingSession ? "新建中..." : "新建会话"}
                </button>
              </div>

              {sessionError && <p className="ws-error">{sessionError}</p>}
              {!currentSessionSummary && (
                <div className="ws-empty-state">
                  <p>当前还没有可用会话，先新建一个会话开始协作。</p>
                </div>
              )}

              {currentSessionSummary && (
                <>
                  <div className="ws-section">
                    <h4>当前会话</h4>
                    <div className="ws-meta-row">
                      <span className="glass-pill glass-pill--muted">{currentSessionSummary.title || "未命名会话"}</span>
                      <span className="glass-pill glass-pill--muted">{currentSessionMessages.length} 条消息</span>
                      {currentSessionSummary.hasUnread && (
                        <span className="glass-pill glass-pill--accent">{currentSessionSummary.unreadCount} 未读</span>
                      )}
                    </div>
                  </div>

                  <div className="ws-section">
                    <h4>历史消息</h4>
                    {currentSessionMessages.length > 0 ? (
                      <div className="ws-message-list" data-testid="silicon-person-message-list">
                        {currentSessionMessages.map((message, index) => {
                          const prev = currentSessionMessages[index - 1];
                          const showDateSep = typeof message.createdAt === "string" && (
                            index === 0 || (typeof prev?.createdAt === "string" && isDifferentDay(prev.createdAt, message.createdAt))
                          );
                          return (
                            <React.Fragment key={message.id}>
                              {showDateSep && (
                                <div className="ws-date-separator"><span>{formatDateSeparator(message.createdAt)}</span></div>
                              )}
                              <div className={`ws-msg ws-msg--${message.role}`}>
                                <span className="ws-msg-role">{roleLabel(message.role)}</span>
                                <div className="ws-msg-body">
                                  <p>{textOf(message.content) || "暂不支持展示的消息内容"}</p>
                                  {typeof message.createdAt === "string" && (
                                    <span className="ws-msg-time" title={formatFullTime(message.createdAt)}>
                                      {formatMessageTime(message.createdAt)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="ws-empty-state">
                        <p>当前会话还没有历史消息，直接发一条消息开始协作。</p>
                      </div>
                    )}
                  </div>

                  {currentSessionApprovalRequests.length > 0 && (
                    <div className="ws-section ws-section--approval">
                      <h4>待审批</h4>
                      <div className="ws-item-list">
                        {currentSessionApprovalRequests.map((request) => (
                          <div key={request.id} className="ws-approval-item">
                            <div className="ws-approval-info">
                              <strong>{request.label || "审批请求"}</strong>
                              <p>{request.detail || "当前会话有一条待处理审批请求。"}</p>
                            </div>
                            <div className="ws-approval-actions">
                              <button type="button" className="ws-btn-approve" onClick={() => void handleResolveApproval(request.id, "allow-once")}>批准</button>
                              <button type="button" className="ws-btn-deny" onClick={() => void handleResolveApproval(request.id, "deny")}>拒绝</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {approvalError && <p className="ws-error">{approvalError}</p>}

                  <div className="ws-composer">
                    <textarea
                      data-testid="silicon-person-composer-input"
                      value={draftMessage}
                      onChange={(event) => setDraftMessage(event.target.value)}
                      placeholder="继续向这个硅基员工追问，消息会写入它自己的 currentSession。"
                      rows={4}
                    />
                    <button
                      type="button"
                      className="ws-btn-send"
                      data-testid="silicon-person-composer-send"
                      onClick={() => void handleSendMessage()}
                      disabled={isSending || draftMessage.trim().length === 0}
                    >
                      {isSending ? "发送中..." : "发送"}
                    </button>
                  </div>
                </>
              )}
            </article>
            <article className="ws-card">
              <WorkFilesPanel
                scope={workFilesScope}
                mode="page"
                title="会话文件"
                description="当前对话产生的文件"
                emptyHint="暂无文件——对话产生的文件会显示在这里"
              />
            </article>
          </section>
        )}
        {/* ═══════════ 资料 Tab ═══════════ */}
        {activeStudioTab === "profile" && siliconPerson && (
          <section className="ws-col ws-profile-col">
            <div className="ws-profile-grid">
              {/* 基本信息 */}
              <div className="ws-card ws-form-card" data-testid="profile-tab-form">
                <h3>基本信息</h3>
                <div className="ws-form-fields">
                  <label className="ws-field">
                    <span>名称</span>
                    <input value={draftName} onChange={(e) => setDraftName(e.target.value)} data-testid="profile-tab-name" type="text" />
                  </label>
                  <label className="ws-field">
                    <span>职位头衔</span>
                    <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} data-testid="profile-tab-title" type="text" />
                  </label>
                  {personPaths.personDir && (
                    <div className="ws-field ws-field--full">
                      <span>数据目录</span>
                      <div className="ws-path-display" title={personPaths.personDir}>{personPaths.personDir}</div>
                    </div>
                  )}
                  {personPaths.skillsDir && (
                    <div className="ws-field ws-field--full">
                      <span>技能目录</span>
                      <div className="ws-path-display" title={personPaths.skillsDir}>{personPaths.skillsDir}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* 身份与人格 */}
              <div className="ws-card ws-form-card" data-testid="profile-persona-form">
                <h3>身份与人格</h3>
                <div className="ws-form-fields">
                  <label className="ws-field ws-field--full">
                    <span>灵魂定义</span>
                    <textarea value={draftSoul} onChange={(e) => setDraftSoul(e.target.value)} data-testid="profile-tab-soul" rows={6} placeholder="定义这个硅基员工的角色身份、行为风格与个性特征。例如：&#10;我是一个专注于数据分析的研究助手，擅长结构化思考，回答简洁精准。" />
                  </label>
                </div>
              </div>

              {/* 模型与策略 */}
              <div className="ws-card ws-form-card" data-testid="profile-model-form">
                <h3>模型与策略</h3>
                <div className="ws-form-fields">
                  <label className="ws-field ws-field--full">
                    <span>使用模型</span>
                    <select value={draftModelProfileId} onChange={(e) => setDraftModelProfileId(e.target.value)} data-testid="profile-tab-model">
                      <option value="">跟随全局默认</option>
                      {workspace.models.map((model) => (
                        <option key={model.id} value={model.id}>{model.name} ({model.model})</option>
                      ))}
                    </select>
                  </label>
                  {runtimeModelStatusItems.length > 0 && (
                    <div className="ws-field ws-field--full">
                      <span>运行诊断</span>
                      <div className="ws-model-status" data-testid="silicon-person-workspace-model-status">
                        {runtimeModelStatusItems.map((item) => (
                          <span key={item.key} className={`ws-model-status-pill ws-model-status-pill--${item.tone}`}>
                            {item.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="ws-field">
                    <span>推理等级</span>
                    <ReasoningPresetPanel
                      spec={reasoningControlSpec}
                      enabled={draftReasoningEnabled}
                      effort={draftReasoningEffort}
                      onEnabledChange={setDraftReasoningEnabled}
                      onEffortChange={setDraftReasoningEffort}
                    />
                  </div>
                  <label className="ws-field">
                    <span>审批模式</span>
                    <select value={draftApprovalMode} onChange={(e) => setDraftApprovalMode(e.target.value as SiliconPersonApprovalMode)} data-testid="profile-tab-approval-mode">
                      <option value="inherit">继承全局策略</option>
                      <option value="always_ask">每次都问</option>
                      <option value="auto_approve">自动批准</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* 系统信息 */}
              <div className="ws-card">
                <h3>系统信息</h3>
                <div className="ws-readonly-grid">
                  <div className="ws-stat-cell">
                    <span className="ws-stat-label">ID</span>
                    <span className="ws-stat-value ws-mono">{siliconPerson.id}</span>
                  </div>
                  <div className="ws-stat-cell">
                    <span className="ws-stat-label">来源</span>
                    <span className="ws-stat-value">{sourceLabel[siliconPerson.source] ?? siliconPerson.source}</span>
                  </div>
                  <div className="ws-stat-cell">
                    <span className="ws-stat-label">最后更新</span>
                    <span className="ws-stat-value">{siliconPerson.updatedAt}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ═══════════ 任务 Tab ═══════════ */}
        {activeStudioTab === "tasks" && (
          <section className="ws-col">
            <article className="ws-card">
              <h3>任务列表</h3>
              <p className="ws-card-desc">当前会话的任务进度总览</p>
              {currentSessionTasks.length > 0 ? (
                <div className="ws-item-list" style={{ marginTop: 16 }}>
                  {currentSessionTasks.map((task) => (
                    <div key={task.id} className="ws-item">
                      <div className="ws-item-main">
                        <strong>{task.subject}</strong>
                        {task.description && <p>{task.description}</p>}
                      </div>
                      <span className={`glass-pill glass-pill--${task.status === "completed" ? "green" : task.status === "in_progress" ? "accent" : "muted"}`}>{taskStatusLabel(task.status)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ws-empty-state" style={{ marginTop: 16 }}>
                  <p>还没有任务，任务会随执行自动产生</p>
                </div>
              )}
            </article>
          </section>
        )}

        {/* ═══════════ 能力 Tab ═══════════ */}
        {activeStudioTab === "capabilities" && (
          <section className="ws-col">
            {/* ── 员工独立 Skills ── */}
            <article className="ws-card">
              <div className="ws-cap-header">
                <div>
                  <h3>技能</h3>
                  <p className="ws-card-desc">员工独立工作空间中的 Skills，可从 Hub 单独安装</p>
                </div>
                <button
                  type="button"
                  className="ws-btn-ghost"
                  onClick={() => void loadPersonResources()}
                >
                  刷新
                </button>
              </div>
              <div className="ws-binding-grid">
                {personSkills.map((skill) => (
                  <div key={skill.id} className="ws-binding-card bound">
                    <div className="ws-binding-card-info">
                      <strong>{skill.name}</strong>
                      <span>{skill.description || skill.id}</span>
                    </div>
                  </div>
                ))}
                {personSkills.length === 0 && (
                  <div className="ws-empty-state"><p>员工工作空间中还没有 Skills，可从 Hub 安装</p></div>
                )}
              </div>
            </article>

            {/* ── 员工独立 MCP 服务 ── */}
            <article className="ws-card">
              <div className="ws-cap-header">
                <div>
                  <h3>MCP 服务</h3>
                  <p className="ws-card-desc">员工独立工作空间中的 MCP 服务，各员工互不影响</p>
                </div>
                <button
                  type="button"
                  className="ws-btn-ghost"
                  onClick={() => void loadPersonResources()}
                >
                  刷新
                </button>
              </div>
              <div className="ws-binding-grid">
                {personMcpServers.map((server) => (
                  <div key={server.id} className="ws-binding-card bound">
                    <div className="ws-binding-card-info">
                      <strong>{server.name}</strong>
                      <span>{server.state?.connected ? "已连接" : "未连接"}</span>
                    </div>
                  </div>
                ))}
                {personMcpServers.length === 0 && (
                  <div className="ws-empty-state"><p>员工工作空间中还没有 MCP 服务，可从 Hub 安装</p></div>
                )}
              </div>
            </article>

            {/* ── 工作流绑定 ── */}
            <article className="ws-card">
              <div className="ws-cap-header">
                <div>
                  <h3>工作流绑定</h3>
                  <p className="ws-card-desc">管理硅基员工的工作流能力</p>
                </div>
                <div className="ws-bind-row">
                  <select
                    value={selectedWorkflowId}
                    onChange={(e) => setSelectedWorkflowId(e.target.value)}
                    data-testid="employee-studio-workflow-select"
                    className="ws-bind-select"
                  >
                    <option value="">选择工作流</option>
                    {workspace.workflows.map((wf) => (
                      <option key={wf.id} value={wf.id}>{wf.name}</option>
                    ))}
                  </select>
                  <button data-testid="employee-studio-bind-workflow" className="ws-btn-ghost" type="button" onClick={bindWorkflow}>
                    绑定
                  </button>
                </div>
              </div>

              {boundWorkflows.length > 0 ? (
                <div className="ws-wf-grid">
                  {boundWorkflows.map(({ workflowId, summary }) => (
                    <div key={workflowId} className="ws-wf-card" data-testid={`silicon-person-workflow-binding-${workflowId}`}>
                      <div className="ws-wf-card-info">
                        <strong>{summary.name}</strong>
                        <span className="ws-mono ws-text-muted">{workflowId}</span>
                      </div>
                      <button
                        type="button"
                        className="ws-btn-ghost"
                        data-testid={`silicon-person-workflow-start-${workflowId}`}
                        onClick={() => void handleStartWorkflowRun(workflowId)}
                      >
                        启动运行
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ws-empty-state" style={{ marginTop: 16 }}>
                  <p>还没有绑定工作流</p>
                </div>
              )}
            </article>

            <article className="ws-card">
              <div className="ws-cap-header">
                <div>
                  <h3>定时任务</h3>
                  <p className="ws-card-desc">为硅基员工绑定周期性 workflow 运行窗口，并复用时间规划的统一调度。</p>
                </div>
                <span className="glass-pill glass-pill--muted">工作时段 {siliconPersonWorkingHoursSummary}</span>
              </div>

              <div className="ws-binding-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 16 }}>
                <label className="ws-field">
                  <span>定时工作流</span>
                  <select value={scheduledWorkflowId} onChange={(e) => setScheduledWorkflowId(e.target.value)} aria-label="定时工作流">
                    <option value="">选择工作流</option>
                    {boundWorkflows.map(({ workflowId, summary }) => (
                      <option key={workflowId} value={workflowId}>{summary.name}</option>
                    ))}
                  </select>
                </label>
                <label className="ws-field">
                  <span>首次运行时间</span>
                  <input
                    type="datetime-local"
                    value={scheduledStartsAt}
                    onChange={(e) => setScheduledStartsAt(e.target.value)}
                    aria-label="首次运行时间"
                  />
                </label>
                <label className="ws-field">
                  <span>周期分钟</span>
                  <input
                    type="number"
                    min="1"
                    value={scheduledIntervalMinutes}
                    onChange={(e) => setScheduledIntervalMinutes(e.target.value)}
                    aria-label="周期分钟"
                  />
                </label>
                <div className="ws-field ws-field--action">
                  <span>执行策略</span>
                  <button type="button" className="ws-btn-ghost" onClick={() => void handleCreateScheduledWorkflowJob()}>
                    创建定时工作流
                  </button>
                </div>
              </div>

              {scheduleMessage ? (
                <p className="ws-card-desc" style={{ marginTop: 12 }}>{scheduleMessage}</p>
              ) : null}

              {siliconPersonScheduleJobs.length > 0 ? (
                <div className="ws-item-list" style={{ marginTop: 16 }}>
                  {siliconPersonScheduleJobs.map((job) => (
                    <div key={job.id} className="ws-item">
                      <div className="ws-item-main">
                        <strong>{job.title}</strong>
                        <p>{job.nextRunAt ? `下次运行 ${job.nextRunAt}` : "等待下一次计算"}</p>
                      </div>
                      <span className="glass-pill glass-pill--muted">{job.scheduleKind}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ws-empty-state" style={{ marginTop: 16 }}>
                  <p>还没有为该硅基员工创建定时任务</p>
                </div>
              )}
            </article>

            {boundWorkflowRuns.length > 0 && (
              <article className="ws-card">
                <h3>运行记录</h3>
                <div className="ws-item-list" style={{ marginTop: 12 }}>
                  {boundWorkflowRuns.map((run) => (
                    <div key={run.id} className="ws-item" data-testid={`silicon-person-workflow-run-${run.id}`}>
                      <div className="ws-item-main">
                        <strong>{run.workflowId}</strong>
                        <p>v{run.workflowVersion} &middot; {run.updatedAt}</p>
                      </div>
                      <span className="glass-pill glass-pill--muted">{workflowRunStatusLabel(run.status)}</span>
                      {run.error && <p className="ws-error" style={{ marginTop: 4 }}>{run.error}</p>}
                    </div>
                  ))}
                </div>
              </article>
            )}

          </section>
        )}

      </section>

      {/* 保存确认弹窗 */}
      {showSaveConfirm && (
        <div className="sp-confirm-overlay" onClick={() => setShowSaveConfirm(false)}>
          <div
            className="sp-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sp-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sp-confirm-icon">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            </div>
            <p id="sp-confirm-title" className="sp-confirm-message">确定保存对「{draftName || siliconPerson?.name}」的配置修改吗？</p>
            <p className="sp-confirm-hint">修改将立即生效，新会话将使用更新后的配置。</p>
            <div className="sp-confirm-actions">
              <button className="sp-confirm-cancel" onClick={() => setShowSaveConfirm(false)}>取消</button>
              <button className="sp-confirm-ok" onClick={() => void handleSave()}>确认保存</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        /* ── Layout ── */
        .ws { height: 100%; overflow-y: auto; padding: 28px 32px; display: flex; flex-direction: column; gap: 20px; }

        /* ── Header ── */
        .ws-header { display: flex; flex-direction: column; gap: 14px; }
        .ws-header-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .ws-back-btn { display: inline-flex; align-items: center; gap: 4px; height: 34px; padding: 0 12px; font-size: 13px; flex-shrink: 0; }
        .ws-identity { display: flex; align-items: center; gap: 16px; flex: 1; min-width: 0; }
        .ws-avatar { width: 52px; height: 52px; border-radius: var(--radius-xl); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .ws-avatar span { font-size: 1.4rem; font-weight: 900; color: #fff; }
        .ws-identity-text { min-width: 0; }
        .ws-name-row { display: flex; align-items: center; gap: 10px; }
        .ws-name-row h2 { margin: 0; font-size: 22px; font-weight: 800; color: var(--text-primary); }
        .ws-status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .ws-title-sub { font-size: 0.8rem; color: var(--text-muted); font-weight: 500; }
        .ws-meta-row { display: flex; flex-wrap: wrap; gap: 6px; }

        /* ── Status-specific pill mappings ── */
        .glass-pill--ws-status-running { color: var(--accent-cyan); background: rgba(16,163,127,0.08); border-color: rgba(16,163,127,0.2); }
        .glass-pill--ws-status-needs_approval { color: var(--status-yellow); background: rgba(245,158,11,0.1); border-color: rgba(245,158,11,0.2); }
        .glass-pill--ws-status-done { color: var(--status-green); background: rgba(34,197,94,0.1); border-color: rgba(34,197,94,0.2); }
        .glass-pill--ws-status-error { color: var(--status-red); background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.2); }
        .glass-pill--ws-status-idle,
        .glass-pill--ws-status-canceling,
        .glass-pill--ws-status-canceled { color: var(--text-muted); background: rgba(115,115,115,0.1); border-color: rgba(115,115,115,0.2); }

        /* ── Tabs ── */
        .ws-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--glass-border); }
        .ws-tab { padding: 10px 18px; border: none; background: none; color: var(--text-muted); font-size: 0.82rem; font-weight: 700; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.15s; }
        .ws-tab:hover { color: var(--text-primary); }
        .ws-tab.active { color: var(--text-primary); border-bottom-color: var(--accent-cyan); }

        /* ── Body Grid ── */
        .ws-body { display: flex; flex-direction: column; gap: 20px; flex: 1; min-height: 0; }
        .ws-col { display: flex; flex-direction: column; gap: 16px; }

        /* ── Card ── */
        .ws-card { border: 1px solid var(--glass-border); border-radius: var(--radius-xl); background: var(--bg-card); padding: 20px; box-shadow: var(--shadow-card), var(--glass-inner-glow); }
        .ws-card h3 { margin: 0 0 4px; color: var(--text-primary); font-size: 0.95rem; font-weight: 800; }
        .ws-card-desc { margin: 0; color: var(--text-muted); font-size: 0.78rem; line-height: 1.5; }

        /* ── Session Bar ── */
        .ws-session-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .ws-session-pills { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }
        .ws-session-pill { padding: 6px 14px; border: 1px solid var(--glass-border); border-radius: 20px; background: transparent; color: var(--text-secondary); font-size: 0.78rem; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 6px; }
        .ws-session-pill:hover { border-color: var(--glass-border-hover); color: var(--text-primary); }
        .ws-session-pill.active { background: rgba(16,163,127,0.1); border-color: var(--accent-cyan); color: var(--accent-cyan); }
        .ws-session-badge { min-width: 16px; height: 16px; border-radius: 999px; background: var(--accent-cyan); color: #fff; font-size: 0.6rem; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; }
        .ws-session-badge.warn { background: var(--status-yellow); color: #000; }
        .ws-empty-hint { color: var(--text-muted); font-size: 0.78rem; }

        /* ── Ghost Button (aligned with global .glass-action-btn) ── */
        .ws-btn-ghost { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 14px; border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; white-space: nowrap; }
        .ws-btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.06); border-color: var(--glass-border-hover); color: var(--text-primary); }
        .ws-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Chat Card ── */
        .ws-chat-card { display: flex; flex-direction: column; gap: 0; }
        .ws-chat-header { margin-bottom: 14px; }
        .ws-chat-header h3 { margin: 0; }

        .ws-message-list { display: flex; flex-direction: column; gap: 8px; max-height: 400px; overflow-y: auto; padding-right: 4px; }
        .ws-msg { display: flex; gap: 10px; align-items: flex-start; }
        .ws-msg-role { flex-shrink: 0; width: 56px; font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-align: right; padding-top: 8px; }
        .ws-msg-body { flex: 1; padding: 10px 14px; border-radius: var(--radius-lg); background: var(--bg-base); border: 1px solid var(--glass-border); min-width: 0; }
        .ws-msg-body p { margin: 0; color: var(--text-primary); font-size: 0.85rem; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
        .ws-msg-time { display: block; margin-top: 6px; font-size: 0.65rem; color: var(--text-muted); cursor: default; }
        .ws-date-separator { display: flex; align-items: center; gap: 12px; padding: 4px 0; }
        .ws-date-separator::before, .ws-date-separator::after { content: ""; flex: 1; height: 1px; background: var(--glass-border); }
        .ws-date-separator span { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
        .ws-msg--assistant .ws-msg-body { background: rgba(16,163,127,0.06); border-color: rgba(16,163,127,0.15); }
        .ws-msg--system .ws-msg-body { background: rgba(245,158,11,0.05); border-color: rgba(245,158,11,0.15); }
        .ws-msg--tool .ws-msg-body { background: rgba(139,92,246,0.05); border-color: rgba(139,92,246,0.15); }

        /* ── Sections inside chat ── */
        .ws-section { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--glass-border); }
        .ws-section h4 { margin: 0 0 10px; font-size: 0.78rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .ws-section--approval { background: rgba(245,158,11,0.03); margin: 16px -20px -20px; padding: 16px 20px 20px; border-radius: 0 0 var(--radius-xl) var(--radius-xl); border-top: 1px solid rgba(245,158,11,0.15); }

        /* ── Item list ── */
        .ws-item-list { display: flex; flex-direction: column; gap: 8px; }
        .ws-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 10px 14px; border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: var(--bg-base); }
        .ws-item-main { min-width: 0; }
        .ws-item-main strong { display: block; font-size: 0.85rem; color: var(--text-primary); margin-bottom: 2px; }
        .ws-item-main p { margin: 0; font-size: 0.78rem; color: var(--text-muted); line-height: 1.5; }

        /* ── Approval ── */
        .ws-approval-item { padding: 14px; border: 1px solid rgba(245,158,11,0.2); border-radius: var(--radius-lg); background: rgba(245,158,11,0.04); display: flex; flex-direction: column; gap: 10px; }
        .ws-approval-info strong { display: block; color: var(--text-primary); font-size: 0.85rem; margin-bottom: 4px; }
        .ws-approval-info p { margin: 0; color: var(--text-secondary); font-size: 0.78rem; line-height: 1.5; }
        .ws-approval-meta { display: flex; gap: 12px; margin-top: 6px; font-size: 0.7rem; color: var(--text-muted); }
        .ws-approval-actions { display: flex; gap: 8px; }
        .ws-btn-approve { padding: 6px 16px; border: 1px solid rgba(16,163,127,0.25); border-radius: var(--radius-md); background: transparent; color: var(--accent-cyan); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; }
        .ws-btn-approve:hover { background: rgba(16,163,127,0.1); border-color: rgba(16,163,127,0.4); }
        .ws-btn-deny { padding: 6px 16px; border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; }
        .ws-btn-deny:hover { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.35); color: var(--status-red); }

        /* ── Composer ── */
        .ws-composer { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--glass-border); display: flex; gap: 10px; align-items: flex-end; }
        .ws-composer textarea { flex: 1; border: 1px solid var(--glass-border); border-radius: var(--radius-lg); background: var(--bg-base); color: var(--text-primary); padding: 10px 14px; font: inherit; font-size: 0.85rem; resize: vertical; transition: border-color 0.2s, box-shadow 0.2s; }
        .ws-composer textarea:focus { border-color: var(--accent-cyan); box-shadow: 0 0 0 3px rgba(16,163,127,0.14); outline: none; }
        .ws-btn-send { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 24px; border: 1px solid var(--accent-cyan); border-radius: var(--radius-md); background: transparent; color: var(--accent-cyan); font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s cubic-bezier(0.4,0,0.2,1); white-space: nowrap; flex-shrink: 0; }
        .ws-btn-send:hover:not(:disabled) { background: rgba(16,163,127,0.1); box-shadow: 0 4px 15px rgba(16,163,127,0.2); transform: translateY(-1px); }
        .ws-btn-send:disabled { opacity: 0.55; cursor: not-allowed; }

        /* ── Profile ── */
        .ws-profile-col { max-width: 900px; margin: 0 auto; width: 100%; }
        .ws-profile-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }

        /* ── Form Card ── */
        .ws-form-card { display: flex; flex-direction: column; gap: 18px; }
        .ws-form-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .ws-model-status { display: flex; flex-wrap: wrap; gap: 8px; }
        .ws-model-status-pill { display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: var(--text-secondary); font-size: 12px; line-height: 1; white-space: nowrap; }
        .ws-model-status-pill--vendor, .ws-model-status-pill--protocol { color: var(--accent-strong); border-color: rgba(16,163,127,0.24); background: rgba(16,163,127,0.08); }
        .ws-field { display: flex; flex-direction: column; gap: 8px; }
        .ws-field span { font-size: 0.8rem; font-weight: 700; color: var(--text-muted); }
        .ws-field--full { grid-column: 1 / -1; }
        .ws-field input, .ws-field textarea, .ws-field select { width: 100%; border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.15); color: var(--text-primary); padding: 10px 14px; font: inherit; font-size: 13px; transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); box-sizing: border-box; }
        .ws-field input:hover, .ws-field textarea:hover, .ws-field select:hover { border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); }
        .ws-field input:focus, .ws-field textarea:focus, .ws-field select:focus { border-color: var(--accent-cyan); box-shadow: 0 0 0 3px rgba(16,163,127,0.15), inset 0 1px 2px rgba(0,0,0,0.2); outline: none; background: rgba(0,0,0,0.3); }
        .ws-field select { appearance: none; -webkit-appearance: none; padding-right: 36px; cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; background-size: 12px; }
        .ws-field select option { background: var(--bg-card); color: var(--text-primary); padding: 8px 12px; }
        .ws-path-display { width: 100%; padding: 10px 14px; border: 1px dashed var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.1); color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.78rem; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: all; cursor: text; box-sizing: border-box; }
        
        /* ── Readonly Stats ── */
        .ws-readonly-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-top: 14px; }
        .ws-stat-cell { padding: 14px 16px; border-radius: 10px; border: 1px solid var(--glass-border); background: linear-gradient(145deg, rgba(255,255,255,0.03), transparent); display: flex; flex-direction: column; gap: 6px; }
        .ws-stat-label { font-size: 0.68rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .ws-stat-value { font-size: 0.85rem; font-weight: 600; color: #e6edf3; word-break: break-all; }
        .ws-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.78rem; }
        .ws-text-muted { color: var(--text-muted); }

        /* ── Capabilities ── */
        .ws-cap-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
        .ws-bind-row { display: flex; gap: 8px; align-items: center; }
        .ws-bind-select { padding: 8px 14px; padding-right: 36px; border: 1px solid var(--glass-border); border-radius: 8px; background: var(--bg-base); color: var(--text-primary); font: inherit; font-size: 0.82rem; appearance: none; -webkit-appearance: none; cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; background-size: 12px; transition: border-color 0.2s, box-shadow 0.2s; }
        .ws-bind-select:hover { border-color: var(--glass-border-hover); background: rgba(255,255,255,0.02); }
        .ws-bind-select:focus { border-color: var(--accent-cyan); box-shadow: 0 0 0 3px rgba(16,163,127,0.14); outline: none; }
        .ws-bind-select option { background: var(--bg-card); color: var(--text-primary); }
        .ws-wf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
        .ws-wf-card { padding: 18px; border: 1px solid var(--glass-border); border-radius: var(--radius-xl); background: linear-gradient(145deg, var(--bg-base), rgba(0,0,0,0.2)); display: flex; align-items: center; justify-content: space-between; gap: 16px; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .ws-wf-card:hover { border-color: var(--glass-border-hover); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
        .ws-wf-card-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .ws-wf-card-info strong { font-size: 0.9rem; font-weight: 600; color: #e6edf3; }
        .ws-wf-card-info span { font-size: 0.72rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* ── Binding Grid (Skills / MCP) ── */
        .ws-binding-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; margin-top: 16px; }
        .ws-binding-card { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border: 1px solid var(--glass-border); border-radius: var(--radius-xl); background: linear-gradient(145deg, var(--bg-base), rgba(0,0,0,0.2)); cursor: default; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .ws-binding-card:hover { border-color: rgba(255,255,255,0.15); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
        .ws-binding-card.bound { border-color: rgba(16,163,127,0.3); background: linear-gradient(145deg, rgba(16,163,127,0.08), rgba(16,163,127,0.02)); box-shadow: 0 0 0 1px rgba(16,163,127,0.1), 0 4px 12px rgba(0,0,0,0.1); }
        .ws-binding-card.bound:hover { border-color: rgba(16,163,127,0.5); box-shadow: 0 0 0 1px rgba(16,163,127,0.2), 0 8px 24px rgba(0,0,0,0.2); }
        .ws-binding-card input[type="checkbox"] { accent-color: var(--accent-cyan); flex-shrink: 0; width: 16px; height: 16px; }
        .ws-binding-card-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
        .ws-binding-card-info strong { font-size: 0.9rem; font-weight: 600; color: #e6edf3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ws-binding-card-info span { font-size: 0.72rem; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ws-binding-card::before { content: ''; display: block; width: 4px; height: 100%; background: var(--accent-cyan); position: absolute; left: 0; top: 0; border-radius: 4px 0 0 4px; opacity: 0; transition: opacity 0.2s; }
        .ws-binding-card.bound::before { opacity: 1; }
        .ws-binding-card { position: relative; overflow: hidden; }

        /* ── Shared ── */
        .ws-error { margin: 0; color: var(--status-red); font-size: 0.82rem; }
        .ws-empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 16px; color: var(--text-muted); text-align: center; }
        .ws-empty-state p { margin: 0; font-size: 0.82rem; }

        /* ── Responsive ── */
        @media (max-width: 960px) {
          .ws { padding: 20px; }
          .ws-profile-grid { grid-template-columns: 1fr; }
          .ws-form-fields { grid-template-columns: 1fr; }
          .ws-readonly-grid { grid-template-columns: 1fr 1fr; }
          .ws-binding-grid { grid-template-columns: 1fr; }
        }

        /* ── Save Confirm Dialog ── */
        .sp-confirm-overlay {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(6px);
          animation: sp-overlay-in 0.18s ease;
        }
        @keyframes sp-overlay-in { from { opacity: 0; } to { opacity: 1; } }

        .sp-confirm-dialog {
          background: var(--bg-card, #1e1e2e);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-xl, 14px);
          padding: 32px 32px 26px;
          min-width: 360px; max-width: 420px;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
          animation: sp-dialog-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          display: flex; flex-direction: column; align-items: center;
          text-align: center;
        }
        @keyframes sp-dialog-in {
          from { opacity: 0; transform: scale(0.92) translateY(10px); }
          to   { opacity: 1; transform: none; }
        }

        .sp-confirm-icon {
          width: 52px; height: 52px;
          border-radius: 14px;
          background: rgba(16, 163, 127, 0.1);
          border: 1px solid rgba(16, 163, 127, 0.2);
          display: flex; align-items: center; justify-content: center;
          color: var(--accent-cyan, #10a37f);
          margin-bottom: 18px;
          flex-shrink: 0;
        }

        .sp-confirm-message {
          margin: 0 0 6px;
          font-size: 15px; font-weight: 600;
          color: var(--text-primary);
          line-height: 1.45;
        }

        .sp-confirm-hint {
          margin: 0 0 24px;
          font-size: 13px;
          color: var(--text-muted);
          line-height: 1.5;
        }

        .sp-confirm-actions {
          display: flex; gap: 12px; width: 100%;
        }

        .sp-confirm-cancel, .sp-confirm-ok {
          flex: 1;
          padding: 10px 20px;
          border-radius: var(--radius-md, 7px);
          font-size: 13px; font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          border: 1px solid var(--glass-border);
        }

        .sp-confirm-cancel {
          background: transparent;
          color: var(--text-secondary);
        }
        .sp-confirm-cancel:hover {
          background: var(--glass-reflection);
          color: var(--text-primary);
        }

        .sp-confirm-ok {
          background: linear-gradient(135deg, var(--accent-cyan, #10a37f), #0d8a6a);
          color: #fff;
          border-color: transparent;
          box-shadow: 0 2px 8px rgba(16, 163, 127, 0.3);
        }
        .sp-confirm-ok:hover {
          background: linear-gradient(135deg, #0ea882, #0b7a5e);
          box-shadow: 0 4px 16px rgba(16, 163, 127, 0.4);
          transform: translateY(-1px);
        }
      `}</style>
    </main>
  );
}

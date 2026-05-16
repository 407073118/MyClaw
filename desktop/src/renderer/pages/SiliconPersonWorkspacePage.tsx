import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  Archive,
  ChevronLeft,
  Clock,
  ListTodo,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plug,
  RotateCcw,
  Save,
  Send,
  Trash2,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";
import type { ApprovalDecision, ApprovalRequest, ArtifactScopeRef, ExecutionRun, McpServer, ModelProfile, ScheduleJob, SiliconPersonApprovalMode, SkillDefinition, Task } from "@shared/contracts";
import MarkdownView from "../components/MarkdownView";
import ReasoningPresetPanel from "../components/ReasoningPresetPanel";
import WorkFilesPanel from "../components/WorkFilesPanel";
import ScheduleJobEditor, { type ScheduleJobEditorSubmitInput } from "../components/time/ScheduleJobEditor";
import { useWorkspaceStore } from "../stores/workspace";
import { formatJobFrequency } from "../utils/frequency";
import { buildModelRuntimeStatusItems } from "../utils/model-profile-display";
import { resolveReasoningControlSpec } from "../utils/reasoning-controls";
import { formatMessageTime, formatFullTime, formatDateSeparator, isDifferentDay } from "../utils/format-time";

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

/** 把定时任务状态映射成员工工作台可读的中文标签。 */
function scheduleJobStatusLabel(status: string): string {
  return ({
    scheduled: "已排期",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  } as Record<string, string>)[status] ?? status;
}

/** 把定时任务执行器映射成用户能理解的中文动作。 */
function scheduleJobExecutorLabel(executor: ScheduleJob["executor"]): string {
  return ({
    assistant_prompt: "定时提示词",
    workflow: "定时跑工作流",
    silicon_person: "定时派发给员工",
  } as Record<ScheduleJob["executor"], string>)[executor] ?? executor;
}

/** 生成最近一次运行的短回执，优先展示失败原因。 */
function latestScheduleRunLabel(run?: ExecutionRun): string {
  if (!run) return "上次运行：尚未运行";
  if (run.status === "failed") return `上次失败${run.errorMessage ? ` · ${run.errorMessage}` : ""}`;
  if (run.status === "succeeded") return `上次成功${run.outputSummary ? ` · ${run.outputSummary}` : ""}`;
  if (run.status === "running") return "上次运行：执行中";
  return "上次运行：已取消";
}

/** 根据执行记录构建每个定时任务的最近一次运行索引。 */
function buildLatestRunByJobId(runs: ExecutionRun[]): Map<string, ExecutionRun> {
  const result = new Map<string, ExecutionRun>();
  runs.forEach((run) => {
    const current = result.get(run.jobId);
    if (!current || Date.parse(run.startedAt) > Date.parse(current.startedAt)) {
      result.set(run.jobId, run);
    }
  });
  return result;
}

type StatusVariant = "green" | "red" | "yellow" | "accent" | "muted";

const SILICON_STATUS_VARIANT: Record<string, StatusVariant> = {
  idle: "muted",
  running: "accent",
  needs_approval: "yellow",
  done: "green",
  error: "red",
  canceling: "yellow",
  canceled: "muted",
};

/** 把硅基员工状态映射到规范的 .status-dot 变体。 */
function statusDotVariant(status: string): StatusVariant {
  return SILICON_STATUS_VARIANT[status] ?? "muted";
}

/** 把硅基员工状态映射到规范的 .tag 变体。 */
function tagStatusVariant(status: string): StatusVariant {
  return SILICON_STATUS_VARIANT[status] ?? "muted";
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
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [activeStudioTab, setActiveStudioTab] = useState<"chat" | "profile" | "tasks" | "capabilities">("chat");
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const saveDialogRef = useRef<HTMLDivElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [chosenJobType, setChosenJobType] = useState<"workflow" | "silicon_person" | null>(null);
  const [editingJob, setEditingJob] = useState<ScheduleJob | null>(null);

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
  const boundWorkflowOptions = useMemo(
    () => boundWorkflows.map(({ workflowId, summary }) => ({ id: workflowId, name: summary.name })),
    [boundWorkflows],
  );
  const modelOptions = useMemo(
    () => workspace.models.map((m) => ({ id: m.id, name: m.name })),
    [workspace.models],
  );
  const siliconPersonScheduleJobs = useMemo(
    () =>
      workspace.time.scheduleJobs.filter((job) => job.ownerScope === "silicon_person" && job.ownerId === siliconPersonId),
    [workspace.time.scheduleJobs, siliconPersonId, viewVersion],
  );
  const latestRunByJobId = useMemo(
    () => buildLatestRunByJobId(workspace.time.executionRuns),
    [workspace.time.executionRuns, viewVersion],
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

  // 保存确认 modal 打开时：聚焦确认按钮、ESC 关闭、Enter 提交、Tab 焦点陷阱、关闭后还原焦点。
  useEffect(() => {
    if (!showSaveConfirm) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    confirmBtnRef.current?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowSaveConfirm(false);
        return;
      }
      if (event.key === "Enter" && !isSaving) {
        const target = event.target as HTMLElement | null;
        if (target !== cancelBtnRef.current) {
          event.preventDefault();
          void handleSave();
        }
        return;
      }
      if (event.key === "Tab") {
        const focusable = [cancelBtnRef.current, confirmBtnRef.current].filter(Boolean) as HTMLButtonElement[];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previouslyFocused?.focus?.();
    };
  }, [showSaveConfirm, isSaving]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /** 为当前硅基员工创建或更新定时任务，统一复用时间规划存储并保留员工归属。 */
  async function handleSaveScheduleJob(input: ScheduleJobEditorSubmitInput, mode: "create" | "update") {
    console.info("[硅基员工工作台] 保存员工定时任务", {
      mode,
      siliconPersonId,
      title: input.title,
      executor: input.executor,
      executorTargetId: input.executorTargetId ?? null,
      scheduleKind: input.scheduleKind,
    });
    if (mode === "update" && editingJob) {
      await workspace.updateScheduleJob({
        ...editingJob,
        ownerScope: "silicon_person",
        ownerId: siliconPersonId,
        title: input.title,
        description: input.description,
        scheduleKind: input.scheduleKind,
        timezone: input.timezone,
        startsAt: input.startsAt,
        intervalMinutes: input.intervalMinutes,
        cronExpression: input.cronExpression,
        executor: input.executor,
        executorTargetId: input.executorTargetId,
        modelProfileId: input.modelProfileId,
        reasoningEffort: input.reasoningEffort,
        reasoningEnabled: input.reasoningEnabled,
        sessionMode: input.sessionMode ?? editingJob.sessionMode,
        nextRunAt: input.startsAt ?? editingJob.nextRunAt,
      });
    } else {
      await workspace.createScheduleJob({
        kind: "schedule_job",
        title: input.title,
        description: input.description,
        scheduleKind: input.scheduleKind,
        timezone: input.timezone,
        ownerScope: "silicon_person",
        ownerId: siliconPersonId,
        status: "scheduled",
        source: "manual",
        startsAt: input.startsAt,
        intervalMinutes: input.intervalMinutes,
        cronExpression: input.cronExpression,
        executor: input.executor,
        executorTargetId: input.executorTargetId,
        modelProfileId: input.modelProfileId,
        reasoningEffort: input.reasoningEffort,
        reasoningEnabled: input.reasoningEnabled,
        sessionMode: input.sessionMode,
        nextRunAt: input.startsAt,
      });
    }
    setChosenJobType(null);
    setEditingJob(null);
  }

  /** 打开员工定时任务编辑器，保留当前任务上下文。 */
  function handleEditScheduleJob(job: ScheduleJob) {
    console.info("[硅基员工工作台] 编辑员工定时任务", { siliconPersonId, jobId: job.id, executor: job.executor });
    setEditingJob(job);
    setChosenJobType(job.executor === "workflow" ? "workflow" : "silicon_person");
  }

  /** 删除员工定时任务，并把删除动作记录到控制台便于排查。 */
  async function handleDeleteScheduleJob(jobId: string) {
    console.info("[硅基员工工作台] 删除员工定时任务", { siliconPersonId, jobId });
    await workspace.deleteScheduleJob(jobId);
  }

  /** 立即触发员工定时任务，用于列表内快速验证派发效果。 */
  async function handleExecuteScheduleJobNow(jobId: string) {
    console.info("[硅基员工工作台] 立即执行员工定时任务", { siliconPersonId, jobId });
    await workspace.executeScheduleJobNow(jobId);
  }

  /** 暂停或恢复员工定时任务，保持列表内可以直接干预后台自动化。 */
  async function handleToggleScheduleJob(job: ScheduleJob) {
    const nextStatus = job.status === "paused" ? "scheduled" : "paused";
    console.info("[硅基员工工作台] 切换员工定时任务状态", {
      siliconPersonId,
      jobId: job.id,
      from: job.status,
      to: nextStatus,
    });
    await workspace.updateScheduleJob({ ...job, status: nextStatus });
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
      setSessionError(error instanceof Error ? error.message : "创建硅基员工会话失败。");
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

  /** 删除指定硅基员工会话，并同步刷新该员工配置用于更新会话列表。 */
  async function handleDeleteSession(sessionId: string) {
    if (!siliconPersonId || !siliconPerson) return;
    if (deletingSessionId) return;

    const targetSession = siliconPerson.sessions.find((item) => item.id === sessionId);
    if (!targetSession) {
      setSessionError("当前会话不存在或已被移除，无法删除。");
      return;
    }
    const targetTitle = targetSession?.title ?? `会话 ${sessionId.slice(0, 8)}`;

    if (!window.confirm(`确认要删除「${targetTitle}」吗？`)) {
      return;
    }

    setSessionError("");
    setDeletingSessionId(sessionId);
    try {
      console.info("[silicon-person-studio] 请求删除会话", {
        siliconPersonId,
        sessionId,
      });
      await workspace.deleteSession(sessionId);
      await workspace.loadSiliconPersonById(siliconPersonId);
      const latestPerson = useWorkspaceStore.getState().siliconPersons.find((item) => item.id === siliconPersonId) ?? null;
      if (currentSessionSummary?.id === sessionId) {
        const fallbackSession = latestPerson?.sessions.find((item) => item.id !== sessionId);
        if (fallbackSession) {
          await workspace.switchSiliconPersonSession(siliconPersonId, fallbackSession.id);
        }
      }
      if (currentSessionSummary?.id === sessionId) {
        setDraftMessage("");
      }
      setViewVersion((value) => value + 1);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "删除硅基员工会话失败。");
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function handleSendMessage() {
    if (!siliconPersonId) return;
    const content = draftMessage.trim();
    if (!content) return;

    setSessionError("");
    setIsSending(true);
    try {
      console.info("[silicon-person-studio] 请求删除当前会话及其消息", {
        siliconPersonId,
        sessionId: currentSessionSummary?.id ?? null,
        contentLength: content.length,
      });
      await workspace.sendSiliconPersonMessage(siliconPersonId, content);
      setDraftMessage("");
      setViewVersion((value) => value + 1);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "删除硅基员工会话失败。");
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

  const sourceLabel: Record<string, string> = {
    personal: "个人创建", enterprise: "企业分发", hub: "Hub 导入",
  };

  return (
    <div className="page-shell" data-testid="silicon-person-studio-view">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <Users size={14} aria-hidden />
            <span>硅基员工工作台</span>
          </div>
          <div className="page-header__title-row">
            <h2 className="page-header__title">{draftName || siliconPerson?.name || "硅基员工"}</h2>
            {siliconPerson && (
              <span
                className={`status-dot status-dot--${statusDotVariant(siliconPerson.status)}`}
                title={siliconPersonStatusLabel(siliconPerson.status)}
              />
            )}
          </div>
          <p className="page-header__subtitle">
            {draftTitle || siliconPerson?.title || "管理这个硅基员工的会话、能力与定时任务。"}
          </p>
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className="btn-toolbar"
            data-testid="ws-back-btn"
            onClick={() => navigate("/employees")}
            title="返回硅基员工列表"
          >
            <ChevronLeft size={14} aria-hidden />
            返回
          </button>
          {siliconPerson && (
            <button
              type="button"
              className="btn-primary"
              data-testid="profile-tab-save"
              onClick={() => setShowSaveConfirm(true)}
              disabled={isSaving}
            >
              <Save size={14} aria-hidden />
              {isSaving ? "保存中..." : "保存"}
            </button>
          )}
        </div>
      </header>

      <main className="page-content">
        <nav className="ws-tabs" data-testid="studio-tab-bar">
          {([
            ["chat", "聊天"],
            ["profile", "配置"],
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

        {saveError && (
          <div className="banner banner--error" role="alert">
            <AlertCircle size={16} aria-hidden />
            <span>{saveError}</span>
          </div>
        )}

        {siliconPerson && (
          <div className="ws-meta-row">
            <div className="ws-meta-tags">
              <span className={`tag tag--${tagStatusVariant(siliconPerson.status)}`}>
                {siliconPersonStatusLabel(siliconPerson.status)}
              </span>
              <span className="tag tag--muted">{sourceLabel[siliconPerson.source] ?? siliconPerson.source}</span>
            </div>
            <div className="ws-meta-stats" aria-label="工作台概览">
              <span className="ws-meta-stat">
                <strong>{siliconPerson.sessions.length}</strong>
                <span>会话</span>
              </span>
              <span className="ws-meta-stat-sep" aria-hidden />
              <span className="ws-meta-stat">
                <strong>{siliconPerson.workflowIds.length}</strong>
                <span>工作流</span>
              </span>
            </div>
            {(siliconPerson.hasUnread || siliconPerson.needsApproval) && (
              <div className="ws-meta-alerts">
                {siliconPerson.hasUnread && (
                  <span className="tag tag--accent">{siliconPerson.unreadCount} 未读</span>
                )}
                {siliconPerson.needsApproval && <span className="tag tag--yellow">待审批</span>}
              </div>
            )}
          </div>
        )}

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
                <div className="ws-session-pills" role="tablist" aria-label="硅基员工会话">
                    {siliconPerson.sessions.map((session) => {
                      const isActive = currentSessionSummary?.id === session.id;
                      const isDeleting = deletingSessionId === session.id;
                      return (
                        <div className="ws-session-row" key={session.id}>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            className={`ws-session-pill${isActive ? " is-active" : ""}`}
                            data-testid={`silicon-person-session-pill-${session.id}`}
                            onClick={() => void handleSwitchSession(session.id)}
                            disabled={isDeleting}
                          >
                            <span className="ws-session-pill__label">{session.title || "未命名会话"}</span>
                            {session.needsApproval && <span className="ws-session-badge warn">!</span>}
                            {session.unreadCount > 0 && !session.needsApproval && (
                              <span className="ws-session-badge">{session.unreadCount > 9 ? "9+" : session.unreadCount}</span>
                            )}
                          </button>
                          <button
                            type="button"
                            className="ws-session-delete"
                            aria-label={`删除会话 ${session.title || "未命名会话"}`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleDeleteSession(session.id);
                            }}
                            disabled={isDeleting}
                          >
                            {isDeleting ? <span aria-hidden>...</span> : <Trash2 size={12} aria-hidden />}
                          </button>
                        </div>
                      );
                    })}
                </div>
                <button
                  type="button"
                  className="btn-toolbar"
                  data-testid="silicon-person-create-session"
                  onClick={() => void handleCreateSession()}
                  disabled={isCreatingSession}
                >
                  {isCreatingSession ? "新建中..." : "新建会话"}
                </button>
              </div>

              {sessionError && (
                <div className="banner banner--error" role="alert">
                  <AlertCircle size={16} aria-hidden />
                  <span>{sessionError}</span>
                </div>
              )}
              {!currentSessionSummary && (
                <section className="empty-state empty-state--minimal">
                  <MessageSquare size={32} className="empty-state__icon" aria-hidden />
                  <h3 className="empty-state__title">还没有可用会话</h3>
                  <p className="empty-state__body">先新建一个会话开始协作。</p>
                </section>
              )}

              {currentSessionSummary && (
                <>
                <div className="ws-section">
                    <h4>当前会话</h4>
                    <div className="ws-meta-row ws-meta-row--inline">
                      <span className="ws-meta-name" title={currentSessionSummary.title || "未命名会话"}>
                        {currentSessionSummary.title || "未命名会话"}
                      </span>
                      <span className="ws-meta-stat-sep" aria-hidden />
                      <span className="ws-meta-stat">
                        <strong>{currentSessionMessages.length}</strong>
                        <span>条消息</span>
                      </span>
                      {currentSessionSummary.hasUnread && (
                        <span className="tag tag--accent ws-meta-alert">
                          {currentSessionSummary.unreadCount} 未读
                        </span>
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
                               <article className={`message-row role-${message.role}`}>
                                 <div className="message-avatar" aria-hidden>
                                   {message.role === "user" ? "我" : message.role === "assistant" ? "AI" : message.role === "tool" ? "T" : "S"}
                                 </div>
                                 <div className="message-body">
                                   <div className="message-header">
                                     <span>{roleLabel(message.role)}</span>
                                     {typeof message.createdAt === "string" && (
                                       <span className="message-time" title={formatFullTime(message.createdAt)}>
                                         {formatMessageTime(message.createdAt)}
                                       </span>
                                     )}
                                   </div>
                                   {(() => {
                                     const renderedMessage = (message as { renderedHtml?: string }).renderedHtml
                                       ?? textOf(message.content);
                                     return renderedMessage ? (
                                       <MarkdownView source={renderedMessage} className="message-content" />
                                     ) : (
                                       <div className="message-content">
                                         <p>暂不支持展示的消息内容</p>
                                       </div>
                                     );
                                   })()}
                                 </div>
                               </article>
                             </React.Fragment>
                           );
                      })}
                      </div>
                    ) : (
                      <section className="empty-state empty-state--minimal">
                        <MessageSquare size={32} className="empty-state__icon" aria-hidden />
                        <h3 className="empty-state__title">还没有历史消息</h3>
                        <p className="empty-state__body">直接发一条消息开始协作。</p>
                      </section>
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
                              <button type="button" className="btn-primary" onClick={() => void handleResolveApproval(request.id, "allow-once")}>批准</button>
                              <button type="button" className="btn-ghost btn-ghost--danger" onClick={() => void handleResolveApproval(request.id, "deny")}>拒绝</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {approvalError && (
                    <div className="banner banner--error" role="alert">
                      <AlertCircle size={16} aria-hidden />
                      <span>{approvalError}</span>
                    </div>
                  )}

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
                      className="btn-primary"
                      data-testid="silicon-person-composer-send"
                      onClick={() => void handleSendMessage()}
                      disabled={isSending || draftMessage.trim().length === 0}
                    >
                      <Send size={14} aria-hidden />
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
                <h3>人格画像</h3>
                <div className="ws-form-fields">
                  <label className="ws-field ws-field--full">
                    <span>人格定义</span>
                    <textarea value={draftSoul} onChange={(e) => setDraftSoul(e.target.value)} data-testid="profile-tab-soul" rows={6} placeholder="定义这个硅基员工的行为特点和人格风格。示例：这是一个偏向严谨、善于数据分析、回答稳定可复现的助手。" />
                  </label>
                </div>
              </div>

              {/* 模型与策略 */}
              <div className="ws-card ws-form-card" data-testid="profile-model-form">
                <h3>模型参数</h3>
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
                    <span className="ws-stat-label">更新时间</span>
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
                      <span className={`tag tag--${task.status === "completed" ? "green" : task.status === "in_progress" ? "accent" : "muted"}`}>{taskStatusLabel(task.status)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <section className="empty-state empty-state--minimal" style={{ marginTop: 16 }}>
                  <ListTodo size={32} className="empty-state__icon" aria-hidden />
                  <h3 className="empty-state__title">暂无任务</h3>
                  <p className="empty-state__body">当前会话暂无任务记录</p>
                </section>
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
                  <p className="ws-card-desc">硅基员工工作台支持的 Skills，可从 Hub 安装。</p>
                </div>
                <button
                  type="button"
                  className="btn-toolbar"
                  onClick={() => void loadPersonResources()}
                >
                  刷新
                </button>
              </div>
              {personSkills.length > 0 ? (
                <div className="list-rows">
                  {personSkills.map((skill) => (
                    <article key={skill.id} className="list-row list-row--with-description">
                      <div className="list-row__lead">
                        <Wrench size={16} aria-hidden />
                      </div>
                      <div className="list-row__main">
                        <div className="list-row__title-row">
                          <span className="list-row__title">{skill.name}</span>
                          <span className="tag tag--accent">系统内置</span>
                        </div>
                        <div className="list-row__description">{skill.description || skill.id}</div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <section className="empty-state empty-state--minimal">
                  <Wrench size={32} className="empty-state__icon" aria-hidden />
                  <h3 className="empty-state__title">还没有 Skills</h3>
                  <p className="empty-state__body">员工工作空间中还没有 Skills，可从 Hub 安装。</p>
                </section>
              )}
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
                  className="btn-toolbar"
                  onClick={() => void loadPersonResources()}
                >
                  刷新
                </button>
              </div>
              {personMcpServers.length > 0 ? (
                <div className="list-rows">
                  {personMcpServers.map((server) => (
                    <article key={server.id} className="list-row list-row--with-description">
                      <div className="list-row__lead">
                        <Plug size={16} aria-hidden />
                      </div>
                      <div className="list-row__main">
                        <div className="list-row__title-row">
                          <span className="list-row__title">{server.name}</span>
                          <span className={`tag tag--${server.state?.connected ? "green" : "muted"}`}>
                            {server.state?.connected ? "已连接" : "未连接"}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <section className="empty-state empty-state--minimal">
                  <Plug size={32} className="empty-state__icon" aria-hidden />
                  <h3 className="empty-state__title">还没有 MCP 服务</h3>
                  <p className="empty-state__body">员工工作空间中还没有 MCP 服务，可从 Hub 安装。</p>
                </section>
              )}
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
                  <button data-testid="employee-studio-bind-workflow" className="btn-toolbar" type="button" onClick={bindWorkflow}>
                    绑定
                  </button>
                </div>
              </div>

              {boundWorkflows.length > 0 ? (
                <div className="list-rows">
                  {boundWorkflows.map(({ workflowId, summary }) => (
                    <article key={workflowId} className="list-row list-row--with-description" data-testid={`silicon-person-workflow-binding-${workflowId}`}>
                      <div className="list-row__lead">
                        <Workflow size={16} aria-hidden />
                      </div>
                      <div className="list-row__main">
                        <div className="list-row__title-row">
                          <span className="list-row__title">{summary.name}</span>
                        </div>
                        <div className="list-row__description ws-mono">{workflowId}</div>
                      </div>
                      <div className="list-row__trailing">
                        <button
                          type="button"
                          className="btn-toolbar"
                          data-testid={`silicon-person-workflow-start-${workflowId}`}
                          onClick={() => void handleStartWorkflowRun(workflowId)}
                        >
                          <Play size={14} aria-hidden />
                          启动运行
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <section className="empty-state empty-state--minimal" style={{ marginTop: 16 }}>
                  <Workflow size={32} className="empty-state__icon" aria-hidden />
                  <h3 className="empty-state__title">还没有绑定工作流</h3>
                  <p className="empty-state__body">从下拉中选择并点击绑定。</p>
                </section>
              )}
            </article>

            <article className="ws-card">
              <div className="ws-cap-header">
                <div>
                  <h3>定时任务</h3>
                  <p className="ws-card-desc">给该员工安排可确认、可追踪的定时工作。</p>
                </div>
                <span className="tag tag--muted">工作时段 {siliconPersonWorkingHoursSummary}</span>
              </div>

              {!chosenJobType ? (
                <div className="ws-schedule-type-picker">
                  <button
                    type="button"
                    className="ws-schedule-type-btn"
                    aria-label="定时跑工作流"
                    onClick={() => setChosenJobType("workflow")}
                  >
                    <Workflow size={16} aria-hidden />
                    <span>定时跑工作流</span>
                    <span className="ws-schedule-type-desc">周期执行绑定的 Workflow</span>
                  </button>
                  <button
                    type="button"
                    className="ws-schedule-type-btn"
                    aria-label="定时派发给员工"
                    onClick={() => setChosenJobType("silicon_person")}
                  >
                    <MessageSquare size={16} aria-hidden />
                    <span>定时派发给员工</span>
                    <span className="ws-schedule-type-desc">到点向当前员工发送工作指令</span>
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 16 }}>
                  <div className="ws-schedule-type-chips">
                    <button
                      type="button"
                      className={chosenJobType === "workflow" ? "ws-type-chip is-active" : "ws-type-chip"}
                      onClick={() => setChosenJobType("workflow")}
                    >
                      <Workflow size={14} aria-hidden />
                      定时跑工作流
                    </button>
                    <button
                      type="button"
                      className={chosenJobType === "silicon_person" ? "ws-type-chip is-active" : "ws-type-chip"}
                      onClick={() => setChosenJobType("silicon_person")}
                    >
                      <MessageSquare size={14} aria-hidden />
                      定时派发给员工
                    </button>
                    <button
                      type="button"
                      className="ws-type-chip ws-type-chip--close"
                      onClick={() => { setChosenJobType(null); setEditingJob(null); }}
                    >
                      收起
                    </button>
                  </div>
                  <ScheduleJobEditor
                    timezone={workspace.time.availabilityPolicy?.timezone ?? "Asia/Shanghai"}
                    executor={chosenJobType}
                    initialJob={editingJob ?? undefined}
                    workflows={boundWorkflowOptions}
                    siliconPersons={siliconPerson ? [{ id: siliconPersonId, name: siliconPerson.name }] : []}
                    modelOptions={modelOptions}
                    ownerScope="silicon_person"
                    ownerId={siliconPersonId}
                    hideSiliconPersonSelector={chosenJobType === "silicon_person"}
                    siliconPersonContextName={siliconPerson?.name}
                    onSave={(_input, _mode) => void handleSaveScheduleJob(_input, _mode)}
                    onCancel={() => { setChosenJobType(null); setEditingJob(null); }}
                  />
                </div>
              )}

              {siliconPersonScheduleJobs.length > 0 ? (
                <div className="list-rows" style={{ marginTop: 16 }}>
                  {siliconPersonScheduleJobs.map((job) => {
                    const latestRun = latestRunByJobId.get(job.id);
                    return (
                      <article key={job.id} className="list-row list-row--with-description" aria-label={`${job.title} 定时任务`}>
                        <div className="list-row__lead">
                          <Clock size={16} aria-hidden />
                        </div>
                        <div className="list-row__main">
                          <div className="list-row__title-row">
                            <span className="list-row__title">{job.title}</span>
                            <span className={`tag job-type-chip job-type-chip--${job.executor}`}>
                              {scheduleJobExecutorLabel(job.executor)}
                            </span>
                            <span className={`tag ${job.status === "failed" ? "tag--danger" : "tag--muted"}`}>
                              {scheduleJobStatusLabel(job.status)}
                            </span>
                          </div>
                          <div className="list-row__description">
                            <span>{formatJobFrequency(job, formatFullTime)}</span>
                            <span> · </span>
                            <span>{job.nextRunAt ? `下次执行 ${formatFullTime(job.nextRunAt)}` : "等待下一次执行"}</span>
                            <span> · </span>
                            <span className={latestRun?.status === "failed" ? "ws-run-receipt is-warning" : "ws-run-receipt"}>
                              {latestScheduleRunLabel(latestRun)}
                            </span>
                            {job.description ? <span> · {job.description.slice(0, 60)}{job.description.length > 60 ? "…" : ""}</span> : null}
                          </div>
                        </div>
                        <div className="list-row__trailing">
                          <button
                            type="button"
                            className="btn-toolbar"
                            aria-label={`立即运行 ${job.title}`}
                            title="立即运行"
                            onClick={() => void handleExecuteScheduleJobNow(job.id)}
                          >
                            <Play size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="btn-toolbar"
                            aria-label={job.status === "paused" ? `恢复 ${job.title}` : `暂停 ${job.title}`}
                            title={job.status === "paused" ? "恢复" : "暂停"}
                            onClick={() => void handleToggleScheduleJob(job)}
                          >
                            {job.status === "paused" ? <RotateCcw size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
                          </button>
                          <button
                            type="button"
                            className="btn-toolbar"
                            aria-label={`编辑 ${job.title}`}
                            title="编辑"
                            onClick={() => handleEditScheduleJob(job)}
                          >
                            <Pencil size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="btn-toolbar btn-toolbar--danger"
                            aria-label={`删除 ${job.title}`}
                            title="删除"
                            onClick={() => void handleDeleteScheduleJob(job.id)}
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <section className="empty-state empty-state--minimal" style={{ marginTop: 16 }}>
                  <Clock size={32} className="empty-state__icon" aria-hidden />
                  <h3 className="empty-state__title">暂无定时任务</h3>
                  <p className="empty-state__body">给该员工安排定时跑工作流或定时派发消息。</p>
                </section>
              )}
            </article>

            {boundWorkflowRuns.length > 0 && (
              <article className="ws-card">
                <h3>运行记录</h3>
                <div className="list-rows" style={{ marginTop: 12 }}>
                  {boundWorkflowRuns.map((run) => (
                    <article key={run.id} className="list-row list-row--with-description" data-testid={`silicon-person-workflow-run-${run.id}`}>
                      <div className="list-row__lead">
                        <Activity size={16} aria-hidden />
                      </div>
                      <div className="list-row__main">
                        <div className="list-row__title-row">
                          <span className="list-row__title">{run.workflowId}</span>
                          <span className="tag tag--muted">{workflowRunStatusLabel(run.status)}</span>
                        </div>
                        <div className="list-row__description">
                          v{run.workflowVersion} · {run.updatedAt}{run.error ? ` · 失败：${run.error}` : ""}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </article>
            )}

          </section>
        )}

      </section>

      </main>

      {/* 保存确认弹窗 */}
      {showSaveConfirm && (
        <div
          className="sp-confirm-overlay"
          role="presentation"
          onClick={() => setShowSaveConfirm(false)}
        >
          <div
            ref={saveDialogRef}
            className="sp-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sp-confirm-title"
            aria-describedby="sp-confirm-hint"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sp-confirm-icon">
              <Save size={24} aria-hidden />
            </div>
            <h3 id="sp-confirm-title" className="sp-confirm-message">确定保存“{draftName || siliconPerson?.name}”的配置修改？</h3>
            <p id="sp-confirm-hint" className="sp-confirm-hint">确认保存后请刷新会话列表和聊天区。</p>
            <div className="sp-confirm-actions">
              <button
                type="button"
                ref={cancelBtnRef}
                className="btn-toolbar"
                onClick={() => setShowSaveConfirm(false)}
              >
                取消
              </button>
              <button
                type="button"
                ref={confirmBtnRef}
                className="btn-primary"
                onClick={() => void handleSave()}
                disabled={isSaving}
              >
                <Save size={14} aria-hidden />
                确认保存
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        /* page-shell + page-header--sticky 接管整体页面骨架；下面只保留工作台内部子组件的局部样式。 */

        /* ── Header title + status dot 对齐（page-header 没定义这个 sub-class）── */
        .page-header__title-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .page-header__title-row .page-header__title { margin: 0; }

        /* ── Tabs（桌面 segmented underline，13px / 600，去 uppercase）── */
        .ws-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--glass-border); margin-bottom: 16px; flex-shrink: 0; }
        .ws-tab { padding: 8px 14px; border: none; background: none; color: var(--text-muted); font-size: 13px; font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color 0.15s ease, border-color 0.15s ease; letter-spacing: 0; }
        .ws-tab:hover { color: var(--text-primary); }
        .ws-tab:focus-visible { outline: 2px solid var(--accent-cyan); outline-offset: 2px; border-radius: var(--radius-sm); }
        .ws-tab.active { color: var(--text-primary); font-weight: 600; border-bottom-color: var(--accent-cyan); }

        /* ── Meta Row（状态/来源 + 数量统计 + 警告徽章 三段式，桌面 stat strip）── */
        .ws-meta-row {
          display: flex; align-items: center; flex-wrap: wrap;
          gap: 14px;
          padding: 10px 0 14px;
          margin-bottom: 16px;
          border-bottom: 1px solid var(--glass-border);
        }
        .ws-meta-tags { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .ws-meta-stats { display: flex; align-items: center; gap: 12px; color: var(--text-muted); font-size: 12px; }
        .ws-meta-stat { display: inline-flex; align-items: baseline; gap: 5px; line-height: 1; }
        .ws-meta-stat strong { color: var(--text-primary); font-weight: 600; font-size: 13px; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
        .ws-meta-stat-sep { width: 3px; height: 3px; border-radius: 50%; background: rgba(255, 255, 255, 0.18); flex-shrink: 0; }
        .ws-meta-alerts { margin-left: auto; display: flex; gap: 6px; }
        /* inline 变体：聊天 tab 里"当前会话"行，没有上 border */
        .ws-meta-row--inline { padding: 0; margin-bottom: 0; border-bottom: none; gap: 10px; }
        .ws-meta-row--inline .ws-meta-name { font-size: 13px; font-weight: 500; color: var(--text-primary); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ws-meta-row--inline .ws-meta-alert { margin-left: auto; }

        /* ── Body Grid ── */
        .ws-body { display: flex; flex-direction: column; gap: 16px; flex: 1; min-height: 0; }
        .ws-col { display: flex; flex-direction: column; gap: 14px; }

        /* ── Card（紧凑桌面 panel，去 inner-glow / shadow，圆角降到 lg）── */
        .ws-card { border: 1px solid var(--glass-border); border-radius: var(--radius-lg); background: var(--bg-card); padding: 18px 20px; }
        .ws-card h3 { margin: 0 0 4px; color: var(--text-primary); font-size: 14px; font-weight: 600; letter-spacing: -0.005em; }
        .ws-card-desc { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }

        /* ── Session Bar ── */
        .ws-session-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
        .ws-session-pills { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; }
        .ws-session-pill {
          display: inline-flex; align-items: center; gap: 6px;
          max-width: 220px; min-width: 0;
          padding: 5px 12px;
          font-size: 12.5px; font-weight: 500;
          color: var(--text-secondary);
          background: var(--bg-surface);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }
        .ws-session-pill__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
        .ws-session-pill:hover { background: var(--bg-surface-hover); border-color: var(--glass-border-hover); color: var(--text-primary); }
        .ws-session-pill:focus-visible { outline: 2px solid var(--accent-cyan); outline-offset: 2px; }
        .ws-session-pill.is-active { background: rgba(16, 163, 127, 0.10); border-color: rgba(16, 163, 127, 0.32); color: var(--accent-cyan); }
        .ws-session-row { display: inline-flex; align-items: center; gap: 6px; flex: 0 1 auto; }
        .ws-session-delete {
          width: 30px;
          height: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid transparent;
          border-radius: var(--radius-md);
          color: var(--text-muted);
          background: transparent;
          cursor: pointer;
          opacity: 0.45;
          transition: all 0.2s ease;
          flex: 0 0 auto;
        }
        .ws-session-row:hover .ws-session-delete,
        .ws-session-delete:focus-visible { opacity: 1; }
        .ws-session-delete:hover:not(:disabled),
        .ws-session-delete:active:not(:disabled) {
          border-color: rgba(239, 68, 68, 0.3);
          color: #ef4444;
          background: rgba(239, 68, 68, 0.08);
        }
        .ws-session-delete:disabled { cursor: not-allowed; opacity: 0.4; }
        .ws-session-badge { min-width: 16px; height: 16px; border-radius: 999px; background: var(--accent-cyan); color: #fff; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; }
        .ws-session-badge.warn { background: var(--status-yellow); color: #000; }
        .ws-empty-hint { color: var(--text-muted); font-size: 12px; }

        /* ── Chat Card ── */
        .ws-chat-card { display: flex; flex-direction: column; gap: 0; }
        .ws-chat-header { margin-bottom: 14px; }
        .ws-chat-header h3 { margin: 0; }

        .ws-message-list { display: flex; flex-direction: column; gap: 24px; max-height: 440px; overflow-y: auto; padding-right: 4px; }
        .message-row { display: flex; align-items: flex-start; gap: 16px; width: 100%; }
        .message-avatar {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          background: var(--bg-card);
          border: 1px solid var(--glass-border);
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
          box-sizing: border-box;
        }
        .role-assistant .message-avatar { background: var(--glass-reflection); border-color: var(--glass-border); color: var(--accent-cyan); }
        .role-tool .message-avatar { color: #c4b5fd; border-color: rgba(196, 181, 253, 0.4); }
        .role-system .message-avatar { color: #f59e0b; border-color: rgba(245, 158, 11, 0.4); }
        .message-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
        .message-header {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 2px;
          display: flex;
          align-items: baseline;
          gap: 8px;
        }
        .message-time { font-size: 11px; font-weight: 400; color: var(--text-muted); cursor: default; }
        .message-content {
          line-height: 1.7;
          font-size: 14px;
          color: var(--text-primary);
          background: var(--bg-base);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-lg);
          padding: 10px 14px;
          margin: 0;
          min-width: 0;
          word-break: break-word;
        }
        .message-content p { margin: 0 0 16px; }
        .message-content p:last-child { margin-bottom: 0; }
        .message-content ul,
        .message-content ol { margin: 0 0 16px; padding-left: 24px; }
        .message-content li { margin-bottom: 6px; }
        .message-content code { background: var(--glass-reflection); padding: 3px 6px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.85em; color: var(--accent-cyan); }
        .message-content code:has(.inline-file-ref) {
          background: transparent;
          padding: 0;
        }
        .message-content pre { background: var(--bg-sidebar); padding: 16px; border-radius: var(--radius-lg); overflow-x: auto; margin: 16px 0; border: 1px solid var(--glass-border); }
        .message-content pre code { background: transparent; padding: 0; color: inherit; }
        .message-content .inline-file-ref {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-height: 20px;
          margin: 0 1px;
          padding: 1px 6px;
          border: 1px solid rgba(103, 232, 249, 0.18);
          border-radius: 5px;
          background: rgba(103, 232, 249, 0.07);
          color: var(--accent-cyan);
          font: inherit;
          font-size: 0.92em;
          cursor: pointer;
          vertical-align: baseline;
          white-space: nowrap;
          transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
        }
        .message-content .inline-file-ref::before {
          content: "";
          width: 7px;
          height: 9px;
          border: 1px solid currentColor;
          border-radius: 2px;
          opacity: 0.82;
          flex-shrink: 0;
        }
        .message-content .inline-file-ref:hover,
        .message-content .inline-file-ref:focus-visible {
          border-color: rgba(103, 232, 249, 0.5);
          background: rgba(103, 232, 249, 0.14);
          color: var(--text-primary);
          outline: none;
        }
        .message-content .inline-file-ref[data-state="loading"] {
          cursor: progress;
          opacity: 0.78;
        }
        .message-content .inline-file-ref[data-state="missing"] {
          border-color: rgba(248, 113, 113, 0.35);
          background: rgba(248, 113, 113, 0.08);
          color: #fca5a5;
        }
        .message-content a { color: var(--accent-cyan); text-decoration: underline; text-underline-offset: 2px; }
        .message-content h1, .message-content h2, .message-content h3 { margin: 24px 0 12px; color: var(--text-primary); font-weight: 600; }
        .message-content blockquote {
          border-left: 4px solid var(--accent-cyan);
          margin: 16px 0;
          padding: 8px 0 8px 16px;
          color: var(--text-secondary);
          background: var(--glass-reflection);
          border-radius: 0 var(--radius-md) var(--radius-md) 0;
        }
        .message-row.role-user { flex-direction: row-reverse; }
        .role-user .message-body { align-items: flex-end; max-width: 72%; }
        .role-user .message-header { justify-content: flex-end; margin-right: 0; }
        .role-user .message-avatar { background: transparent; border-color: var(--glass-border); color: var(--text-primary); }
        .role-user .message-content { background: rgba(16, 163, 127, 0.08); border-color: rgba(16, 163, 127, 0.3); }
        .role-system .message-content { background: rgba(245,158,11,0.06); border-color: rgba(245,158,11,0.22); }
        .role-tool .message-content { background: rgba(139,92,246,0.06); border-color: rgba(139,92,246,0.2); }
        .ws-date-separator { display: flex; align-items: center; gap: 12px; padding: 4px 0; }
        .ws-date-separator::before, .ws-date-separator::after { content: ""; flex: 1; height: 1px; background: var(--glass-border); }
        .ws-date-separator span { font-size: 11px; color: var(--text-muted); white-space: nowrap; }

        /* ── Sections inside chat（11px caps eyebrow，对齐 ui-style-guide 的 eyebrow 规则）── */
        .ws-section { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--glass-border); }
        .ws-section h4 { margin: 0 0 10px; font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }
        .ws-section--approval { background: rgba(245,158,11,0.03); margin: 16px -20px -18px; padding: 16px 20px 18px; border-radius: 0 0 var(--radius-lg) var(--radius-lg); border-top: 1px solid rgba(245,158,11,0.15); }

        /* ── Item list (non-list-row legacy: tasks tab) ── */
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

        /* ── Composer ── */
        .ws-composer { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--glass-border); display: flex; gap: 10px; align-items: flex-end; }
        .ws-composer textarea { flex: 1; border: 1px solid var(--glass-border); border-radius: var(--radius-lg); background: var(--bg-base); color: var(--text-primary); padding: 10px 14px; font: inherit; font-size: 0.85rem; resize: vertical; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
        .ws-composer textarea:focus { border-color: var(--accent-cyan); box-shadow: 0 0 0 3px rgba(16,163,127,0.14); outline: none; }

        /* ── Profile ── */
        .ws-profile-col { width: 100%; }
        .ws-profile-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }

        /* ── Form Card ── */
        .ws-form-card { display: flex; flex-direction: column; gap: 18px; }
        .ws-form-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .ws-model-status { display: flex; flex-wrap: wrap; gap: 8px; }
        .ws-model-status-pill { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 7px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: var(--text-secondary); font-size: 11px; font-weight: 600; line-height: 1; letter-spacing: 0.04em; white-space: nowrap; }
        .ws-model-status-pill--vendor, .ws-model-status-pill--protocol { color: var(--accent-strong); border-color: rgba(16,163,127,0.24); background: rgba(16,163,127,0.08); }
        .ws-field { display: flex; flex-direction: column; gap: 6px; }
        .ws-field span { font-size: 12px; font-weight: 500; color: var(--text-muted); letter-spacing: 0; }
        .ws-field--full { grid-column: 1 / -1; }
        .ws-field input, .ws-field textarea, .ws-field select { width: 100%; border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: rgba(0,0,0,0.15); color: var(--text-primary); padding: 10px 14px; font: inherit; font-size: 13px; transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease; box-sizing: border-box; }
        .ws-field input:hover, .ws-field textarea:hover, .ws-field select:hover { border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); }
        .ws-field input:focus, .ws-field textarea:focus, .ws-field select:focus { border-color: var(--accent-cyan); box-shadow: 0 0 0 3px rgba(16,163,127,0.15); outline: none; background: rgba(0,0,0,0.3); }
        .ws-field select { appearance: none; -webkit-appearance: none; padding-right: 36px; cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; background-size: 12px; }
        .ws-field select option { background: var(--bg-card); color: var(--text-primary); padding: 8px 12px; }
        .ws-path-display { width: 100%; padding: 10px 14px; border: 1px dashed var(--glass-border); border-radius: var(--radius-md); background: rgba(0,0,0,0.1); color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.78rem; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: all; cursor: text; box-sizing: border-box; }

        /* ── Readonly Stats（dl 描述列表模式，桌面应用紧凑展示）── */
        .ws-readonly-grid {
          display: grid;
          grid-template-columns: 96px 1fr;
          column-gap: 16px;
          row-gap: 2px;
          margin-top: 12px;
        }
        .ws-stat-cell { display: contents; }
        .ws-stat-cell .ws-stat-label {
          font-size: 12px; font-weight: 500;
          color: var(--text-muted);
          text-transform: none; letter-spacing: 0;
          padding: 7px 0;
          align-self: baseline;
        }
        .ws-stat-cell .ws-stat-value {
          font-size: 13px; font-weight: 500;
          color: var(--text-primary);
          padding: 7px 0;
          word-break: break-all;
          align-self: baseline;
          min-width: 0;
        }
        .ws-stat-cell + .ws-stat-cell .ws-stat-label,
        .ws-stat-cell + .ws-stat-cell .ws-stat-value { border-top: 1px solid var(--glass-border); }
        .ws-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
        .ws-text-muted { color: var(--text-muted); }

        /* 鈹€鈹€ Capabilities 鈹€鈹€ */
        .ws-cap-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
        .ws-cap-header > div:first-child { min-width: 0; flex: 1; }
        .ws-bind-row { display: flex; gap: 8px; align-items: center; }
        .ws-bind-select { padding: 8px 14px; padding-right: 36px; border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: var(--bg-base); color: var(--text-primary); font: inherit; font-size: 0.82rem; appearance: none; -webkit-appearance: none; cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; background-size: 12px; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
        .ws-bind-select:hover { border-color: var(--glass-border-hover); background: rgba(255,255,255,0.02); }
        .ws-bind-select:focus { border-color: var(--accent-cyan); box-shadow: 0 0 0 3px rgba(16,163,127,0.14); outline: none; }
        .ws-bind-select option { background: var(--bg-card); color: var(--text-primary); }

        /* ── Schedule Form (定时任务表单容器) ── */
        .ws-schedule-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 16px; }
        .time-editor-form { display: grid; gap: 12px; }
        .time-editor-field { min-width: 0; display: grid; gap: 6px; color: var(--text-secondary); font-size: 12px; }
        .time-editor-field input,
        .time-editor-field select,
        .time-editor-field textarea {
          min-width: 0;
          width: 100%;
          box-sizing: border-box;
          padding: 9px 10px;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          color: var(--text-primary);
          font-size: 13px;
        }
        .time-editor-submit {
          min-height: 34px;
          border: 1px solid var(--accent-cyan);
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--accent-cyan);
          cursor: pointer;
        }
        .time-editor-cancel {
          min-height: 34px;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
        }
        .frequency-picker,
        .frequency-picker__detail { display: grid; gap: 10px; }
        .frequency-picker__chips,
        .frequency-picker__weekdays,
        .reasoning-chip-group { display: flex; flex-wrap: wrap; gap: 6px; }
        .frequency-picker__chip,
        .frequency-picker__weekday,
        .reasoning-chip {
          padding: 5px 10px;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--text-secondary);
          font-size: 12px;
          cursor: pointer;
        }
        .frequency-picker__chip.is-active,
        .frequency-picker__weekday.is-active,
        .reasoning-chip.is-active {
          border-color: rgba(16,163,127,0.5);
          background: rgba(16,163,127,0.1);
          color: var(--accent-cyan);
        }
        .schedule-job-editor__actions { display: flex; justify-content: flex-end; gap: 8px; }

        /* ── Schedule Type Picker (定时任务类型选择卡片) ── */
        .ws-schedule-type-picker {
          display: flex;
          gap: 12px;
          margin-top: 16px;
        }
        .ws-schedule-type-btn {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          padding: 14px 16px;
          border-radius: var(--radius-md);
          background: var(--glass-surface, rgba(255,255,255,0.04));
          border: 1px solid var(--glass-border, rgba(255,255,255,0.08));
          color: inherit;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
        }
        .ws-schedule-type-btn:hover {
          border-color: var(--glass-border-hover);
          background: var(--bg-surface-hover);
        }
        .ws-schedule-type-btn > span:first-of-type {
          font-weight: 500;
          font-size: 14px;
        }
        .ws-schedule-type-desc {
          font-size: 12px;
          color: var(--text-secondary, #888);
        }

        /* ── Schedule Type Chips (编辑器内类型切换) ── */
        .ws-schedule-type-chips {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }
        .ws-type-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 12px;
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-weight: 500;
          border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
          background: transparent;
          color: var(--text-secondary, #888);
          cursor: pointer;
          transition: all 0.15s;
        }
        .ws-type-chip.is-active {
          background: rgba(16, 163, 127, 0.12);
          border-color: rgba(16, 163, 127, 0.3);
          color: var(--accent-cyan);
        }
        .ws-type-chip--close {
          margin-left: auto;
          color: var(--text-tertiary, #666);
          border-color: transparent;
        }
        .ws-type-chip--close:hover { color: var(--text-secondary, #888); }

        /* ── Job Type Chips (任务列表中的类型标签) ── */
        .job-type-chip {
          display: inline-block;
          padding: 1px 8px;
          border-radius: var(--radius-sm);
          font-size: 11px;
          font-weight: 500;
          line-height: 18px;
        }
        .job-type-chip--workflow {
          background: rgba(99, 102, 241, 0.12);
          color: #818cf8;
          border: 1px solid rgba(99, 102, 241, 0.25);
        }
        .job-type-chip--silicon_person {
          background: rgba(16, 163, 127, 0.12);
          color: #2dd4bf;
          border: 1px solid rgba(16, 163, 127, 0.25);
        }
        .job-type-chip--assistant_prompt {
          background: rgba(234, 179, 8, 0.12);
          color: #facc15;
          border: 1px solid rgba(234, 179, 8, 0.25);
        }

        .tag--danger { color: #f87171; }
        .ws-run-receipt.is-warning { color: var(--status-red); }

        .schedule-job-editor__section,
        .schedule-job-preview {
          display: grid;
          gap: 12px;
          padding: 12px;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: rgba(255,255,255,0.02);
        }
        .schedule-job-editor__step {
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 700;
        }
        .schedule-job-editor__locked-target {
          padding: 10px 12px;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: rgba(255,255,255,0.02);
        }
        .schedule-job-editor__locked-target strong { color: var(--text-primary); font-size: 13px; }
        .schedule-job-preview dl { display: grid; gap: 8px; margin: 0; }
        .schedule-job-preview dl > div {
          display: grid;
          grid-template-columns: 88px minmax(0, 1fr);
          gap: 10px;
          align-items: start;
        }
        .schedule-job-preview dt { color: var(--text-muted); font-size: 12px; font-weight: 700; }
        .schedule-job-preview dd { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; word-break: break-word; }
        .reasoning-chip,
        .frequency-picker__chip,
        .frequency-picker__weekday {
          border-radius: var(--radius-sm);
        }

        /* ── Responsive ── */
        @media (max-width: 960px) {
          .ws-profile-grid { grid-template-columns: 1fr; }
          .ws-form-fields { grid-template-columns: 1fr; }
          .ws-readonly-grid { grid-template-columns: 80px 1fr; }
          .ws-schedule-form { grid-template-columns: 1fr; }
          .ws-meta-alerts { margin-left: 0; }
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
          background: var(--bg-card);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-2xl);
          padding: 32px 32px 26px;
          min-width: 360px; max-width: 420px;
          box-shadow: var(--shadow-modal);
          animation: sp-dialog-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
          display: flex; flex-direction: column; align-items: center;
          text-align: center;
        }
        @keyframes sp-dialog-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: none; }
        }

        .sp-confirm-icon {
          width: 52px; height: 52px;
          border-radius: var(--radius-xl);
          background: rgba(16, 163, 127, 0.1);
          border: 1px solid rgba(16, 163, 127, 0.2);
          display: flex; align-items: center; justify-content: center;
          color: var(--accent-cyan);
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
        .sp-confirm-actions .btn-toolbar,
        .sp-confirm-actions .btn-primary {
          flex: 1;
          justify-content: center;
        }
      `}</style>
    </div>
  );
}

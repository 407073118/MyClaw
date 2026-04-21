import { ipcMain } from "electron";

import type { AvailabilityPolicy } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";

function requireTimeApplication(ctx: RuntimeContext) {
  const service = ctx.services.timeApplication;
  if (!service) {
    throw new Error("time application service is not available");
  }
  return service;
}

function requireTimeStore(ctx: RuntimeContext) {
  const store = ctx.services.timeStore;
  if (!store) {
    throw new Error("time store is not available");
  }
  return store;
}

export function registerTimeOrchestrationHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("time:list-calendar-events", async () => {
    console.info("[time-ipc] 列出日历事件");
    const items = ctx.services.timeApplication?.listCalendarEvents
      ? await ctx.services.timeApplication.listCalendarEvents()
      : await requireTimeStore(ctx).listCalendarEvents();
    return { items };
  });

  ipcMain.handle("time:create-calendar-event", async (_event, input: Record<string, unknown>) => {
    console.info("[time-ipc] 创建日历事件", { title: input.title });
    const item = await requireTimeApplication(ctx).saveCalendarEvent(input as any);
    return { item };
  });

  ipcMain.handle("time:update-calendar-event", async (_event, input: Record<string, unknown>) => {
    console.info("[time-ipc] 更新日历事件", { id: input.id });
    const item = await requireTimeApplication(ctx).saveCalendarEvent(input as any);
    return { item };
  });

  ipcMain.handle("time:list-task-commitments", async () => {
    console.info("[time-ipc] 列出时间承诺");
    const items = ctx.services.timeApplication?.listTaskCommitments
      ? await ctx.services.timeApplication.listTaskCommitments()
      : await requireTimeStore(ctx).listTaskCommitments();
    return { items };
  });

  ipcMain.handle("time:create-task-commitment", async (_event, input: Record<string, unknown>) => {
    console.info("[time-ipc] 创建时间承诺", { title: input.title });
    const item = await requireTimeApplication(ctx).saveTaskCommitment(input as any);
    return { item };
  });

  ipcMain.handle("time:update-task-commitment", async (_event, input: Record<string, unknown>) => {
    console.info("[time-ipc] 更新时间承诺", { id: input.id });
    const item = await requireTimeApplication(ctx).saveTaskCommitment(input as any);
    return { item };
  });

  ipcMain.handle("time:list-reminders", async () => {
    console.info("[time-ipc] 列出提醒");
    const items = ctx.services.timeApplication?.listReminders
      ? await ctx.services.timeApplication.listReminders()
      : await requireTimeStore(ctx).listReminders();
    return { items };
  });

  ipcMain.handle("time:create-reminder", async (_event, input: Record<string, unknown>) => {
    console.info("[time-ipc] 创建提醒", { title: input.title });
    const item = await requireTimeApplication(ctx).saveReminder(input as any);
    return { item };
  });

  ipcMain.handle("time:update-reminder", async (_event, input: Record<string, unknown>) => {
    console.info("[time-ipc] 更新提醒", { id: input.id });
    const item = await requireTimeApplication(ctx).saveReminder(input as any);
    return { item };
  });

  ipcMain.handle("time:delete-reminder", async (_event, id: string) => {
    console.info("[time-ipc] 删除提醒", { id });
    await requireTimeApplication(ctx).deleteReminder(id);
    return { ok: true };
  });

  ipcMain.handle("time:list-schedule-jobs", async () => {
    console.info("[time-ipc] 列出计划任务");
    const items = ctx.services.timeApplication?.listScheduleJobs
      ? await ctx.services.timeApplication.listScheduleJobs()
      : await requireTimeStore(ctx).listScheduleJobs();
    return { items };
  });

  ipcMain.handle("time:create-schedule-job", async (_event, input: Record<string, unknown>) => {
    console.info("[time-ipc] 创建计划任务", { title: input.title });
    const item = await requireTimeApplication(ctx).saveScheduleJob(input as any);
    return { item };
  });

  ipcMain.handle("time:update-schedule-job", async (_event, input: Record<string, unknown>) => {
    console.info("[time-ipc] 更新计划任务", { id: input.id });
    const item = await requireTimeApplication(ctx).saveScheduleJob(input as any);
    return { item };
  });

  ipcMain.handle("time:delete-schedule-job", async (_event, id: string) => {
    console.info("[time-ipc] 删除计划任务", { id });
    await requireTimeApplication(ctx).deleteScheduleJob(id);
    return { ok: true };
  });

  ipcMain.handle("time:get-availability-policy", async () => {
    console.info("[time-ipc] 读取可用时段策略");
    const policy = await requireTimeApplication(ctx).getAvailabilityPolicy();
    return { policy };
  });

  ipcMain.handle("time:save-availability-policy", async (_event, policy: AvailabilityPolicy) => {
    console.info("[time-ipc] 保存可用时段策略", { timezone: policy.timezone });
    const nextPolicy = await requireTimeApplication(ctx).saveAvailabilityPolicy(policy);
    return { policy: nextPolicy };
  });

  ipcMain.handle("time:get-today-brief", async () => {
    console.info("[time-ipc] 读取今日摘要");
    const brief = await requireTimeApplication(ctx).getTodayBrief();
    return { brief };
  });

  ipcMain.handle("time:suggest-timeboxes", async () => {
    console.info("[time-ipc] 鐢熸垚鏃堕棿鍧楀缓璁?");
    const items = await requireTimeApplication(ctx).suggestTimeboxes();
    return { items };
  });

  ipcMain.handle("time:list-execution-runs", async () => {
    console.info("[time-ipc] 读取执行记录");
    const items = await requireTimeStore(ctx).listExecutionRuns();
    return { items };
  });
}

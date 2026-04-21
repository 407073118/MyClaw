import { BrowserWindow, ipcMain } from "electron";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { AsrConfig, MeetingEvent } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import { extractMeetingFollowUps } from "../services/meeting-follow-up-service";
import { saveSettings } from "../services/state-persistence";

/**
 * 注册会议录音相关 IPC 通道。
 *
 * 约定：
 * - 命令通道使用 ipcMain.handle（请求/响应）
 * - 音频数据通道使用 ipcMain.on（fire-and-forget，避免延迟累积）
 * - 事件推送使用 webContents.send，广播给所有 Renderer
 */
export function registerMeetingHandlers(ctx: RuntimeContext): void {
  const recorder = ctx.services.meetingRecorder;
  if (!recorder) return;

  // 订阅录音事件，广播给所有 Renderer 窗口
  recorder.onEvent((event: MeetingEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("meeting:event", event);
      }
    }
  });

  ipcMain.handle("meeting:start", async (_event, title?: string) => {
    const meetingId = await recorder.start(title);
    return { meetingId };
  });

  ipcMain.handle("meeting:stop", async () => {
    const meetingId = await recorder.stop();
    return { meetingId };
  });

  ipcMain.handle("meeting:cancel", async () => {
    await recorder.cancel();
    return { ok: true };
  });

  ipcMain.handle("meeting:list", () => {
    return { items: recorder.list() };
  });

  ipcMain.handle("meeting:get", (_event, meetingId: string) => {
    const meeting = recorder.get(meetingId);
    const transcript = meeting ? recorder.getTranscript(meetingId) : null;
    const summary = meeting ? recorder.getSummaryText(meetingId) : null;
    return {
      meeting: meeting ?? null,
      transcript,
      summary,
    };
  });

  ipcMain.handle("meeting:build-follow-ups", async (_event, meetingId: string) => {
    const followUpSource = recorder.getFollowUpSource(meetingId);
    if (!followUpSource.meeting) {
      console.warn("[meeting] 未找到会议，无法导入时间中心", { meetingId });
      return {
        commitments: [],
        reminders: [],
        suggestedEvents: [],
      };
    }

    const timeApplication = ctx.services.timeApplication;
    if (!timeApplication) {
      throw new Error("timeApplication is unavailable");
    }

    const summaryText = followUpSource.summary
      ?? followUpSource.transcript?.segments.map((segment) => segment.text.trim()).filter(Boolean).join("\n")
      ?? "";

    if (!summaryText.trim()) {
      console.info("[meeting] 会议没有可导入的纪要或转写文本", {
        meetingId,
        title: followUpSource.meeting.title,
      });
      return {
        commitments: [],
        reminders: [],
        suggestedEvents: [],
      };
    }

    const timezone = (await timeApplication.getAvailabilityPolicy())?.timezone ?? "Asia/Shanghai";
    console.info("[meeting] 开始导入会议跟进事项到时间中心", {
      meetingId,
      title: followUpSource.meeting.title,
      timezone,
    });

    const drafts = await extractMeetingFollowUps({
      meetingId,
      title: followUpSource.meeting.title,
      summary: summaryText,
      timezone,
    });

    const commitments = await Promise.all(
      drafts.commitments.map((item) =>
        timeApplication.saveTaskCommitment({
          id: item.id,
          title: item.title,
          description: item.description,
          dueAt: item.dueAt,
          durationMinutes: item.durationMinutes,
          timezone: item.timezone,
          ownerScope: item.ownerScope,
          ownerId: item.ownerId,
          priority: item.priority,
          status: item.status,
          source: item.source,
          externalRef: item.externalRef,
        })),
    );
    const reminders = await Promise.all(
      drafts.reminders.map((item) =>
        timeApplication.saveReminder({
          id: item.id,
          title: item.title,
          body: item.body,
          triggerAt: item.triggerAt,
          timezone: item.timezone,
          ownerScope: item.ownerScope,
          ownerId: item.ownerId,
          status: item.status,
          source: item.source,
          externalRef: item.externalRef,
        })),
    );
    const suggestedEvents = await Promise.all(
      drafts.suggestedEvents.map((item) =>
        timeApplication.saveCalendarEvent({
          id: item.id,
          title: item.title,
          description: item.description,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          timezone: item.timezone,
          ownerScope: item.ownerScope,
          ownerId: item.ownerId,
          status: item.status,
          source: item.source,
          externalRef: item.externalRef,
          location: item.location,
        })),
    );

    console.info("[meeting] 会议跟进事项已导入时间中心", {
      meetingId,
      commitments: commitments.length,
      reminders: reminders.length,
      suggestedEvents: suggestedEvents.length,
    });

    return {
      commitments,
      reminders,
      suggestedEvents,
    };
  });

  ipcMain.handle("meeting:delete", async (_event, meetingId: string) => {
    await recorder.delete(meetingId);
    return { ok: true };
  });

  ipcMain.handle(
    "meeting:update-speaker",
    async (_event, meetingId: string, speakerIndex: number, label: string) => {
      await recorder.updateSpeakerLabel(meetingId, speakerIndex, label);
      return { ok: true };
    },
  );

  ipcMain.handle("meeting:update-title", async (_event, meetingId: string, title: string) => {
    await recorder.updateTitle(meetingId, title);
    return { ok: true };
  });

  /** 读取 WAV 音频字节；渲染进程转成 Blob URL 供 <audio> 播放。 */
  ipcMain.handle("meeting:read-audio", async (_event, meetingId: string) => {
    const audioPath = recorder.getAudioPath(meetingId);
    if (!existsSync(audioPath)) return { buffer: null };
    const buffer = await readFile(audioPath);
    return { buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  });

  // 高频音频数据通道 — fire-and-forget
  ipcMain.on("meeting:audio-chunk", (_event, chunk: ArrayBuffer | Uint8Array | Buffer) => {
    // chunk 可能是 ArrayBuffer / Uint8Array / Buffer，统一转成 Buffer 再下发
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk);
    recorder.onAudioChunk(buf);
  });

  // ---- ASR 配置 ----------------------------------------------------------
  ipcMain.handle("asr:get-config", () => {
    return { config: ctx.state.getAsrConfig() };
  });

  ipcMain.handle("asr:save-config", async (_event, next: AsrConfig) => {
    const merged: AsrConfig = { ...ctx.state.getAsrConfig(), ...next };
    ctx.state.setAsrConfig(merged);
    await saveSettings(ctx.runtime.paths, {
      defaultModelProfileId: ctx.state.getDefaultModelProfileId(),
      approvalPolicy: ctx.state.getApprovals(),
      personalPrompt: ctx.state.getPersonalPromptProfile(),
      asrConfig: merged,
    });
    return { config: merged };
  });
}

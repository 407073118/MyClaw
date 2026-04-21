/**
 * 会议录音服务。
 *
 * 管理录音生命周期：开始 → 接收音频帧 → 停止 → 后处理流水线（离线 ASR → 转写稿 → LLM 纪要）。
 *
 * 存储结构：
 *   {dataRoot}/meetings/
 *     ├── meetings.json         — 元数据索引
 *     └── {meetingId}/
 *         ├── recording.wav     — 原始音频
 *         ├── transcript.json   — 结构化转写
 *         ├── transcript.md     — 可读版转写稿
 *         └── summary.md        — LLM 会议纪要
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  MeetingRecord,
  MeetingEvent,
  MeetingStatus,
  AsrConfig,
  StructuredTranscript,
} from "@shared/contracts";

import type { MyClawPaths } from "./directory-service";
import type { MeetingIntelligenceProvider } from "./meeting-intelligence-provider";
import type { StreamingSession } from "./asr-client";
import { createLogger } from "./logger";

const logger = createLogger("meeting-recorder");

// ---------------------------------------------------------------------------
// WAV 文件写入辅助
// ---------------------------------------------------------------------------

/** 生成 16-bit PCM WAV 文件头。 */
function createWavHeader(dataLength: number, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);         // fmt chunk size
  header.writeUInt16LE(1, 20);          // PCM format
  header.writeUInt16LE(1, 22);          // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);          // block align
  header.writeUInt16LE(16, 34);         // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

// ---------------------------------------------------------------------------
// 格式化辅助
// ---------------------------------------------------------------------------

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
  return formatTimestamp(ms);
}

// ---------------------------------------------------------------------------
// 活跃录音状态
// ---------------------------------------------------------------------------

type ActiveMeeting = {
  meetingId: string;
  startTime: number;
  audioChunks: Buffer[];
  streamingSession: StreamingSession;
  sampleRate: number;
};

// ---------------------------------------------------------------------------
// LLM 纪要 system prompt
// ---------------------------------------------------------------------------

const SUMMARY_SYSTEM_PROMPT = `你是一个专业的会议纪要助手。请根据以下会议转写稿生成结构化会议纪要。

输出格式：
## 会议概要
（一句话概括会议主题和结论）

## 参会人
（列出所有发言人）

## 关键议题
（按讨论顺序，每个议题包含：议题名、讨论要点、结论）

## 待办事项
（明确的 action items，包含：内容、负责人、截止时间（如有提及））

## 关键决策
（会议中明确做出的决定）

要求：
- 保持客观，忠实于原文
- 待办事项必须标注对应的发言人
- 如果发言中提到了时间节点，务必提取`;

// ---------------------------------------------------------------------------
// MeetingRecorder
// ---------------------------------------------------------------------------

export class MeetingRecorder {
  private meetingsDir: string;
  private meetingsIndexFile: string;
  private meetings: MeetingRecord[] = [];
  private activeMeeting: ActiveMeeting | null = null;
  private eventListeners: Set<(event: MeetingEvent) => void> = new Set();

  constructor(
    private provider: MeetingIntelligenceProvider,
    paths: MyClawPaths,
    private getAsrConfig: () => AsrConfig,
    private generateSummary: (transcriptText: string) => Promise<string>,
  ) {
    this.meetingsDir = join(paths.myClawDir, "meetings");
    this.meetingsIndexFile = join(this.meetingsDir, "meetings.json");
    this.loadIndex();
  }

  /** 对外暴露 system prompt，便于外部使用相同模板单独调用 LLM。 */
  static readonly SUMMARY_SYSTEM_PROMPT = SUMMARY_SYSTEM_PROMPT;

  // ---- 事件 ----------------------------------------------------------------

  onEvent(listener: (event: MeetingEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private emit(event: MeetingEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // 忽略单个监听器异常
      }
    }
  }

  // ---- 索引持久化 ------------------------------------------------------------

  private loadIndex(): void {
    if (existsSync(this.meetingsIndexFile)) {
      try {
        this.meetings = JSON.parse(readFileSync(this.meetingsIndexFile, "utf-8"));
      } catch {
        this.meetings = [];
      }
    }
  }

  private async saveIndex(): Promise<void> {
    if (!existsSync(this.meetingsDir)) {
      mkdirSync(this.meetingsDir, { recursive: true });
    }
    await writeFile(this.meetingsIndexFile, JSON.stringify(this.meetings, null, 2));
  }

  // ---- 公开 API ------------------------------------------------------------

  /** 获取所有录音记录（按创建时间降序）。 */
  list(): MeetingRecord[] {
    return [...this.meetings].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** 获取单条录音记录。 */
  get(meetingId: string): MeetingRecord | undefined {
    return this.meetings.find((m) => m.id === meetingId);
  }

  /** 获取结构化转写数据。 */
  getTranscript(meetingId: string): StructuredTranscript | null {
    const meeting = this.get(meetingId);
    if (!meeting?.structuredTranscriptPath) return null;
    const filePath = join(this.meetingsDir, meetingId, "transcript.json");
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as StructuredTranscript;
    } catch {
      return null;
    }
  }

  /** 获取 WAV 文件绝对路径（不检查是否存在）。 */
  getAudioPath(meetingId: string): string {
    return join(this.meetingsDir, meetingId, "recording.wav");
  }

  /** 获取会议纪要文本（不存在时返回 null）。 */
  getSummaryText(meetingId: string): string | null {
    const filePath = join(this.meetingsDir, meetingId, "summary.md");
    if (!existsSync(filePath)) return null;
    try {
      return readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  /** 获取导入时间中心所需的会议上下文，统一返回标题、纪要和转写。 */
  getFollowUpSource(meetingId: string): {
    meeting: MeetingRecord | null;
    transcript: StructuredTranscript | null;
    summary: string | null;
  } {
    const meeting = this.get(meetingId) ?? null;
    if (!meeting) {
      return {
        meeting: null,
        transcript: null,
        summary: null,
      };
    }
    return {
      meeting,
      transcript: this.getTranscript(meetingId),
      summary: this.getSummaryText(meetingId),
    };
  }

  /** 开始录音。 */
  async start(title?: string): Promise<string> {
    if (this.activeMeeting) {
      throw new Error("已有正在进行的录音，请先停止当前录音");
    }

    const meetingId = randomUUID();
    const meetingDir = join(this.meetingsDir, meetingId);
    mkdirSync(meetingDir, { recursive: true });

    const asrConfig = this.getAsrConfig();

    const streamingSession = this.provider.startStreaming({
      asrConfig,
      meetingId,
    });

    streamingSession.onTranscribe((event) => {
      this.emit({ ...event, meetingId });
    });

    const now = new Date().toISOString();
    const defaultTitle = title || `会议录音 ${now.slice(0, 10)} ${now.slice(11, 16)}`;

    const record: MeetingRecord = {
      id: meetingId,
      title: defaultTitle,
      createdAt: now,
      durationMs: 0,
      status: "recording",
    };

    this.meetings.push(record);
    await this.saveIndex();

    this.activeMeeting = {
      meetingId,
      startTime: Date.now(),
      audioChunks: [],
      streamingSession,
      sampleRate: asrConfig.audioSampleRate,
    };

    this.emit({ type: "status", meetingId, status: "recording" });
    logger.info("开始会议录音", { meetingId, title: defaultTitle });

    return meetingId;
  }

  /** 接收 Renderer 推送的 PCM 帧。 */
  onAudioChunk(chunk: Buffer): void {
    if (!this.activeMeeting) return;
    this.activeMeeting.audioChunks.push(chunk);
    this.activeMeeting.streamingSession.sendAudio(chunk);
  }

  /** 停止录音，启动异步后处理。 */
  async stop(): Promise<string | null> {
    if (!this.activeMeeting) return null;

    const { meetingId, startTime, audioChunks, streamingSession, sampleRate } = this.activeMeeting;
    const durationMs = Date.now() - startTime;
    this.activeMeeting = null;

    // 通知 ASR 说话结束
    await streamingSession.finish();
    streamingSession.destroy();

    const record = this.meetings.find((m) => m.id === meetingId);
    if (record) {
      record.durationMs = durationMs;
      await this.saveIndex();
    }

    logger.info("录音已停止，开始后处理", { meetingId, durationMs });

    // 异步后处理，不阻塞返回
    this.postProcess(meetingId, audioChunks, sampleRate).catch((err) => {
      logger.error("录音后处理失败", { meetingId, error: String(err) });
    });

    return meetingId;
  }

  /** 取消当前录音。 */
  async cancel(): Promise<void> {
    if (!this.activeMeeting) return;

    const { meetingId, streamingSession } = this.activeMeeting;
    this.activeMeeting = null;
    streamingSession.destroy();

    this.meetings = this.meetings.filter((m) => m.id !== meetingId);
    await this.saveIndex();

    const meetingDir = join(this.meetingsDir, meetingId);
    await rm(meetingDir, { recursive: true, force: true });

    logger.info("录音已取消", { meetingId });
  }

  /** 删除一条录音记录。 */
  async delete(meetingId: string): Promise<void> {
    this.meetings = this.meetings.filter((m) => m.id !== meetingId);
    await this.saveIndex();

    const meetingDir = join(this.meetingsDir, meetingId);
    if (existsSync(meetingDir)) {
      await rm(meetingDir, { recursive: true, force: true });
    }

    logger.info("录音已删除", { meetingId });
  }

  /** 更新说话人标签。 */
  async updateSpeakerLabel(meetingId: string, speakerIndex: number, label: string): Promise<void> {
    const record = this.meetings.find((m) => m.id === meetingId);
    if (!record) return;
    if (!record.speakerLabels) record.speakerLabels = {};
    record.speakerLabels[speakerIndex] = label;
    await this.saveIndex();
  }

  /** 更新会议标题。 */
  async updateTitle(meetingId: string, title: string): Promise<void> {
    const record = this.meetings.find((m) => m.id === meetingId);
    if (!record) return;
    record.title = title;
    await this.saveIndex();
  }

  /** 记录关联的对话会话 ID。 */
  async linkSession(meetingId: string, sessionId: string): Promise<void> {
    const record = this.meetings.find((m) => m.id === meetingId);
    if (!record) return;
    record.linkedSessionId = sessionId;
    await this.saveIndex();
  }

  /** 是否正在录音。 */
  get isRecording(): boolean {
    return this.activeMeeting !== null;
  }

  /** 当前录音 ID。 */
  get activeMeetingId(): string | null {
    return this.activeMeeting?.meetingId ?? null;
  }

  // ---- 后处理流水线 ----------------------------------------------------------

  private async postProcess(meetingId: string, audioChunks: Buffer[], sampleRate: number): Promise<void> {
    const record = this.meetings.find((m) => m.id === meetingId);
    if (!record) return;

    const meetingDir = join(this.meetingsDir, meetingId);
    const wavPath = join(meetingDir, "recording.wav");

    try {
      // 阶段一：保存 WAV 文件
      const pcmData = Buffer.concat(audioChunks);
      const wavHeader = createWavHeader(pcmData.length, sampleRate);
      await writeFile(wavPath, Buffer.concat([wavHeader, pcmData]));
      logger.info("WAV 文件已保存", { meetingId, sizeBytes: wavHeader.length + pcmData.length });

      // 阶段二：离线 ASR（说话人分离）
      this.updateStatus(record, "transcribing");

      const asrConfig = this.getAsrConfig();
      const transcript = await this.provider.transcribeAudio(wavPath, asrConfig);

      const transcriptJsonPath = join(meetingDir, "transcript.json");
      await writeFile(transcriptJsonPath, JSON.stringify(transcript, null, 2));
      record.structuredTranscriptPath = "transcript.json";
      record.speakerCount = transcript.speakerCount;

      const transcriptMd = this.renderTranscriptMarkdown(transcript, record);
      await writeFile(join(meetingDir, "transcript.md"), transcriptMd);

      logger.info("转写完成", {
        meetingId,
        segmentCount: transcript.segments.length,
        speakerCount: transcript.speakerCount,
      });

      // 阶段三：LLM 生成会议纪要
      this.updateStatus(record, "summarizing");

      const summaryText = await this.generateSummary(transcriptMd);
      await writeFile(join(meetingDir, "summary.md"), summaryText);

      this.updateStatus(record, "done");
      logger.info("会议纪要生成完成", { meetingId });
    } catch (err) {
      record.errorMessage = String(err);
      this.updateStatus(record, "failed");
      logger.error("后处理流水线失败", { meetingId, error: String(err) });
    }
  }

  private updateStatus(record: MeetingRecord, status: MeetingStatus): void {
    record.status = status;
    void this.saveIndex();
    this.emit({
      type: "status",
      meetingId: record.id,
      status,
      errorMessage: record.errorMessage,
    });
  }

  private renderTranscriptMarkdown(transcript: StructuredTranscript, record: MeetingRecord): string {
    const lines: string[] = [
      `# ${record.title} - 转写稿`,
      "",
      `> 时间：${record.createdAt} | 时长：${formatDuration(transcript.durationMs)} | 发言人：${transcript.speakerCount} 位`,
      "",
      "---",
      "",
    ];

    let currentSpeaker: number | null = null;
    for (const seg of transcript.segments) {
      if (!seg.text.trim()) continue;

      if (seg.speaker !== currentSpeaker) {
        currentSpeaker = seg.speaker;
        const label = record.speakerLabels?.[seg.speaker] || `发言人${seg.speaker}`;
        lines.push("");
        lines.push(`**${label}**（${formatTimestamp(seg.startMs)}）`);
        lines.push("");
      }
      lines.push(seg.text);
    }

    return lines.join("\n");
  }
}

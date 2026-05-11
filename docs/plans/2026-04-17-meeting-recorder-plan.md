# Meeting Recorder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a meeting recording feature to MyClaw desktop — real-time ASR transcription via WebSocket, post-meeting speaker diarization via HTTP, LLM-generated meeting summary, with results stored as Artifacts and injectable into chat sessions for follow-up analysis.

**Architecture:** Renderer captures microphone PCM via getUserMedia, sends chunks to Main Process over IPC. Main Process manages WebSocket connection to streaming ASR, pushes real-time partial_text back. After recording stops, Main sends the full wav to offline ASR (with speaker diarization), generates a structured transcript, feeds it to LLM for summary, and registers all three outputs (wav, transcript.md, summary.md) as Artifacts. A `MeetingIntelligenceProvider` interface abstracts the ASR+LLM pipeline for future replacement with a standalone service.

**Tech Stack:** Electron IPC, WebSocket (ws package), native fetch (HTTP POST multipart), MediaRecorder/AudioContext in Renderer, existing model-client for LLM summary, existing ArtifactRegistry for storage.

**Design Document:** `docs/plans/2026-04-17-meeting-recorder-design.md` — refer to this for full type definitions, data flow diagrams, and UI mockups.

---

## Task 1: Meeting Domain Contracts

**Files:**
- Create: `desktop/shared/contracts/meeting.ts`
- Modify: `desktop/shared/contracts/index.ts`

**Step 1: Create meeting contract types**

Create `desktop/shared/contracts/meeting.ts`:

```typescript
// ---------------------------------------------------------------------------
// 会议录音领域类型
// ---------------------------------------------------------------------------

/** 转写稿原子单元 — 一句话 */
export type TranscriptSegment = {
  /** 说话人编号（离线 ASR 返回） */
  speaker: number;
  /** 用户可编辑的说话人名称，如 "张经理" */
  speakerLabel?: string;
  /** 识别文本 */
  text: string;
  /** 音频中的起始时间 (ms) */
  startMs: number;
  /** 音频中的结束时间 (ms) */
  endMs: number;
};

/** 结构化转写结果 — 离线 ASR 的核心产出 */
export type StructuredTranscript = {
  segments: TranscriptSegment[];
  speakerCount: number;
  durationMs: number;
  /** 声纹向量，跨分片时传递以保持说话人编号一致 */
  speakerCenters?: number[][];
};

/** 会议录音状态 */
export type MeetingStatus =
  | "recording"
  | "transcribing"
  | "summarizing"
  | "done"
  | "failed";

/** 一次会议录音的元数据 */
export type MeetingRecord = {
  id: string;
  title: string;
  createdAt: string;
  durationMs: number;
  status: MeetingStatus;

  /** 三件套 Artifact ID */
  audioArtifactId?: string;
  transcriptArtifactId?: string;
  summaryArtifactId?: string;

  /** 结构化转写数据路径（相对于 meeting 目录） */
  structuredTranscriptPath?: string;

  /** 关联的对话 Session ID（用户点「对话分析」时创建） */
  linkedSessionId?: string;

  speakerCount?: number;
  /** 用户编辑的说话人标签映射 { 0: "张经理", 1: "李总" } */
  speakerLabels?: Record<number, string>;
  errorMessage?: string;
};

/** Main → Renderer 实时转写推送事件 */
export type MeetingTranscribeEvent = {
  type: "transcribe";
  meetingId: string;
  /** 当前正在识别的句子（持续更新） */
  partialText: string;
  /** VAD 断句后的确认文字 */
  finalText?: string;
  /** 是否为整段录音的最终结果 */
  isFinal: boolean;
};

/** Main → Renderer 状态变更事件 */
export type MeetingStatusEvent = {
  type: "status";
  meetingId: string;
  status: MeetingStatus;
  /** 离线转写/纪要生成进度 0-100 */
  progress?: number;
  errorMessage?: string;
};

export type MeetingEvent = MeetingTranscribeEvent | MeetingStatusEvent;

/** ASR 服务配置（存入 settings.json） */
export type AsrConfig = {
  /** 实时流式 ASR WebSocket 地址 */
  wsUrl: string;
  /** 离线 ASR HTTP 地址 */
  httpUrl: string;
  /** 识别模式：online（低延迟）或 2pass（更准确） */
  mode: "online" | "2pass";
  /** 音频采样率，默认 16000 */
  audioSampleRate: number;
  /** 是否启用 SSL */
  ssl: boolean;
  /** 是否启用说话人识别 */
  enableSpeaker: boolean;
  /** 最大说话人数 */
  maxSpeakers: number;
  /** 纪要生成使用的模型 Profile ID，null 表示用默认模型 */
  summaryModelProfileId: string | null;
};

/** ASR 默认配置 */
export const DEFAULT_ASR_CONFIG: AsrConfig = {
  wsUrl: "ws://192.168.160.55:10099",
  httpUrl: "https://zh-offline-16k-asr-antalos-app-server.100credit.cn/recognition",
  mode: "online",
  audioSampleRate: 16000,
  ssl: false,
  enableSpeaker: true,
  maxSpeakers: 3,
  summaryModelProfileId: null,
};
```

**Step 2: Export from contracts index**

Modify `desktop/shared/contracts/index.ts` — add at the end:

```typescript
export * from "./meeting";
```

**Step 3: Verify TypeScript compilation**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.main.json 2>&1 | head -20`
Expected: No errors related to meeting.ts

**Step 4: Commit**

```bash
git add desktop/shared/contracts/meeting.ts desktop/shared/contracts/index.ts
git commit -m "feat(desktop): add meeting recorder domain contracts"
```

---

## Task 2: ASR Client Service

**Files:**
- Create: `desktop/src/main/services/asr-client.ts`

**Dependencies:** Task 1 (contracts)

**Step 1: Create ASR client with WebSocket streaming and HTTP offline**

Create `desktop/src/main/services/asr-client.ts`:

```typescript
/**
 * ASR 客户端服务。
 *
 * 封装两个 ASR 通道：
 * - 实时流式：WebSocket 连接，持续推送 PCM 帧，接收 partial_text / final_text
 * - 离线识别：HTTP POST 上传完整音频，返回带说话人+时间戳的结构化转写
 */

import { WebSocket } from "ws";
import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import { createLogger } from "./logger";

import type {
  AsrConfig,
  StructuredTranscript,
  TranscriptSegment,
  MeetingTranscribeEvent,
} from "@shared/contracts";

const logger = createLogger("asr-client");

// ---------------------------------------------------------------------------
// 流式会话
// ---------------------------------------------------------------------------

export type StreamingSession = {
  /** 推送 PCM 音频帧 */
  sendAudio(chunk: Buffer): void;
  /** 通知说话结束，等待服务端最终结果 */
  finish(): Promise<void>;
  /** 注册实时转写回调 */
  onTranscribe(cb: (event: Omit<MeetingTranscribeEvent, "meetingId">) => void): void;
  /** 关闭连接，释放资源 */
  destroy(): void;
};

// ---------------------------------------------------------------------------
// 离线识别选项
// ---------------------------------------------------------------------------

export type TranscribeOfflineOptions = {
  modelList?: string;
  maxSpks?: number;
  spkCenter?: number[][];
  /** 音频分片的起始时刻偏移 (ms)，用于多分片场景 */
  offset?: number;
};

// ---------------------------------------------------------------------------
// AsrClient
// ---------------------------------------------------------------------------

export class AsrClient {
  /**
   * 开启流式 WebSocket 连接。
   *
   * 协议流程：
   * 1. 建立 ws/wss 连接
   * 2. 发送 JSON 配置帧（mode, chunk_size, audio_fs, is_speaking:true 等）
   * 3. 持续发送 PCM 二进制帧
   * 4. 服务端持续返回 JSON（partial_text, final_text, is_final 等）
   * 5. 结束时发送 { is_speaking: false }
   */
  startStreaming(config: AsrConfig): StreamingSession {
    const uri = config.wsUrl;
    logger.info("建立实时 ASR 连接", { uri, mode: config.mode });

    const ws = new WebSocket(uri, ["binary"], {
      rejectUnauthorized: false,
    });

    let transcribeCb: ((event: Omit<MeetingTranscribeEvent, "meetingId">) => void) | null = null;
    let finishResolve: (() => void) | null = null;
    let connected = false;

    ws.on("open", () => {
      connected = true;
      // 发送初始化配置帧
      const initMsg = JSON.stringify({
        mode: config.mode,
        chunk_size: [5, 10, 5],
        chunk_interval: 10,
        audio_fs: config.audioSampleRate,
        wav_name: "meeting",
        is_speaking: true,
        itn: true,
      });
      ws.send(initMsg);
      logger.info("实时 ASR 连接已建立，已发送配置");
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const event: Omit<MeetingTranscribeEvent, "meetingId"> = {
          type: "transcribe",
          partialText: msg.partial_text ?? "",
          finalText: msg.final_text ?? undefined,
          isFinal: msg.is_final === true,
        };
        transcribeCb?.(event);

        if (msg.is_final && finishResolve) {
          finishResolve();
          finishResolve = null;
        }
      } catch (err) {
        logger.warn("解析 ASR 消息失败", { error: String(err) });
      }
    });

    ws.on("error", (err) => {
      logger.error("实时 ASR 连接错误", { error: String(err) });
    });

    ws.on("close", () => {
      connected = false;
      // 如果连接意外断开且还在等待 finish，也 resolve
      if (finishResolve) {
        finishResolve();
        finishResolve = null;
      }
    });

    return {
      sendAudio(chunk: Buffer) {
        if (connected && ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        }
      },

      finish() {
        return new Promise<void>((resolve) => {
          if (!connected || ws.readyState !== WebSocket.OPEN) {
            resolve();
            return;
          }
          finishResolve = resolve;
          ws.send(JSON.stringify({ is_speaking: false }));

          // 超时保护：最多等 10 秒
          setTimeout(() => {
            if (finishResolve) {
              logger.warn("等待 ASR 最终结果超时，强制结束");
              finishResolve();
              finishResolve = null;
            }
          }, 10_000);
        });
      },

      onTranscribe(cb) {
        transcribeCb = cb;
      },

      destroy() {
        transcribeCb = null;
        finishResolve = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      },
    };
  }

  /**
   * 离线识别 — HTTP POST 带说话人分离。
   *
   * 将 wav/mp3 文件 POST 到离线 ASR 服务，返回结构化转写。
   */
  async transcribeOffline(
    audioPath: string,
    httpUrl: string,
    options?: TranscribeOfflineOptions,
  ): Promise<StructuredTranscript> {
    const fileName = basename(audioPath);
    const fileSize = statSync(audioPath).size;
    logger.info("开始离线 ASR 识别", { audioPath: fileName, fileSize, modelList: options?.modelList });

    const formData = new FormData();

    // 读取音频文件为 Blob
    const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(audioPath);
      stream.on("data", (chunk) => chunks.push(chunk as Buffer));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });

    formData.append("audio", new Blob([audioBuffer]), fileName);

    if (options?.modelList) {
      formData.append("model_list", options.modelList);
    }
    if (options?.maxSpks != null) {
      formData.append("max_num_spks", String(options.maxSpks));
    }
    if (options?.spkCenter) {
      formData.append("spk_center", JSON.stringify(options.spkCenter));
    }
    if (options?.offset != null) {
      formData.append("offset", String(options.offset));
    }

    const response = await fetch(httpUrl, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`离线 ASR 请求失败: HTTP ${response.status}`);
    }

    const payload = await response.json() as {
      text?: string;
      sentences?: Array<{
        spk?: number;
        text?: string;
        start?: number;
        end?: number;
      }>;
      spk_center?: number[][];
      code?: number;
    };

    if (payload.code != null && payload.code !== 0) {
      throw new Error(`离线 ASR 返回错误码: ${payload.code}`);
    }

    const segments: TranscriptSegment[] = (payload.sentences ?? []).map((s) => ({
      speaker: s.spk ?? 0,
      text: (s.text ?? "").trim(),
      startMs: s.start ?? 0,
      endMs: s.end ?? 0,
    }));

    // 计算说话人数
    const speakerSet = new Set(segments.map((s) => s.speaker));

    const result: StructuredTranscript = {
      segments,
      speakerCount: speakerSet.size,
      durationMs: segments.length > 0 ? segments[segments.length - 1].endMs : 0,
      speakerCenters: payload.spk_center ?? undefined,
    };

    logger.info("离线 ASR 识别完成", {
      segmentCount: segments.length,
      speakerCount: result.speakerCount,
      durationMs: result.durationMs,
    });

    return result;
  }
}
```

**Step 2: Verify TypeScript compilation**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.main.json 2>&1 | head -20`
Expected: No errors. Note: `ws` package may need to be installed — check if it's already a dependency.

**Step 3: Check if `ws` package exists, install if needed**

Run: `cd F:/MyClaw/desktop && node -e "require('ws')" 2>&1`
If error: `pnpm add ws && pnpm add -D @types/ws`

**Step 4: Commit**

```bash
git add desktop/src/main/services/asr-client.ts
git commit -m "feat(desktop): add ASR client with WebSocket streaming and HTTP offline"
```

---

## Task 3: Meeting Intelligence Provider Interface

**Files:**
- Create: `desktop/src/main/services/meeting-intelligence-provider.ts`

**Dependencies:** Task 1, Task 2

**Step 1: Create the provider interface and direct implementation**

Create `desktop/src/main/services/meeting-intelligence-provider.ts`:

```typescript
/**
 * 会议智能处理能力抽象。
 *
 * 当前实现（DirectAsrProvider）直连 ASR 服务 + LLM。
 * 未来可替换为 RemoteMeetingServiceProvider，对接独立的会议智能中间服务。
 */

import type {
  AsrConfig,
  StructuredTranscript,
  MeetingTranscribeEvent,
} from "@shared/contracts";

import type { AsrClient, StreamingSession, TranscribeOfflineOptions } from "./asr-client";

// ---------------------------------------------------------------------------
// 抽象接口
// ---------------------------------------------------------------------------

export type StreamConfig = {
  asrConfig: AsrConfig;
  meetingId: string;
};

export interface MeetingIntelligenceProvider {
  /** 开始实时流式转写 */
  startStreaming(config: StreamConfig): StreamingSession;
  /** 提交完整音频，返回结构化转写（含说话人） */
  transcribeAudio(audioPath: string, asrConfig: AsrConfig, options?: TranscribeOfflineOptions): Promise<StructuredTranscript>;
}

// ---------------------------------------------------------------------------
// 直连实现
// ---------------------------------------------------------------------------

export class DirectAsrProvider implements MeetingIntelligenceProvider {
  constructor(private asrClient: AsrClient) {}

  startStreaming(config: StreamConfig): StreamingSession {
    return this.asrClient.startStreaming(config.asrConfig);
  }

  async transcribeAudio(
    audioPath: string,
    asrConfig: AsrConfig,
    options?: TranscribeOfflineOptions,
  ): Promise<StructuredTranscript> {
    return this.asrClient.transcribeOffline(audioPath, asrConfig.httpUrl, {
      modelList: asrConfig.enableSpeaker ? "spk" : undefined,
      maxSpks: asrConfig.maxSpeakers,
      ...options,
    });
  }
}
```

**Step 2: Verify compilation**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.main.json 2>&1 | head -20`

**Step 3: Commit**

```bash
git add desktop/src/main/services/meeting-intelligence-provider.ts
git commit -m "feat(desktop): add MeetingIntelligenceProvider interface with DirectAsrProvider"
```

---

## Task 4: Meeting Recorder Service

**Files:**
- Create: `desktop/src/main/services/meeting-recorder.ts`

**Dependencies:** Task 1, Task 2, Task 3

**Step 1: Create the meeting recorder service**

This is the core service managing the recording lifecycle. Create `desktop/src/main/services/meeting-recorder.ts`:

```typescript
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
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  MeetingRecord,
  MeetingEvent,
  MeetingStatus,
  AsrConfig,
  StructuredTranscript,
  DEFAULT_ASR_CONFIG,
} from "@shared/contracts";
import { DEFAULT_ASR_CONFIG as ASR_DEFAULTS } from "@shared/contracts";

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
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
    private paths: MyClawPaths,
    private getAsrConfig: () => AsrConfig,
    private generateSummary: (transcriptText: string) => Promise<string>,
  ) {
    this.meetingsDir = join(paths.myClawDir, "meetings");
    this.meetingsIndexFile = join(this.meetingsDir, "meetings.json");
    this.loadIndex();
  }

  // ---- 事件 ----------------------------------------------------------------

  onEvent(listener: (event: MeetingEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emit(event: MeetingEvent): void {
    for (const listener of this.eventListeners) {
      try { listener(event); } catch { /* 忽略单个监听器异常 */ }
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

  /** 获取所有录音记录。 */
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
      return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
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

    // 建立实时 ASR 连接
    const streamingSession = this.provider.startStreaming({
      asrConfig,
      meetingId,
    });

    streamingSession.onTranscribe((event) => {
      this.emit({ ...event, meetingId });
    });

    const now = new Date().toISOString();
    const defaultTitle = title || `会议录音 ${now.slice(0, 10)} ${now.slice(11, 16).replace(":", ":")}`;

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

    // 更新时长
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

    // 移除记录
    this.meetings = this.meetings.filter((m) => m.id !== meetingId);
    await this.saveIndex();

    // 删除目录
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

      // 保存结构化转写
      const transcriptJsonPath = join(meetingDir, "transcript.json");
      await writeFile(transcriptJsonPath, JSON.stringify(transcript, null, 2));
      record.structuredTranscriptPath = "transcript.json";
      record.speakerCount = transcript.speakerCount;

      // 渲染可读版转写稿
      const transcriptMd = this.renderTranscriptMarkdown(transcript, record);
      await writeFile(join(meetingDir, "transcript.md"), transcriptMd);

      logger.info("转写完成", { meetingId, segmentCount: transcript.segments.length, speakerCount: transcript.speakerCount });

      // 阶段三：LLM 生成会议纪要
      this.updateStatus(record, "summarizing");

      const summaryText = await this.generateSummary(transcriptMd);
      await writeFile(join(meetingDir, "summary.md"), summaryText);

      // 完成
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
```

**Step 2: Verify compilation**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.main.json 2>&1 | head -20`

**Step 3: Commit**

```bash
git add desktop/src/main/services/meeting-recorder.ts
git commit -m "feat(desktop): add MeetingRecorder service with recording lifecycle and post-processing pipeline"
```

---

## Task 5: IPC Handlers

**Files:**
- Create: `desktop/src/main/ipc/meetings.ts`
- Modify: `desktop/src/main/ipc/index.ts`

**Dependencies:** Task 4

**Step 1: Create meeting IPC handlers**

Create `desktop/src/main/ipc/meetings.ts`:

```typescript
import { ipcMain, webContents } from "electron";
import type { RuntimeContext } from "../services/runtime-context";
import type { MeetingEvent } from "@shared/contracts";

/**
 * 注册会议录音相关 IPC 通道。
 *
 * 约定：
 * - 命令通道使用 ipcMain.handle（请求/响应）
 * - 音频数据通道使用 ipcMain.on（fire-and-forget，避免延迟累积）
 * - 事件推送使用 webContents.send
 */
export function registerMeetingHandlers(ctx: RuntimeContext): void {
  const recorder = ctx.services.meetingRecorder;
  if (!recorder) return;

  // 订阅录音事件，推送给所有 Renderer
  recorder.onEvent((event: MeetingEvent) => {
    for (const wc of webContents.getAllWebContents()) {
      wc.send("meeting:event", event);
    }
  });

  ipcMain.handle("meeting:start", async (_e, title?: string) => {
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

  ipcMain.handle("meeting:get", (_e, meetingId: string) => {
    const meeting = recorder.get(meetingId);
    const transcript = meeting ? recorder.getTranscript(meetingId) : null;
    return { meeting: meeting ?? null, transcript };
  });

  ipcMain.handle("meeting:delete", async (_e, meetingId: string) => {
    await recorder.delete(meetingId);
    return { ok: true };
  });

  ipcMain.handle("meeting:update-speaker", async (_e, meetingId: string, speakerIndex: number, label: string) => {
    await recorder.updateSpeakerLabel(meetingId, speakerIndex, label);
    return { ok: true };
  });

  // 高频音频数据通道 — fire-and-forget
  ipcMain.on("meeting:audio-chunk", (_e, chunk: Buffer) => {
    recorder.onAudioChunk(Buffer.from(chunk));
  });
}
```

**Step 2: Register in IPC index**

Modify `desktop/src/main/ipc/index.ts` — add import and registration:

Add at the top with other imports:
```typescript
import { registerMeetingHandlers } from "./meetings";
```

Add inside `registerAllIpcHandlers` function body, after the last existing registration:
```typescript
  registerMeetingHandlers(ctx);
```

**Step 3: Verify compilation**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.main.json 2>&1 | head -20`

**Step 4: Commit**

```bash
git add desktop/src/main/ipc/meetings.ts desktop/src/main/ipc/index.ts
git commit -m "feat(desktop): add meeting recording IPC handlers"
```

---

## Task 6: RuntimeContext & Main Process Integration

**Files:**
- Modify: `desktop/src/main/services/runtime-context.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/main/services/state-persistence.ts`

**Dependencies:** Task 4, Task 5

**Step 1: Add meetingRecorder to RuntimeContext**

Modify `desktop/src/main/services/runtime-context.ts`:

Add import at top:
```typescript
import type { MeetingRecorder } from "./meeting-recorder";
```

Add to the `services` field in the `RuntimeContext` type (after `appUpdater`):
```typescript
    meetingRecorder?: MeetingRecorder;
```

**Step 2: Add ASR config to AppSettings**

Modify `desktop/src/main/services/state-persistence.ts`:

Add import:
```typescript
import type { AsrConfig } from "@shared/contracts";
```

Extend `AppSettings` type to include:
```typescript
  asrConfig?: AsrConfig;
```

In `loadPersistedState`, after the personal prompt loading section (around line 203), add ASR config extraction:
```typescript
  let asrConfig: AsrConfig | undefined;
  if (settings?.asrConfig) {
    asrConfig = settings.asrConfig;
  }
```

And include `asrConfig` in the returned `PersistedState`. (Add the field to the `PersistedState` type as well.)

**Step 3: Initialize MeetingRecorder in main index**

Modify `desktop/src/main/index.ts`:

Add imports for the new services, then initialize them when building the runtime context. The MeetingRecorder needs:
- `MeetingIntelligenceProvider` (DirectAsrProvider wrapping AsrClient)
- `paths` from directory service
- `getAsrConfig` getter that reads from persisted settings
- `generateSummary` function that uses the existing model client

The exact integration point depends on where `buildRuntimeContext` is called. Add the recorder to `ctx.services.meetingRecorder` before `registerAllIpcHandlers(ctx)`.

**Step 4: Verify compilation**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.main.json 2>&1 | head -20`

**Step 5: Commit**

```bash
git add desktop/src/main/services/runtime-context.ts desktop/src/main/index.ts desktop/src/main/services/state-persistence.ts
git commit -m "feat(desktop): integrate MeetingRecorder into runtime context and state persistence"
```

---

## Task 7: Preload Bridge

**Files:**
- Modify: `desktop/src/preload/index.ts`

**Dependencies:** Task 5

**Step 1: Add meeting methods to preload bridge**

Modify `desktop/src/preload/index.ts`:

Add meeting type imports at the top with other imports:
```typescript
import type { MeetingRecord, MeetingEvent, StructuredTranscript } from "@shared/contracts";
```

Add a new `meetings` namespace to the `myClawAPI` object (follow the existing pattern of auth/windowControls):

```typescript
  // ---- 会议录音 ---------------------------------------------------------------
  meetings: {
    start: (title?: string) =>
      ipcRenderer.invoke("meeting:start", title) as Promise<{ meetingId: string }>,
    stop: () =>
      ipcRenderer.invoke("meeting:stop") as Promise<{ meetingId: string | null }>,
    cancel: () =>
      ipcRenderer.invoke("meeting:cancel") as Promise<{ ok: boolean }>,
    list: () =>
      ipcRenderer.invoke("meeting:list") as Promise<{ items: MeetingRecord[] }>,
    get: (meetingId: string) =>
      ipcRenderer.invoke("meeting:get", meetingId) as Promise<{ meeting: MeetingRecord | null; transcript: StructuredTranscript | null }>,
    delete: (meetingId: string) =>
      ipcRenderer.invoke("meeting:delete", meetingId) as Promise<{ ok: boolean }>,
    updateSpeaker: (meetingId: string, speakerIndex: number, label: string) =>
      ipcRenderer.invoke("meeting:update-speaker", meetingId, speakerIndex, label) as Promise<{ ok: boolean }>,
    /** 高频音频数据推送 — fire-and-forget */
    sendAudioChunk: (chunk: ArrayBuffer) =>
      ipcRenderer.send("meeting:audio-chunk", Buffer.from(chunk)),
    /** 订阅录音事件（实时转写、状态变更） */
    onEvent: (callback: (event: MeetingEvent) => void): UnsubscribeFn =>
      onChannel("meeting:event", callback),
  },
```

**Step 2: Verify compilation**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.main.json 2>&1 | head -20`

**Step 3: Commit**

```bash
git add desktop/src/preload/index.ts
git commit -m "feat(desktop): expose meeting recording API in preload bridge"
```

---

## Task 8: useMeetingRecorder Hook

**Files:**
- Create: `desktop/src/renderer/hooks/useMeetingRecorder.ts`

**Dependencies:** Task 7

**Step 1: Create the recording hook**

Create `desktop/src/renderer/hooks/useMeetingRecorder.ts` with the implementation from design doc section 5.2:
- `getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } })`
- `AudioContext({ sampleRate: 16000 })` + `AnalyserNode` + `ScriptProcessorNode`
- Float32 → Int16 PCM conversion in `onaudioprocess`
- `myClawAPI.meetings.sendAudioChunk()` fire-and-forget
- Subscribe to `myClawAPI.meetings.onEvent()` for real-time transcription updates
- Expose: `status`, `duration`, `partialText`, `confirmedLines`, `analyserNode`, `startRecording`, `stopRecording`, `cancelRecording`

**Step 2: Verify compilation**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.renderer.json 2>&1 | head -20`

**Step 3: Commit**

```bash
git add desktop/src/renderer/hooks/useMeetingRecorder.ts
git commit -m "feat(desktop): add useMeetingRecorder hook for audio capture and real-time transcription"
```

---

## Task 9: Meeting UI Components

**Files:**
- Create: `desktop/src/renderer/components/meeting/AudioWaveform.tsx`
- Create: `desktop/src/renderer/components/meeting/AudioPlayer.tsx`
- Create: `desktop/src/renderer/components/meeting/TranscriptView.tsx`

**Dependencies:** Task 8

**Step 1: Create AudioWaveform component**

Canvas-based real-time waveform visualization using `AnalyserNode.getByteTimeDomainData()`. See design doc section 5.3.

**Step 2: Create AudioPlayer component**

HTML5 `<audio>` element with:
- Play/pause, progress bar, time display
- Speed control (1x/1.5x/2x)
- External `seekToMs` prop for transcript click-to-seek
- `onTimeUpdate` callback

**Step 3: Create TranscriptView component**

Renders `StructuredTranscript` segments as a scrollable list:
- Speaker label (editable on click) + timestamp
- Text content
- Click on any segment → callback with `startMs` for audio seek
- Highlight currently playing segment based on `currentTimeMs` prop

**Step 4: Verify compilation**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.renderer.json 2>&1 | head -20`

**Step 5: Commit**

```bash
git add desktop/src/renderer/components/meeting/
git commit -m "feat(desktop): add meeting UI components — waveform, audio player, transcript view"
```

---

## Task 10: MeetingsPage

**Files:**
- Create: `desktop/src/renderer/pages/MeetingsPage.tsx`

**Dependencies:** Task 8, Task 9

**Step 1: Create MeetingsPage with three view states**

Follow the design doc section 3 (UI mockups). The page manages three states via local React state:
- `view: "list" | "recording" | "detail"`
- `selectedMeetingId: string | null`

**List view:** Fetch meetings via `myClawAPI.meetings.list()`, render as `.glass-card` cards.
**Recording view:** Use `useMeetingRecorder` hook, show waveform + real-time transcript.
**Detail view:** Fetch meeting + transcript via `myClawAPI.meetings.get(id)`, show AudioPlayer + TranscriptView with tab toggle (transcript/summary).

Follow `desktop/docs/ui-style-guide.md`:
- `.page-container` + `.page-header` layout
- `.btn-premium` for start recording button
- `.glass-card` for meeting cards
- `.glass-pill` for status badges

**Step 2: Verify compilation**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.renderer.json 2>&1 | head -20`

**Step 3: Commit**

```bash
git add desktop/src/renderer/pages/MeetingsPage.tsx
git commit -m "feat(desktop): add MeetingsPage with list, recording, and detail views"
```

---

## Task 11: Router & Navigation Integration

**Files:**
- Modify: `desktop/src/renderer/router/index.tsx`
- Modify: `desktop/src/renderer/layouts/AppShell.tsx`

**Dependencies:** Task 10

**Step 1: Add route**

Modify `desktop/src/renderer/router/index.tsx`:

Add import at top:
```typescript
import MeetingsPage from "../pages/MeetingsPage";
```

Add routes inside the `RequireAuth > AppShell` group, after the `/workflows/:id` route:
```typescript
        <Route path="/meetings" element={<MeetingsPage />} />
        <Route path="/meetings/:id" element={<MeetingsPage />} />
```

**Step 2: Add nav icon and nav item**

Modify `desktop/src/renderer/layouts/AppShell.tsx`:

Add a new `IconMeetings` SVG component (microphone icon) after the existing icon definitions:

```typescript
const IconMeetings = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    <path
      fill="currentColor"
      d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"
    />
  </svg>
);
```

Add to `navItems` array, after the `Workflows` entry:
```typescript
  { to: "/meetings", label: "会议录音", icon: IconMeetings, testId: "nav-meetings" },
```

**Step 3: Verify compilation**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.renderer.json 2>&1 | head -20`

**Step 4: Commit**

```bash
git add desktop/src/renderer/router/index.tsx desktop/src/renderer/layouts/AppShell.tsx
git commit -m "feat(desktop): add meetings route and sidebar navigation entry"
```

---

## Task 12: Settings Page ASR Configuration

**Files:**
- Modify: `desktop/src/renderer/pages/SettingsPage.tsx`

**Dependencies:** Task 7

**Step 1: Add ASR tab to SettingsPage**

Modify `desktop/src/renderer/pages/SettingsPage.tsx`:

Extend the `TABS` array:
```typescript
const TABS = ["模型", "通用", "审批", "语音识别"] as const;
```

Add state for ASR config draft and a new tab panel section that renders:
- WebSocket URL input
- Mode radio buttons (online / 2pass)
- SSL checkbox
- HTTP URL input
- Speaker diarization checkbox
- Max speakers number input
- Summary model dropdown
- Test connection button

The save action writes ASR config via a new IPC channel `settings:save-asr` or by extending the existing settings save mechanism.

**Step 2: Verify compilation and visual test**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.renderer.json 2>&1 | head -20`

Start dev server and visually verify the new tab appears with correct fields.

**Step 3: Commit**

```bash
git add desktop/src/renderer/pages/SettingsPage.tsx
git commit -m "feat(desktop): add ASR configuration tab to settings page"
```

---

## Task 13: Prompt Composer Meeting Context Integration

**Files:**
- Modify: `desktop/src/main/services/model-runtime/prompt-composer.ts`

**Dependencies:** Task 4

**Step 1: Add meeting transcript context block**

Modify `desktop/src/main/services/model-runtime/prompt-composer.ts`:

In the `ComposePromptInput` type, add:
```typescript
  meetingContextBlock?: string | null;
```

In the system prompt assembly logic, if `meetingContextBlock` is present, append it as a context section:
```typescript
if (input.meetingContextBlock) {
  contextSections.push(input.meetingContextBlock);
}
```

**Step 2: Wire up in sessions.ts**

When a session has `linkedMeetingId`, load the structured transcript and format it as a context block before passing to prompt composer. This follows the same pattern as `artifactContextBlock`.

**Step 3: Verify compilation**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit --project tsconfig.main.json 2>&1 | head -20`

**Step 4: Commit**

```bash
git add desktop/src/main/services/model-runtime/prompt-composer.ts
git commit -m "feat(desktop): inject meeting transcript context into prompt composer for chat analysis"
```

---

## Execution Summary

| Task | Description | Dependencies | Estimated Steps |
|------|-------------|-------------|----------------|
| 1 | Meeting domain contracts | — | 4 |
| 2 | ASR Client (WebSocket + HTTP) | 1 | 4 |
| 3 | MeetingIntelligenceProvider interface | 1, 2 | 3 |
| 4 | MeetingRecorder service | 1, 2, 3 | 3 |
| 5 | IPC handlers | 4 | 4 |
| 6 | RuntimeContext & main integration | 4, 5 | 5 |
| 7 | Preload bridge | 5 | 3 |
| 8 | useMeetingRecorder hook | 7 | 3 |
| 9 | Meeting UI components | 8 | 5 |
| 10 | MeetingsPage | 8, 9 | 3 |
| 11 | Router & navigation | 10 | 4 |
| 12 | Settings page ASR config | 7 | 3 |
| 13 | Prompt composer integration | 4 | 4 |

**Critical path:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

**Parallelizable:** Task 12 (settings) can run in parallel with Tasks 8-11. Task 13 can run after Task 4.

**Total commits:** 13

// ---------------------------------------------------------------------------
// 会议录音领域类型
// ---------------------------------------------------------------------------

/** 转写稿原子单元 — 一句话。 */
export type TranscriptSegment = {
  /** 说话人编号（离线 ASR 返回）。 */
  speaker: number;
  /** 用户可编辑的说话人名称，如 "张经理"。 */
  speakerLabel?: string;
  /** 识别文本。 */
  text: string;
  /** 音频中的起始时间 (ms)。 */
  startMs: number;
  /** 音频中的结束时间 (ms)。 */
  endMs: number;
};

/** 结构化转写结果 — 离线 ASR 的核心产出。 */
export type StructuredTranscript = {
  segments: TranscriptSegment[];
  speakerCount: number;
  durationMs: number;
  /** 声纹向量，跨分片时传递以保持说话人编号一致。 */
  speakerCenters?: number[][];
};

/** 会议录音状态。 */
export type MeetingStatus =
  | "recording"
  | "transcribing"
  | "summarizing"
  | "done"
  | "failed";

/** 一次会议录音的元数据。 */
export type MeetingRecord = {
  id: string;
  title: string;
  createdAt: string;
  durationMs: number;
  status: MeetingStatus;

  /** 三件套 Artifact ID。 */
  audioArtifactId?: string;
  transcriptArtifactId?: string;
  summaryArtifactId?: string;

  /** 结构化转写数据路径（相对于 meeting 目录）。 */
  structuredTranscriptPath?: string;

  /** 关联的对话 Session ID（用户点「对话分析」时创建）。 */
  linkedSessionId?: string;

  speakerCount?: number;
  /** 用户编辑的说话人标签映射 { 0: "张经理", 1: "李总" }。 */
  speakerLabels?: Record<number, string>;
  errorMessage?: string;
};

/** Main → Renderer 实时转写推送事件。 */
export type MeetingTranscribeEvent = {
  type: "transcribe";
  meetingId: string;
  /** 当前正在识别的句子（持续更新）。 */
  partialText: string;
  /** VAD 断句后的确认文字。 */
  finalText?: string;
  /** 是否为整段录音的最终结果。 */
  isFinal: boolean;
};

/** Main → Renderer 状态变更事件。 */
export type MeetingStatusEvent = {
  type: "status";
  meetingId: string;
  status: MeetingStatus;
  /** 离线转写/纪要生成进度 0-100。 */
  progress?: number;
  errorMessage?: string;
};

export type MeetingEvent = MeetingTranscribeEvent | MeetingStatusEvent;

/** ASR 服务配置（存入 settings.json）。 */
export type AsrConfig = {
  /** 实时流式 ASR WebSocket 地址。 */
  wsUrl: string;
  /** 离线 ASR HTTP 地址。 */
  httpUrl: string;
  /** 识别模式：online（低延迟）或 2pass（更准确）。 */
  mode: "online" | "2pass";
  /** 音频采样率，默认 16000。 */
  audioSampleRate: number;
  /** 是否启用 SSL。 */
  ssl: boolean;
  /** 是否启用说话人识别。 */
  enableSpeaker: boolean;
  /** 最大说话人数。 */
  maxSpeakers: number;
  /** 纪要生成使用的模型 Profile ID，null 表示用默认模型。 */
  summaryModelProfileId: string | null;
};

/** ASR 默认配置。 */
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

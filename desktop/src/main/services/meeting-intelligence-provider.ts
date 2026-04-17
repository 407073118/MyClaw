/**
 * 会议智能处理能力抽象。
 *
 * 当前实现（DirectAsrProvider）直连 ASR 服务 + LLM。
 * 未来可替换为 RemoteMeetingServiceProvider，对接独立的会议智能中间服务。
 */

import type {
  AsrConfig,
  StructuredTranscript,
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
  /** 开始实时流式转写。 */
  startStreaming(config: StreamConfig): StreamingSession;
  /** 提交完整音频，返回结构化转写（含说话人）。 */
  transcribeAudio(
    audioPath: string,
    asrConfig: AsrConfig,
    options?: TranscribeOfflineOptions,
  ): Promise<StructuredTranscript>;
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

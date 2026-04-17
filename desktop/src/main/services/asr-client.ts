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
  /** 推送 PCM 音频帧。 */
  sendAudio(chunk: Buffer): void;
  /** 通知说话结束，等待服务端最终结果。 */
  finish(): Promise<void>;
  /** 注册实时转写回调。 */
  onTranscribe(cb: (event: Omit<MeetingTranscribeEvent, "meetingId">) => void): void;
  /** 关闭连接，释放资源。 */
  destroy(): void;
};

// ---------------------------------------------------------------------------
// 离线识别选项
// ---------------------------------------------------------------------------

export type TranscribeOfflineOptions = {
  modelList?: string;
  maxSpks?: number;
  spkCenter?: number[][];
  /** 音频分片的起始时刻偏移 (ms)，用于多分片场景。 */
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
      logger.info("实时 ASR 连接已建立，已发送配置帧");
    });

    ws.on("message", (data: Buffer) => {
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

    ws.on("error", (err: Error) => {
      logger.error("实时 ASR 连接错误", { error: String(err) });
    });

    ws.on("close", () => {
      connected = false;
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

    // 读取音频文件为 Buffer
    const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(audioPath);
      stream.on("data", (chunk) => chunks.push(chunk as Buffer));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });

    formData.append("audio", new Blob([new Uint8Array(audioBuffer)]), fileName);

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

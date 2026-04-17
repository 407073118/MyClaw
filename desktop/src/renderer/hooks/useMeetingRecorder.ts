import { useCallback, useEffect, useRef, useState } from "react";

import type { MeetingEvent, MeetingStatus } from "@shared/contracts";

/**
 * 会议录音 hook：采集麦克风 PCM → 送 Main → 订阅实时转写事件。
 *
 * 实现细节：
 * - getUserMedia 要求采样率 16kHz、单声道；部分浏览器会忽略该请求，以 AudioContext 重采样兜底
 * - AudioContext 创建后经过 MediaStreamSource → AnalyserNode（对外暴露供波形绘制） → ScriptProcessorNode
 * - ScriptProcessor 回调里把 Float32 → Int16 PCM，并通过 myClawAPI.meetings.sendAudioChunk 透传 Main
 * - 订阅 meeting:event，聚合实时 partialText 和 confirmedLines 供 UI 消费
 */
export type UseMeetingRecorderOptions = {
  sampleRate?: number;
  /** 状态转变回调（recording → transcribing → summarizing → done/failed）。 */
  onStatusChange?: (status: MeetingStatus, meetingId: string) => void;
};

export type UseMeetingRecorderResult = {
  /** 当前录音 UI 状态。 */
  status: "idle" | "starting" | "recording" | "stopping";
  /** 底层会议记录状态（Main 侧推送），可能为 null。 */
  meetingStatus: MeetingStatus | null;
  meetingId: string | null;
  /** 已录制时长（ms）。 */
  durationMs: number;
  /** 实时 partial_text（未确认的当前句）。 */
  partialText: string;
  /** 已确认的句子列表。 */
  confirmedLines: string[];
  /** 最近一次错误信息。 */
  error: string | null;
  /** 提供给 AudioWaveform 组件消费的 AnalyserNode。 */
  analyserNode: AnalyserNode | null;
  startRecording: (title?: string) => Promise<string | null>;
  stopRecording: () => Promise<string | null>;
  cancelRecording: () => Promise<void>;
};

const DEFAULT_SAMPLE_RATE = 16000;

/** Float32 PCM → 16bit Int16 PCM Little Endian。 */
function encodeFloat32ToPcm16(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export function useMeetingRecorder(options?: UseMeetingRecorderOptions): UseMeetingRecorderResult {
  const sampleRate = options?.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const onStatusChange = options?.onStatusChange;

  const [status, setStatus] = useState<UseMeetingRecorderResult["status"]>("idle");
  const [meetingStatus, setMeetingStatus] = useState<MeetingStatus | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [partialText, setPartialText] = useState("");
  const [confirmedLines, setConfirmedLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const durationTimerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const meetingIdRef = useRef<string | null>(null);

  // 订阅 Main 推送的会议事件
  useEffect(() => {
    const unsubscribe = window.myClawAPI.meetings.onEvent((event: MeetingEvent) => {
      // 只关注当前正在进行的会议事件
      if (meetingIdRef.current && event.meetingId !== meetingIdRef.current) {
        return;
      }

      if (event.type === "transcribe") {
        setPartialText(event.partialText ?? "");
        if (event.finalText && event.finalText.trim()) {
          setConfirmedLines((prev) => [...prev, event.finalText!.trim()]);
          setPartialText("");
        }
      } else if (event.type === "status") {
        setMeetingStatus(event.status);
        if (event.errorMessage) {
          setError(event.errorMessage);
        }
        onStatusChange?.(event.status, event.meetingId);
      }
    });
    return unsubscribe;
  }, [onStatusChange]);

  const cleanupCapture = useCallback(() => {
    if (durationTimerRef.current != null) {
      window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch { /* ignore */ }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
    if (audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      ctx.close().catch(() => { /* ignore */ });
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setAnalyserNode(null);
  }, []);

  const startRecording = useCallback(async (title?: string): Promise<string | null> => {
    if (status !== "idle") return meetingIdRef.current;

    setStatus("starting");
    setError(null);
    setPartialText("");
    setConfirmedLines([]);
    setDurationMs(0);
    setMeetingStatus(null);

    try {
      // 1) 先向 Main 申请 meetingId，建立 WebSocket 连接
      const { meetingId: id } = await window.myClawAPI.meetings.start(title);
      meetingIdRef.current = id;
      setMeetingId(id);

      // 2) 获取麦克风权限并构建音频管道
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // 部分浏览器不支持显式 sampleRate，AudioContext 会使用硬件采样率；
      // 通过指定 sampleRate 尝试重采样到 16kHz
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate });
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      setAnalyserNode(analyser);

      // ScriptProcessor 已废弃，但 AudioWorklet 在 Electron 环境下配置更复杂，
      // 会议录音不在热路径上，继续使用 ScriptProcessor 换取实现简洁
      const bufferSize = 4096;
      const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (audioEvent) => {
        const channelData = audioEvent.inputBuffer.getChannelData(0);
        const pcmBuffer = encodeFloat32ToPcm16(channelData);
        window.myClawAPI.meetings.sendAudioChunk(pcmBuffer);
      };

      analyser.connect(processor);
      processor.connect(ctx.destination);

      // 3) 启动计时器
      startTimeRef.current = Date.now();
      durationTimerRef.current = window.setInterval(() => {
        setDurationMs(Date.now() - startTimeRef.current);
      }, 500);

      setStatus("recording");
      setMeetingStatus("recording");

      return id;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      cleanupCapture();
      meetingIdRef.current = null;
      setMeetingId(null);
      setStatus("idle");
      // 同步 Main 侧取消，避免遗留占位记录
      try { await window.myClawAPI.meetings.cancel(); } catch { /* ignore */ }
      return null;
    }
  }, [sampleRate, status, cleanupCapture]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    if (status !== "recording") return meetingIdRef.current;

    setStatus("stopping");
    cleanupCapture();

    try {
      const { meetingId: id } = await window.myClawAPI.meetings.stop();
      setStatus("idle");
      meetingIdRef.current = null;
      return id;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
      return null;
    }
  }, [status, cleanupCapture]);

  const cancelRecording = useCallback(async () => {
    cleanupCapture();
    setStatus("idle");
    setMeetingStatus(null);
    meetingIdRef.current = null;
    setMeetingId(null);
    setDurationMs(0);
    setPartialText("");
    setConfirmedLines([]);

    try { await window.myClawAPI.meetings.cancel(); } catch { /* ignore */ }
  }, [cleanupCapture]);

  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      cleanupCapture();
    };
  }, [cleanupCapture]);

  return {
    status,
    meetingStatus,
    meetingId,
    durationMs,
    partialText,
    confirmedLines,
    error,
    analyserNode,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}

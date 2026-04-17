import { useEffect, useRef, useState } from "react";

/**
 * 会议音频回放组件。
 *
 * - 支持倍速（1x / 1.5x / 2x）
 * - 通过 seekToMs prop 外部控制跳转位置（例如转写稿点击）
 * - onTimeUpdate 回调提供给 TranscriptView 做高亮同步
 */
export type AudioPlayerProps = {
  src: string;
  /** 外部触发的跳转位置（ms），变化时播放头定位到该时间。 */
  seekToMs?: number | null;
  onTimeUpdate?: (currentMs: number) => void;
};

const SPEED_OPTIONS = [1, 1.5, 2] as const;

function formatSeconds(totalSec: number): string {
  if (!Number.isFinite(totalSec)) return "00:00";
  const s = Math.floor(totalSec);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function AudioPlayer({ src, seekToMs, onTimeUpdate }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);

  // 响应外部 seekToMs 变化
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || seekToMs == null) return;
    const target = seekToMs / 1000;
    audio.currentTime = target;
    setCurrentSec(target);
  }, [seekToMs]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
  }, [speed]);

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setDurationSec(audio.duration);
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentSec(audio.currentTime);
    onTimeUpdate?.(Math.floor(audio.currentTime * 1000));
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Number(event.target.value);
    audio.currentTime = next;
    setCurrentSec(next);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: "var(--bg-card)",
        border: "1px solid var(--glass-border)",
        borderRadius: "var(--radius-lg)",
        backdropFilter: "var(--blur-std)",
      }}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setPlaying(false)}
      />

      <button
        type="button"
        className="glass-action-btn glass-action-btn--primary"
        onClick={togglePlay}
        style={{ minWidth: 72 }}
      >
        {playing ? "暂停" : "播放"}
      </button>

      <span style={{ fontSize: 12, color: "var(--text-secondary)", minWidth: 44, textAlign: "right" }}>
        {formatSeconds(currentSec)}
      </span>

      <input
        type="range"
        min={0}
        max={durationSec || 0}
        step={0.1}
        value={currentSec}
        onChange={handleSeek}
        style={{ flex: 1, accentColor: "var(--accent-cyan)" }}
      />

      <span style={{ fontSize: 12, color: "var(--text-secondary)", minWidth: 44 }}>
        {formatSeconds(durationSec)}
      </span>

      <div style={{ display: "flex", gap: 4 }}>
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={`glass-action-btn${s === speed ? " glass-action-btn--primary" : ""}`}
            onClick={() => setSpeed(s)}
            style={{ minWidth: 42 }}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}

export default AudioPlayer;

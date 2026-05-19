import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

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
    <section className="meeting-audio-player meeting-audio-player--compact" data-testid="meeting-audio-player" aria-label="会议录音播放器">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setPlaying(false)}
      />

      <div className="meeting-audio-player__transport" data-testid="meeting-audio-transport">
        <button
          type="button"
          className="meeting-audio-player__play-btn"
          onClick={togglePlay}
          aria-label={playing ? "暂停录音回放" : "播放录音回放"}
        >
          {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          <span>{playing ? "暂停" : "播放"}</span>
        </button>

        <div className="meeting-audio-player__timeline">
          <div className="meeting-audio-player__time-row">
            <span className="meeting-audio-player__time meeting-audio-player__time--current">
              {formatSeconds(currentSec)}
            </span>
            <span className="meeting-audio-player__time">
              {formatSeconds(durationSec)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={durationSec || 0}
            step={0.1}
            value={currentSec}
            onChange={handleSeek}
            className="meeting-audio-player__slider"
            aria-label="播放进度"
          />
        </div>
      </div>

      <div className="meeting-audio-player__speed-panel">
        <span className="meeting-audio-player__speed-label">倍速</span>
        <div className="meeting-audio-player__speed-segmented" data-testid="meeting-speed-segmented" role="group" aria-label="播放倍速">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={`meeting-audio-player__speed-btn${s === speed ? " is-active" : ""}`}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export default AudioPlayer;

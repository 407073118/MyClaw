import { useEffect, useRef } from "react";

/**
 * 录音实时波形可视化。
 *
 * 将外部传入的 AnalyserNode 数据以时域波形方式绘制到 canvas 上。
 * 仅在 analyserNode 可用时运行动画；父组件未启动录音或已停止时，组件会清空画布。
 */
export type AudioWaveformProps = {
  analyserNode: AnalyserNode | null;
  height?: number;
  /** 波形主色，默认使用 accent cyan。 */
  color?: string;
};

export function AudioWaveform({ analyserNode, height = 80, color = "#10a37f" }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 高清屏适配：按 devicePixelRatio 放大内部像素
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();

    if (!analyserNode) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const bufferLength = analyserNode.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      if (!canvasRef.current) return;
      const width = canvas.width / dpr;
      const h = canvas.height / dpr;

      analyserNode.getByteTimeDomainData(dataArray);

      ctx.clearRect(0, 0, width, h);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.beginPath();

      const sliceWidth = width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(width, h / 2);
      ctx.stroke();

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [analyserNode, color]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height,
        display: "block",
        borderRadius: "var(--radius-lg)",
        background: "rgba(0, 0, 0, 0.25)",
        border: "1px solid var(--glass-border)",
      }}
    />
  );
}

export default AudioWaveform;

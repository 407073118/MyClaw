import React from "react";

import type { TimeAssistantSnapshot } from "../../utils/time-assistant-presence";

type TimeAssistantCapsuleProps = {
  open: boolean;
  snapshot: TimeAssistantSnapshot;
  onClose: () => void;
  onOpenTimeCenter: () => void;
};

/** 渲染桌面端全局时间助理胶囊，承接常驻状态与跳转入口。 */
export default function TimeAssistantCapsule({
  open,
  snapshot,
  onClose,
  onOpenTimeCenter,
}: TimeAssistantCapsuleProps) {
  if (!open) {
    return null;
  }

  return (
    <>
      <section
        data-testid="floating-time-capsule"
        className={`time-assistant-capsule time-assistant-capsule--${snapshot.tone}`}
        aria-live="polite"
      >
        <div className="time-assistant-capsule__header">
          <div>
            <span className="time-assistant-capsule__eyebrow">{snapshot.statusLabel}</span>
            <h3 className="time-assistant-capsule__title">{snapshot.title}</h3>
          </div>
          <button
            type="button"
            className="time-assistant-capsule__icon-button"
            aria-label="关闭时间助理胶囊"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <p className="time-assistant-capsule__detail">{snapshot.detail}</p>

        <div className="time-assistant-capsule__facts">
          <span className="time-assistant-capsule__fact">现在 {snapshot.nowLabel}</span>
          {snapshot.nextLabel ? <span className="time-assistant-capsule__fact">下一项 {snapshot.nextLabel}</span> : null}
        </div>

        <div className="time-assistant-capsule__actions">
          <button type="button" className="time-assistant-capsule__action time-assistant-capsule__action--primary" onClick={onOpenTimeCenter}>
            打开时间规划
          </button>
          <button type="button" className="time-assistant-capsule__action" onClick={onClose}>
            先隐藏
          </button>
        </div>
      </section>

      <style>{`
        .time-assistant-capsule {
          position: fixed;
          right: 22px;
          bottom: 22px;
          width: min(360px, calc(100vw - 92px));
          display: grid;
          gap: 12px;
          padding: 14px;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.09);
          background:
            radial-gradient(circle at top right, rgba(34, 197, 94, 0.16), transparent 42%),
            rgba(12, 15, 20, 0.94);
          box-shadow: 0 20px 42px rgba(0, 0, 0, 0.34);
          backdrop-filter: blur(18px);
          z-index: 180;
        }

        .time-assistant-capsule--warning {
          background:
            radial-gradient(circle at top right, rgba(245, 158, 11, 0.2), transparent 42%),
            rgba(12, 15, 20, 0.95);
        }

        .time-assistant-capsule__header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .time-assistant-capsule__eyebrow {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          color: rgba(255, 255, 255, 0.76);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .time-assistant-capsule__title {
          margin: 10px 0 0;
          color: #f8fafc;
          font-size: 18px;
          line-height: 1.2;
        }

        .time-assistant-capsule__icon-button {
          width: 28px;
          height: 28px;
          border: 0;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.78);
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
        }

        .time-assistant-capsule__detail {
          margin: 0;
          color: rgba(255, 255, 255, 0.76);
          font-size: 13px;
          line-height: 1.6;
        }

        .time-assistant-capsule__facts {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .time-assistant-capsule__fact {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.68);
          font-size: 12px;
          font-weight: 600;
        }

        .time-assistant-capsule__actions {
          display: flex;
          gap: 8px;
        }

        .time-assistant-capsule__action {
          border: 0;
          border-radius: 12px;
          min-height: 36px;
          padding: 0 14px;
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.84);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }

        .time-assistant-capsule__action--primary {
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.24), rgba(59, 130, 246, 0.24));
          color: #ffffff;
        }

        @media (max-width: 900px) {
          .time-assistant-capsule {
            right: 12px;
            bottom: 12px;
            width: min(340px, calc(100vw - 24px));
          }
        }
      `}</style>
    </>
  );
}

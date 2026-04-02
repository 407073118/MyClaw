import React, { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../stores/workspace";

export default function WebPanel() {
  const webPanel = useWorkspaceStore((s) => s.webPanel);
  const closeWebPanel = useWorkspaceStore((s) => s.closeWebPanel);
  const setWebPanelWidth = useWorkspaceStore((s) => s.setWebPanelWidth);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // Reset loaded state when view changes
  useEffect(() => {
    setIframeLoaded(false);
  }, [webPanel.viewPath, iframeKey]);

  // Push data to iframe via postMessage after load
  useEffect(() => {
    if (!webPanel.isOpen || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const handleLoad = () => {
      setIframeLoaded(true);
      iframe.contentWindow?.postMessage(
        { type: "skill-data", payload: webPanel.data },
        "*"
      );
    };
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [webPanel.isOpen, webPanel.viewPath, webPanel.data, iframeKey]);

  // Listen for skill-callback messages from iframe
  useEffect(() => {
    if (!webPanel.isOpen) return;
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "skill-callback") {
        console.info("[web-panel] Received callback from view:", e.data);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [webPanel.isOpen]);

  // Drag resize handler
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const startX = e.clientX;
      const startWidth = webPanel.panelWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX;
        const newWidth = Math.max(320, Math.min(720, startWidth + delta));
        setWebPanelWidth(newWidth);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [webPanel.panelWidth, setWebPanelWidth]
  );

  const handleRefresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  if (!webPanel.isOpen || !webPanel.viewPath) return null;

  return (
    <aside
      ref={panelRef}
      className={`web-panel${isDragging ? " dragging" : ""}`}
      style={{ width: webPanel.panelWidth }}
    >
      {/* Drag handle */}
      <div className="wp-drag-handle" onMouseDown={handleMouseDown}>
        <div className="wp-drag-indicator" />
      </div>

      {/* Toolbar */}
      <div className="wp-toolbar">
        <div className="wp-toolbar-left">
          <span className="wp-dot" />
          <span className="wp-title">{webPanel.title}</span>
        </div>
        <div className="wp-toolbar-actions">
          <button
            type="button"
            className="wp-btn"
            onClick={handleRefresh}
            title="刷新"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            type="button"
            className="wp-btn wp-btn-close"
            onClick={closeWebPanel}
            title="关闭面板"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Loading indicator */}
      {!iframeLoaded && (
        <div className="wp-loading">
          <div className="wp-loading-bar" />
        </div>
      )}

      {/* Iframe */}
      <iframe
        key={iframeKey}
        ref={iframeRef}
        src={`file://${webPanel.viewPath.replace(/\\/g, "/")}`}
        className="wp-iframe"
        sandbox="allow-scripts allow-same-origin"
        style={{ opacity: iframeLoaded ? 1 : 0 }}
      />

      <style>{`
        .web-panel {
          position: relative;
          border-left: 1px solid var(--glass-border);
          background: var(--bg-base);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          overflow: hidden;
          min-width: 320px;
          max-width: 720px;
        }

        .web-panel.dragging {
          user-select: none;
        }

        .web-panel.dragging .wp-iframe {
          pointer-events: none;
        }

        /* ---- 拖拽手柄 ---- */
        .wp-drag-handle {
          position: absolute;
          left: -4px;
          top: 0;
          bottom: 0;
          width: 8px;
          cursor: col-resize;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .wp-drag-indicator {
          width: 3px;
          height: 32px;
          border-radius: 2px;
          background: transparent;
          transition: background 0.2s;
        }

        .wp-drag-handle:hover .wp-drag-indicator,
        .web-panel.dragging .wp-drag-indicator {
          background: var(--accent-cyan, #67e8f9);
        }

        /* ---- 顶部工具栏 ---- */
        .wp-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 40px;
          padding: 0 12px 0 14px;
          border-bottom: 1px solid var(--glass-border);
          background: var(--bg-sidebar);
          flex-shrink: 0;
        }

        .wp-toolbar-left {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .wp-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-cyan, #67e8f9);
          flex-shrink: 0;
          box-shadow: 0 0 6px rgba(103, 232, 249, 0.4);
        }

        .wp-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: 0.01em;
        }

        .wp-toolbar-actions {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
        }

        .wp-btn {
          width: 28px;
          height: 28px;
          border: none;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }

        .wp-btn:hover {
          background: rgba(255, 255, 255, 0.06);
          color: var(--text-primary);
        }

        .wp-btn-close:hover {
          background: rgba(239, 68, 68, 0.12);
          color: #fca5a5;
        }

        /* ---- 加载指示器 ---- */
        .wp-loading {
          height: 2px;
          background: rgba(255, 255, 255, 0.04);
          overflow: hidden;
          flex-shrink: 0;
        }

        .wp-loading-bar {
          width: 40%;
          height: 100%;
          background: linear-gradient(90deg, transparent, var(--accent-cyan, #67e8f9), transparent);
          animation: wp-slide 1.2s ease-in-out infinite;
        }

        @keyframes wp-slide {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(350%); }
        }

        /* ---- iframe ---- */
        .wp-iframe {
          flex: 1;
          width: 100%;
          border: none;
          background: #0c0c0c;
          transition: opacity 0.2s ease;
        }
      `}</style>
    </aside>
  );
}

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspace";

const WEB_PANEL_MIN_WIDTH = 320;
const WEB_PANEL_MAX_WIDTH = 1120;

/** 渲染右侧原生 WebContentsView 的停靠壳层，只负责布局、标题栏和 bounds 同步。 */
export default function WebPanel() {
  const webPanel = useWorkspaceStore((s) => s.webPanel);
  const closeWebPanel = useWorkspaceStore((s) => s.closeWebPanel);
  const setWebPanelWidth = useWorkspaceStore((s) => s.setWebPanelWidth);

  const panelRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  /** 把当前 DOM 占位区域同步给主进程里的 WebContentsView。 */
  const reportPanelBounds = useCallback(() => {
    if (!webPanel.isOpen || !window.myClawAPI?.panelSetBounds) {
      return;
    }
    const target = surfaceRef.current ?? panelRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const width = rect.width || (isFullscreen ? window.innerWidth : webPanel.panelWidth);
    const height = rect.height || window.innerHeight;
    void window.myClawAPI.panelSetBounds({
      x: rect.left,
      y: rect.top,
      width,
      height,
    });
  }, [isFullscreen, webPanel.isOpen, webPanel.panelWidth]);

  /** 面板打开或数据变化时，通知主进程加载对应 WebContentsView。 */
  useEffect(() => {
    if (!webPanel.isOpen || !webPanel.viewPath || !window.myClawAPI?.panelOpen) {
      return;
    }
    void window.myClawAPI.panelOpen({
      viewPath: webPanel.viewPath,
      title: webPanel.title,
      data: webPanel.data,
    }).then(() => reportPanelBounds());
  }, [reportPanelBounds, webPanel.data, webPanel.isOpen, webPanel.title, webPanel.viewPath]);

  useLayoutEffect(() => {
    reportPanelBounds();
  }, [reportPanelBounds]);

  useEffect(() => {
    if (!webPanel.isOpen) {
      setIsFullscreen(false);
      void window.myClawAPI?.panelClose?.();
      return;
    }
    const handleResize = () => reportPanelBounds();
    window.addEventListener("resize", handleResize);
    requestAnimationFrame(reportPanelBounds);
    return () => window.removeEventListener("resize", handleResize);
  }, [reportPanelBounds, webPanel.isOpen]);

  // 全屏预览时支持 Esc 退出，符合文件/网页查看器的常见操作预期。
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  /** 处理拖拽开始事件，并在鼠标移动时实时更新面板宽度。 */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const startX = e.clientX;
      const startWidth = webPanel.panelWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX;
        const newWidth = Math.max(WEB_PANEL_MIN_WIDTH, Math.min(WEB_PANEL_MAX_WIDTH, startWidth + delta));
        setWebPanelWidth(newWidth);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        requestAnimationFrame(reportPanelBounds);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [reportPanelBounds, webPanel.panelWidth, setWebPanelWidth]
  );

  /** 刷新主进程中的 WebContentsView，保留当前面板数据。 */
  const handleRefresh = useCallback(() => {
    console.info("[web-panel] 用户请求刷新右侧原生面板", { viewPath: webPanel.viewPath });
    void window.myClawAPI?.panelRefresh?.();
  }, [webPanel.viewPath]);

  /** 切换右侧预览全屏状态，便于阅读宽表格、文档和网页内容。 */
  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((value) => !value);
    requestAnimationFrame(reportPanelBounds);
  }, [reportPanelBounds]);

  /** 关闭右侧面板，同时销毁主进程 WebContentsView。 */
  const handleClose = useCallback(() => {
    console.info("[web-panel] 用户关闭右侧原生面板", { viewPath: webPanel.viewPath });
    void window.myClawAPI?.panelClose?.();
    closeWebPanel();
  }, [closeWebPanel, webPanel.viewPath]);

  if (!webPanel.isOpen || !webPanel.viewPath) return null;

  return (
    <aside
      ref={panelRef}
      className={`web-panel${isDragging ? " dragging" : ""}${isFullscreen ? " fullscreen" : ""}`}
      style={isFullscreen ? undefined : { width: webPanel.panelWidth }}
    >
      {/* 拖拽手柄 */}
      <div className="wp-drag-handle" onMouseDown={handleMouseDown}>
        <div className="wp-drag-indicator" />
      </div>

      {/* 顶部工具栏 */}
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
            aria-label="刷新"
          >
            <RefreshCw size={14} aria-hidden />
          </button>
          <button
            type="button"
            className={`wp-btn wp-btn-fullscreen${isFullscreen ? " is-exit" : ""}`}
            onClick={handleToggleFullscreen}
            aria-label={isFullscreen ? "退出全屏" : "全屏展示"}
            aria-pressed={isFullscreen}
            title={isFullscreen ? "退出全屏" : "全屏展示"}
            data-testid={isFullscreen ? "web-panel-fullscreen-exit" : "web-panel-fullscreen-toggle"}
          >
            {isFullscreen ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
            {isFullscreen ? <span className="wp-btn-label">退出全屏</span> : null}
          </button>
          <button
            type="button"
            className="wp-btn wp-btn-close"
            onClick={handleClose}
            title="关闭面板"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* 原生 WebContentsView 会覆盖在这块占位区域内。 */}
      <div ref={surfaceRef} className="wp-native-surface" data-testid="web-panel-native-surface" aria-hidden />

      <style>{`
        .web-panel {
          position: relative;
          border-left: 1px solid var(--glass-border);
          background: var(--bg-base);
          color-scheme: dark;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          overflow: hidden;
          min-width: 320px;
          max-width: min(1120px, calc(100vw - 72px));
        }

        .web-panel.fullscreen {
          position: fixed;
          inset: 0;
          z-index: 2000;
          width: auto;
          max-width: none;
          min-width: 0;
          border-left: none;
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.42);
        }

        .web-panel.dragging {
          user-select: none;
        }

        .web-panel.fullscreen .wp-drag-handle {
          display: none;
        }

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

        .wp-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 40px;
          padding: 0 12px 0 14px;
          border-bottom: 1px solid var(--glass-border);
          background: var(--bg-sidebar);
          flex-shrink: 0;
          z-index: 2200;
        }

        .web-panel.fullscreen .wp-toolbar {
          height: 44px;
          padding: 0 14px 0 16px;
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

        .wp-btn-fullscreen.is-exit {
          width: auto;
          gap: 6px;
          padding: 0 10px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-secondary);
        }

        .wp-btn-close:hover {
          background: rgba(239, 68, 68, 0.12);
          color: #fca5a5;
        }

        .wp-btn-label {
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }

        .wp-native-surface {
          flex: 1;
          min-height: 0;
          background: #0c0c0c;
        }

      `}</style>
    </aside>
  );
}

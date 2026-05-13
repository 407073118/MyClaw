import React, { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { FILE_VIEWER_PANEL_PATH } from "@shared/contracts";
import { useWorkspaceStore } from "../stores/workspace";
import FileViewerPanel from "./FileViewerPanel";

const WEB_PANEL_MIN_WIDTH = 320;
const WEB_PANEL_MAX_WIDTH = 1120;

type SkillDataRefPayload = {
  type?: unknown;
  skillId?: unknown;
  dataRef?: unknown;
};

/** 渲染 Skill 侧边 Web 面板，并负责 iframe 通信与拖拽调宽。 */
export default function WebPanel() {
  const webPanel = useWorkspaceStore((s) => s.webPanel);
  const closeWebPanel = useWorkspaceStore((s) => s.closeWebPanel);
  const setWebPanelWidth = useWorkspaceStore((s) => s.setWebPanelWidth);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastPostedSkillDataRef = useRef<{ viewPath: string | null; iframeKey: number; data: unknown } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFileViewerPanel =
    webPanel.viewPath === FILE_VIEWER_PANEL_PATH
    || (webPanel.data as { panelKind?: unknown } | null)?.panelKind === "file-viewer";

  /** 向已加载的 Skill iframe 推送结构化数据，保证同一页面二次打开也能刷新内容。 */
  const postSkillDataToIframe = useCallback(() => {
    if (isFileViewerPanel || !webPanel.isOpen || !iframeRef.current?.contentWindow) {
      return;
    }
    iframeRef.current.contentWindow.postMessage(
      { type: "skill-data", payload: webPanel.data },
      "*",
    );
    lastPostedSkillDataRef.current = {
      viewPath: webPanel.viewPath,
      iframeKey,
      data: webPanel.data,
    };
    console.info("[web-panel] 已向 Skill iframe 推送数据", {
      viewPath: webPanel.viewPath,
      hasData: webPanel.data != null,
    });
  }, [iframeKey, isFileViewerPanel, webPanel.data, webPanel.isOpen, webPanel.viewPath]);

  // 面板关闭后退出全屏，避免下一次打开时继承旧的沉浸状态。
  useEffect(() => {
    if (!webPanel.isOpen) {
      setIsFullscreen(false);
    }
  }, [webPanel.isOpen]);

  // 视图切换或主动刷新后，重置 iframe 加载状态。
  useEffect(() => {
    lastPostedSkillDataRef.current = null;
    if (isFileViewerPanel) {
      setIframeLoaded(true);
      return;
    }
    setIframeLoaded(false);
  }, [webPanel.viewPath, iframeKey, isFileViewerPanel]);

  /** 处理 iframe 加载完成事件，并立即把结构化数据推送给子页面。 */
  const handleIframeLoad = useCallback(() => {
    setIframeLoaded(true);
    postSkillDataToIframe();
  }, [postSkillDataToIframe]);

  /** 处理 HTML 面板主动请求的本地 dataRef，并只通过宿主受控 IPC 读取。 */
  const handleSkillDataRefRequest = useCallback(async (request: Record<string, unknown>) => {
    const currentDataRef = webPanel.data as SkillDataRefPayload | null;
    const skillId = typeof request.skillId === "string"
      ? request.skillId
      : typeof currentDataRef?.skillId === "string"
        ? currentDataRef.skillId
        : "";
    const dataRef = typeof request.dataRef === "string"
      ? request.dataRef
      : typeof currentDataRef?.dataRef === "string"
        ? currentDataRef.dataRef
        : "";
    const requestId = typeof request.requestId === "string" ? request.requestId : "";

    if (!skillId || !dataRef || !window.myClawAPI?.webPanelReadSkillDataRef) {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "skill-data-ref-result",
          requestId,
          success: false,
          error: "缺少 skillId、dataRef 或宿主读取接口。",
        },
        "*",
      );
      return;
    }

    const result = await window.myClawAPI.webPanelReadSkillDataRef(skillId, dataRef);
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "skill-data-ref-result",
        requestId,
        success: result.success,
        payload: result.data,
        error: result.error,
      },
      "*",
    );
    console.info("[web-panel] 已响应 HTML 面板 dataRef 读取请求", {
      skillId,
      dataRef,
      success: result.success,
    });
  }, [webPanel.data]);

  // 同一个 HTML 面板已加载时，后续 skill_view/openWebPanel 更新 data 也要推送给 iframe。
  useEffect(() => {
    if (isFileViewerPanel || !webPanel.isOpen || !iframeLoaded) {
      return;
    }
    const lastPosted = lastPostedSkillDataRef.current;
    if (
      lastPosted
      && lastPosted.viewPath === webPanel.viewPath
      && lastPosted.iframeKey === iframeKey
      && Object.is(lastPosted.data, webPanel.data)
    ) {
      return;
    }
    postSkillDataToIframe();
  }, [iframeKey, iframeLoaded, isFileViewerPanel, postSkillDataToIframe, webPanel.data, webPanel.isOpen, webPanel.viewPath]);

  // 监听 iframe 回传的回调消息，便于后续接入更复杂的交互。
  useEffect(() => {
    if (isFileViewerPanel) return;
    if (!webPanel.isOpen) return;
    const handleMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) {
        return;
      }
      if (e.data?.type === "skill-callback") {
        if (e.data.action === "read-data-ref") {
          void handleSkillDataRefRequest(e.data as Record<string, unknown>);
          return;
        }
        console.info("[web-panel] Received callback from view:", e.data);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleSkillDataRefRequest, webPanel.isOpen, isFileViewerPanel]);

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
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [webPanel.panelWidth, setWebPanelWidth]
  );

  /** 强制刷新 iframe，重新加载当前 Web 面板视图。 */
  const handleRefresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  /** 切换右侧预览全屏状态，便于阅读宽表格、文档和网页内容。 */
  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((value) => !value);
  }, []);

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
          {!isFileViewerPanel && (
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
          )}
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
            onClick={closeWebPanel}
            title="关闭面板"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {isFullscreen && (
        <button
          type="button"
          className="wp-floating-exit"
          onClick={handleToggleFullscreen}
          aria-label="退出全屏"
          title="退出全屏"
          data-testid="web-panel-floating-fullscreen-exit"
        >
          <Minimize2 size={15} aria-hidden />
          <span>退出全屏</span>
        </button>
      )}

      {/* 加载指示器 */}
      {!isFileViewerPanel && !iframeLoaded && (
        <div className="wp-loading">
          <div className="wp-loading-bar" />
        </div>
      )}

      {/* 内容 iframe */}
      {isFileViewerPanel ? (
        <div className="wp-file-viewer">
          <FileViewerPanel data={webPanel.data} />
        </div>
      ) : (
        <iframe
          key={iframeKey}
          ref={iframeRef}
          src={`file://${webPanel.viewPath.replace(/\\/g, "/")}`}
          className="wp-iframe"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={handleIframeLoad}
          style={{ opacity: iframeLoaded ? 1 : 0 }}
        />
      )}

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
          scrollbar-width: thin;
          scrollbar-color: hsla(0, 0%, 100%, 0.15) transparent;
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

        .web-panel::-webkit-scrollbar,
        .wp-iframe::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        .web-panel::-webkit-scrollbar-track,
        .wp-iframe::-webkit-scrollbar-track {
          background: transparent;
        }

        .web-panel::-webkit-scrollbar-thumb,
        .wp-iframe::-webkit-scrollbar-thumb {
          background: hsla(0, 0%, 100%, 0.15);
          border-radius: 999px;
        }

        .web-panel::-webkit-scrollbar-thumb:hover,
        .wp-iframe::-webkit-scrollbar-thumb:hover {
          background: hsla(0, 0%, 100%, 0.28);
        }

        .web-panel.dragging {
          user-select: none;
        }

        .web-panel.dragging .wp-iframe {
          pointer-events: none;
        }

        .web-panel.fullscreen .wp-drag-handle {
          display: none;
        }

        .wp-file-viewer {
          flex: 1;
          min-height: 0;
          overflow: hidden;
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

        .web-panel.fullscreen .wp-toolbar {
          height: 44px;
          padding: 0 14px 0 16px;
        }

        .wp-floating-exit {
          position: fixed;
          top: 12px;
          right: 14px;
          z-index: 2200;
          height: 34px;
          padding: 0 12px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 7px;
          background: rgba(12, 13, 15, 0.9);
          color: var(--text-primary);
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.34);
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .wp-floating-exit:hover {
          border-color: rgba(255, 255, 255, 0.3);
          background: rgba(28, 30, 34, 0.96);
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

        .wp-btn-fullscreen.is-exit {
          width: auto;
          gap: 6px;
          padding: 0 10px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-secondary);
        }

        .wp-btn-fullscreen.is-exit:hover {
          border-color: rgba(255, 255, 255, 0.22);
          background: rgba(255, 255, 255, 0.09);
          color: var(--text-primary);
        }

        .wp-btn-label {
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
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

        /* ---- 内容 iframe ---- */
        .wp-iframe {
          flex: 1;
          width: 100%;
          border: none;
          background: #0c0c0c;
          color-scheme: dark;
          transition: opacity 0.2s ease;
        }
      `}</style>
    </aside>
  );
}

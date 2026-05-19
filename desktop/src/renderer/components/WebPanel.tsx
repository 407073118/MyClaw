import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Plus, RefreshCw, X } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspace";

const WEB_PANEL_MIN_WIDTH = 320;
const WEB_PANEL_MAX_WIDTH = 1120;
const WEB_PANEL_APP_TITLEBAR_HEIGHT = 36;
const WEB_PANEL_FULLSCREEN_TOOLBAR_HEIGHT = 44;
type PanelLoadState = "idle" | "loading" | "ready" | "error";

/** 把受 webFrame 缩放影响的 DOM 坐标换算回主窗口坐标，避免原生 view 错位。 */
function getPanelBoundsScale(): number {
  const scale = window.myClawAPI?.rendererZoomFactor;
  return typeof scale === "number" && Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** 渲染右侧原生 WebContentsView 的停靠壳层，只负责布局、标题栏和 bounds 同步。 */
export default function WebPanel() {
  const webPanel = useWorkspaceStore((s) => s.webPanel);
  const closeWebPanel = useWorkspaceStore((s) => s.closeWebPanel);
  const selectWebPanelTab = useWorkspaceStore((s) => s.selectWebPanelTab);
  const closeWebPanelTab = useWorkspaceStore((s) => s.closeWebPanelTab);
  const createWebPanelTab = useWorkspaceStore((s) => s.createWebPanelTab);
  const setWebPanelWidth = useWorkspaceStore((s) => s.setWebPanelWidth);
  const panelTabs = webPanel.tabs?.length
    ? webPanel.tabs
    : webPanel.viewPath
      ? [{
          id: "legacy-web-panel",
          viewPath: webPanel.viewPath,
          title: webPanel.title,
          data: webPanel.data,
          createdAt: new Date().toISOString(),
        }]
      : [];
  const activeTab = panelTabs.find((tab) => tab.id === webPanel.activeTabId) ?? panelTabs[0] ?? null;
  const activeViewPath = activeTab?.viewPath ?? null;
  const activeTitle = activeTab?.title ?? "";
  const activeData = activeTab?.data ?? null;

  const panelRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const latestDataRef = useRef<unknown>(activeData);
  const lastSentDataRef = useRef<unknown>(null);
  const openRequestIdRef = useRef(0);
  const currentOpenKeyRef = useRef<string | null>(null);
  const panelWidthRef = useRef(webPanel.panelWidth);
  const fullscreenRef = useRef(false);
  const hasSentDataRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelLoadState, setPanelLoadState] = useState<PanelLoadState>("idle");
  const [panelLoadError, setPanelLoadError] = useState<string | null>(null);

  useEffect(() => {
    latestDataRef.current = activeData;
  }, [activeData]);

  useEffect(() => {
    panelWidthRef.current = webPanel.panelWidth;
  }, [webPanel.panelWidth]);

  useLayoutEffect(() => {
    fullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  /** 把当前 DOM 占位区域同步给主进程里的 WebContentsView。 */
  const reportPanelBounds = useCallback(() => {
    if (!webPanel.isOpen || !window.myClawAPI?.panelSetBounds) {
      return;
    }
    const target = surfaceRef.current ?? panelRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const isFullscreenSnapshot = fullscreenRef.current;
    const isUnmeasuredFullscreenSurface = isFullscreenSnapshot && target === surfaceRef.current && rect.height === 0;
    const fullscreenContentTop = WEB_PANEL_APP_TITLEBAR_HEIGHT + WEB_PANEL_FULLSCREEN_TOOLBAR_HEIGHT;
    const width = rect.width || (isFullscreenSnapshot ? window.innerWidth : panelWidthRef.current);
    const height = rect.height || (isUnmeasuredFullscreenSurface
      ? Math.max(0, window.innerHeight - fullscreenContentTop)
      : window.innerHeight);
    const y = isUnmeasuredFullscreenSurface ? fullscreenContentTop : rect.top;
    const boundsScale = getPanelBoundsScale();
    void window.myClawAPI.panelSetBounds({
      x: rect.left * boundsScale,
      y: y * boundsScale,
      width: width * boundsScale,
      height: height * boundsScale,
    });
  }, [webPanel.isOpen]);

  /** 面板首次打开或路径切换时，通知主进程加载对应 WebContentsView。 */
  useEffect(() => {
    if (!webPanel.isOpen || !activeViewPath || !window.myClawAPI?.panelOpen) {
      return;
    }
    const openKey = `${activeViewPath}\n${activeTitle}`;
    if (currentOpenKeyRef.current === openKey) {
      return;
    }
    currentOpenKeyRef.current = openKey;
    const requestId = openRequestIdRef.current + 1;
    openRequestIdRef.current = requestId;
    const initialData = latestDataRef.current;
    hasSentDataRef.current = false;
    lastSentDataRef.current = null;
    setPanelLoadState("loading");
    setPanelLoadError(null);
    console.info("[web-panel] 请求打开右侧原生面板", {
      title: activeTitle,
      viewPath: activeViewPath,
    });
    void window.myClawAPI.panelOpen({
      viewPath: activeViewPath,
      title: activeTitle,
      data: initialData,
    }).then((result) => {
      if (openRequestIdRef.current !== requestId) {
        return;
      }
      if (!result?.success) {
        const error = result?.error || "右侧面板加载失败。";
        currentOpenKeyRef.current = null;
        console.warn("[web-panel] 右侧原生面板打开失败", {
          title: activeTitle,
          viewPath: activeViewPath,
          error,
        });
        setPanelLoadState("error");
        setPanelLoadError(error);
        return;
      }
      hasSentDataRef.current = true;
      lastSentDataRef.current = initialData;
      setPanelLoadState("ready");
      console.info("[web-panel] 右侧原生面板已打开", {
        title: activeTitle,
        viewPath: activeViewPath,
      });
      requestAnimationFrame(reportPanelBounds);
    }).catch((error: unknown) => {
      if (openRequestIdRef.current !== requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      currentOpenKeyRef.current = null;
      console.warn("[web-panel] 右侧原生面板打开异常", {
        title: activeTitle,
        viewPath: activeViewPath,
        error: message,
      });
      setPanelLoadState("error");
      setPanelLoadError(message);
    });
  }, [activeTitle, activeViewPath, reportPanelBounds, webPanel.isOpen]);

  /** 面板数据变化时只注入数据，不重新创建 WebContentsView。 */
  useEffect(() => {
    if (!webPanel.isOpen || !activeViewPath || panelLoadState !== "ready") {
      return;
    }
    if (!hasSentDataRef.current || Object.is(lastSentDataRef.current, activeData)) {
      return;
    }
    lastSentDataRef.current = activeData;
    console.info("[web-panel] 更新右侧原生面板数据", {
      title: activeTitle,
      viewPath: activeViewPath,
    });
    const updateTask = window.myClawAPI?.panelUpdateData?.(activeData);
    if (!updateTask) {
      return;
    }
    void updateTask.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[web-panel] 更新右侧原生面板数据失败", {
        title: activeTitle,
        viewPath: activeViewPath,
        error: message,
      });
    });
  }, [activeData, activeTitle, activeViewPath, panelLoadState, webPanel.isOpen]);

  useEffect(() => {
    if (!webPanel.isOpen || activeViewPath) {
      return;
    }
    openRequestIdRef.current += 1;
    currentOpenKeyRef.current = null;
    hasSentDataRef.current = false;
    lastSentDataRef.current = null;
    setPanelLoadState("idle");
    setPanelLoadError(null);
    void window.myClawAPI?.panelClose?.();
  }, [activeViewPath, webPanel.isOpen]);

  useLayoutEffect(() => {
    reportPanelBounds();
  }, [isFullscreen, reportPanelBounds, webPanel.panelWidth]);

  useEffect(() => {
    if (!webPanel.isOpen) {
      openRequestIdRef.current += 1;
      currentOpenKeyRef.current = null;
      hasSentDataRef.current = false;
      lastSentDataRef.current = null;
      setPanelLoadState("idle");
      setPanelLoadError(null);
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
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      let latestWidth = startWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      console.info("[web-panel] 开始拖拽调整右侧面板宽度", { startWidth });

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX;
        const newWidth = Math.max(WEB_PANEL_MIN_WIDTH, Math.min(WEB_PANEL_MAX_WIDTH, startWidth + delta));
        latestWidth = newWidth;
        setWebPanelWidth(newWidth);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        console.info("[web-panel] 完成拖拽调整右侧面板宽度", { startWidth, finalWidth: latestWidth });
        requestAnimationFrame(reportPanelBounds);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [reportPanelBounds, webPanel.panelWidth, setWebPanelWidth]
  );

  /** 支持键盘微调右侧面板宽度，保证拖拽线不可精确点击时仍有可达操作。 */
  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? 1 : -1;
      const nextWidth = Math.max(WEB_PANEL_MIN_WIDTH, Math.min(WEB_PANEL_MAX_WIDTH, webPanel.panelWidth + direction * 32));
      console.info("[web-panel] 用户通过键盘调整右侧面板宽度", {
        key: event.key,
        previousWidth: webPanel.panelWidth,
        nextWidth,
      });
      setWebPanelWidth(nextWidth);
      requestAnimationFrame(reportPanelBounds);
    },
    [reportPanelBounds, setWebPanelWidth, webPanel.panelWidth]
  );

  /** 刷新主进程中的 WebContentsView，保留当前面板数据。 */
  const handleRefresh = useCallback(() => {
    if (!activeViewPath) {
      console.info("[web-panel] 用户请求刷新空白右侧面板，已忽略");
      return;
    }
    console.info("[web-panel] 用户请求刷新右侧原生面板", { viewPath: activeViewPath });
    setPanelLoadState("loading");
    setPanelLoadError(null);
    if (panelLoadState === "error" && activeViewPath) {
      const retryData = latestDataRef.current;
      const retryRequestId = openRequestIdRef.current + 1;
      openRequestIdRef.current = retryRequestId;
      currentOpenKeyRef.current = `${activeViewPath}\n${activeTitle}`;
      console.info("[web-panel] 重新打开失败后的右侧原生面板", {
        title: activeTitle,
        viewPath: activeViewPath,
      });
      const retryTask = window.myClawAPI?.panelOpen?.({
        viewPath: activeViewPath,
        title: activeTitle,
        data: retryData,
      });
      if (!retryTask) {
        currentOpenKeyRef.current = null;
        setPanelLoadState("error");
        setPanelLoadError("右侧面板打开通道不可用。");
        return;
      }
      void retryTask.then((result) => {
        if (openRequestIdRef.current !== retryRequestId) {
          return;
        }
        if (!result?.success) {
          const error = result?.error || "右侧面板重新加载失败。";
          currentOpenKeyRef.current = null;
          setPanelLoadState("error");
          setPanelLoadError(error);
          console.warn("[web-panel] 重新打开右侧原生面板失败", { viewPath: activeViewPath, error });
          return;
        }
        hasSentDataRef.current = true;
        lastSentDataRef.current = retryData;
        setPanelLoadState("ready");
        requestAnimationFrame(reportPanelBounds);
      }).catch((error: unknown) => {
        if (openRequestIdRef.current !== retryRequestId) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        currentOpenKeyRef.current = null;
        setPanelLoadState("error");
        setPanelLoadError(message);
        console.warn("[web-panel] 重新打开右侧原生面板异常", { viewPath: activeViewPath, error: message });
      });
      return;
    }
    const refreshTask = window.myClawAPI?.panelRefresh?.();
    if (!refreshTask) {
      setPanelLoadState("error");
      setPanelLoadError("右侧面板刷新通道不可用。");
      return;
    }
    void refreshTask.then((result) => {
      if (!result?.success) {
        const error = result?.error || "右侧面板刷新失败。";
        setPanelLoadState("error");
        setPanelLoadError(error);
        console.warn("[web-panel] 刷新右侧原生面板失败", { viewPath: activeViewPath, error });
        return;
      }
      hasSentDataRef.current = true;
      lastSentDataRef.current = latestDataRef.current;
      setPanelLoadState("ready");
      requestAnimationFrame(reportPanelBounds);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setPanelLoadState("error");
      setPanelLoadError(message);
      console.warn("[web-panel] 刷新右侧原生面板异常", { viewPath: activeViewPath, error: message });
    });
  }, [activeTitle, activeViewPath, panelLoadState, reportPanelBounds]);

  /** 切换右侧预览全屏状态，便于阅读宽表格、文档和网页内容。 */
  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((value) => !value);
  }, []);

  /** 关闭右侧面板，同时销毁主进程 WebContentsView。 */
  const handleClose = useCallback(() => {
    console.info("[web-panel] 用户关闭右侧原生面板", { viewPath: activeViewPath });
    void window.myClawAPI?.panelClose?.();
    closeWebPanel();
  }, [activeViewPath, closeWebPanel]);

  /** 切换右侧工作区标签页，并让主进程加载该 tab 对应内容。 */
  const handleSelectTab = useCallback((tabId: string) => {
    console.info("[web-panel] 用户切换右侧标签页", { tabId });
    selectWebPanelTab(tabId);
  }, [selectWebPanelTab]);

  /** 关闭指定右侧标签页，最后一个 tab 关闭时收起整个右侧工作区。 */
  const handleCloseTab = useCallback((event: React.MouseEvent, tabId: string) => {
    event.stopPropagation();
    console.info("[web-panel] 用户关闭右侧标签页", { tabId });
    closeWebPanelTab(tabId);
  }, [closeWebPanelTab]);

  /** 新增一个空白右侧标签页，保持 Codex App 一样的可扩展工作区模型。 */
  const handleCreateTab = useCallback(() => {
    console.info("[web-panel] 用户新增右侧标签页");
    createWebPanelTab();
  }, [createWebPanelTab]);

  if (!webPanel.isOpen) return null;

  return (
    <aside
      ref={panelRef}
      className={`web-panel${isDragging ? " dragging" : ""}${isFullscreen ? " fullscreen" : ""} is-${panelLoadState}`}
      style={isFullscreen ? undefined : { width: webPanel.panelWidth }}
    >
      {/* 拖拽手柄 */}
      <div
        className="wp-drag-handle"
        role="separator"
        aria-label="调整右侧 WebPanel 宽度"
        aria-orientation="vertical"
        aria-valuemin={WEB_PANEL_MIN_WIDTH}
        aria-valuemax={WEB_PANEL_MAX_WIDTH}
        aria-valuenow={webPanel.panelWidth}
        tabIndex={0}
        data-testid="web-panel-resize-handle"
        onMouseDown={handleMouseDown}
        onKeyDown={handleResizeKeyDown}
      >
        <div className="wp-drag-indicator" />
      </div>

      {/* 顶部工具栏 */}
      <div className="wp-toolbar">
        <div className="wp-toolbar-left">
          <div className="wp-tabs" role="tablist" aria-label="右侧面板标签页">
            {panelTabs.map((tab) => (
              <div
                key={tab.id}
                role="tab"
                tabIndex={0}
                aria-selected={tab.id === activeTab?.id}
                className={`wp-tab${tab.id === activeTab?.id ? " active" : ""}`}
                onClick={() => handleSelectTab(tab.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleSelectTab(tab.id);
                  }
                }}
                title={tab.title}
              >
                <span className="wp-tab-close-dot" aria-hidden>
                  {tab.id === activeTab?.id ? <X size={11} /> : null}
                </span>
                <span className="wp-tab-title">{tab.title}</span>
                <button
                  type="button"
                  className="wp-tab-close"
                  onClick={(event) => handleCloseTab(event, tab.id)}
                  aria-label={`关闭 ${tab.title}`}
                >
                  <X size={11} aria-hidden />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="wp-tab-add"
              onClick={handleCreateTab}
              title="新增面板"
              aria-label="新增面板"
              data-testid="web-panel-tab-add"
            >
              <Plus size={15} aria-hidden />
            </button>
          </div>
        </div>
        <div className="wp-toolbar-actions">
          <button
            type="button"
            className="wp-btn"
            onClick={handleRefresh}
            title="刷新"
            aria-label="刷新"
            disabled={!activeViewPath}
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
            aria-label="关闭面板"
            title="关闭面板"
          >
            <PanelRightClose size={14} aria-hidden />
          </button>
        </div>
      </div>

      {/* 原生 WebContentsView 会覆盖在这块占位区域内。 */}
      <div ref={surfaceRef} className="wp-native-surface" data-testid="web-panel-native-surface" aria-hidden />

      {!activeViewPath ? (
        <div className="wp-empty-panel" data-testid="web-panel-empty-state">
          <div className="wp-empty-panel-icon" aria-hidden>
            <PanelRightOpen size={18} />
          </div>
          <strong>右侧 WebPanel</strong>
          <span>从聊天、文件或 Skill 打开内容后，会在这里停靠成独立标签页。</span>
        </div>
      ) : null}

      {panelLoadState === "loading" ? (
        <div className="wp-status-overlay" aria-live="polite">
          <Loader2 className="wp-status-spinner" size={18} aria-hidden />
          <div>
            <strong>正在加载预览</strong>
            <span>保持会话运行，右侧内容就绪后会自动接管。</span>
          </div>
        </div>
      ) : null}

      {panelLoadState === "error" ? (
        <div className="wp-status-overlay wp-status-error" role="alert">
          <AlertCircle size={18} aria-hidden />
          <div>
            <strong>预览加载失败</strong>
            <span>{panelLoadError ?? "右侧面板暂时无法显示内容。"}</span>
          </div>
          <button type="button" className="wp-status-action" onClick={handleRefresh}>
            重试
          </button>
        </div>
      ) : null}

      <style>{`
        .web-panel {
          position: relative;
          border-left: 1px solid var(--glass-border);
          background: var(--bg-base);
          color-scheme: dark;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          overflow: visible;
          min-width: 320px;
          max-width: min(1120px, calc(100vw - 72px));
        }

        .web-panel.fullscreen {
          position: fixed;
          left: 0;
          right: 0;
          top: 36px;
          bottom: 0;
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
          left: -12px;
          top: 0;
          bottom: 0;
          width: 16px;
          cursor: col-resize;
          z-index: 2300;
          display: flex;
          align-items: center;
          justify-content: center;
          touch-action: none;
          box-sizing: border-box;
        }

        .wp-drag-indicator {
          width: 3px;
          height: 32px;
          border-radius: 2px;
          background: transparent;
          transition: background 0.2s;
        }

        .wp-drag-handle:hover,
        .wp-drag-handle:focus-visible {
          background: rgba(45, 212, 191, 0.08);
        }

        .wp-drag-handle:focus-visible {
          outline: 1px solid rgba(45, 212, 191, 0.36);
          outline-offset: -1px;
        }

        .wp-drag-handle:hover .wp-drag-indicator,
        .wp-drag-handle:focus-visible .wp-drag-indicator,
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
          position: relative;
          height: 44px;
          padding: 0 14px 0 16px;
          background: rgba(12, 12, 13, 0.98);
          border-bottom-color: rgba(255, 255, 255, 0.10);
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24);
        }

        .wp-toolbar-left {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex: 1;
        }

        .wp-tabs {
          display: flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          width: 100%;
          overflow: hidden;
        }

        .wp-tab {
          min-width: 0;
          max-width: 180px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 0 8px;
          border-radius: 7px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          outline: none;
        }

        .wp-tab:hover {
          background: rgba(255, 255, 255, 0.045);
          color: var(--text-primary);
        }

        .wp-tab.active {
          background: rgba(255, 255, 255, 0.075);
          border-color: rgba(255, 255, 255, 0.10);
          color: var(--text-primary);
        }

        .wp-tab:focus-visible,
        .wp-tab-add:focus-visible,
        .wp-tab-close:focus-visible {
          box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.35);
        }

        .wp-tab-close-dot {
          width: 12px;
          height: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .wp-tab-title {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          font-weight: 600;
          line-height: 1;
        }

        .wp-tab-close {
          width: 18px;
          height: 18px;
          border: 0;
          border-radius: 5px;
          background: transparent;
          color: var(--text-muted);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          flex-shrink: 0;
        }

        .wp-tab:hover .wp-tab-close,
        .wp-tab.active .wp-tab-close {
          opacity: 1;
        }

        .wp-tab-close:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-primary);
        }

        .wp-tab-add {
          width: 28px;
          height: 28px;
          border: 0;
          border-radius: 7px;
          background: transparent;
          color: var(--text-muted);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
        }

        .wp-tab-add:hover {
          background: rgba(255, 255, 255, 0.06);
          color: var(--text-primary);
        }

        .wp-title {
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

        .wp-btn:disabled,
        .wp-btn:disabled:hover {
          cursor: not-allowed;
          opacity: 0.38;
          background: transparent;
          color: var(--text-muted);
        }

        .wp-btn-fullscreen.is-exit {
          width: auto;
          gap: 6px;
          padding: 0 10px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-secondary);
        }

        .web-panel.fullscreen .wp-btn-fullscreen.is-exit {
          border-color: rgba(45, 212, 191, 0.30);
          background: rgba(45, 212, 191, 0.10);
          color: var(--accent-cyan, #67e8f9);
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

        .wp-empty-panel {
          position: absolute;
          left: 0;
          right: 0;
          top: 40px;
          bottom: 0;
          z-index: 2100;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 24px;
          background: #0c0c0d;
          color: var(--text-muted);
          text-align: center;
        }

        .web-panel.fullscreen .wp-empty-panel {
          top: 44px;
        }

        .wp-empty-panel-icon {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.10);
          background: rgba(255, 255, 255, 0.045);
          color: var(--text-secondary);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .wp-empty-panel strong {
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 650;
        }

        .wp-empty-panel span {
          max-width: 280px;
          font-size: 12px;
          line-height: 1.55;
        }

        .wp-status-overlay {
          position: absolute;
          left: 0;
          right: 0;
          top: 40px;
          bottom: 0;
          z-index: 2100;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 22px;
          background:
            linear-gradient(180deg, rgba(12, 12, 13, 0.96), rgba(8, 8, 9, 0.98)),
            radial-gradient(circle at 50% 22%, rgba(45, 212, 191, 0.08), transparent 34%);
          color: var(--text-secondary);
          text-align: left;
        }

        .web-panel.fullscreen .wp-status-overlay {
          top: 44px;
        }

        .wp-status-overlay > div {
          display: flex;
          flex-direction: column;
          gap: 4px;
          max-width: 320px;
        }

        .wp-status-overlay strong {
          color: var(--text-primary);
          font-size: 13px;
          line-height: 1.4;
        }

        .wp-status-overlay span {
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.55;
        }

        .wp-status-spinner {
          color: var(--accent-cyan, #67e8f9);
          animation: wp-spin 0.9s linear infinite;
          flex-shrink: 0;
        }

        .wp-status-error {
          color: #fca5a5;
        }

        .wp-status-action {
          height: 28px;
          padding: 0 10px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
        }

        .wp-status-action:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-primary);
        }

        @keyframes wp-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

      `}</style>
    </aside>
  );
}

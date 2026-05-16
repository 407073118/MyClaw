import { contextBridge, ipcRenderer, webFrame } from "electron";

type PanelMessageHandler = (message: unknown) => void;

const handlers = new Set<PanelMessageHandler>();

/** 把宿主消息派发给新 bridge，旧 message listener 由主进程注入的主世界事件负责。 */
ipcRenderer.on("panel:host-message", (_event, message: unknown) => {
  for (const handler of handlers) {
    handler(message);
  }
});

contextBridge.exposeInMainWorld("myClawPanel", {
  /** 向宿主发送结构化面板消息，替代旧 window.parent.postMessage。 */
  postMessage(message: unknown) {
    ipcRenderer.send("panel:message", message);
  },

  /** 订阅宿主发来的结构化消息。 */
  onMessage(callback: PanelMessageHandler) {
    handlers.add(callback);
    return () => handlers.delete(callback);
  },

  /** 调用宿主受控动作，例如打开本地应用、定位文件或读取 dataRef。 */
  invokeAction(action: string, data?: unknown) {
    return ipcRenderer.invoke("panel:action", { action, data });
  },
});

const legacyShim = `
(() => {
  if (window.__myClawPanelShimInstalled) return;
  Object.defineProperty(window, "__myClawPanelShimInstalled", { value: true });
  const originalPostMessage = window.postMessage.bind(window);
  Object.defineProperty(window, "postMessage", {
    configurable: true,
    value(message, targetOrigin, transfer) {
      if (message && typeof message === "object" && message.type === "skill-callback") {
        window.myClawPanel?.postMessage(message);
        return;
      }
      return originalPostMessage(message, targetOrigin, transfer);
    },
  });
})();
`;

/** 在页面主世界安装旧 Skill HTML 兼容层，接住 window.parent.postMessage。 */
function installLegacyShim(): void {
  webFrame.executeJavaScript(legacyShim).catch((error: unknown) => {
    ipcRenderer.send("panel:message", {
      type: "skill-callback",
      action: "shim-error",
      data: { error: error instanceof Error ? error.message : String(error) },
    });
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", installLegacyShim, { once: true });
} else {
  installLegacyShim();
}

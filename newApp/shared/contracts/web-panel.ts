/** Skill 执行结果中携带的面板打开指令 */
export interface OpenWebPanelPayload {
  /** view.html 的绝对路径 */
  viewPath: string;
  /** 面板标题 */
  title: string;
  /** 传给 view.html 的结构化数据 */
  data: unknown;
}

/** WebPanel 的运行时状态 */
export interface WebPanelState {
  isOpen: boolean;
  viewPath: string | null;
  title: string;
  data: unknown;
  panelWidth: number;
}

/** view.html 中监听的消息类型 */
export type SkillMessage =
  | { type: "skill-data"; payload: unknown }
  | { type: "skill-update"; payload: unknown }
  | { type: "skill-progress"; current: number; total: number; message?: string }
  | { type: "skill-action"; action: string; params?: unknown };

/** view.html 回传给宿主的消息类型 */
export type SkillCallbackMessage = {
  type: "skill-callback";
  action: string;
  data?: unknown;
};

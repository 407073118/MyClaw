import type {
  CapabilityEvent,
  ComputerAction,
  ComputerCall,
  JsonValue,
} from "@shared/contracts";
import { ToolRiskCategory } from "@shared/contracts";

type BrowserActionResult = {
  success: boolean;
  output: string;
  error?: string;
  imageBase64?: string;
};

type BrowserHarness = {
  clickAt(
    x: number,
    y: number,
    options?: {
      button?: "left" | "right" | "middle";
      clickCount?: number;
      keys?: string[];
    },
  ): Promise<BrowserActionResult>;
  movePointer(x: number, y: number, options?: { keys?: string[] }): Promise<BrowserActionResult>;
  dragPath(path: Array<{ x: number; y: number }>, options?: { keys?: string[] }): Promise<BrowserActionResult>;
  scrollAt(
    deltaX: number,
    deltaY: number,
    options?: { x?: number; y?: number; keys?: string[] },
  ): Promise<BrowserActionResult>;
  typeText(text: string): Promise<BrowserActionResult>;
  wait(milliseconds: number): Promise<BrowserActionResult>;
  pressKey(key: string): Promise<BrowserActionResult>;
  captureComputerState(): Promise<BrowserActionResult>;
};

export type ComputerActionApprovalInput = {
  sessionId?: string | null;
  responseId?: string | null;
  callId: string;
  actionIndex: number;
  action: ComputerAction;
  toolId: string;
  label: string;
  risk: ToolRiskCategory;
  detail: string;
};

export type ComputerActionApprovalResult = {
  approved: boolean;
  reason?: string | null;
};

export type ComputerHarnessExecutionInput = {
  sessionId?: string | null;
  workflowRunId?: string | null;
  responseId?: string | null;
  computerCalls: ComputerCall[];
  signal?: AbortSignal;
};

export type ComputerHarnessExecutionOutput = {
  responseInputItems: Array<Record<string, unknown>>;
  capabilityEvents: CapabilityEvent[];
};

export type ComputerActionHarness = {
  executeCalls(input: ComputerHarnessExecutionInput): Promise<ComputerHarnessExecutionOutput>;
};

export type ComputerActionHarnessDeps = {
  browser: BrowserHarness;
  requestApproval?: (input: ComputerActionApprovalInput) => Promise<ComputerActionApprovalResult>;
  now?: () => string;
};

/** 将 native computer action 映射成统一 toolId，便于复用现有审批策略。 */
export function getComputerActionToolId(action: ComputerAction): string {
  const type = String(action.type ?? "unknown").toLowerCase();
  return `computer.${type}`;
}

/** 将 native computer action 映射成风险级别，供会话审批链判断是否拦截。 */
export function getComputerActionRisk(action: ComputerAction): ToolRiskCategory {
  const type = String(action.type ?? "unknown").toLowerCase();
  if (type === "screenshot" || type === "wait" || type === "scroll" || type === "move") {
    return ToolRiskCategory.Read;
  }
  return ToolRiskCategory.Write;
}

/** 生成用户可读的 computer action 标签，供审批卡片和日志复用。 */
export function buildComputerActionLabel(action: ComputerAction): string {
  const type = String(action.type ?? "unknown").toLowerCase();
  if (typeof action.x === "number" && typeof action.y === "number") {
    return `computer.${type} (${action.x}, ${action.y})`;
  }
  if (typeof action.text === "string") {
    return `computer.${type} "${action.text}"`;
  }
  return `computer.${type}`;
}

/** 为 capability trace 生成统一事件对象，避免 harness 内部散落手写。 */
function createComputerEvent(
  now: () => string,
  type: string,
  payload: Record<string, JsonValue | null>,
): CapabilityEvent {
  return {
    type,
    capabilityId: "computer",
    createdAt: now(),
    payload,
  };
}

/** 将任意数字字段收敛成有限数值，避免动作载荷污染浏览器执行。 */
function asFiniteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/** 归一化 computer scroll 动作的双轴位移。 */
function resolveScrollDelta(action: ComputerAction): { deltaX: number; deltaY: number } {
  const deltaX = asFiniteNumber(action.delta_x ?? action.scroll_x ?? action.x_delta ?? 0, 0);
  const deltaY = asFiniteNumber(action.delta_y ?? action.scroll_y ?? action.y_delta ?? 0, 0);

  if (deltaX !== 0 || deltaY !== 0) {
    return { deltaX, deltaY };
  }

  const direction = String(action.direction ?? "down").toLowerCase();
  const amount = asFiniteNumber(action.amount ?? 600, 600);
  if (direction === "up") return { deltaX: 0, deltaY: -Math.abs(amount) };
  if (direction === "left") return { deltaX: -Math.abs(amount), deltaY: 0 };
  if (direction === "right") return { deltaX: Math.abs(amount), deltaY: 0 };
  return { deltaX: 0, deltaY: Math.abs(amount) };
}

/** 归一化 drag 动作路径，兼容 path 与 from/to 两种常见载荷。 */
function resolveDragPath(action: ComputerAction): Array<{ x: number; y: number }> {
  const pathValue = Array.isArray(action.path) ? action.path : [];
  const path = pathValue
    .filter((point): point is { [key: string]: JsonValue } => !!point && typeof point === "object" && !Array.isArray(point))
    .map((point) => ({
      x: asFiniteNumber(point["x"]),
      y: asFiniteNumber(point["y"]),
    }));

  if (path.length >= 2) {
    return path;
  }

  const fromValue = action.from && typeof action.from === "object" ? action.from as Record<string, unknown> : null;
  const toValue = action.to && typeof action.to === "object" ? action.to as Record<string, unknown> : null;
  if (fromValue && toValue) {
    return [
      { x: asFiniteNumber(fromValue.x), y: asFiniteNumber(fromValue.y) },
      { x: asFiniteNumber(toValue.x), y: asFiniteNumber(toValue.y) },
    ];
  }

  return path;
}

/** 将浏览器执行失败统一抛成 Error，方便 harness 在单点中断并记录 trace。 */
function assertBrowserSuccess(result: BrowserActionResult, fallbackMessage: string): BrowserActionResult {
  if (!result.success) {
    throw new Error(result.error ?? fallbackMessage);
  }
  return result;
}

/** 创建 native computer action harness，负责动作执行、审批衔接与 screenshot 回传。 */
export function createComputerActionHarness(deps: ComputerActionHarnessDeps): ComputerActionHarness {
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    async executeCalls(input: ComputerHarnessExecutionInput): Promise<ComputerHarnessExecutionOutput> {
      const capabilityEvents: CapabilityEvent[] = [];
      const responseInputItems: Array<Record<string, unknown>> = [];

      for (const call of input.computerCalls) {
        if (input.signal?.aborted) {
          throw new Error("Computer harness aborted");
        }

        let halted = false;
        for (const [actionIndex, action] of call.actions.entries()) {
          const toolId = getComputerActionToolId(action);
          const label = buildComputerActionLabel(action);
          const risk = getComputerActionRisk(action);
          const detail = JSON.stringify(action);

          capabilityEvents.push(createComputerEvent(now, "computer_action_started", {
            callId: call.id,
            actionIndex,
            actionType: action.type,
            label,
          }));

          if (deps.requestApproval) {
            const approval = await deps.requestApproval({
              sessionId: input.sessionId ?? null,
              responseId: input.responseId ?? null,
              callId: call.id,
              actionIndex,
              action,
              toolId,
              label,
              risk,
              detail,
            });

            if (!approval.approved) {
              capabilityEvents.push(createComputerEvent(now, "computer_action_denied", {
                callId: call.id,
                actionIndex,
                actionType: action.type,
                reason: approval.reason ?? null,
              }));
              halted = true;
              break;
            }
          }

          try {
            const keys = Array.isArray(action.keys)
              ? action.keys.filter((value): value is string => typeof value === "string")
              : undefined;
            const actionType = String(action.type ?? "").toLowerCase();

            if (actionType === "click" || actionType === "double_click") {
              assertBrowserSuccess(await deps.browser.clickAt(
                asFiniteNumber(action.x),
                asFiniteNumber(action.y),
                {
                  button: typeof action.button === "string" ? action.button as "left" | "right" | "middle" : undefined,
                  clickCount: actionType === "double_click" ? 2 : 1,
                  keys,
                },
              ), "computer click failed");
            } else if (actionType === "move") {
              assertBrowserSuccess(await deps.browser.movePointer(
                asFiniteNumber(action.x),
                asFiniteNumber(action.y),
                { keys },
              ), "computer move failed");
            } else if (actionType === "drag") {
              assertBrowserSuccess(await deps.browser.dragPath(resolveDragPath(action), { keys }), "computer drag failed");
            } else if (actionType === "scroll") {
              const delta = resolveScrollDelta(action);
              assertBrowserSuccess(await deps.browser.scrollAt(delta.deltaX, delta.deltaY, {
                x: typeof action.x === "number" ? action.x : undefined,
                y: typeof action.y === "number" ? action.y : undefined,
                keys,
              }), "computer scroll failed");
            } else if (actionType === "type") {
              assertBrowserSuccess(await deps.browser.typeText(String(action.text ?? "")), "computer type failed");
            } else if (actionType === "keypress") {
              const keysToPress = Array.isArray(action.keys)
                ? action.keys.filter((value): value is string => typeof value === "string")
                : [];
              const explicitKey = typeof action.key === "string" ? action.key : null;
              const chord = explicitKey
                ? [...keysToPress, explicitKey].join("+")
                : keysToPress.join("+");
              assertBrowserSuccess(await deps.browser.pressKey(chord), "computer keypress failed");
            } else if (actionType === "wait") {
              assertBrowserSuccess(await deps.browser.wait(asFiniteNumber(action.ms ?? action.duration_ms ?? 1000, 1000)), "computer wait failed");
            } else if (actionType === "screenshot") {
              capabilityEvents.push(createComputerEvent(now, "computer_action_executed", {
                callId: call.id,
                actionIndex,
                actionType,
                skipped: true,
              }));
              continue;
            } else {
              capabilityEvents.push(createComputerEvent(now, "computer_action_failed", {
                callId: call.id,
                actionIndex,
                actionType: action.type,
                reason: "unsupported_action",
              }));
              halted = true;
              break;
            }

            capabilityEvents.push(createComputerEvent(now, "computer_action_executed", {
              callId: call.id,
              actionIndex,
              actionType,
            }));
          } catch (error) {
            capabilityEvents.push(createComputerEvent(now, "computer_action_failed", {
              callId: call.id,
              actionIndex,
              actionType: action.type,
              reason: error instanceof Error ? error.message : String(error),
            }));
            halted = true;
            break;
          }
        }

        const screenshot = assertBrowserSuccess(
          await deps.browser.captureComputerState(),
          "computer screenshot failed",
        );
        if (!screenshot.imageBase64) {
          throw new Error("Computer harness expected screenshot image data");
        }

        capabilityEvents.push(createComputerEvent(now, "computer_output_captured", {
          callId: call.id,
          halted,
        }));

        responseInputItems.push({
          type: "computer_call_output",
          call_id: call.id,
          output: {
            type: "input_image",
            image_url: `data:image/jpeg;base64,${screenshot.imageBase64}`,
            detail: "original",
          },
        });
      }

      return {
        responseInputItems,
        capabilityEvents,
      };
    },
  };
}

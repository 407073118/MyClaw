import type {
  WorkflowNodeInputSource,
  WorkflowVariableRef,
} from "@shared/contracts";

type WorkflowStateLike = ReadonlyMap<string, unknown>;

/** 判断值是否是可继续按路径读取的对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 按 dotted path 从对象里读取值，路径为空时返回对象本身。 */
export function readWorkflowPath(source: unknown, path: string): unknown {
  if (!path.trim()) return source;
  const normalizedPath = path.startsWith("$.") ? path.slice(2) : path;
  const parts = normalizedPath.split(".").filter(Boolean);
  let current = source;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

/** 将模板值转成字符串，确保对象值不会显示成 [object Object]。 */
function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** 从 state 根对象或临时输入里解析表达式路径。 */
export function resolveWorkflowPathExpression(
  expression: string,
  state: WorkflowStateLike,
  locals: Record<string, unknown> = {},
): unknown {
  const path = expression.trim();
  if (!path) return "";

  if (Object.prototype.hasOwnProperty.call(locals, path)) {
    return locals[path];
  }

  const [rootName, ...rest] = path.split(".");
  const scopedRoot = rootName ? state.get(rootName) : undefined;
  if (scopedRoot !== undefined) {
    return readWorkflowPath(scopedRoot, rest.join("."));
  }

  if (rootName && Object.prototype.hasOwnProperty.call(locals, rootName)) {
    return readWorkflowPath(locals[rootName], rest.join("."));
  }

  if (state.has(path)) {
    return state.get(path);
  }

  return readWorkflowPath(Object.fromEntries(state), path);
}

/** 渲染工作流模板，支持 {{ inputs.xxx }}、{{ nodes.nodeId.output }} 和本地输入。 */
export function renderWorkflowTemplate(
  template: string,
  state: WorkflowStateLike,
  locals: Record<string, unknown> = {},
): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression) => {
    const value = resolveWorkflowPathExpression(String(expression), state, locals);
    return stringifyTemplateValue(value);
  });
}

/** 根据 typed variable ref 从运行态 state 中读取变量值。 */
export function resolveWorkflowVariableRef(
  ref: WorkflowVariableRef,
  state: WorkflowStateLike,
  locals: Record<string, unknown> = {},
): unknown {
  if (ref.scope === "node") {
    const nodeOutputs = state.get("nodes");
    const nodeId = ref.nodeId ?? "";
    const nodeValue = readWorkflowPath(nodeOutputs, nodeId);
    return readWorkflowPath(nodeValue, ref.path);
  }

  if (ref.scope === "input") {
    const value = readWorkflowPath(state.get("inputs"), ref.path);
    return value === undefined ? resolveWorkflowPathExpression(ref.path, state, locals) : value;
  }

  if (ref.scope === "system") {
    const value = readWorkflowPath(state.get("sys"), ref.path);
    return value === undefined ? resolveWorkflowPathExpression(`sys.${ref.path}`, state, locals) : value;
  }

  if (ref.scope === "output") {
    return readWorkflowPath(state.get("outputs"), ref.path);
  }

  if (ref.scope === "secret") {
    return readWorkflowPath(state.get("secrets"), ref.path);
  }

  const varsValue = readWorkflowPath(state.get("vars"), ref.path);
  return varsValue === undefined ? resolveWorkflowPathExpression(ref.path, state, locals) : varsValue;
}

/** 解析节点 inputSources，供所有 executor 统一消费参数。 */
export function resolveWorkflowInputSources(
  sources: Record<string, WorkflowNodeInputSource> | undefined,
  state: WorkflowStateLike,
  locals: Record<string, unknown> = {},
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, source] of Object.entries(sources ?? {})) {
    if (source.mode === "static") {
      resolved[key] = source.value;
      continue;
    }
    if (source.mode === "variable") {
      resolved[key] = resolveWorkflowVariableRef(source.ref, state, locals);
      continue;
    }
    resolved[key] = renderWorkflowTemplate(source.expression, state, locals);
  }
  return resolved;
}

/** 解析旧版 inputBindings，兼容已保存工作流。 */
export function resolveLegacyInputBindings(
  bindings: Record<string, string> | undefined,
  state: WorkflowStateLike,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [inputName, channelName] of Object.entries(bindings ?? {})) {
    resolved[inputName] = resolveWorkflowPathExpression(channelName, state);
  }
  return resolved;
}

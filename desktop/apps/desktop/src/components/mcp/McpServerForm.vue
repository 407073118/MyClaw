<template>
  <form data-testid="mcp-server-form" class="mcp-form" @submit.prevent="handleSubmit">
    <div class="field-grid">
      <label class="field">
        <span>服务 ID</span>
        <input
          :value="form.id"
          :disabled="!isCreate"
          data-testid="mcp-form-id"
          type="text"
          placeholder="例如：mcp-docs"
          @input="updateText('id', $event)"
        />
      </label>
      <label class="field">
        <span>名称</span>
        <input
          :value="form.name"
          data-testid="mcp-form-name"
          type="text"
          placeholder="例如：文档网关"
          @input="updateText('name', $event)"
        />
      </label>
    </div>

    <div class="field-grid">
      <label class="field">
        <span>传输方式</span>
        <select :value="form.transport" data-testid="mcp-form-transport" @change="updateTransport">
          <option value="stdio">STDIO</option>
          <option value="http">HTTP</option>
        </select>
      </label>
      <label class="field checkbox-field">
        <span>启用服务</span>
        <input
          :checked="form.enabled"
          data-testid="mcp-form-enabled"
          type="checkbox"
          @change="updateEnabled"
        />
      </label>
    </div>

    <template v-if="form.transport === 'stdio'">
      <div class="field-grid">
        <label class="field">
          <span>命令</span>
          <input
            :value="form.command"
            data-testid="mcp-form-command"
            type="text"
            placeholder="npx"
            @input="updateText('command', $event)"
          />
        </label>
        <label class="field">
          <span>参数</span>
          <input
            :value="form.argsText"
            data-testid="mcp-form-args"
            type="text"
            placeholder="@modelcontextprotocol/server-filesystem ."
            @input="updateText('argsText', $event)"
          />
        </label>
      </div>
    </template>

    <template v-else>
      <label class="field">
        <span>URL</span>
        <input
          :value="form.url"
          data-testid="mcp-form-url"
          type="url"
          placeholder="http://127.0.0.1:8123/mcp"
          @input="updateText('url', $event)"
        />
      </label>
      <label class="field">
        <span>请求头 JSON</span>
        <textarea
          :value="form.headersText"
          data-testid="mcp-form-headers"
          rows="6"
          placeholder="{&quot;Authorization&quot;:&quot;Bearer token&quot;}"
          @input="updateText('headersText', $event)"
        />
      </label>
    </template>

    <p v-if="errorMessage" class="error-copy" data-testid="mcp-form-error">{{ errorMessage }}</p>

    <footer class="actions">
      <button type="button" class="secondary-button" data-testid="mcp-form-cancel" @click="emitCancel">
        取消
      </button>
      <button type="submit" class="primary-button" data-testid="mcp-form-submit">
        {{ submitLabel }}
      </button>
    </footer>
  </form>
</template>

<script setup lang="ts">
import type { McpServerConfig, McpSource, McpTransport } from "@myclaw-desktop/shared";
import { reactive, ref, watch } from "vue";

type FormState = {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  command: string;
  argsText: string;
  url: string;
  headersText: string;
};

const props = withDefaults(defineProps<{
  initialValue?: McpServerConfig | null;
  submitLabel?: string;
  isCreate?: boolean;
}>(), {
  initialValue: null,
  submitLabel: "保存修改",
  isCreate: false,
});

const emit = defineEmits<{
  (e: "submit", value: McpServerConfig): void;
  (e: "cancel"): void;
}>();

const errorMessage = ref("");
const form = reactive<FormState>(createFormState(props.initialValue));

watch(
  () => props.initialValue,
  (value) => {
    Object.assign(form, createFormState(value));
    errorMessage.value = "";
  },
  { immediate: true },
);

/** 根据传入配置生成表单初始值。 */
function createFormState(config: McpServerConfig | null | undefined): FormState {
  if (!config) {
    return {
      id: "",
      name: "",
      enabled: true,
      transport: "stdio",
      command: "",
      argsText: "",
      url: "",
      headersText: "",
    };
  }

  if (config.transport === "http") {
    return {
      id: config.id,
      name: config.name,
      enabled: config.enabled,
      transport: "http",
      command: "",
      argsText: "",
      url: config.url,
      headersText: config.headers ? JSON.stringify(config.headers, null, 2) : "",
    };
  }

  return {
    id: config.id,
    name: config.name,
    enabled: config.enabled,
    transport: "stdio",
    command: config.command,
    argsText: (config.args ?? []).join(" "),
    url: "",
    headersText: "",
  };
}

/** 更新普通文本字段，并在编辑过程中清空旧错误。 */
function updateText(field: keyof FormState, event: Event) {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
  form[field] = target?.value ?? "";
  errorMessage.value = "";
}

/** 更新传输方式，并在切换时保留对应字段。 */
function updateTransport(event: Event) {
  const target = event.target as HTMLSelectElement | null;
  const nextTransport = target?.value === "http" ? "http" : "stdio";
  console.info("[mcp-server-form] 切换传输方式", {
    previousTransport: form.transport,
    nextTransport,
  });
  form.transport = nextTransport;
  errorMessage.value = "";
}

/** 更新启用状态。 */
function updateEnabled(event: Event) {
  const target = event.target as HTMLInputElement | null;
  form.enabled = Boolean(target?.checked);
  errorMessage.value = "";
}

/** 触发表单取消事件。 */
function emitCancel() {
  console.info("[mcp-server-form] 取消 MCP 表单编辑", {
    serverId: form.id.trim(),
    isCreate: props.isCreate,
  });
  emit("cancel");
}

/** 把参数文本拆分成数组，避免空白项落入配置。 */
function parseArgs(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 解析请求头 JSON，并校验值类型为字符串。 */
function parseHeaders(value: string): Record<string, string> | undefined {
  if (!value.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("请求头必须是 JSON 对象。");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("请求头必须是 JSON 对象。");
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  for (const [, headerValue] of entries) {
    if (typeof headerValue !== "string") {
      throw new Error("每个请求头的值都必须是字符串。");
    }
  }

  return Object.fromEntries(entries as Array<[string, string]>);
}

/** 生成可提交的 MCP 配置，并在校验失败时抛出中文错误。 */
function buildConfig(): McpServerConfig {
  const id = form.id.trim();
  const name = form.name.trim();
  const source = (props.initialValue?.source ?? "manual") as McpSource;

  if (!id) {
    throw new Error("服务 ID 不能为空。");
  }
  if (!name) {
    throw new Error("服务名称不能为空。");
  }

  if (form.transport === "stdio") {
    const command = form.command.trim();
    if (!command) {
      throw new Error("stdio 模式必须填写命令。");
    }
    return {
      id,
      name,
      source,
      enabled: form.enabled,
      transport: "stdio",
      command,
      ...(parseArgs(form.argsText).length > 0 ? { args: parseArgs(form.argsText) } : {}),
    };
  }

  const url = form.url.trim();
  if (!url) {
    throw new Error("http 模式必须填写 URL。");
  }

  const headers = parseHeaders(form.headersText);
  return {
    id,
    name,
    source,
    enabled: form.enabled,
    transport: "http",
    url,
    ...(headers ? { headers } : {}),
  };
}

/** 提交表单，成功时向页面层返回规范化配置。 */
function handleSubmit() {
  console.info("[mcp-server-form] 提交 MCP 表单", {
    serverId: form.id.trim(),
    transport: form.transport,
    isCreate: props.isCreate,
  });

  try {
    const config = buildConfig();
    errorMessage.value = "";
    emit("submit", config);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "构建 MCP 配置失败。";
    console.error("[mcp-server-form] MCP 表单校验失败", {
      serverId: form.id.trim(),
      detail: errorMessage.value,
    });
  }
}
</script>

<style scoped>
.mcp-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field span {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #b0b0b8);
}

.checkbox-field {
  justify-content: flex-end;
}

.checkbox-field input {
  width: 18px;
  height: 18px;
  margin-top: 10px;
}

input,
select,
textarea {
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--glass-border, #3f3f46);
  background: var(--bg-base, #111214);
  color: var(--text-primary, #fff);
  font: inherit;
}

textarea {
  resize: vertical;
  min-height: 128px;
}

.error-copy {
  margin: 0;
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.2);
  padding: 12px 14px;
  border-radius: 12px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.secondary-button,
.primary-button {
  height: 38px;
  border-radius: 10px;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.secondary-button {
  border: 1px solid var(--glass-border, #42424c);
  background: transparent;
  color: var(--text-primary, #fff);
}

.primary-button {
  border: none;
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #0891b2);
}

@media (max-width: 720px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>

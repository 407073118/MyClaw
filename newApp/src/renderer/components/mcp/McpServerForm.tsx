import React, { useEffect, useState } from "react";
import type { McpServerConfig, McpSource, McpTransport } from "@shared/contracts";

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

interface McpServerFormProps {
  initialValue?: McpServerConfig | null;
  submitLabel?: string;
  isCreate?: boolean;
  onSubmit: (value: McpServerConfig) => void;
  onCancel: () => void;
}

function createFormState(config: McpServerConfig | null | undefined): FormState {
  if (!config) {
    return { id: "", name: "", enabled: true, transport: "stdio", command: "", argsText: "", url: "", headersText: "" };
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

function parseArgs(value: string): string[] {
  return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function parseHeaders(value: string): Record<string, string> | undefined {
  if (!value.trim()) return undefined;

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

export default function McpServerForm({
  initialValue = null,
  submitLabel = "保存修改",
  isCreate = false,
  onSubmit,
  onCancel,
}: McpServerFormProps) {
  const [form, setForm] = useState<FormState>(() => createFormState(initialValue));
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setForm(createFormState(initialValue));
    setErrorMessage("");
  }, [initialValue]);

  function updateField(field: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrorMessage("");
  }

  function updateTransport(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextTransport = event.target.value === "http" ? "http" : "stdio";
    console.info("[mcp-server-form] 切换传输方式", { previousTransport: form.transport, nextTransport });
    updateField("transport", nextTransport);
  }

  function emitCancel() {
    console.info("[mcp-server-form] 取消 MCP 表单编辑", { serverId: form.id.trim(), isCreate });
    onCancel();
  }

  function buildConfig(): McpServerConfig {
    const id = form.id.trim();
    const name = form.name.trim();
    const source = (initialValue?.source ?? "manual") as McpSource;

    if (!id) throw new Error("服务 ID 不能为空。");
    if (!name) throw new Error("服务名称不能为空。");

    if (form.transport === "stdio") {
      const command = form.command.trim();
      if (!command) throw new Error("stdio 模式必须填写命令。");
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
    if (!url) throw new Error("http 模式必须填写 URL。");

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    console.info("[mcp-server-form] 提交 MCP 表单", { serverId: form.id.trim(), transport: form.transport, isCreate });
    try {
      const config = buildConfig();
      setErrorMessage("");
      onSubmit(config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "构建 MCP 配置失败。";
      setErrorMessage(msg);
      console.error("[mcp-server-form] MCP 表单校验失败", { serverId: form.id.trim(), detail: msg });
    }
  }

  return (
    <form data-testid="mcp-server-form" className="mcp-form" onSubmit={handleSubmit}>
      <div className="field-grid">
        <label className="field">
          <span>服务 ID</span>
          <input
            value={form.id}
            disabled={!isCreate}
            data-testid="mcp-form-id"
            type="text"
            placeholder="例如：mcp-docs"
            onChange={(e) => updateField("id", e.target.value)}
          />
        </label>
        <label className="field">
          <span>名称</span>
          <input
            value={form.name}
            data-testid="mcp-form-name"
            type="text"
            placeholder="例如：文档网关"
            onChange={(e) => updateField("name", e.target.value)}
          />
        </label>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>传输方式</span>
          <select value={form.transport} data-testid="mcp-form-transport" onChange={updateTransport}>
            <option value="stdio">STDIO</option>
            <option value="http">HTTP</option>
          </select>
        </label>
        <label className="field checkbox-field">
          <span>启用服务</span>
          <input
            checked={form.enabled}
            data-testid="mcp-form-enabled"
            type="checkbox"
            onChange={(e) => updateField("enabled", e.target.checked)}
          />
        </label>
      </div>

      {form.transport === "stdio" ? (
        <div className="field-grid">
          <label className="field">
            <span>命令</span>
            <input
              value={form.command}
              data-testid="mcp-form-command"
              type="text"
              placeholder="npx"
              onChange={(e) => updateField("command", e.target.value)}
            />
          </label>
          <label className="field">
            <span>参数</span>
            <input
              value={form.argsText}
              data-testid="mcp-form-args"
              type="text"
              placeholder="@modelcontextprotocol/server-filesystem ."
              onChange={(e) => updateField("argsText", e.target.value)}
            />
          </label>
        </div>
      ) : (
        <>
          <label className="field">
            <span>URL</span>
            <input
              value={form.url}
              data-testid="mcp-form-url"
              type="url"
              placeholder="http://127.0.0.1:8123/mcp"
              onChange={(e) => updateField("url", e.target.value)}
            />
          </label>
          <label className="field">
            <span>请求头 JSON</span>
            <textarea
              value={form.headersText}
              data-testid="mcp-form-headers"
              rows={6}
              placeholder={'{"Authorization":"Bearer token"}'}
              onChange={(e) => updateField("headersText", e.target.value)}
            />
          </label>
        </>
      )}

      {errorMessage && (
        <p className="error-copy" data-testid="mcp-form-error">{errorMessage}</p>
      )}

      <footer className="actions">
        <button type="button" className="secondary-button" data-testid="mcp-form-cancel" onClick={emitCancel}>
          取消
        </button>
        <button type="submit" className="primary-button" data-testid="mcp-form-submit">
          {submitLabel}
        </button>
      </footer>

      <style>{`
        .mcp-form {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .mcp-form .field-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        .mcp-form .field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .mcp-form .field span {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary, #b0b0b8);
        }
        .mcp-form .checkbox-field {
          justify-content: flex-end;
        }
        .mcp-form .checkbox-field input {
          width: 18px;
          height: 18px;
          margin-top: 10px;
        }
        .mcp-form input,
        .mcp-form select,
        .mcp-form textarea {
          width: 100%;
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid var(--glass-border, #3f3f46);
          background: var(--bg-base, #111214);
          color: var(--text-primary, #fff);
          font: inherit;
        }
        .mcp-form textarea {
          resize: vertical;
          min-height: 128px;
        }
        .mcp-form .error-copy {
          margin: 0;
          color: #fca5a5;
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.2);
          padding: 12px 14px;
          border-radius: 12px;
        }
        .mcp-form .actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
        }
        .mcp-form .secondary-button,
        .mcp-form .primary-button {
          height: 38px;
          border-radius: 10px;
          padding: 0 16px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .mcp-form .secondary-button {
          border: 1px solid var(--glass-border, #42424c);
          background: transparent;
          color: var(--text-primary, #fff);
        }
        .mcp-form .primary-button {
          border: none;
          color: #fff;
          background: linear-gradient(135deg, #2563eb, #0891b2);
        }
        @media (max-width: 720px) {
          .mcp-form .field-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </form>
  );
}

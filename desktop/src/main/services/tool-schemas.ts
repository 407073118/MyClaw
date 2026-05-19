/**
 * 为内置工具定义 OpenAI function calling 所需的 schema。
 *
 * 这些 schema 会作为 `tools` 参数传给模型，
 * 让模型通过函数调用来触发工具。每个工具都对应一份 JSON Schema，
 * 因此模型返回的是结构化参数，而不是自由文本。
 */

import type { CapabilityBundle, McpTool, ResolvedBuiltinTool, SkillDefinition } from "@shared/contracts";
import {
  resolveAllowedBuiltinToolGroups,
  resolveBlockedBuiltinToolNames,
} from "./model-runtime/vendor-policy-registry";
import { inferBuiltinToolSchemaGroup } from "./builtin-tool-registry";

export type OpenAIFunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type BuildToolSchemaOptions = {
  builtinTools?: ResolvedBuiltinTool[];
  capabilityBundle?: CapabilityBundle;
  artifactsRootPath?: string | null;
};

/** 根据工具中心偏好判断内置工具是否应该暴露给模型。 */
function shouldExposeBuiltinFunctionTool(functionName: string, options?: BuildToolSchemaOptions): boolean {
  if (!options?.builtinTools) {
    return true;
  }
  const toolId = functionNameToToolId(functionName);
  const configuredTool = options.builtinTools.find((tool) => tool.id === toolId);
  if (!configuredTool) {
    return true;
  }
  return configuredTool.enabled && configuredTool.exposedToModel;
}

/** 根据工具中心偏好判断 MCP 工具是否应该暴露给模型。 */
function shouldExposeMcpTool(tool: McpTool & { serverId: string }): boolean {
  const preference = tool as McpTool & { serverId: string; enabled?: boolean; exposedToModel?: boolean };
  return preference.enabled !== false && preference.exposedToModel !== false;
}

/** 读取 bundle MCP 的参数 schema，优先使用冻结的 inputSchema，兼容旧 manifestJson.inputSchema。 */
function resolveBundleMcpInputSchema(ref: CapabilityBundle["functionNameMap"][string]): Record<string, unknown> {
  if (ref.inputSchema && typeof ref.inputSchema === "object" && !Array.isArray(ref.inputSchema)) {
    return ref.inputSchema as Record<string, unknown>;
  }
  if (ref.manifestJson && typeof ref.manifestJson === "object" && !Array.isArray(ref.manifestJson) && "inputSchema" in ref.manifestJson) {
    const schema = (ref.manifestJson as { inputSchema?: unknown }).inputSchema;
    if (schema && typeof schema === "object" && !Array.isArray(schema)) {
      return schema as Record<string, unknown>;
    }
  }
  console.warn("[tool-schemas] bundle MCP 缺少参数 schema，使用空对象 schema", {
    functionName: ref.functionName ?? ref.id,
    source: ref.source,
    capabilityRefId: ref.capabilityRefId ?? null,
  });
  return { type: "object", properties: {}, required: [] };
}

/**
 * 为所有启用中的内置工具构建 OpenAI function calling 定义。
 * `cwd` 会写入描述中，用于告诉模型当前工作目录。
 */
export function buildToolSchemas(
  cwd: string,
  skills?: SkillDefinition[],
  mcpTools?: Array<McpTool & { serverId: string }>,
  toolPolicyId?: string,
  options?: BuildToolSchemaOptions,
): OpenAIFunctionTool[] {
  const artifactsRootPath = options?.artifactsRootPath?.trim() || null;
  const artifactDirectoryHint = artifactsRootPath
    ? ` Current configured Files output directory: ${artifactsRootPath}. Do not hard-code myClaw/artifacts; use the configured path when the user asks to create a user-facing file.`
    : "";
  const artifactDirectoryLine = artifactsRootPath
    ? `Current configured Files output directory: ${artifactsRootPath}`
    : null;
  const staticTools: OpenAIFunctionTool[] = [
    {
      type: "function",
      function: {
        name: "fs_read",
        description: `Read short text/code files before editing. Output is truncated for long files, so use \`document_read\` for .xlsx/.xls/.xlsm/.docx/.pdf/.pptx/.md/.txt/.csv/.json when you need complete analysis, outline/search, or precise section/subtree reads. For Excel files specifically, \`xlsx_extract\` still works but \`document_read\` is preferred. Supports paths outside the workspace with path-access approval. Working directory: ${cwd}`,
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path. Relative paths resolve against the working directory; absolute paths (including workspace-external paths) are supported subject to user approval.",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "file_view",
        description: [
          `Open a local file for the user in the right-side viewer panel without returning the file body to the model context.`,
          `Use this when the user says view/open/browse a file. Use document_read instead when you need to analyze, summarize, search, or quote file contents.`,
          `Supported panel previews include markdown, text/code, JSON, CSV/TSV, images, PDF, Office semantic previews, media, archives, plus fallback metadata.`,
          `Working directory: ${cwd}`,
        ].join("\n"),
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute or relative local file path. Subject to the same path-access approval rules as fs_read.",
            },
            mode: {
              type: "string",
              enum: ["auto", "panel", "external", "reveal"],
              description: "auto/panel opens the right viewer; external opens with the system default app; reveal locates it in file manager.",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "xlsx_extract",
        description: `Read an Excel workbook (.xlsx/.xls/.xlsm) and return its contents as a Markdown table. LEGACY alias — prefer \`document_read\` which also exposes stats/outline/search. Subject to the same path-access consent rules as fs_read. Working directory: ${cwd}`,
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the Excel file. Absolute or relative to the working directory.",
            },
            sheet: {
              type: "string",
              description: "Optional sheet name; defaults to the first sheet in the workbook.",
            },
            maxRows: {
              type: "number",
              description: "Maximum rows to include (default 200, hard cap 500).",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "document_read",
        description: [
          `Read office / pdf / pptx / markdown / csv / json documents natively (zero Python required).`,
          `Use this instead of fs_read for .xlsx/.xls/.xlsm/.docx/.pdf/.pptx/.md/.txt/.csv/.json, especially when the file may exceed fs_read's truncation window.`,
          `Examples:`,
          `  1. Stats first:   {"path":"./Q4.pptx","mode":"stats"}`,
          `  2. Outline:       {"path":"./report.docx","mode":"outline"}`,
          `  3. Precise read:  {"path":"./report.docx","mode":"read","locator":{"heading":"Conclusion"},"maxChars":4000}`,
          `  4. Search:        {"path":"./book.pdf","mode":"search","query":"revenue"}`,
          `  5. JSON subtree:  {"path":"./package.json","mode":"read","locator":{"pointer":"/dependencies/react"},"maxChars":2000}`,
          `Working directory: ${cwd}`,
        ].join("\n"),
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute or relative file path. Subject to path-access approval (same rules as fs_read).",
            },
            mode: {
              type: "string",
              enum: ["stats", "outline", "read", "search"],
              description: "stats=document metadata; outline=table of contents; read=precise section or whole doc; search=keyword lookup.",
            },
            locator: {
              type: "object",
              description: "Pinpoint what to read in mode=read. Omit for whole-doc read.",
              properties: {
                page: { type: "number", description: "PDF page number (1-based)." },
                slide: { type: "number", description: "PPTX slide number (1-based)." },
                sheet: { type: "string", description: "XLSX sheet name." },
                heading: { type: "string", description: "DOCX/MD heading text to anchor on." },
                pointer: { type: "string", description: "JSON Pointer for JSON subtrees, e.g. /dependencies/react or /scripts/build." },
                range: {
                  type: "array",
                  items: { type: "number" },
                  minItems: 2,
                  maxItems: 2,
                  description: "[startIndex, endExclusive] over the body node array.",
                },
              },
            },
            query: {
              type: "string",
              description: "Search keyword; required when mode=search.",
            },
            maxChars: {
              type: "number",
              description: "Output character budget; default 8000, hard cap 32000.",
            },
            format: {
              type: "string",
              enum: ["markdown", "json"],
              description: "Output format for mode=read; default markdown.",
            },
            includeImages: {
              type: "string",
              enum: ["none", "refs", "inline"],
              description: "Image handling; default refs. Use inline only for multimodal models.",
            },
          },
          required: ["path", "mode"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fs_write",
        description: `Write content to a file, creating directories as needed. Working directory: ${cwd}.${artifactDirectoryHint}`,
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: artifactsRootPath
                ? `File path relative to the working directory, or an absolute path under the current configured Files output directory (${artifactsRootPath}) for user-facing generated files.`
                : "File path relative to the working directory",
            },
            content: {
              type: "string",
              description: "The full content to write to the file",
            },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fs_list",
        description: `List files and subdirectories in a directory. Working directory: ${cwd}`,
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Directory path relative to the working directory. Defaults to '.' (current dir)",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fs_search",
        description: `Search for text content in files recursively. Working directory: ${cwd}`,
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "The text pattern to search for",
            },
            path: {
              type: "string",
              description: "Directory to search in, relative to working directory. Defaults to '.'",
            },
          },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fs_find",
        description: `Find files matching a glob pattern. Working directory: ${cwd}`,
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Glob pattern (e.g. '**/*.ts', 'src/*.json')",
            },
            path: {
              type: "string",
              description: "Directory to search in, relative to working directory. Defaults to '.'",
            },
          },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fs_edit",
        description: `Edit a file by replacing a specific string with a new string. The old_string must match exactly one occurrence in the file (including whitespace and newlines). Use this instead of fs_write when you only need to change part of a file. Working directory: ${cwd}`,
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path relative to the working directory",
            },
            old_string: {
              type: "string",
              description: "The exact string to find and replace. Must match exactly one location in the file.",
            },
            new_string: {
              type: "string",
              description: "The replacement string",
            },
          },
          required: ["path", "old_string", "new_string"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "artifact_register",
        description: [
          `Register an existing local file into the Files workspace for the current session.`,
          `Use this after exec_command, scripts, MCP tools, or external programs create a user-facing work file that should appear in Files.`,
          `fs_write and ppt_generate outputs are registered automatically, but call artifact_register for indirect outputs or when you need to mark a generated file as final.`,
          ...(artifactDirectoryLine ? [artifactDirectoryLine] : []),
          `Working directory: ${cwd}`,
        ].join("\n"),
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute or relative local file path to record in Files.",
            },
            title: {
              type: "string",
              description: "Optional display title. Defaults to the file name.",
            },
            kind: {
              type: "string",
              enum: ["doc", "image", "code", "dataset", "archive", "log", "other"],
              description: "Optional artifact kind. Defaults to extension-based inference.",
            },
            lifecycle: {
              type: "string",
              enum: ["working", "ready", "final"],
              description: "Optional lifecycle. Use final only for user-approved deliverables; default is working.",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "exec_command",
        description: `Execute a shell command. Working directory: ${cwd}. Dangerous commands are blocked. Long-running commands automatically retry with larger timeoutMs when they time out, up to a default 10 minute ceiling.`,
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
            cwd: {
              type: "string",
              description: "Optional working directory override for this command. Supports absolute paths and paths relative to the current session working directory.",
            },
            timeoutMs: {
              type: "number",
              description: "Optional initial timeout in milliseconds. If the command times out, exec.command will retry with a larger timeout.",
            },
            maxAttempts: {
              type: "number",
              description: "Optional maximum number of timeout attempts. Defaults to the built-in retry policy.",
            },
            maxTimeoutMs: {
              type: "number",
              description: "Optional upper bound for the timeout expansion, in milliseconds.",
            },
            timeoutMultiplier: {
              type: "number",
              description: "Optional timeout growth multiplier used after each timeout retry.",
            },
            retryOnTimeout: {
              type: "boolean",
              description: "Optional. Set to false to disable timeout retries for this command.",
            },
          },
          required: ["command"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "git_status",
        description: `Show the git working tree status. Working directory: ${cwd}`,
        parameters: {
          type: "object",
          properties: {
            target: {
              type: "string",
              description: "Optional: specific file or directory to check status for",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "git_diff",
        description: `Show git diff summary (changed files and stats). Working directory: ${cwd}`,
        parameters: {
          type: "object",
          properties: {
            target: {
              type: "string",
              description: "Optional: specific file or directory to diff",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "git_log",
        description: `Show recent git commit history. Working directory: ${cwd}`,
        parameters: {
          type: "object",
          properties: {
            count: {
              type: "string",
              description: "Number of commits to show (default: 10, max: 50)",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "git_commit",
        description: `Stage all changes and create a git commit. Working directory: ${cwd}`,
        parameters: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "The commit message",
            },
          },
          required: ["message"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "http_fetch",
        description: "Fetch content from a URL via HTTP GET request.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL to fetch",
            },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web using DuckDuckGo and return summarized results.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
          },
          required: ["query"],
        },
      },
    },
    // ── ppt.* ── 演示文稿生成工具 ────────────────────────
    {
      type: "function",
      function: {
        name: "ppt_themes",
        description: "获取所有可用的演示文稿主题列表，包括 ID、名称、配色预览和适用场景。在调用 ppt_generate 之前先用此工具了解可选主题。",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "ppt_generate",
        description: [
          "根据结构化 slide 数据生成可编辑的 .pptx 演示文稿。",
          "每张 slide 只需指定 type（版式类型）和 data（内容数据），所有设计排版由内置模板自动完成。",
          "可用版式类型: cover(封面), section(章节), key_points(要点), metrics(数据大字报), comparison(对比), closing(结束页)。",
          "生成前建议先查阅 ppt-designer 技能获取设计指导。",
        ].join(" "),
        parameters: {
          type: "object",
          properties: {
            outputPath: {
              type: "string",
              description: "输出文件的绝对路径，如 C:/Users/xxx/Desktop/report.pptx",
            },
            theme: {
              type: "string",
              description: "主题 ID，通过 ppt_themes 获取，如 business-blue",
            },
            meta: {
              type: "object",
              description: "演示文稿元数据",
              properties: {
                title: { type: "string", description: "文稿标题" },
                subtitle: { type: "string", description: "副标题" },
                author: { type: "string", description: "作者" },
                date: { type: "string", description: "日期" },
              },
            },
            slides: {
              type: "array",
              description: "Slide 列表，按展示顺序排列",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    description: "版式类型: cover | section | key_points | metrics | comparison | closing",
                  },
                  data: {
                    type: "object",
                    description: "该版式所需的内容数据，具体字段参见 ppt-designer 技能说明",
                  },
                },
                required: ["type", "data"],
              },
            },
          },
          required: ["outputPath", "theme", "slides"],
        },
      },
    },

    // ── task.* ── Task V2 任务追踪 ────────────────────────────
    {
      type: "function",
      function: {
        name: "task_create",
        description: "Create a task as part of your execution plan. When you receive a user request, decompose it into tasks BEFORE starting work. Each task represents one logical step you will execute. Provide subject (imperative: 'Run tests') and activeForm (present continuous: 'Running tests'). Tasks are automatically chained in creation order — each new task is blocked by the previous one, enforcing sequential execution. To create a task with no dependency (e.g., parallel work), pass blockedBy as an empty array.",
        parameters: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Imperative description of what needs to be done (e.g., 'Fix authentication bug')" },
            description: { type: "string", description: "Detailed description of the task requirements" },
            activeForm: { type: "string", description: "Present continuous form shown during execution (e.g., 'Fixing authentication bug')" },
            status: { type: "string", enum: ["pending", "in_progress", "blocked", "failed", "completed", "cancelled"], description: "Initial status. Defaults to 'pending'. Use task_wait_for_user instead of creating waiting_user directly." },
            blockedBy: { type: "array", items: { type: "string" }, description: "Task IDs that must complete before this task can start. Omit to auto-chain to previous task; pass [] for no dependencies." },
          },
          required: ["subject", "description"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "task_list",
        description: "List all tasks in the current execution plan with their status and details.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "task_get",
        description: "Get a specific task by ID with full details including status and blocking relationships.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The task ID to retrieve" },
          },
          required: ["id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "task_update",
        description: "Update a task's status or details. Set 'in_progress' before you start working on a task and 'completed' immediately after you finish. Use the dedicated user-wait tool for any user input pause. Only ONE task should be in_progress at a time — others are automatically demoted to pending. IMPORTANT: Setting status to 'in_progress' will FAIL if the task has unfinished blockers (blockedBy). You must complete blocking tasks first, in order.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The task ID to update" },
            subject: { type: "string", description: "Updated task subject" },
            description: { type: "string", description: "Updated description" },
            activeForm: { type: "string", description: "Updated present continuous form" },
            status: { type: "string", enum: ["pending", "in_progress", "blocked", "failed", "completed", "cancelled"], description: "Updated status. Use the dedicated user-wait tool for user-input pauses." },
            blocks: { type: "array", items: { type: "string" }, description: "Task IDs this task blocks" },
            blockedBy: { type: "array", items: { type: "string" }, description: "Task IDs that block this task" },
          },
          required: ["id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "task_wait_for_user",
        description: "terminal Task V2 hard pause. Use this when a task needs user input, approval, rejection, or cancellation before any pending task may continue. The runtime creates an active interrupt, sets the task to waiting_user, stops this turn, and waits for structured resume input.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "The existing non-terminal task ID that is waiting for the user" },
            question: { type: "string", description: "Clear user-facing question shown in the waiting card" },
            reason: { type: "string", description: "Short runtime reason for pausing this task" },
            inputSchema: {
              type: ["object", "null"],
              description: "Optional simple field schema for the expected resume payload",
              properties: {
                fields: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "Stable payload field name" },
                      label: { type: "string", description: "User-facing field label" },
                      type: { type: "string", enum: ["text", "textarea", "number", "boolean", "select"], description: "Input control type" },
                      required: { type: "boolean", description: "Whether the field must be supplied" },
                      choices: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            label: { type: "string" },
                            value: { type: "string" },
                          },
                          required: ["label", "value"],
                        },
                      },
                    },
                    required: ["name", "label", "type"],
                  },
                },
              },
            },
            choices: {
              type: ["array", "null"],
              description: "Optional choices rendered as structured UI controls",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "User-facing choice label" },
                  value: { type: "string", description: "Stable choice value submitted on resume" },
                  description: { type: "string", description: "Optional choice help text" },
                },
                required: ["label", "value"],
              },
            },
            expiresAt: { type: ["string", "null"], description: "Optional ISO-8601 expiration time for the resume token" },
          },
          required: ["taskId", "question", "reason"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "calendar_event_create",
        description: "Create a calendar event for a meeting, review, appointment, or fixed time block. By default, also creates a user-facing reminder 15 minutes before the event unless createReminder is false.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short calendar event title shown in Time Center." },
            description: { type: "string", description: "Optional event details." },
            startsAt: { type: "string", description: "Event start time in ISO-8601 format." },
            endsAt: { type: "string", description: "Optional event end time in ISO-8601 format. If omitted, durationMinutes or 60 minutes is used." },
            durationMinutes: { type: "number", description: "Optional duration in minutes when endsAt is unknown. Defaults to 60." },
            timezone: { type: "string", description: "Optional IANA timezone. Defaults to the current local time policy timezone." },
            ownerScope: { type: "string", enum: ["personal", "silicon_person"], description: "Event owner scope. Defaults to personal." },
            ownerId: { type: "string", description: "Optional owner id when the event belongs to a silicon person." },
            location: { type: "string", description: "Optional meeting location or link." },
            reminderMinutesBefore: { type: "number", description: "Minutes before startsAt to create the reminder. Defaults to 15. Use 0 or createReminder=false to skip." },
            reminderAt: { type: "string", description: "Optional explicit reminder trigger time in ISO-8601 format. Overrides reminderMinutesBefore." },
            createReminder: { type: "boolean", description: "Whether to create a pre-event reminder. Defaults to true." },
          },
          required: ["title", "startsAt"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "calendar_event_list",
        description: "List saved calendar events from the local desktop time center.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "reminder_create",
        description: "Create a user-facing reminder for a specific future time. Use this when the assistant should notify the user later, not when the system should execute autonomous work.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short reminder title shown in Time Center and desktop notifications." },
            body: { type: "string", description: "Optional reminder note or body text." },
            triggerAt: { type: "string", description: "Reminder trigger time in ISO-8601 format." },
            timezone: { type: "string", description: "Optional IANA timezone. Defaults to the current local time policy timezone." },
            ownerScope: { type: "string", enum: ["personal", "silicon_person"], description: "Reminder owner scope. Defaults to personal." },
            ownerId: { type: "string", description: "Optional owner id when the reminder belongs to a silicon person." },
          },
          required: ["title", "triggerAt"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "reminder_list",
        description: "List saved reminders from the local desktop time center.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "schedule_job_create",
        description: "Create a local scheduled job for autonomous time-based execution. Use this for workflows, silicon-person actions, or assistant-driven recurring work.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short job title shown in Time Center." },
            description: { type: "string", description: "Optional longer description of what the job does." },
            scheduleKind: { type: "string", enum: ["once", "interval", "cron"], description: "Scheduling mode." },
            startsAt: { type: "string", description: "ISO-8601 start time. Required for once/interval jobs." },
            intervalMinutes: { type: "number", description: "Interval in minutes for interval jobs." },
            cronExpression: { type: "string", description: "Cron expression for cron jobs." },
            timezone: { type: "string", description: "Optional IANA timezone. Defaults to the current local time policy timezone." },
            executor: {
              type: "string",
              enum: ["workflow", "silicon_person", "assistant_prompt"],
              description: "Execution target type.",
            },
            executorTargetId: { type: "string", description: "Optional workflow id or silicon person id." },
            ownerScope: { type: "string", enum: ["personal", "silicon_person"], description: "Job owner scope. Defaults to personal." },
            ownerId: { type: "string", description: "Optional owner id when the job belongs to a silicon person." },
          },
          required: ["title", "scheduleKind"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "schedule_job_list",
        description: "List local scheduled jobs from the desktop time center.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "today_brief_get",
        description: "Read the local today brief summary. This is query-only and does not change any time objects.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },

    // ── browser.* ── 浏览器自动化 ──────────────────────────
    {
      type: "function",
      function: {
        name: "browser_open",
        description: "Navigate to a URL in the browser. Automatically launches the system Chrome/Edge if not already running.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to open (http/https)" },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_snapshot",
        description: [
          "Get an accessibility tree snapshot of the current page.",
          "Returns a structured text representation of all visible elements with role, name, and value.",
          "Use this to understand page structure and content instead of screenshots.",
          "Element references (e.g. ref=42) in the output can be used directly with browser_click, browser_type, etc.",
        ].join("\n"),
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "Optional: CSS selector to scope the snapshot to a subtree. Omit for the entire page.",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_click",
        description: "Click an element on the page. Accepts CSS selectors, text matching (text=Login), or ref references (ref=42) from accessibility snapshots.",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: 'The element to click. Supports: CSS selector ("button.submit"), text match ("text=Login"), or ref ("ref=42").',
            },
          },
          required: ["selector"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_type",
        description: "Type text into an input field. Clears the field first, then types the provided text.",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "The target input element. Supports CSS selector, text match, or ref reference.",
            },
            text: { type: "string", description: "The text to type" },
            pressEnter: {
              type: "boolean",
              description: "Whether to press Enter after typing. Default false.",
            },
          },
          required: ["selector", "text"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_screenshot",
        description: "Take a screenshot and save it to a local file. Returns the file path. Use browser_snapshot (accessibility tree) as the primary way to understand pages — screenshots are for visual verification when needed.",
        parameters: {
          type: "object",
          properties: {
            fullPage: {
              type: "boolean",
              description: "Whether to capture the full scrollable page. Default false (viewport only).",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_evaluate",
        description: "Execute a JavaScript expression in the page context and return the result. The result is JSON.stringify'd.",
        parameters: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "The JavaScript expression to evaluate.",
            },
          },
          required: ["expression"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_select",
        description: "Select option(s) in a <select> dropdown element.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "The target <select> element selector" },
            values: {
              type: "array",
              items: { type: "string" },
              description: "Option values or display text to select",
            },
          },
          required: ["selector", "values"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_hover",
        description: "Hover over an element to trigger hover menus, tooltips, etc.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "The element selector, text match, or ref reference" },
          },
          required: ["selector"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_back",
        description: "Navigate back to the previous page.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_forward",
        description: "Navigate forward to the next page.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_wait",
        description: "Wait for the specified number of milliseconds. Useful for page loads or animations. Max 30000ms.",
        parameters: {
          type: "object",
          properties: {
            milliseconds: {
              type: "number",
              description: "Wait duration in milliseconds (max 30000)",
            },
          },
          required: ["milliseconds"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_scroll",
        description: "Scroll the page or a specific element. Use to reveal content below the fold or trigger lazy loading.",
        parameters: {
          type: "object",
          properties: {
            direction: {
              type: "string",
              enum: ["up", "down", "left", "right"],
              description: "Scroll direction. Default 'down'.",
            },
            amount: {
              type: "number",
              description: "Number of scroll ticks (1-10). Default 3. Each tick is about 100px.",
            },
            selector: {
              type: "string",
              description: "Optional: scroll within a specific scrollable element instead of the page.",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_press_key",
        description: "Press a keyboard key or shortcut. Supports Escape, Tab, ArrowDown, Backspace, Delete, Enter, and modifier combos like Control+a, Meta+c.",
        parameters: {
          type: "object",
          properties: {
            key: {
              type: "string",
              description: 'Key name (e.g. "Escape", "Tab", "ArrowDown") or combo (e.g. "Control+a", "Shift+Tab").',
            },
          },
          required: ["key"],
        },
      },
    },
  ];
  const effectiveToolPolicyId = toolPolicyId ?? "generic.tools.default";
  const blockedBuiltinNames = new Set(resolveBlockedBuiltinToolNames(effectiveToolPolicyId));
  const allowedBuiltinGroups = new Set(resolveAllowedBuiltinToolGroups(effectiveToolPolicyId));
  const filteredStaticTools = staticTools.filter((tool) => {
    const toolName = tool.function.name;
    const toolGroup = inferBuiltinToolSchemaGroup(toolName);
    if (!toolGroup) {
      return false;
    }
    if (!allowedBuiltinGroups.has(toolGroup as "fs" | "exec" | "git" | "http" | "web" | "ppt" | "task" | "time" | "browser")) {
      return false;
    }
    return !blockedBuiltinNames.has(toolName) && shouldExposeBuiltinFunctionTool(toolName, options);
  });

  // 生成 CapabilityBundle 中冻结的项目 / 全局能力 schema。
  if (options?.capabilityBundle) {
    let bundleSkillCount = 0;
    let bundleMcpCount = 0;
    for (const [functionName, ref] of Object.entries(options.capabilityBundle.functionNameMap)) {
      if (ref.kind === "skill") {
        bundleSkillCount++;
        filteredStaticTools.push({
          type: "function",
          function: {
            name: functionName,
            description: `Read the "${ref.displayName ?? ref.id}" ${ref.source === "project" ? "project" : "user"} skill instructions. ${ref.description || ""}`.trim(),
            parameters: {
              type: "object",
              properties: {
                input: {
                  type: "string",
                  description: "Optional input or question for the skill.",
                },
              },
              required: [],
            },
          },
        });
      }
      if (ref.kind === "mcp") {
        bundleMcpCount++;
        filteredStaticTools.push({
          type: "function",
          function: {
            name: functionName,
            description: ref.description || `MCP tool: ${ref.displayName ?? ref.id}`,
            parameters: resolveBundleMcpInputSchema(ref),
          },
        });
      }
    }
    console.info("[tool-schemas] 已合并 CapabilityBundle schema", {
      bundleHash: options.capabilityBundle.hash,
      skillCount: bundleSkillCount,
      mcpToolCount: bundleMcpCount,
    });
  }

  // 生成 MCP 工具 schema
  if (!options?.capabilityBundle && mcpTools && mcpTools.length > 0) {
    const usedMcpNames = new Set<string>();
    for (const tool of mcpTools) {
      if (!shouldExposeMcpTool(tool)) continue;
      // 函数名格式：mcp__<serverId_short>__<toolName>
      let safeName = tool.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      // 去重：如果净化后名称冲突，追加数字后缀
      const baseName = safeName;
      let suffix = 2;
      while (usedMcpNames.has(safeName)) {
        safeName = `${baseName}_${suffix}`;
        suffix++;
      }
      usedMcpNames.add(safeName);
      filteredStaticTools.push({
        type: "function",
        function: {
          name: safeName,
          description: tool.description || `MCP tool: ${tool.name}`,
          parameters: tool.inputSchema ?? {
            type: "object",
            properties: {},
            required: [],
          },
        },
      });
    }
  }

  // 生成 skill invoke 工具
  if (!options?.capabilityBundle && skills && skills.length > 0) {
    const usedSkillNames = new Set<string>();
    for (const skill of skills) {
      if (!skill.enabled || skill.disableModelInvocation) continue;
      // 清洗 ID，保留字母数字和连字符/下划线，压缩连续下划线
      let sanitizedId = skill.id.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      // 去重：如果存在冲突，追加数字后缀
      const baseId = sanitizedId;
      let suffix = 2;
      while (usedSkillNames.has(sanitizedId)) {
        sanitizedId = `${baseId}_${suffix}`;
        suffix++;
      }
      usedSkillNames.add(sanitizedId);
      filteredStaticTools.push({
        type: "function",
        function: {
          name: `skill_invoke__${sanitizedId}`,
          description: `Read the "${skill.name}" skill instructions. ${skill.description || ""}`.trim(),
          parameters: {
            type: "object",
            properties: {
              input: {
                type: "string",
                description: "Optional input or question for the skill.",
              },
            },
            required: [],
          },
        },
      });
    }

  }

  // skill_view：模型应在完成工作后调用它，并携带数据或本地 dataRef 打开 HTML 面板。
  const viewSkills = (skills ?? []).filter((s) => s.enabled && s.hasViewFile && s.viewFiles && s.viewFiles.length > 0);
  if (viewSkills.length > 0 && shouldExposeBuiltinFunctionTool("skill_view", options)) {
    const allPages = viewSkills.flatMap((s) => (s.viewFiles || []).map((f: string) => `${s.id}:${f}`));
    console.info("[tool-schemas] 已暴露 skill_view", { viewSkillCount: viewSkills.length, pageCount: allPages.length });
    filteredStaticTools.push({
      type: "function",
      function: {
        name: "skill_view",
        description: `Open an HTML panel to display results visually. Call this AFTER completing analysis/report work and generating the data. Pass either data or dataRef; prefer dataRef for large local JSON payloads already saved under the skill directory so the payload is not embedded in model context. Available pages: ${allPages.join(", ")}`,
        parameters: {
          type: "object",
          properties: {
            skill_id: {
              type: "string",
              description: `The skill ID. One of: ${viewSkills.map((s) => s.id).join(", ")}`,
            },
            page: {
              type: "string",
              description: `The HTML page to open. Example: "analysis.html", "report.html"`,
            },
            data: {
              type: "object",
              description: "The JSON data to display in the panel. Must match the page's expected data structure (defined in the skill's SKILL.md).",
            },
            dataRef: {
              type: "string",
              description: "Optional local JSON payload file path under the skill directory. Use this instead of data for large local payloads, for example \".myclaw-payloads/resume-diagnosis.json\".",
            },
          },
          required: ["skill_id", "page"],
        },
      },
    });
  } else {
    console.info("[tool-schemas] 未暴露 skill_view：当前无启用 HTML 面板 Skill");
  }

  return filteredStaticTools;
}

/**
 * 将工具函数名映射回内置工具 ID。
 * 函数名使用下划线（OpenAI 约定），工具 ID 使用点号。
 */
export function functionNameToToolId(name: string): string {
  if (name.startsWith("mcp__") || name.startsWith("mcp_project_")) {
    return name;
  }
  if (name.startsWith("skill_invoke__")) {
    return name; // Skill tools keep their full name as ID
  }
  if (name === "skill_view") {
    return "skill.view";
  }
  if (name === "task_wait_for_user") {
    return "task.wait_for_user";
  }
  if (name.startsWith("calendar_event_")) {
    return "calendar_event." + name.slice("calendar_event_".length);
  }
  if (name.startsWith("schedule_job_")) {
    return "schedule_job." + name.slice("schedule_job_".length);
  }
  if (name.startsWith("today_brief_")) {
    return "today_brief." + name.slice("today_brief_".length);
  }
  // browser 工具：只替换第一个下划线（位于 "browser" 之后）
  // 以保留 press_key 这类多词动作名，映射为 "browser.press_key"
  if (name.startsWith("browser_")) {
    return "browser." + name.slice("browser_".length);
  }
  return name.replace(/_/g, ".");
}

/**
 * 将结构化工具参数转换成 BuiltinToolExecutor 期望的 label 格式。
 */
export function buildToolLabel(functionName: string, args: Record<string, unknown>): string {
  const toolId = functionNameToToolId(functionName);

  switch (toolId) {
    case "fs.read":
      return String(args.path ?? "");

    case "fs.write": {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      return `${path}\n---\n${content}`;
    }

    case "fs.edit":
      // 以 JSON 形式传递，便于执行器解析结构化参数
      return JSON.stringify({
        path: args.path ?? "",
        old_string: args.old_string ?? "",
        new_string: args.new_string ?? "",
      });

    case "fs.list":
      return String(args.path ?? ".");

    case "fs.search": {
      const pattern = String(args.pattern ?? "");
      const searchPath = String(args.path ?? ".");
      return searchPath !== "." ? `${pattern}::${searchPath}` : pattern;
    }

    case "fs.find": {
      const pattern = String(args.pattern ?? "");
      const searchPath = String(args.path ?? ".");
      return searchPath !== "." ? `${pattern}::${searchPath}` : pattern;
    }

    case "file.view":
      return JSON.stringify({
        path: args.path ?? "",
        mode: args.mode ?? "auto",
      });

    case "exec.command": {
      // 判定是否需要附带配置字段，触发 JSON 形式
      const hasConfig =
        "cwd" in args ||
        "timeoutMs" in args ||
        "maxAttempts" in args ||
        "maxTimeoutMs" in args ||
        "timeoutMultiplier" in args ||
        "retryOnTimeout" in args;

      const commandValue = typeof args.command === "string" ? args.command : "";
      const commandMissing = !commandValue.trim();

      // command 合法且无配置：保留旧契约的纯字符串 label（覆盖 90% 调用路径）
      if (!commandMissing && !hasConfig) {
        return commandValue;
      }

      // 其它情况一律走 JSON。command 缺失时额外塞入诊断字段，
      // 让执行器给模型回一条自纠错误消息，而不是抛一句"缺少要执行的命令"。
      const payload: Record<string, unknown> = {
        command: commandValue,
        ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        ...(args.maxAttempts !== undefined ? { maxAttempts: args.maxAttempts } : {}),
        ...(args.maxTimeoutMs !== undefined ? { maxTimeoutMs: args.maxTimeoutMs } : {}),
        ...(args.timeoutMultiplier !== undefined ? { timeoutMultiplier: args.timeoutMultiplier } : {}),
        ...(args.retryOnTimeout !== undefined ? { retryOnTimeout: args.retryOnTimeout } : {}),
      };

      if (commandMissing) {
        payload._diagnostics = {
          receivedArgKeys: Object.keys(args),
          commandFieldType: args.command === undefined ? "undefined" : typeof args.command,
          commandIsWhitespace: typeof args.command === "string" && args.command.length > 0,
        };
      }

      return JSON.stringify(payload);
    }

    case "git.status":
      return String(args.target ?? ".");

    case "git.diff":
      return String(args.target ?? ".");

    case "git.log":
      return String(args.count ?? "10");

    case "git.commit":
      return String(args.message ?? "");

    case "http.fetch":
      return String(args.url ?? "");

    case "web.search":
      return String(args.query ?? "");

    case "task.create":
    case "task.list":
    case "task.get":
    case "task.update":
    case "task.wait_for_user":
    case "artifact.register":
    case "calendar_event.create":
    case "calendar_event.list":
    case "reminder.create":
    case "reminder.list":
    case "schedule_job.create":
    case "schedule_job.list":
    case "today_brief.get":
      return JSON.stringify(args);

    case "skill.view":
      // 把完整参数作为 JSON 传递，便于执行器解析 skill_id、page、data 和 dataRef
      return JSON.stringify(args);

    case "ppt.themes":
      return "";

    case "ppt.generate":
      return JSON.stringify(args);

    case "xlsx.extract":
      return JSON.stringify({
        path: args.path ?? "",
        ...(args.sheet !== undefined ? { sheet: args.sheet } : {}),
        ...(args.maxRows !== undefined ? { maxRows: args.maxRows } : {}),
      });

    case "document.read":
      return JSON.stringify({
        path: args.path ?? "",
        mode: args.mode ?? "stats",
        ...(args.locator !== undefined ? { locator: args.locator } : {}),
        ...(args.query !== undefined ? { query: args.query } : {}),
        ...(args.maxChars !== undefined ? { maxChars: args.maxChars } : {}),
        ...(args.format !== undefined ? { format: args.format } : {}),
        ...(args.includeImages !== undefined ? { includeImages: args.includeImages } : {}),
      });

    default: {
      // browser.*：以完整 JSON 形式传递，供执行器解析
      if (toolId.startsWith("browser.")) {
        return JSON.stringify(args);
      }
      // 检查是否为 skill invoke
      if (toolId.startsWith("skill_invoke__")) {
        return String(args.input ?? "");
      }
      // 兜底：直接拼接所有参数值
      return Object.values(args).map(String).join(" ");
    }
  }
}

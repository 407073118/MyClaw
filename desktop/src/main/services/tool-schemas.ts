/**
 * 为内置工具定义 OpenAI function calling 所需的 schema。
 *
 * 这些 schema 会作为 `tools` 参数传给模型，
 * 让模型通过函数调用来触发工具。每个工具都对应一份 JSON Schema，
 * 因此模型返回的是结构化参数，而不是自由文本。
 */

import type { McpTool, SkillDefinition } from "@shared/contracts";

export type OpenAIFunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * 为所有启用中的内置工具构建 OpenAI function calling 定义。
 * `cwd` 会写入描述中，用于告诉模型当前工作目录。
 */
export function buildToolSchemas(
  cwd: string,
  skills?: SkillDefinition[],
  mcpTools?: Array<McpTool & { serverId: string }>,
): OpenAIFunctionTool[] {
  const staticTools: OpenAIFunctionTool[] = [
    {
      type: "function",
      function: {
        name: "fs_read",
        description: `Read the contents of a text file. Working directory: ${cwd}`,
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path relative to the working directory",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fs_write",
        description: `Write content to a file, creating directories as needed. Working directory: ${cwd}`,
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path relative to the working directory",
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
        name: "exec_command",
        description: `Execute a shell command. Working directory: ${cwd}. Dangerous commands are blocked.`,
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
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
    {
      type: "function",
      function: {
        name: "task_manage",
        description: "Manage a task list for multi-step work. Supports add/done/clear/list actions.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["add", "done", "clear", "list"],
              description: "The action to perform",
            },
            text: {
              type: "string",
              description: "Task description (for 'add') or task number (for 'done')",
            },
          },
          required: ["action"],
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

  // 生成 MCP 工具 schema
  if (mcpTools && mcpTools.length > 0) {
    for (const tool of mcpTools) {
      // 函数名格式：mcp__<serverId_short>__<toolName>
      const safeName = tool.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      staticTools.push({
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
  if (skills && skills.length > 0) {
    for (const skill of skills) {
      if (!skill.enabled || skill.disableModelInvocation) continue;
      staticTools.push({
        type: "function",
        function: {
          name: `skill_invoke__${skill.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
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

    // skill_view：模型应在完成工作后调用它，并携带数据打开 HTML 面板
    const viewSkills = skills.filter((s) => s.enabled && s.hasViewFile && s.viewFiles && s.viewFiles.length > 0);
    if (viewSkills.length > 0) {
      const allPages = viewSkills.flatMap((s) => (s.viewFiles || []).map((f: string) => `${s.id}:${f}`));
      staticTools.push({
        type: "function",
        function: {
          name: "skill_view",
          description: `Open an HTML panel to display results visually. Call this AFTER completing analysis/report work and generating the data. Available pages: ${allPages.join(", ")}`,
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
            },
            required: ["skill_id", "page", "data"],
          },
        },
      });
    }
  }

  return staticTools;
}

/**
 * 将工具函数名映射回内置工具 ID。
 * 函数名使用下划线（OpenAI 约定），工具 ID 使用点号。
 */
export function functionNameToToolId(name: string): string {
  if (name.startsWith("skill_invoke__")) {
    return name; // Skill tools keep their full name as ID
  }
  if (name === "skill_view") {
    return "skill.view";
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

    case "exec.command":
      return String(args.command ?? "");

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

    case "task.manage": {
      const action = String(args.action ?? "list");
      const text = args.text ? ` ${args.text}` : "";
      return `${action}${text}`;
    }

    case "skill.view":
      // 把完整参数作为 JSON 传递，便于执行器解析 skill_id、page 和 data
      return JSON.stringify(args);

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

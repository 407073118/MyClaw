/**
 * OpenAI function calling schemas for builtin tools.
 *
 * These schemas are sent to the model as the `tools` parameter so it can
 * invoke tools via function calling. Each tool has a JSON Schema for its
 * parameters — the model generates structured arguments instead of free-text.
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
 * Build the OpenAI function calling tool definitions for all enabled builtin tools.
 * The `cwd` parameter is used in descriptions to tell the model the working directory.
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
  ];

  // Generate MCP tool schemas
  if (mcpTools && mcpTools.length > 0) {
    for (const tool of mcpTools) {
      // Function name: mcp__<serverId_short>__<toolName>
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

  // Generate skill invoke tools
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

    // skill_view — model calls this AFTER completing work to open an HTML panel with data
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
 * Map tool function names back to builtin tool IDs.
 * Function names use underscores (OpenAI convention), tool IDs use dots.
 */
export function functionNameToToolId(name: string): string {
  if (name.startsWith("skill_invoke__")) {
    return name; // Skill tools keep their full name as ID
  }
  if (name === "skill_view") {
    return "skill.view";
  }
  return name.replace(/_/g, ".");
}

/**
 * Convert structured tool call arguments into the label format expected by BuiltinToolExecutor.
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
      // Pass as JSON so the executor can parse structured args
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
      // Pass the full args as JSON so executor can parse skill_id, page, and data
      return JSON.stringify(args);

    default: {
      // Check if it's a skill invoke
      if (toolId.startsWith("skill_invoke__")) {
        return String(args.input ?? "");
      }
      // Fallback: join all values
      return Object.values(args).map(String).join(" ");
    }
  }
}

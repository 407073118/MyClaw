import type { ModelConversationToolDefinition } from "./types";

type ModelToolDefinitionId = string;

const BUILTIN_MODEL_TOOL_DEFINITIONS: Record<string, ModelConversationToolDefinition> = {
  "fs.list": {
    name: "fs_list_files",
    description: "List directory entries in the current workspace.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative directory path. Defaults to '.'.",
        },
      },
      additionalProperties: false,
    },
  },
  "fs.read": {
    name: "fs_read_file",
    description: "Read a UTF-8 text file from the current workspace.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path under the workspace root.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  "fs.search": {
    name: "fs_search",
    description: "Search for text inside files in the current workspace.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Text pattern to search for.",
        },
        path: {
          type: "string",
          description: "Relative directory path. Defaults to '.'.",
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  "fs.stat": {
    name: "fs_stat",
    description: "Inspect file metadata in the current workspace.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path under the workspace root.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  "fs.write": {
    name: "fs_write_file",
    description: "Write UTF-8 text content to a file in the current workspace.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path under the workspace root.",
        },
        content: {
          type: "string",
          description: "File content to write.",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  "fs.apply_patch": {
    name: "fs_apply_patch",
    description: "Apply a structured patch inside the current workspace.",
    parameters: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description: "Structured patch content in apply_patch format.",
        },
      },
      required: ["patch"],
      additionalProperties: false,
    },
  },
  "fs.move": {
    name: "fs_move",
    description: "Move or rename a file in the current workspace.",
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Source relative path.",
        },
        to: {
          type: "string",
          description: "Destination relative path.",
        },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  "fs.delete": {
    name: "fs_delete",
    description: "Delete a file or directory in the current workspace.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to remove.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  "exec.command": {
    name: "exec_command",
    description:
      "Execute a concrete shell command in the current workspace or an explicitly provided working directory. The command argument must be real shell syntax, not user prose.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Concrete shell command to execute, for example `Get-ChildItem E:\\`.",
        },
        cwd: {
          type: "string",
          description: "Optional absolute working directory for the command. Use this for skill-local commands.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  "exec.task": {
    name: "exec_task",
    description: "Run a predefined development task.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Builtin task identifier, for example workspace.print-working-directory.",
        },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
  "git.status": {
    name: "git_status",
    description: "Inspect repository working tree status.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional relative path filter.",
        },
      },
      additionalProperties: false,
    },
  },
  "git.diff": {
    name: "git_diff",
    description: "Inspect repository diffs.",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Optional path or ref to diff.",
        },
      },
      additionalProperties: false,
    },
  },
  "git.show": {
    name: "git_show",
    description: "Inspect a commit or object in the repository.",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Commit or object reference. Defaults to HEAD.",
        },
      },
      additionalProperties: false,
    },
  },
  "process.list": {
    name: "process_list",
    description: "List local running processes.",
    parameters: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description: "Optional keyword filter for process rows.",
        },
      },
      additionalProperties: false,
    },
  },
  "process.kill": {
    name: "process_kill",
    description: "Terminate a local process by pid.",
    parameters: {
      type: "object",
      properties: {
        pid: {
          type: "integer",
          description: "Target process id.",
        },
      },
      required: ["pid"],
      additionalProperties: false,
    },
  },
  "http.fetch": {
    name: "http_fetch",
    description: "Send a GET request to a URL and inspect the response.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "HTTP, HTTPS, or local URL to fetch.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  "archive.extract": {
    name: "archive_extract",
    description: "Extract a zip or tar archive in the current workspace.",
    parameters: {
      type: "object",
      properties: {
        archivePath: {
          type: "string",
          description: "Relative path to the archive file.",
        },
        destinationPath: {
          type: "string",
          description: "Relative destination directory. Defaults to '.'.",
        },
      },
      required: ["archivePath"],
      additionalProperties: false,
    },
  },
  "fs.find": {
    name: "fs_find",
    description:
      "Find files by name pattern (glob) in the current workspace. Returns matching file paths.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern to match file names, e.g. '**/*.ts', 'src/**/*.vue'.",
        },
        path: {
          type: "string",
          description: "Relative directory to search in. Defaults to '.'.",
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  "web.search": {
    name: "web_search",
    description:
      "Search the web for information using a text query. Returns a summary of relevant results.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query text.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  "task.manage": {
    name: "task_manage",
    description:
      "Create, update, or list tasks for tracking multi-step work. Use action 'list' to view, 'add' to create, 'done' to complete, or 'clear' to reset.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "add", "done", "clear"],
          description: "Action to perform on the task list.",
        },
        text: {
          type: "string",
          description: "Task description (for 'add') or task number (for 'done').",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
};

const MODEL_EXTRA_TOOL_DEFINITIONS: Record<ModelToolDefinitionId, ModelConversationToolDefinition> = {
  "legacy.shell_command": {
    name: "shell_command",
    description:
      "Execute a shell command inside the workspace directory or an explicitly provided working directory.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute.",
        },
        cwd: {
          type: "string",
          description: "Optional absolute working directory for the command.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  "legacy.run_skill": {
    name: "run_skill",
    description: "Run a local skill from the skills directory.",
    parameters: {
      type: "object",
      properties: {
        invocation: {
          type: "string",
          description: "Skill invocation string, for example 'code-review src'.",
        },
      },
      required: ["invocation"],
      additionalProperties: false,
    },
  },
  "legacy.network_request": {
    name: "network_request",
    description: "Send a GET request to an external URL.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "HTTP or HTTPS URL.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
};

const MODEL_TOOL_DEFINITIONS_BY_ID: Record<ModelToolDefinitionId, ModelConversationToolDefinition> = {
  ...BUILTIN_MODEL_TOOL_DEFINITIONS,
  ...MODEL_EXTRA_TOOL_DEFINITIONS,
};

export const DEFAULT_MODEL_TOOL_IDS: readonly ModelToolDefinitionId[] = Object.freeze([
  "fs.read",
  "fs.write",
  "fs.list",
  "fs.search",
  "fs.find",
  "fs.apply_patch",
  "exec.command",
  "git.status",
  "git.diff",
  "git.show",
  "http.fetch",
  "web.search",
  "task.manage",
  "legacy.run_skill",
]);

/** 克隆模型工具定义，避免调用方原地修改共享引用。 */
function cloneToolDefinition(tool: ModelConversationToolDefinition): ModelConversationToolDefinition {
  return structuredClone(tool);
}

/** 读取单个 builtin 工具对应的模型 schema。 */
export function getBuiltinModelToolDefinition(toolId: string): ModelConversationToolDefinition | null {
  const tool = BUILTIN_MODEL_TOOL_DEFINITIONS[toolId];
  return tool ? cloneToolDefinition(tool) : null;
}

/** 列出全部 builtin 工具对应的模型 schema。 */
export function listBuiltinModelToolDefinitions(): Record<string, ModelConversationToolDefinition> {
  return Object.fromEntries(
    Object.entries(BUILTIN_MODEL_TOOL_DEFINITIONS).map(([toolId, tool]) => [toolId, cloneToolDefinition(tool)]),
  );
}

/** 按默认暴露顺序返回模型可见工具 schema。 */
export function listDefaultModelToolDefinitions(): ModelConversationToolDefinition[] {
  return DEFAULT_MODEL_TOOL_IDS.map((toolId) => cloneToolDefinition(MODEL_TOOL_DEFINITIONS_BY_ID[toolId]!));
}

/** 兼容旧门面的默认工具集合，由统一工具源派生。 */
export const MYCLAW_MODEL_TOOLS: readonly ModelConversationToolDefinition[] = Object.freeze(
  listDefaultModelToolDefinitions(),
);

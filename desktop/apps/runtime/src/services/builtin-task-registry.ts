import { platform } from "node:os";

export type BuiltinTaskDefinition = {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  cwdKind: "workspace" | "attached-or-workspace";
};

function createShellTask(
  id: string,
  name: string,
  description: string,
  windowsCommand: string,
  unixCommand: string,
): BuiltinTaskDefinition {
  if (platform() === "win32") {
    return {
      id,
      name,
      description,
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        windowsCommand,
      ],
      cwdKind: "attached-or-workspace",
    };
  }

  return {
    id,
    name,
    description,
    command: "sh",
    args: ["-lc", unixCommand],
    cwdKind: "attached-or-workspace",
  };
}

const BUILTIN_TASK_DEFINITIONS: BuiltinTaskDefinition[] = [
  createShellTask(
    "workspace.print-working-directory",
    "Print Working Directory",
    "Print the current workspace path for quick environment checks.",
    "Get-Location | Select-Object -ExpandProperty Path",
    "pwd",
  ),
  createShellTask(
    "workspace.list-files",
    "List Workspace Files",
    "List top-level files in the current workspace.",
    "Get-ChildItem -Force | Select-Object -ExpandProperty Name",
    "ls -a",
  ),
  {
    id: "shared.build",
    name: "Build Shared",
    description: "Run the shared package TypeScript build check.",
    command: "pnpm",
    args: ["--dir", "packages/shared", "build"],
    cwdKind: "workspace",
  },
  {
    id: "shared.test",
    name: "Test Shared",
    description: "Run the shared package test suite.",
    command: "pnpm",
    args: ["--dir", "packages/shared", "test"],
    cwdKind: "workspace",
  },
  {
    id: "runtime.build",
    name: "Build Runtime",
    description: "Run the runtime TypeScript build check.",
    command: "pnpm",
    args: ["--dir", "apps/runtime", "build"],
    cwdKind: "workspace",
  },
  {
    id: "runtime.test",
    name: "Test Runtime",
    description: "Run the runtime test suite.",
    command: "pnpm",
    args: ["--dir", "apps/runtime", "test"],
    cwdKind: "workspace",
  },
  {
    id: "desktop.build",
    name: "Build Desktop",
    description: "Run the desktop production build.",
    command: "pnpm",
    args: ["--dir", "apps/desktop", "build"],
    cwdKind: "workspace",
  },
  {
    id: "desktop.test",
    name: "Test Desktop",
    description: "Run the desktop test suite.",
    command: "pnpm",
    args: ["--dir", "apps/desktop", "test"],
    cwdKind: "workspace",
  },
];

/** 返回当前运行时内置的预设任务列表。 */
export function listBuiltinTasks(): BuiltinTaskDefinition[] {
  return BUILTIN_TASK_DEFINITIONS.map((task) => ({
    id: task.id,
    name: task.name,
      description: task.description,
      command: task.command,
      args: [...task.args],
      cwdKind: task.cwdKind,
    }));
}

/** 根据任务 ID 查询预设任务定义。 */
export function getBuiltinTask(taskId: string): BuiltinTaskDefinition | null {
  const task = BUILTIN_TASK_DEFINITIONS.find((item) => item.id === taskId);
  if (!task) {
    return null;
  }

  return {
    id: task.id,
    name: task.name,
    description: task.description,
    command: task.command,
    args: [...task.args],
    cwdKind: task.cwdKind,
  };
}

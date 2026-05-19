/**
 * 跨厂商工具名 / 参数键归一化。
 *
 * 模型常见别名：
 *   read_file / readFile / file.read / read    → fs.read
 *   write_file / writeFile / file.write        → fs.write
 *   list_dir / listDir / ls / dir              → fs.list
 *   search / grep / fs.grep                     → fs.search
 *   find / fs.find                              → fs.find
 *   artifact_register / artifact.register       → artifact.register
 *   exec / shell / bash                         → exec.command
 *   run_command / runCommand                    → exec.command
 *
 * 参数别名（特指 fs.*）：
 *   file / filepath / filePath / target / query → path
 */

const TOOL_ID_ALIASES: Record<string, string> = {
  // fs.read
  "read_file": "fs.read",
  "readfile": "fs.read",
  "read": "fs.read",
  "file.read": "fs.read",
  "fs_read": "fs.read",
  "cat": "fs.read",
  // fs.write
  "write_file": "fs.write",
  "writefile": "fs.write",
  "file.write": "fs.write",
  "fs_write": "fs.write",
  // fs.list
  "list_dir": "fs.list",
  "listdir": "fs.list",
  "ls": "fs.list",
  "dir": "fs.list",
  "file.list": "fs.list",
  "fs_list": "fs.list",
  // fs.search
  "search": "fs.search",
  "grep": "fs.search",
  "fs_search": "fs.search",
  "fs.grep": "fs.search",
  // fs.find
  "find": "fs.find",
  "fs_find": "fs.find",
  "glob": "fs.find",
  "fs.glob": "fs.find",
  // artifact.register
  "artifact_register": "artifact.register",
  "artifact.register": "artifact.register",
  "file.register": "artifact.register",
  "register_file": "artifact.register",
  // exec.command
  "exec": "exec.command",
  "shell": "exec.command",
  "bash": "exec.command",
  "run_command": "exec.command",
  "runcommand": "exec.command",
  "exec_command": "exec.command",
  "command": "exec.command",
};

export function normalizeToolId(raw: string): string {
  if (!raw) return "";
  const lower = raw.toLowerCase();
  return TOOL_ID_ALIASES[lower] ?? raw;
}

const FS_PATH_ALIASES = new Set(["file", "filepath", "filePath", "target", "query"]);

/** 把 fs.* 工具的 args 里的路径类别名统一改成 `path`。返回新对象，不动原对象。 */
export function normalizePathArgKeys(
  args: Record<string, unknown>,
  toolId: string,
): Record<string, unknown> {
  if (!args || typeof args !== "object") return args;
  if (!toolId.startsWith("fs.")) return args;
  if (typeof args.path === "string" && args.path.length > 0) return args;

  const next: Record<string, unknown> = { ...args };
  for (const alias of FS_PATH_ALIASES) {
    if (typeof next[alias] === "string") {
      next.path = next[alias];
      break;
    }
  }
  return next;
}

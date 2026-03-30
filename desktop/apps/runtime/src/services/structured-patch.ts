import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { DirectoryService } from "./directory-service";

type PatchOperation =
  | {
      kind: "add";
      path: string;
      lines: string[];
    }
  | {
      kind: "delete";
      path: string;
    }
  | {
      kind: "update";
      path: string;
      nextPath: string | null;
      lines: string[];
    };

type ParsedHunk = {
  oldLines: string[];
  newLines: string[];
};

type SplitContentResult = {
  lines: string[];
  endsWithNewline: boolean;
};

function splitContent(content: string): SplitContentResult {
  if (!content) {
    return { lines: [], endsWithNewline: false };
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const endsWithNewline = normalized.endsWith("\n");
  const trimmed = endsWithNewline ? normalized.slice(0, -1) : normalized;
  return {
    lines: trimmed ? trimmed.split("\n") : [],
    endsWithNewline,
  };
}

function joinContent(lines: string[], endsWithNewline: boolean): string {
  const content = lines.join("\n");
  return endsWithNewline && content ? `${content}\n` : content;
}

function assertPatchBoundary(lines: string[]) {
  if (lines[0] !== "*** Begin Patch" || lines[lines.length - 1] !== "*** End Patch") {
    throw new Error("补丁格式错误：必须以 *** Begin Patch 开始并以 *** End Patch 结束。");
  }
}

function collectPatchBlock(lines: string[], startIndex: number): { block: string[]; nextIndex: number } {
  const block: string[] = [];
  let index = startIndex;

  while (index < lines.length && !lines[index].startsWith("*** ")) {
    block.push(lines[index]);
    index += 1;
  }

  return { block, nextIndex: index };
}

function parsePatch(patch: string): PatchOperation[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  assertPatchBoundary(lines);

  const operations: PatchOperation[] = [];
  let index = 1;

  while (index < lines.length - 1) {
    const line = lines[index];
    if (!line) {
      index += 1;
      continue;
    }

    if (line.startsWith("*** Add File: ")) {
      const path = line.slice("*** Add File: ".length).trim();
      const { block, nextIndex } = collectPatchBlock(lines, index + 1);
      operations.push({
        kind: "add",
        path,
        lines: block.map((item) => {
          if (!item.startsWith("+")) {
            throw new Error(`补丁格式错误：新增文件 ${path} 的内容行必须以 + 开头。`);
          }
          return item.slice(1);
        }),
      });
      index = nextIndex;
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      operations.push({
        kind: "delete",
        path: line.slice("*** Delete File: ".length).trim(),
      });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const path = line.slice("*** Update File: ".length).trim();
      let nextPath: string | null = null;
      let blockStart = index + 1;

      if (lines[blockStart]?.startsWith("*** Move to: ")) {
        nextPath = lines[blockStart].slice("*** Move to: ".length).trim();
        blockStart += 1;
      }

      const { block, nextIndex } = collectPatchBlock(lines, blockStart);
      operations.push({
        kind: "update",
        path,
        nextPath,
        lines: block.filter((item) => item !== "*** End of File"),
      });
      index = nextIndex;
      continue;
    }

    throw new Error(`补丁格式错误：无法识别的指令 ${line}`);
  }

  return operations;
}

function parseUpdateHunks(lines: string[]): ParsedHunk[] {
  const hunks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (current.length > 0) {
        hunks.push(current);
        current = [];
      }
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    hunks.push(current);
  }

  if (hunks.length === 0 && lines.length > 0) {
    hunks.push(lines);
  }

  return hunks.map((hunkLines) => {
    const oldLines: string[] = [];
    const newLines: string[] = [];

    for (const line of hunkLines) {
      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === " ") {
        oldLines.push(content);
        newLines.push(content);
        continue;
      }
      if (prefix === "-") {
        oldLines.push(content);
        continue;
      }
      if (prefix === "+") {
        newLines.push(content);
        continue;
      }
      throw new Error(`补丁格式错误：无法解析的 hunk 行 ${line}`);
    }

    return { oldLines, newLines };
  });
}

function findHunkStart(lines: string[], startIndex: number, oldLines: string[]): number {
  if (oldLines.length === 0) {
    return startIndex;
  }

  for (let index = startIndex; index <= lines.length - oldLines.length; index += 1) {
    const matched = oldLines.every((line, offset) => lines[index + offset] === line);
    if (matched) {
      return index;
    }
  }

  throw new Error("补丁应用失败：未找到可匹配的上下文。");
}

function applyUpdateToContent(content: string, patchLines: string[]): string {
  const original = splitContent(content);
  const hunks = parseUpdateHunks(patchLines);
  const output: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const start = findHunkStart(original.lines, cursor, hunk.oldLines);
    output.push(...original.lines.slice(cursor, start));
    output.push(...hunk.newLines);
    cursor = start + hunk.oldLines.length;
  }

  output.push(...original.lines.slice(cursor));
  return joinContent(output, original.endsWithNewline);
}

/** 在受工作区约束的目录中应用结构化补丁，并返回受影响的相对路径。 */
export async function applyStructuredPatch(input: {
  patch: string;
  attachedDirectory: string | null;
  directoryService: DirectoryService;
}): Promise<string[]> {
  const operations = parsePatch(input.patch);
  const touchedPaths = new Set<string>();

  for (const operation of operations) {
    if (operation.kind === "add") {
      const resolvedPath = input.directoryService.resolvePath(operation.path, input.attachedDirectory);
      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, joinContent(operation.lines, operation.lines.length > 0), "utf8");
      touchedPaths.add(operation.path);
      continue;
    }

    if (operation.kind === "delete") {
      const resolvedPath = input.directoryService.resolvePath(operation.path, input.attachedDirectory);
      await rm(resolvedPath, { force: true });
      touchedPaths.add(operation.path);
      continue;
    }

    const currentPath = input.directoryService.resolvePath(operation.path, input.attachedDirectory);
    const currentContent = await readFile(currentPath, "utf8");
    const nextContent = applyUpdateToContent(currentContent, operation.lines);
    const nextPath = operation.nextPath ?? operation.path;
    const resolvedNextPath = input.directoryService.resolvePath(nextPath, input.attachedDirectory);

    await mkdir(dirname(resolvedNextPath), { recursive: true });
    await writeFile(resolvedNextPath, nextContent, "utf8");
    if (resolvedNextPath !== currentPath) {
      await rm(currentPath, { force: true });
    }

    touchedPaths.add(operation.path);
    touchedPaths.add(nextPath);
  }

  return [...touchedPaths].filter(Boolean);
}

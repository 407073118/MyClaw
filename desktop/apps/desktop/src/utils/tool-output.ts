export type DirectoryTreeEntry = {
  kind: "dir" | "file";
  modifiedAt: string;
  name: string;
  size: string | null;
};

export type DirectoryTree = {
  entries: DirectoryTreeEntry[];
  root: string;
};

const ROOT_PATTERNS = [/^\s*Directory:\s*(.+)\s*$/i, /^\s*\u76ee\u5f55:\s*(.+)\s*$/];

const ENTRY_PATTERN =
  /^(?<mode>\S+)\s+(?<date>\d{4}[/-]\d{1,2}[/-]\d{1,2})\s+(?<time>\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\s*(?:(?<size>\d+)\s+)?(?<name>.+)$/i;

function parseRoot(line: string): string | null {
  for (const pattern of ROOT_PATTERNS) {
    const match = line.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function isHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("Mode") && trimmed.includes("LastWriteTime") && trimmed.endsWith("Name");
}

export function parsePowerShellDirectoryTree(content: string): DirectoryTree | null {
  const lines = content.replace(/\r/g, "").split("\n");
  const root = lines.map(parseRoot).find((value): value is string => Boolean(value));
  const headerIndex = lines.findIndex((line) => isHeaderLine(line));

  if (!root || headerIndex < 0) {
    return null;
  }

  const entries: DirectoryTreeEntry[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed || /^-+$/.test(trimmed)) {
      continue;
    }

    const match = line.match(ENTRY_PATTERN);
    const groups = match?.groups;
    if (!groups?.mode || !groups.name || !groups.date || !groups.time) {
      continue;
    }

    entries.push({
      kind: groups.mode.toLowerCase().startsWith("d") ? "dir" : "file",
      modifiedAt: `${groups.date} ${groups.time}`,
      name: groups.name.trim(),
      size: groups.size?.trim() ?? null,
    });
  }

  if (entries.length === 0) {
    return null;
  }

  return { root, entries };
}

export type InlineFileReference = {
  path: string;
  start: number;
  end: number;
};

const FILE_REFERENCE_EXTENSION_LIST = [
  "md",
  "markdown",
  "mdown",
  "txt",
  "log",
  "env",
  "ini",
  "conf",
  "properties",
  "json",
  "jsonc",
  "csv",
  "tsv",
  "pdf",
  "docx",
  "xlsx",
  "xls",
  "xlsm",
  "pptx",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "mp4",
  "webm",
  "mov",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "css",
  "scss",
  "less",
  "html",
  "htm",
  "xml",
  "svg",
  "yaml",
  "yml",
  "toml",
  "rs",
  "go",
  "py",
  "java",
  "cs",
  "cpp",
  "c",
  "h",
  "hpp",
  "sql",
  "sh",
  "ps1",
] as const;
const FILE_REFERENCE_EXTENSIONS = FILE_REFERENCE_EXTENSION_LIST.join("|");

const SEGMENT = String.raw`[A-Za-z0-9_\-().\u4e00-\u9fff]+`;
const RELATIVE_PATH = String.raw`(?:\.{1,2}[\\/])?${SEGMENT}(?:[\\/]${SEGMENT})*\.(${FILE_REFERENCE_EXTENSIONS})`;
const WINDOWS_PATH = String.raw`[A-Za-z]:[\\/](?:[^\s"'<>|?*:\u3001\uff0c\uff1b\uff1a]+[\\/])*[^\s"'<>|?*:\u3001\uff0c\uff1b\uff1a]+\.(${FILE_REFERENCE_EXTENSIONS})`;
const FILE_REFERENCE_RE = new RegExp(`${WINDOWS_PATH}|${RELATIVE_PATH}`, "giu");
const FILE_CONTEXT_EXT_RE = new RegExp(String.raw`\.(${FILE_REFERENCE_EXTENSIONS})$`, "iu");
const WINDOWS_CONTEXT_PATH_RE = /[A-Za-z]:[\\/](?:[^\s"'<>|?*:\u3001\uff0c\uff1b\uff1a]+[\\/])*[^\s"'<>|?*:\u3001\uff0c\uff1b\uff1a]+/gu;
const UNC_CONTEXT_PATH_RE = /\\\\[^\s"'<>|?*:]+\\[^\s"'<>|?*:]+(?:\\[^\s"'<>|?*:]+)*/gu;
const POSIX_CONTEXT_PATH_RE = /(?<![A-Za-z0-9_\-/.:\\])\/(?:[A-Za-z0-9_\-().\u4e00-\u9fff]+\/)+[A-Za-z0-9_\-().\u4e00-\u9fff]+/gu;

const TRAILING_PUNCTUATION_RE = /[),.;:，。；：、]+$/u;

/** 判断候选路径前后是否处在 URL 或普通单词中，减少聊天文本误报。 */
function hasSafeBoundary(text: string, start: number, end: number): boolean {
  const prev = start > 0 ? text[start - 1] : "";
  const next = end < text.length ? text[end] : "";
  if (prev && /[\w:/\\.-]/u.test(prev)) return false;
  if (next && /[\w/\\.-]/u.test(next)) return false;

  const prefix = text.slice(Math.max(0, start - 12), start).toLowerCase();
  if (prefix.endsWith("http://") || prefix.endsWith("https://") || prefix.endsWith("file://")) return false;
  return true;
}

/** 如果消息里出现完整文件路径，把它的父目录也作为后续裸文件名的候选根。 */
function toCandidateBaseDirectory(raw: string): string | null {
  const trimmed = raw.trim().replace(TRAILING_PUNCTUATION_RE, "");
  if (!trimmed || /^[a-z]+:\/\//i.test(trimmed)) return null;
  if (!FILE_CONTEXT_EXT_RE.test(trimmed)) return trimmed;

  const slashIndex = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (slashIndex < 0) return null;
  if (slashIndex === 0) return "/";
  if (/^[A-Za-z]:[\\/]/.test(trimmed) && slashIndex === 2) {
    return trimmed.slice(0, slashIndex + 1);
  }
  return trimmed.slice(0, slashIndex);
}

/** 从同一条消息中抽取绝对目录，供后续裸文件名点击时兜底解析。 */
export function findInlineFileCandidateBaseDirectories(text: string): string[] {
  const dirs = new Set<string>();
  if (!text) return [];

  const pushMatches = (pattern: RegExp) => {
    for (const match of text.matchAll(pattern)) {
      const raw = match[0];
      const start = match.index ?? 0;
      const end = start + raw.length;
      if (!hasSafeBoundary(text, start, end)) continue;
      const dir = toCandidateBaseDirectory(raw);
      if (dir && dir.length > 2) dirs.add(dir);
    }
  };

  pushMatches(WINDOWS_CONTEXT_PATH_RE);
  pushMatches(UNC_CONTEXT_PATH_RE);
  pushMatches(POSIX_CONTEXT_PATH_RE);

  return [...dirs];
}

/** 从普通聊天文本里找出可作为本地文件入口的路径片段。 */
export function findInlineFileReferences(text: string): InlineFileReference[] {
  const refs: InlineFileReference[] = [];
  if (!text) return refs;

  for (const match of text.matchAll(FILE_REFERENCE_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const trimmed = raw.replace(TRAILING_PUNCTUATION_RE, "");
    const end = start + trimmed.length;
    if (!trimmed || !hasSafeBoundary(text, start, end)) continue;
    refs.push({ path: trimmed, start, end });
  }

  return refs;
}

/**
 * 从用户消息里抽取路径字面量。用于 PathAccessPolicy T1 自动放行。
 *
 * 覆盖：
 * - Windows 绝对：C:\foo\bar.txt（含中文、空格需在引号内）
 * - POSIX 绝对：/foo/bar.txt
 * - UNC：\\server\share\path
 * - WSL↔Win 等价：/mnt/c/foo ↔ C:\foo
 * - file:// URI：file:///C:/foo 或 file:///home/u/x
 *
 * 不做 realpath（同步函数，留给调用方）。输出 NFC 归一后的绝对路径字符串。
 */

/**
 * 轻量 resolve：把含 `.`/`..` 的片段收拢，但保留绝对路径前缀。
 * 不用 node:path，因为本文件在 shared/ 下、会被 renderer 打包。
 */
function liteResolve(p: string): string {
  if (!p) return p;
  // Windows 绝对：Drive:[\\/]rest
  const winMatch = /^([A-Za-z]):([\\\/])(.*)$/.exec(p);
  if (winMatch) {
    const drive = winMatch[1].toUpperCase();
    const sep = "\\";
    const parts = winMatch[3].replace(/\//g, "\\").split(/\\+/).filter(Boolean);
    const out: string[] = [];
    for (const seg of parts) {
      if (seg === ".") continue;
      if (seg === "..") { out.pop(); continue; }
      out.push(seg);
    }
    return `${drive}:${sep}${out.join(sep)}`;
  }
  // POSIX 绝对
  if (p.startsWith("/") || p.startsWith("\\\\")) {
    const prefix = p.startsWith("\\\\") ? "\\\\" : "/";
    const parts = p.slice(prefix.length).split(/[\\/]+/).filter(Boolean);
    const out: string[] = [];
    for (const seg of parts) {
      if (seg === ".") continue;
      if (seg === "..") { out.pop(); continue; }
      out.push(seg);
    }
    return prefix + out.join(prefix === "\\\\" ? "\\" : "/");
  }
  return p;
}

const WIN_DRIVE_RE = /\b([A-Za-z]):[\\\/](?:[^\s"'<>|?*:]+[\\\/])*[^\s"'<>|?*:]*/g;
const WIN_DRIVE_QUOTED_RE = /"([A-Za-z]:[\\\/][^"<>|?*:]+)"/g;
const POSIX_ABS_RE = /(?<![A-Za-z0-9_\-\/.])(\/(?:[A-Za-z0-9_一-鿿\-.+][^\s"'<>|?*:]*(?:\/[A-Za-z0-9_一-鿿\-.+][^\s"'<>|?*:]*)*)?)/g;
const POSIX_QUOTED_RE = /"(\/[^"<>|?*:]+)"/g;
const UNC_RE = /\\\\[A-Za-z0-9._\-]+\\[A-Za-z0-9._\-$]+(?:\\[^\s"'<>|?*:]*)*/g;
const FILE_URI_RE = /file:\/\/(?:\/[A-Za-z]:\/[^\s"'<>]*|\/[^\s"'<>]+)/g;
const WSL_RE = /\/mnt\/[a-z](?:\/[^\s"'<>|?*:]*)?/g;

/** WSL 路径 `/mnt/c/foo` → Windows `C:\foo`。 */
export function wslToWindows(p: string): string | null {
  const m = /^\/mnt\/([a-z])(\/.*)?$/.exec(p);
  if (!m) return null;
  const drive = m[1].toUpperCase();
  const rest = (m[2] ?? "").replace(/\//g, "\\");
  return `${drive}:${rest || "\\"}`;
}

/** Windows 路径 `C:\foo` → WSL `/mnt/c/foo`。 */
export function windowsToWsl(p: string): string | null {
  const m = /^([A-Za-z]):([\\\/].*)?$/.exec(p);
  if (!m) return null;
  const drive = m[1].toLowerCase();
  const rest = (m[2] ?? "\\").replace(/\\/g, "/");
  return `/mnt/${drive}${rest === "/" ? "" : rest}`;
}

/** 清洗 file:// URI 为本地绝对路径。 */
export function fromFileUri(uri: string): string | null {
  const m = /^file:\/\/(?:\/([A-Za-z]):)?(\/.*)?$/.exec(uri);
  if (!m) return null;
  const drive = m[1];
  const rest = m[2] ?? "";
  if (drive) {
    // file:///C:/foo → C:\foo
    return `${drive}:${rest.replace(/\//g, "\\")}`;
  }
  return rest; // file:///home/u/x → /home/u/x
}

/** 抽取消息里的路径。返回去重后的 absolute + NFC 字符串数组。 */
export function extractPaths(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const push = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    // 去掉 URL 前缀（http 类）
    if (/^https?:\/\//i.test(t)) return;
    try {
      const abs = liteResolve(t).normalize("NFC");
      if (abs.length > 2) found.add(abs);
    } catch {
      // ignore bad input
    }
  };

  // 先扫带引号的（保护带空格的路径）
  for (const m of text.matchAll(WIN_DRIVE_QUOTED_RE)) push(m[1]);
  for (const m of text.matchAll(POSIX_QUOTED_RE)) push(m[1]);

  // Windows 绝对（支持中文，不支持带空格除非在引号内）
  for (const m of text.matchAll(WIN_DRIVE_RE)) push(m[0]);

  // UNC
  for (const m of text.matchAll(UNC_RE)) push(m[0]);

  // file:// URI → 本地
  for (const m of text.matchAll(FILE_URI_RE)) {
    const local = fromFileUri(m[0]);
    if (local) push(local);
  }

  // WSL 路径，同时登记它等价的 Windows 路径
  for (const m of text.matchAll(WSL_RE)) {
    push(m[0]);
    const win = wslToWindows(m[0]);
    if (win) push(win);
  }

  // POSIX 绝对（包含 WSL 已经在内）
  for (const m of text.matchAll(POSIX_ABS_RE)) {
    const raw = m[1];
    if (!raw || raw === "/") continue;
    // 排除形如 "2026/04/21"（纯数字斜杠）的日期
    if (/^\/\d+\/\d+/.test(raw) && !/[A-Za-z_]/.test(raw)) continue;
    push(raw);
  }

  return [...found];
}

/** 对已抽取的 Win 路径附带其 WSL 等价形式（反过来同理）。 */
export function expandPathEquivalents(paths: string[]): string[] {
  const out = new Set(paths);
  for (const p of paths) {
    const wsl = windowsToWsl(p);
    if (wsl) out.add(wsl);
    const win = wslToWindows(p);
    if (win) out.add(win);
  }
  return [...out];
}

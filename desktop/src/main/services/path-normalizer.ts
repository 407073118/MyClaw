/**
 * 跨厂商路径参数归一化。
 *
 * 处理步骤：
 * 1. JSON-unescape（部分模型多次转义 `\\\\` → `\\`）
 * 2. URL-decode（file:/// 或 %E9%9D...）
 * 3. NFC 归一
 * 4. WSL↔Win 等价（仅做单向转换，供 policy 判定不依赖平台）
 * 5. resolve 到绝对路径
 *
 * 不做 realpath（调用方自行 canonicalize）。
 */

import { resolve as resolvePath } from "node:path";
import { fromFileUri, wslToWindows } from "@shared/utils/path-extractor";

/**
 * 归一化模型传入的路径参数字符串。
 * 返回 NFC + 绝对路径。若输入已是相对路径，使用 cwd 解析。
 */
export function normalizeToolPath(raw: string, cwd: string): string {
  if (!raw) return "";
  let s = raw.trim();

  // 去除外层引号
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }

  // file:// URI → local
  if (/^file:\/\//i.test(s)) {
    const local = fromFileUri(s);
    if (local) s = local;
  }

  // URL-decode（只当看到 % 时）
  if (/%[0-9A-Fa-f]{2}/.test(s)) {
    try {
      s = decodeURIComponent(s);
    } catch {
      // keep as-is
    }
  }

  // JSON-double-escape 尝试（`\\\\` → `\\`）。保守：仅当能匹配 `\\\\` 时才解一层。
  if (s.includes("\\\\")) {
    s = s.replace(/\\\\/g, "\\");
  }

  // WSL → Win（桌面端主要跑 Windows；如果模型给了 /mnt/f/... 统一转成 F:\...）
  if (process.platform === "win32") {
    const win = wslToWindows(s);
    if (win) s = win;
  }

  // NFC
  s = s.normalize("NFC");

  // resolve 到绝对路径
  try {
    return resolvePath(cwd, s).normalize("NFC");
  } catch {
    return s;
  }
}

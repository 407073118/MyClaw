export const AVATAR_FILE_MAX_BYTES = 2 * 1024 * 1024;

const SUPPORTED_AVATAR_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const AVATAR_PALETTES = [
  ["#2563eb", "#22d3ee", "#f8fafc"],
  ["#7c3aed", "#f472b6", "#fef3c7"],
  ["#0f766e", "#f59e0b", "#ecfeff"],
  ["#be123c", "#fb7185", "#ffe4e6"],
  ["#4338ca", "#a78bfa", "#e0f2fe"],
  ["#0f172a", "#38bdf8", "#facc15"],
  ["#0e7490", "#14b8a6", "#fef08a"],
  ["#a16207", "#f97316", "#ffedd5"],
];

type AvatarIdentity = {
  id?: string | null;
  name?: string | null;
  title?: string | null;
};

/** 计算稳定哈希，保证同一个员工在所有入口获得同一套默认头像配色。 */
function hashAvatarSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = seed.charCodeAt(index) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** 从姓名中提取头像首字母，中文姓名保留首字，英文姓名优先取两个词首字母。 */
export function resolveSiliconPersonAvatarInitials(name: string | null | undefined): string {
  const normalized = (name ?? "").trim();
  if (!normalized) return "?";

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
  }
  return normalized.charAt(0).toUpperCase();
}

/** 生成离线可复现的多层渐变头像背景，替代单色绿块。 */
export function getSiliconPersonAvatarBackground(identity: AvatarIdentity): string {
  const seed = `${identity.id ?? ""}:${identity.name ?? ""}:${identity.title ?? ""}`;
  const palette = AVATAR_PALETTES[hashAvatarSeed(seed) % AVATAR_PALETTES.length] ?? AVATAR_PALETTES[0]!;
  const [primary, secondary, highlight] = palette;

  return [
    `radial-gradient(circle at 26% 18%, color-mix(in srgb, ${highlight} 78%, transparent) 0, transparent 30%)`,
    `radial-gradient(circle at 78% 86%, color-mix(in srgb, ${secondary} 42%, transparent) 0, transparent 34%)`,
    `linear-gradient(135deg, ${primary} 0%, ${secondary} 56%, color-mix(in srgb, ${primary} 68%, #111827) 100%)`,
  ].join(", ");
}

/** 判断本地头像文件类型是否可直接作为图片预览和持久化。 */
export function isSupportedAvatarMimeType(mimeType: string): boolean {
  return SUPPORTED_AVATAR_MIME_TYPES.has(mimeType);
}

/** 读取用户本地上传头像，并在进入状态树前完成格式与大小校验。 */
export async function readAvatarFileAsDataUrl(file: File): Promise<string> {
  if (!isSupportedAvatarMimeType(file.type)) {
    console.warn("[silicon-person-avatar] 本地头像格式不支持", {
      fileName: file.name,
      fileType: file.type,
      allowedTypes: [...SUPPORTED_AVATAR_MIME_TYPES],
    });
    throw new Error("头像图片仅支持 PNG、JPG、WebP 或 GIF。");
  }

  if (file.size > AVATAR_FILE_MAX_BYTES) {
    console.warn("[silicon-person-avatar] 本地头像文件超过大小限制", {
      fileName: file.name,
      fileSize: file.size,
      maxBytes: AVATAR_FILE_MAX_BYTES,
    });
    throw new Error("头像图片不能超过 2MB。");
  }

  console.info("[silicon-person-avatar] 开始读取本地头像文件", {
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  });

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      console.error("[silicon-person-avatar] 本地头像文件读取失败", {
        fileName: file.name,
        error: reader.error?.message,
      });
      reject(new Error("读取头像图片失败，请重新选择文件。"));
    };

    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result.startsWith("data:image/")) {
        console.error("[silicon-person-avatar] 本地头像读取结果不是图片 data URL", {
          fileName: file.name,
          resultType: typeof reader.result,
        });
        reject(new Error("读取头像图片失败，请重新选择文件。"));
        return;
      }

      console.info("[silicon-person-avatar] 本地头像文件读取完成", {
        fileName: file.name,
        dataUrlLength: result.length,
      });
      resolve(result);
    };

    reader.readAsDataURL(file);
  });
}

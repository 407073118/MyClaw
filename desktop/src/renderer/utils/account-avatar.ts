import { readAvatarFileAsDataUrl } from "./silicon-person-avatar";

type AccountAvatarIdentity = {
  account?: string | null;
  displayName?: string | null;
};

const ACCOUNT_AVATAR_PALETTES = [
  ["#0f766e", "#22c55e", "#ccfbf1"],
  ["#2563eb", "#38bdf8", "#dbeafe"],
  ["#7c3aed", "#f472b6", "#fef3c7"],
  ["#be123c", "#fb7185", "#ffe4e6"],
  ["#4338ca", "#a78bfa", "#e0f2fe"],
  ["#475569", "#14b8a6", "#f8fafc"],
];

export const readAccountAvatarFileAsDataUrl = readAvatarFileAsDataUrl;

/** 计算账号头像的稳定哈希，让同一用户在未上传图片时保持一致的默认配色。 */
function hashAccountAvatarSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = seed.charCodeAt(index) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** 从账号名称里提取头像占位文字，中文保留首字，英文优先取两个单词首字母。 */
export function resolveAccountAvatarInitials(identity: AccountAvatarIdentity): string {
  const label = (identity.displayName || identity.account || "").trim();
  if (!label) return "?";

  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
  }
  return label.charAt(0).toUpperCase();
}

/** 生成个人账号的离线渐变头像背景，替代单调的绿色方块。 */
export function getAccountAvatarBackground(identity: AccountAvatarIdentity): string {
  const seed = `${identity.account ?? ""}:${identity.displayName ?? ""}`;
  const palette = ACCOUNT_AVATAR_PALETTES[hashAccountAvatarSeed(seed) % ACCOUNT_AVATAR_PALETTES.length] ?? ACCOUNT_AVATAR_PALETTES[0]!;
  const [primary, secondary, highlight] = palette;

  return [
    `radial-gradient(circle at 24% 18%, color-mix(in srgb, ${highlight} 82%, transparent) 0, transparent 30%)`,
    `radial-gradient(circle at 82% 86%, color-mix(in srgb, ${secondary} 46%, transparent) 0, transparent 34%)`,
    `linear-gradient(135deg, ${primary} 0%, ${secondary} 58%, color-mix(in srgb, ${primary} 70%, #111827) 100%)`,
  ].join(", ");
}

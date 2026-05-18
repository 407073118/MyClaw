import React, { useState } from "react";

interface FallbackAvatarProps {
  name: string;
  background: string;
  src?: string | null;
  className?: string;
  alt?: string;
}

/** 渲染支持图片降级的头像，图片加载失败时回退到首字母占位。 */
export default function FallbackAvatar({
  name,
  background,
  src,
  className,
  alt,
}: FallbackAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const initials = name.trim().charAt(0).toUpperCase() || "?";
  const shouldRenderImage = Boolean(src && failedSrc !== src);

  /** 记录失败图片地址，避免挂载后的状态重置把失败头像重新显示出来。 */
  function handleImageError() {
    console.warn("[fallback-avatar] 头像图片加载失败，已切换到首字母占位", { name, src });
    setFailedSrc(src ?? null);
  }

  return (
    <div className={className} style={{ background }}>
      {shouldRenderImage ? (
        <img src={src ?? undefined} alt={alt ?? name} onError={handleImageError} />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

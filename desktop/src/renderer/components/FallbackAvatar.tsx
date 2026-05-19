import React, { useState } from "react";

interface FallbackAvatarProps {
  name: string;
  background: string;
  src?: string | null;
  className?: string;
  alt?: string;
  initials?: string;
  "aria-hidden"?: boolean;
  "data-testid"?: string;
  children?: React.ReactNode;
}

/** 渲染支持图片降级的头像，图片加载失败时回退到首字母占位。 */
export default function FallbackAvatar({
  name,
  background,
  src,
  className,
  alt,
  initials: explicitInitials,
  "aria-hidden": ariaHidden,
  "data-testid": testId,
  children,
}: FallbackAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const initials = (explicitInitials ?? name.trim().charAt(0).toUpperCase()) || "?";
  const shouldRenderImage = Boolean(src && failedSrc !== src);

  /** 记录失败图片地址，避免挂载后的状态重置把失败头像重新显示出来。 */
  function handleImageError() {
    console.warn("[fallback-avatar] 头像图片加载失败，已切换到首字母占位", { name, src });
    setFailedSrc(src ?? null);
  }

  return (
    <div className={className} style={{ background }} aria-hidden={ariaHidden} data-testid={testId}>
      {shouldRenderImage ? (
        <img
          src={src ?? undefined}
          alt={alt ?? name}
          className="fallback-avatar__image"
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit", display: "block" }}
          onError={handleImageError}
        />
      ) : (
        <span className="fallback-avatar__initials">{initials}</span>
      )}
      {children}
    </div>
  );
}

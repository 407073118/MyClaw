import React, { useEffect, useState } from "react";

interface FallbackAvatarProps {
  name: string;
  background: string;
  src?: string | null;
  className?: string;
  alt?: string;
}

/** 渲染支持图片降级的头像，在加载失败时回退到首字母占位。 */
export default function FallbackAvatar({
  name,
  background,
  src,
  className,
  alt,
}: FallbackAvatarProps) {
  const [hasImageError, setHasImageError] = useState(false);
  const initials = name.trim().charAt(0).toUpperCase() || "·";

  useEffect(() => {
    setHasImageError(false);
  }, [name, src]);

  return (
    <div className={className} style={{ background }}>
      {src && !hasImageError ? (
        <img src={src} alt={alt ?? name} onError={() => setHasImageError(true)} />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

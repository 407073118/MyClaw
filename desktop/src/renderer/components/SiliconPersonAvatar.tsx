import React from "react";

import type { SiliconPerson } from "@shared/contracts";
import FallbackAvatar from "./FallbackAvatar";
import {
  getSiliconPersonAvatarBackground,
  resolveSiliconPersonAvatarInitials,
} from "../utils/silicon-person-avatar";

type SiliconPersonAvatarInput = Pick<SiliconPerson, "id" | "name" | "title" | "avatarDataUrl">;

interface SiliconPersonAvatarProps {
  person: SiliconPersonAvatarInput;
  className?: string;
  alt?: string;
  "aria-hidden"?: boolean;
  "data-testid"?: string;
  children?: React.ReactNode;
}

/** 统一渲染硅基员工头像，优先使用用户上传图片，缺省时使用离线渐变头像。 */
export default function SiliconPersonAvatar({
  person,
  className,
  alt,
  "aria-hidden": ariaHidden,
  "data-testid": testId,
  children,
}: SiliconPersonAvatarProps) {
  const displayName = person.name || person.title || "硅基员工";
  const initials = resolveSiliconPersonAvatarInitials(displayName);

  return (
    <FallbackAvatar
      name={initials}
      initials={initials}
      background={getSiliconPersonAvatarBackground(person)}
      src={person.avatarDataUrl ?? null}
      className={className}
      alt={alt ?? `${displayName} 头像`}
      aria-hidden={ariaHidden}
      data-testid={testId}
    >
      {children}
    </FallbackAvatar>
  );
}

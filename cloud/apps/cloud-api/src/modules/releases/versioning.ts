/** 根据当前版本推导下一个 patch 版本，缺少或格式异常时从 1.0.0 开始。 */
export function resolveNextPatchVersion(currentVersion?: string | null): string {
  const normalized = currentVersion?.trim().replace(/^v/i, "") ?? "";
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return "1.0.0";
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return "1.0.0";
  }

  return `${major}.${minor}.${patch + 1}`;
}

/** 优先使用用户显式传入的版本，否则按最新版本自动递增 patch。 */
export function resolveReleaseVersion(input: {
  requestedVersion?: string | null;
  latestVersion?: string | null;
}): string {
  const requestedVersion = input.requestedVersion?.trim();
  if (requestedVersion) {
    return requestedVersion;
  }

  return resolveNextPatchVersion(input.latestVersion);
}

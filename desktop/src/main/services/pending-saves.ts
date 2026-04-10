/** 记录待完成的保存操作，便于优雅退出。 */
const pendingSaves = new Set<Promise<unknown>>();

export function trackSave(promise: Promise<unknown>): void {
  pendingSaves.add(promise);
  promise.finally(() => pendingSaves.delete(promise));
}

export function waitForPendingSaves(): Promise<void> {
  return Promise.all(pendingSaves).then(() => {});
}

export function getPendingSavesCount(): number {
  return pendingSaves.size;
}

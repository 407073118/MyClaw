import { Injectable } from "@nestjs/common";

export type AcquireLocalSessionResult =
  | { acquired: true }
  | { acquired: false; position: number };

@Injectable()
export class LocalSessionLockService {
  private readonly runningBySession = new Map<string, string>();
  private readonly queuedBySession = new Map<string, string[]>();

  /** 尝试获取本地会话投递锁，同一会话已有运行任务时进入队列。 */
  acquire(localSessionKey: string, deliveryId: string): AcquireLocalSessionResult {
    const runningDeliveryId = this.runningBySession.get(localSessionKey);
    if (!runningDeliveryId) {
      this.runningBySession.set(localSessionKey, deliveryId);
      console.info("[delivery-lock] 本地会话投递锁获取成功", { localSessionKey, deliveryId });
      return { acquired: true };
    }

    const queue = this.queuedBySession.get(localSessionKey) ?? [];
    queue.push(deliveryId);
    this.queuedBySession.set(localSessionKey, queue);
    console.warn("[delivery-lock] 本地会话已有运行投递，当前投递进入队列", {
      localSessionKey,
      deliveryId,
      runningDeliveryId,
      position: queue.length,
    });
    return { acquired: false, position: queue.length };
  }

  /** 释放本地会话投递锁，并把下一个排队投递提升为运行态。 */
  release(localSessionKey: string, deliveryId: string): { nextDeliveryId?: string } {
    if (this.runningBySession.get(localSessionKey) !== deliveryId) {
      console.warn("[delivery-lock] 释放投递锁时发现运行投递不匹配", { localSessionKey, deliveryId });
      return {};
    }

    const queue = this.queuedBySession.get(localSessionKey) ?? [];
    const nextDeliveryId = queue.shift();
    if (nextDeliveryId) {
      this.runningBySession.set(localSessionKey, nextDeliveryId);
      this.queuedBySession.set(localSessionKey, queue);
      console.info("[delivery-lock] 本地会话排队投递已提升为运行态", { localSessionKey, nextDeliveryId });
      return { nextDeliveryId };
    }

    this.runningBySession.delete(localSessionKey);
    this.queuedBySession.delete(localSessionKey);
    console.info("[delivery-lock] 本地会话投递锁释放成功", { localSessionKey, deliveryId });
    return {};
  }

  /** 判断指定投递是否为当前会话正在运行的投递。 */
  isRunning(localSessionKey: string, deliveryId: string): boolean {
    const running = this.runningBySession.get(localSessionKey) === deliveryId;
    console.info("[delivery-lock] 查询本地会话运行投递", { localSessionKey, deliveryId, running });
    return running;
  }
}

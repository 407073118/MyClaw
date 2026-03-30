import type { RuntimeEvent } from "@myclaw-desktop/shared";

export class EventBus {
  private readonly events: RuntimeEvent[] = [];

  push(event: RuntimeEvent): void {
    this.events.push(event);
  }

  list(): RuntimeEvent[] {
    return [...this.events];
  }
}


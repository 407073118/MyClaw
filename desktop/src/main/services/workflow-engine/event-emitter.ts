import type { WorkflowStreamEvent } from "@shared/contracts/workflow-stream";

export type WorkflowEventListener = (event: WorkflowStreamEvent) => void;

export class WorkflowEventEmitter {
  private listeners: WorkflowEventListener[] = [];

  on(listener: WorkflowEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(event: WorkflowStreamEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[workflow-emitter] listener error", err);
      }
    }
  }
}

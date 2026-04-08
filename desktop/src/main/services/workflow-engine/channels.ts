import type { WorkflowMergeStrategy, WorkflowStateSchemaField } from "@shared/contracts";

export interface Channel<Value = unknown, Update = unknown> {
  readonly name: string;
  version: number;
  get(): Value | undefined;
  update(values: Update[]): boolean;
  checkpoint(): unknown;
  fromCheckpoint(data: unknown): void;
  reset(): void;
}

export class LastValueChannel<T> implements Channel<T, T> {
  version = 0;
  private value: T;

  constructor(
    public readonly name: string,
    private defaultValue: T,
  ) {
    this.value = defaultValue;
  }

  get(): T {
    return this.value;
  }

  update(values: T[]): boolean {
    if (values.length === 0) return false;
    const newValue = values[values.length - 1];
    if (this.value === newValue) return false;
    this.value = newValue;
    this.version++;
    return true;
  }

  checkpoint(): unknown {
    return { value: this.value, version: this.version };
  }

  fromCheckpoint(data: unknown): void {
    const cp = data as { value: T; version: number };
    this.value = cp.value;
    this.version = cp.version;
  }

  reset(): void {
    this.value = this.defaultValue;
    this.version = 0;
  }
}

export class ReducerChannel<T> implements Channel<T, T> {
  version = 0;
  private value: T;

  constructor(
    public readonly name: string,
    private reducer: (current: T, update: T) => T,
    private defaultValue: T,
  ) {
    this.value = defaultValue;
  }

  get(): T {
    return this.value;
  }

  update(values: T[]): boolean {
    if (values.length === 0) return false;
    const prev = this.value;
    for (const v of values) {
      this.value = this.reducer(this.value, v);
    }
    // Use JSON comparison for non-primitive types
    const changed = typeof this.value === "object"
      ? JSON.stringify(this.value) !== JSON.stringify(prev)
      : this.value !== prev;
    if (!changed) return false;
    this.version++;
    return true;
  }

  checkpoint(): unknown {
    return { value: this.value, version: this.version };
  }

  fromCheckpoint(data: unknown): void {
    const cp = data as { value: T; version: number };
    this.value = cp.value;
    this.version = cp.version;
  }

  reset(): void {
    this.value = this.defaultValue;
    this.version = 0;
  }
}

export class EphemeralChannel<T> implements Channel<T, T> {
  version = 0;
  private value: T | undefined = undefined;

  constructor(public readonly name: string) {}

  get(): T | undefined {
    return this.value;
  }

  update(values: T[]): boolean {
    if (values.length === 0) return false;
    this.value = values[values.length - 1];
    this.version++;
    return true;
  }

  checkpoint(): unknown {
    return null;
  }

  fromCheckpoint(): void {
    this.value = undefined;
  }

  reset(): void {
    this.value = undefined;
  }
}

function appendReducer<T>(current: T[], update: T[]): T[] {
  return [...current, ...update];
}

function unionReducer<T>(current: T[], update: T[]): T[] {
  return [...new Set([...current, ...update])];
}

function objectMergeReducer(
  current: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  return { ...current, ...update };
}

function getDefaultForType(valueType: string): unknown {
  switch (valueType) {
    case "string": return "";
    case "number": return 0;
    case "boolean": return false;
    case "object": return {};
    case "array": return [];
    default: return null;
  }
}

export function compileChannels(
  schema: WorkflowStateSchemaField[],
): Map<string, Channel> {
  const channels = new Map<string, Channel>();

  for (const field of schema) {
    const defaultVal = getDefaultForType(field.valueType);

    switch (field.mergeStrategy) {
      case "replace":
        channels.set(field.key, new LastValueChannel(field.key, defaultVal));
        break;
      case "append":
        channels.set(field.key, new ReducerChannel(field.key, appendReducer as any, defaultVal));
        break;
      case "union":
        channels.set(field.key, new ReducerChannel(field.key, unionReducer as any, defaultVal));
        break;
      case "object-merge":
        channels.set(field.key, new ReducerChannel(field.key, objectMergeReducer as any, defaultVal));
        break;
      case "custom":
        channels.set(field.key, new LastValueChannel(field.key, defaultVal));
        break;
    }
  }

  channels.set("__route__", new EphemeralChannel("__route__"));
  channels.set("__interrupt__", new EphemeralChannel("__interrupt__"));
  channels.set("__resume__", new EphemeralChannel("__resume__"));
  channels.set("__done__", new EphemeralChannel("__done__"));

  return channels;
}

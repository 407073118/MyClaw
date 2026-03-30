export type ProviderKind = "openai-compatible" | "anthropic" | "local-gateway";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ModelProfile = {
  id: string;
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  baseUrlMode?: "manual" | "provider-root";
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
  requestBody?: Record<string, JsonValue>;
};

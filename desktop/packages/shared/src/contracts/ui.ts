export const A2UI_LITE_VERSION = "a2ui-lite/v1" as const;

export type A2UiLiteVersion = typeof A2UI_LITE_VERSION;

export type A2UiFormFieldInput = "text" | "textarea" | "select";

export type A2UiSelectOption = {
  label: string;
  value: string;
};

export type A2UiFormField = {
  name: string;
  label: string;
  input: A2UiFormFieldInput;
  placeholder?: string;
  required?: boolean;
  options?: A2UiSelectOption[];
};

export type A2UiForm = {
  version: A2UiLiteVersion;
  kind: "form";
  id: string;
  title: string;
  description?: string;
  submitLabel?: string;
  fields: A2UiFormField[];
};

export type A2UiPayload = A2UiForm;

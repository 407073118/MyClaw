/** @vitest-environment jsdom */

import React, { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import WorkflowStateSchemaEditor from "../src/renderer/components/workflow/WorkflowStateSchemaEditor";
import type { WorkflowStateSchemaField } from "@shared/contracts";

const initialFields: WorkflowStateSchemaField[] = [
  {
    key: "title",
    label: "Title",
    description: "Document title",
    valueType: "string",
    mergeStrategy: "replace",
    required: false,
    producerNodeIds: [],
    consumerNodeIds: [],
  },
];

/** 提供一个可控容器，模拟父组件在字段变更后回写 modelValue。 */
function SchemaEditorHarness() {
  const [fields, setFields] = useState<WorkflowStateSchemaField[]>(initialFields);

  return React.createElement(WorkflowStateSchemaEditor, {
    modelValue: fields,
    onUpdateModelValue: setFields,
    onValidation: () => {},
  });
}

describe("WorkflowStateSchemaEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the key input focused when editing the key field", () => {
    const { getByTestId } = render(React.createElement(SchemaEditorHarness));

    const keyInput = getByTestId("workflow-state-schema-key-0") as HTMLInputElement;
    keyInput.focus();
    expect(document.activeElement).toBe(keyInput);

    fireEvent.change(keyInput, { target: { value: "headline" } });

    const updatedKeyInput = getByTestId("workflow-state-schema-key-0") as HTMLInputElement;
    expect(updatedKeyInput.value).toBe("headline");
    expect(document.activeElement).toBe(updatedKeyInput);
  });
});

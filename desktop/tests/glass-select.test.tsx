/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlassSelect } from "../src/renderer/components/ui/GlassSelect";

describe("GlassSelect", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens a project-styled listbox and emits option changes", async () => {
    const onChange = vi.fn();

    render(
      <GlassSelect
        ariaLabel="Mode"
        data-testid="mode-select"
        value=""
        placeholder="Choose mode"
        options={[
          { label: "Fast", value: "fast" },
          { label: "Careful", value: "careful" },
        ]}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId("mode-select").className).toContain("glass-select__native");
    const control = screen.getByTestId("mode-select-control");
    expect(control.className).toContain("glass-select__button");

    fireEvent.click(control);

    expect((await screen.findByRole("listbox")).className).toContain("glass-select__menu");
    fireEvent.click(screen.getByRole("option", { name: "Careful" }));

    expect(onChange).toHaveBeenCalledWith("careful");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });
});

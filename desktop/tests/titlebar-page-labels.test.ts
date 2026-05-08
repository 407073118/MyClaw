/** @vitest-environment jsdom */

import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("TitleBar page labels", () => {
  it("shows meetings label for nested meetings route", async () => {
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        platform: "win32",
      },
    });

    const { default: TitleBar } = await import("../src/renderer/components/TitleBar");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/meetings/meeting-1"] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: "/meetings/:id",
            element: React.createElement(TitleBar),
          }),
        ),
      ),
    );

    expect(screen.getByText("会议录音")).toBeTruthy();
    expect(screen.queryByText("MyClaw")).toBeTruthy();
  });
});

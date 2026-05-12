/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../src/renderer/stores/auth";

vi.mock("../src/renderer/components/TitleBar", () => ({
  default: () => React.createElement("div", { "data-testid": "mock-titlebar" }),
}));

describe("desktop guest login", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    (window as any).myClawAPI = {
      auth: {
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
        introspect: vi.fn(),
      },
    };
    useAuthStore.getState().clearSession();
  });

  afterEach(() => {
    cleanup();
  });

  it("creates an authenticated local guest session without cloud auth", async () => {
    const response = await useAuthStore.getState().loginAsGuest();
    const state = useAuthStore.getState();

    expect(response.user.account).toBe("guest");
    expect(response.user.displayName).toBe("游客");
    expect(response.user.roles).toContain("guest");
    expect(state.isAuthenticated).toBe(true);
    expect(state.session.user?.account).toBe("guest");
    expect((window as any).myClawAPI.auth.login).not.toHaveBeenCalled();
    expect((window as any).myClawAPI.auth.introspect).not.toHaveBeenCalled();

    await expect(useAuthStore.getState().introspectSession()).resolves.toBe(true);
    expect((window as any).myClawAPI.auth.introspect).not.toHaveBeenCalled();
  });

  it("lets the login page enter by guest without account or password", async () => {
    const { default: LoginPage } = await import("../src/renderer/pages/LoginPage");

    render(
      <MemoryRouter
        initialEntries={["/login?redirect=/chat"]}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/chat" element={<div data-testid="chat-destination" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect((screen.getByTestId("desktop-login-account") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("desktop-login-password") as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getByTestId("desktop-login-guest"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-destination")).toBeTruthy();
    });
    expect(useAuthStore.getState().session.user?.account).toBe("guest");
    expect((window as any).myClawAPI.auth.login).not.toHaveBeenCalled();
  });
});

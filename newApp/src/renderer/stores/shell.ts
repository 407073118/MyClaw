import { create } from "zustand";

type ShellState = {
  platform: string;
  attachedDirectory: string;
  runtimeBaseUrl: string;

  // Actions
  setAttachedDirectory: (path: string) => void;
};

export const useShellStore = create<ShellState>()((set) => ({
  platform: (typeof window !== "undefined" ? (window.myClawAPI?.platform ?? "unknown") : "unknown"),
  attachedDirectory: "",
  runtimeBaseUrl: (typeof import.meta !== "undefined" ? ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_RUNTIME_BASE_URL ?? "http://127.0.0.1:43110") : "http://127.0.0.1:43110"),

  setAttachedDirectory(path: string) {
    set({ attachedDirectory: path });
  },
}));

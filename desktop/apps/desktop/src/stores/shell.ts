import { defineStore } from "pinia";

export const useShellStore = defineStore("shell", {
  state: () => ({
    runtimeBaseUrl: import.meta.env.VITE_RUNTIME_BASE_URL ?? "http://127.0.0.1:43110",
    attachedDirectory: "",
  }),
  actions: {
    setAttachedDirectory(path: string) {
      this.attachedDirectory = path;
    },
  },
});


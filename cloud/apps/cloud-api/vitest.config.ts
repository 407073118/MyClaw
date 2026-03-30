import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    api: {
      host: "127.0.0.1"
    },
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});

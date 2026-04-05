import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "shared"),
      "@": resolve(__dirname, "src/renderer"),
    },
  },
});

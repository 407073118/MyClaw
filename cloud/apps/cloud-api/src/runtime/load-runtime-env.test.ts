import { afterEach, describe, expect, it, vi } from "vitest";

import { loadRuntimeEnv } from "./load-runtime-env";

describe("loadRuntimeEnv", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalLoadEnvFile = process.loadEnvFile;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    process.loadEnvFile = originalLoadEnvFile;
    vi.restoreAllMocks();
  });

  it("loads .env from the current cloud-api working directory", () => {
    delete process.env.DATABASE_URL;
    process.loadEnvFile = vi.fn((path: string) => {
      if (path.endsWith("/.env")) {
        process.env.DATABASE_URL = "postgresql://cwd-user:cwd-pass@127.0.0.1:5432/myclaw_cloud?schema=public";
      } else {
        throw new Error(`unexpected path: ${path}`);
      }
    });

    const loadedPath = loadRuntimeEnv("/tmp/myclaw/cloud/apps/cloud-api", "/tmp/myclaw/cloud/apps/cloud-api/dist/runtime");

    expect(loadedPath).toBe("/tmp/myclaw/cloud/apps/cloud-api/.env");
    expect(process.env.DATABASE_URL).toBe(
      "postgresql://cwd-user:cwd-pass@127.0.0.1:5432/myclaw_cloud?schema=public"
    );
  });

  it("falls back to apps/cloud-api/.env when started from the cloud workspace root", () => {
    delete process.env.DATABASE_URL;
    process.loadEnvFile = vi.fn((path: string) => {
      if (path === "/tmp/myclaw/cloud/.env") {
        const error = new Error("missing env file") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }

      if (path === "/tmp/myclaw/cloud/apps/cloud-api/.env") {
        process.env.DATABASE_URL = "postgresql://root-user:root-pass@127.0.0.1:5432/myclaw_cloud?schema=public";
        return;
      }

      throw new Error(`unexpected path: ${path}`);
    });

    const loadedPath = loadRuntimeEnv("/tmp/myclaw/cloud", "/tmp/myclaw/cloud/apps/cloud-api/dist/runtime");

    expect(loadedPath).toBe("/tmp/myclaw/cloud/apps/cloud-api/.env");
    expect(process.env.DATABASE_URL).toBe(
      "postgresql://root-user:root-pass@127.0.0.1:5432/myclaw_cloud?schema=public"
    );
  });

  it("returns null when DATABASE_URL is already present", () => {
    process.env.DATABASE_URL = "postgresql://existing-user:existing-pass@127.0.0.1:5432/myclaw_cloud?schema=public";
    process.loadEnvFile = vi.fn();

    const loadedPath = loadRuntimeEnv("/tmp/myclaw/cloud", "/tmp/myclaw/cloud/apps/cloud-api/dist/runtime");

    expect(loadedPath).toBeNull();
    expect(process.loadEnvFile).not.toHaveBeenCalled();
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { initializeSiliconRuntimeRoot } from "../src/core/runtime-root";
import { createEmployeeTask } from "../src/core/task-store";
import { createSiliconHttpServer, isSiliconHttpServerEntrypoint, readSiliconHttpServerCliOptions } from "../src/http/server";

const tempRoots: string[] = [];

/** 创建 HTTP 测试使用的临时 runtime 根目录。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-http-"));
  tempRoots.push(root);
  return root;
}

/** 在随机端口启动测试 server，并返回 base URL 和关闭函数。 */
async function listenForTest(server: ReturnType<typeof createSiliconHttpServer>): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP 测试 server 地址不可用");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}

describe("silicon HTTP server", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("serves dashboard API and Workbench UI without desktop dependencies", async () => {
    const runtimeRoot = await makeTempRoot();
    await initializeSiliconRuntimeRoot({ runtimeRoot });
    const { employeeDir } = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "document-organizer",
    });
    await createEmployeeTask({
      employeeDir,
      taskId: "write-report",
      title: "写报告",
      instruction: "生成一份结构化报告。",
    });

    const server = createSiliconHttpServer({ runtimeRoot });
    const started = await listenForTest(server);
    try {
      const dashboardResponse = await fetch(`${started.baseUrl}/api/runtime/dashboard`);
      expect(dashboardResponse.status).toBe(200);
      const dashboard = await dashboardResponse.json();
      expect(dashboard.summary.employees).toBe(1);
      expect(dashboard.employees[0]).toMatchObject({
        employeeId: "ada",
        displayName: "Ada",
      });

      const uiResponse = await fetch(`${started.baseUrl}/`);
      expect(uiResponse.status).toBe(200);
      const html = await uiResponse.text();
      expect(html).toContain("Silicon Workbench");
      expect(html).toContain("app.js");
    } finally {
      await started.close();
    }
  });

  it("recognizes a relative dist server path as the direct entrypoint", () => {
    expect(isSiliconHttpServerEntrypoint(
      "file:///F:/repo/silicon/dist/http/server.js",
      "silicon/dist/http/server.js",
      "F:/repo",
    )).toBe(true);
  });

  it("parses runtime root and port from direct server arguments", () => {
    expect(readSiliconHttpServerCliOptions([
      "--runtime-root",
      "F:\\tmp\\silicon-ui-runtime",
      "--port",
      "17321",
    ], {})).toEqual({
      runtimeRoot: "F:\\tmp\\silicon-ui-runtime",
      port: 17321,
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FastdfsArtifactStorage } from "./fastdfs-artifact-storage";

function createTextStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    }
  });
}

describe("fastdfs artifact storage", () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env.FASTDFS_BASE_URL = "http://127.0.0.1:8080";
    process.env.FASTDFS_PROJECT_CODE = "BrTest";
    process.env.FASTDFS_TOKEN = "BrTest20210526";
    process.env.FASTDFS_UPLOAD_PATH = "/api/file/uploadSingle";
    process.env.FASTDFS_DOWNLOAD_PATH = "/api/file/download";
    process.env.FASTDFS_TIMEOUT_MS = "30000";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("stores skill artifact metadata via fastdfs upload response", async () => {
    const fetchMock = vi.fn(async () => (
      new Response(
        JSON.stringify({
          code: 0,
          msg: "成功",
          result: {
            name: "security-audit.zip",
            url: "http://127.0.0.1:8080/group1/M00/00/16/security-audit.zip",
            fileSizeByte: 32
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    ));
    vi.stubGlobal("fetch", fetchMock);

    const storage = new FastdfsArtifactStorage();
    const stored = await storage.storeSkillArtifact({
      releaseId: "release-skill-security-audit-2.2.0",
      fileName: "security-audit.zip",
      fileBytes: Buffer.from("zip-binary-content")
    });

    expect(stored).toMatchObject({
      fileName: "security-audit.zip",
      fileSize: 32,
      storageKey: "/group1/M00/00/16/security-audit.zip",
      storageUrl: "http://127.0.0.1:8080/group1/M00/00/16/security-audit.zip"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const uploadCalls = fetchMock.mock.calls as unknown[][];
    expect(String(uploadCalls[0]?.[0])).toContain("/api/file/uploadSingle");
  });

  it("opens a readable stream through fastdfs download endpoint", async () => {
    const fetchMock = vi.fn(async () => (
      new Response(createTextStream("artifact-body"), {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-length": "13"
        }
      })
    ));
    vi.stubGlobal("fetch", fetchMock);

    const storage = new FastdfsArtifactStorage();
    const readStream = await storage.openSkillArtifactReadStream({
      fileName: "security-audit.zip",
      fileSize: 13,
      storageKey: "/group1/M00/00/16/security-audit.zip",
      storageUrl: "http://127.0.0.1:8080/group1/M00/00/16/security-audit.zip"
    });

    expect(readStream.fileName).toBe("security-audit.zip");
    expect(readStream.contentType).toBe("application/zip");
    expect(readStream.contentLength).toBe(13);
    const downloadCalls = fetchMock.mock.calls as unknown[][];
    expect(String(downloadCalls[0]?.[0])).toContain("/api/file/download");
    expect(String(downloadCalls[0]?.[0])).toContain("url=%2Fgroup1%2FM00%2F00%2F16%2Fsecurity-audit.zip");

    const bodyText = await new Response(readStream.stream).text();
    expect(bodyText).toBe("artifact-body");
  });

  it("throws when FASTDFS_BASE_URL is missing", async () => {
    delete process.env.FASTDFS_BASE_URL;
    const storage = new FastdfsArtifactStorage();

    await expect(
      storage.storeSkillArtifact({
        releaseId: "release-missing-config",
        fileName: "x.zip",
        fileBytes: Buffer.from("x")
      }),
    ).rejects.toThrowError("FASTDFS_BASE_URL is required");
  });
});

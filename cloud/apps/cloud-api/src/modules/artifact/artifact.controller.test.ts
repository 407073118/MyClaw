import { PassThrough } from "node:stream";

import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { SkillArtifactReadStream, StoredSkillArtifact } from "./artifact-storage.port";
import { ArtifactController } from "./artifact.controller";
import { ArtifactService } from "./artifact.service";

function createResponseMock() {
  const headers = new Map<string, string>();
  const bodyChunks: Buffer[] = [];
  const stream = new PassThrough();

  stream.on("data", (chunk) => {
    bodyChunks.push(Buffer.from(chunk));
  });

  const response = stream as PassThrough & {
    setHeader: (name: string, value: string) => void;
    headersSent: boolean;
  };
  let sent = false;
  response.setHeader = (name: string, value: string) => {
    headers.set(name.toLowerCase(), value);
  };
  Object.defineProperty(response, "headersSent", {
    get: () => sent
  });

  const originalWrite = response.write.bind(response);
  response.write = ((chunk: any, ...args: any[]) => {
    sent = true;
    return originalWrite(chunk, ...args);
  }) as any;

  const originalEnd = response.end.bind(response);
  response.end = ((...args: any[]) => {
    sent = true;
    return originalEnd(...args);
  }) as any;

  return {
    response: response as any,
    getHeader(name: string) {
      return headers.get(name.toLowerCase()) ?? null;
    },
    getBodyText() {
      return Buffer.concat(bodyChunks).toString("utf8");
    }
  };
}

function createReadStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    }
  });
}

describe("artifact controller", () => {
  it("streams artifact bytes from storage to response", async () => {
    const storedArtifact: StoredSkillArtifact = {
      fileName: "security-audit.zip",
      fileSize: 12,
      storageKey: "/group1/M00/00/16/security-audit.zip",
      storageUrl: "http://127.0.0.1:8080/group1/M00/00/16/security-audit.zip"
    };
    const artifactStream: SkillArtifactReadStream = {
      fileName: "security-audit.zip",
      contentType: "application/zip",
      contentLength: 12,
      stream: createReadStream("zip-content")
    };
    const artifactService = {
      getStoredSkillArtifact: vi.fn(async () => storedArtifact),
      openSkillArtifactReadStream: vi.fn(async () => artifactStream)
    } as unknown as ArtifactService;
    const controller = new ArtifactController(artifactService);
    const responseMock = createResponseMock();

    await controller.download("release-skill-security-audit-2.2.0", responseMock.response);

    expect(responseMock.getHeader("content-type")).toBe("application/zip");
    expect(responseMock.getHeader("content-length")).toBe("12");
    expect(responseMock.getHeader("content-disposition")).toContain("security-audit.zip");
    expect(responseMock.getBodyText()).toBe("zip-content");
  });

  it("throws not found when artifact metadata does not exist", async () => {
    const artifactService = {
      getStoredSkillArtifact: vi.fn(async () => null),
      openSkillArtifactReadStream: vi.fn(async () => {
        throw new Error("not used");
      })
    } as unknown as ArtifactService;
    const controller = new ArtifactController(artifactService);
    const responseMock = createResponseMock();

    await expect(controller.download("missing-release", responseMock.response)).rejects.toBeInstanceOf(NotFoundException);
  });
});

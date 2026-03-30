import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchCloudHubDetail,
  fetchCloudHubDownloadToken,
  fetchCloudHubItems,
  fetchCloudHubManifest,
} from "@/services/cloud-hub-client";

describe("cloud hub client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the runtime proxy endpoints instead of talking to cloud hub directly", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    await fetchCloudHubItems("http://127.0.0.1:43110", "skill");

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:43110/api/cloud-hub/items?type=skill");
  });

  it("uses runtime proxy paths for detail, manifest, and download token requests", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "item-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ kind: "skill" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ downloadUrl: "https://example.com/file.zip", expiresIn: 300 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await fetchCloudHubDetail("http://127.0.0.1:43110", "item-1");
    await fetchCloudHubManifest("http://127.0.0.1:43110", "release-1");
    await fetchCloudHubDownloadToken("http://127.0.0.1:43110", "release-1");

    expect(fetchSpy).toHaveBeenNthCalledWith(1, "http://127.0.0.1:43110/api/cloud-hub/items/item-1");
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "http://127.0.0.1:43110/api/cloud-hub/releases/release-1/manifest");
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:43110/api/cloud-hub/releases/release-1/download-token",
    );
  });
});

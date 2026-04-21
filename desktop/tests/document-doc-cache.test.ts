import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createDocCache,
  DEFAULT_CACHE_MAX_BYTES,
  sha256OfBuffer,
  type DocCacheMeta,
} from "../src/main/services/document/doc-cache";

// 最小 IR literal，仅用于测试 builder/缓存路径，不依赖真实 DocumentIR 实现。
const makeFakeIr = (sha: string) => ({
  source: { path: "fake.docx", format: "docx" as const, bytes: 10, sha256: sha },
  meta: {},
  outline: [],
  body: [],
  media: [],
});

describe("doc-cache module", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "myclaw-doccache-"));
  });

  afterEach(() => {
    if (root && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes DEFAULT_CACHE_MAX_BYTES = 500MB", () => {
    expect(DEFAULT_CACHE_MAX_BYTES).toBe(500 * 1024 * 1024);
  });

  it("sha256OfBuffer returns stable hex sha256", () => {
    const hex = sha256OfBuffer(Buffer.from("hello"));
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(hex).toBe(sha256OfBuffer(Buffer.from("hello")));
    expect(hex).not.toBe(sha256OfBuffer(Buffer.from("world")));
  });

  it("getOrBuild on cold cache invokes builder once and persists ir.json + meta.json", async () => {
    const cache = createDocCache({ rootDir: root });
    const sha = "a".repeat(64);
    const builder = vi.fn(async () => makeFakeIr(sha));

    const ir = await cache.getOrBuild(sha, builder);

    expect(builder).toHaveBeenCalledTimes(1);
    expect(ir).toMatchObject({ source: { sha256: sha } });

    const entryDir = cache.entryDir(sha);
    expect(existsSync(join(entryDir, "ir.json"))).toBe(true);
    expect(existsSync(join(entryDir, "meta.json"))).toBe(true);
    expect(existsSync(cache.mediaDir(sha))).toBe(true);

    const meta = JSON.parse(readFileSync(join(entryDir, "meta.json"), "utf-8")) as DocCacheMeta;
    expect(meta.sha256).toBe(sha);
    expect(meta.hits).toBe(0);
    expect(meta.bytes).toBeGreaterThan(0);
    expect(typeof meta.cachedAt).toBe("string");
    expect(typeof meta.lastAccess).toBe("string");
  });

  it("getOrBuild on warm cache does NOT invoke builder and returns deep-equal IR", async () => {
    const cache = createDocCache({ rootDir: root });
    const sha = "b".repeat(64);
    const builder = vi.fn(async () => makeFakeIr(sha));

    const first = await cache.getOrBuild(sha, builder);
    const second = await cache.getOrBuild(sha, builder);

    expect(builder).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("second warm read increments meta.hits and updates meta.lastAccess", async () => {
    const cache = createDocCache({ rootDir: root });
    const sha = "c".repeat(64);
    const builder = vi.fn(async () => makeFakeIr(sha));

    await cache.getOrBuild(sha, builder);

    const metaPath = join(cache.entryDir(sha), "meta.json");
    const firstMeta = JSON.parse(readFileSync(metaPath, "utf-8")) as DocCacheMeta;

    // Wait long enough so ISO timestamps differ (monotonic clock at ms granularity).
    await new Promise((resolve) => setTimeout(resolve, 10));

    await cache.getOrBuild(sha, builder);
    const secondMeta = JSON.parse(readFileSync(metaPath, "utf-8")) as DocCacheMeta;

    expect(secondMeta.hits).toBe(firstMeta.hits + 1);
    expect(new Date(secondMeta.lastAccess).getTime()).toBeGreaterThan(
      new Date(firstMeta.lastAccess).getTime(),
    );

    // Third read bumps hits again.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await cache.getOrBuild(sha, builder);
    const thirdMeta = JSON.parse(readFileSync(metaPath, "utf-8")) as DocCacheMeta;
    expect(thirdMeta.hits).toBe(secondMeta.hits + 1);
  });

  it("enforceLru evicts least-recently-accessed entries when total exceeds maxBytes", async () => {
    const cache = createDocCache({ rootDir: root, maxBytes: 2048 });

    // Build 4 large entries; builder writes a bulky payload so each exceeds a large fraction of cap.
    const shas = ["1".repeat(64), "2".repeat(64), "3".repeat(64), "4".repeat(64)];
    const bigPayload = "x".repeat(800);
    const builder = (sha: string) => async (mediaDir: string) => {
      // Also drop a media file so bytes reflects recursive size.
      await mkdir(mediaDir, { recursive: true });
      await writeFile(join(mediaDir, "img.bin"), bigPayload, "utf-8");
      return { ...makeFakeIr(sha), padding: bigPayload };
    };

    for (const sha of shas) {
      await cache.getOrBuild(sha, builder(sha));
      // Ensure distinct lastAccess timestamps.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    // First entries should have been evicted; at minimum, the oldest entry should be gone.
    const firstEntry = cache.entryDir(shas[0]);
    expect(existsSync(firstEntry)).toBe(false);

    // Most recent entry must still be present.
    const lastEntry = cache.entryDir(shas[shas.length - 1]);
    expect(existsSync(lastEntry)).toBe(true);
  });

  it("treats corrupted ir.json as cache miss and rebuilds", async () => {
    const cache = createDocCache({ rootDir: root });
    const sha = "d".repeat(64);
    const builder = vi.fn(async () => makeFakeIr(sha));

    // Pre-seed a corrupted entry directory.
    const entryDir = cache.entryDir(sha);
    await mkdir(entryDir, { recursive: true });
    writeFileSync(join(entryDir, "ir.json"), "{not valid json", "utf-8");
    writeFileSync(
      join(entryDir, "meta.json"),
      JSON.stringify({
        sha256: sha,
        cachedAt: new Date().toISOString(),
        lastAccess: new Date().toISOString(),
        hits: 5,
        bytes: 16,
      }),
      "utf-8",
    );

    const ir = await cache.getOrBuild(sha, builder);

    expect(builder).toHaveBeenCalledTimes(1);
    expect(ir).toMatchObject({ source: { sha256: sha } });

    // Rebuilt ir.json is now parseable.
    const parsed = JSON.parse(readFileSync(join(entryDir, "ir.json"), "utf-8")) as {
      source: { sha256: string };
    };
    expect(parsed.source.sha256).toBe(sha);

    // Meta reset (hits = 0 after rebuild, per spec).
    const meta = JSON.parse(readFileSync(join(entryDir, "meta.json"), "utf-8")) as DocCacheMeta;
    expect(meta.hits).toBe(0);
  });

  it("clear() removes the entire docCache root", async () => {
    const cache = createDocCache({ rootDir: root });
    const sha = "e".repeat(64);
    await cache.getOrBuild(sha, async () => makeFakeIr(sha));
    expect(existsSync(cache.entryDir(sha))).toBe(true);

    await cache.clear();
    expect(existsSync(cache.getRoot())).toBe(false);
  });

  it("getRoot returns <rootDir>/docCache", () => {
    const cache = createDocCache({ rootDir: root });
    expect(cache.getRoot()).toBe(join(root, "docCache"));
  });

  it("handles missing entry (ENOENT) as cache miss without throwing", async () => {
    const cache = createDocCache({ rootDir: root });
    const sha = "f".repeat(64);
    const builder = vi.fn(async () => makeFakeIr(sha));

    const ir = await cache.getOrBuild(sha, builder);

    expect(builder).toHaveBeenCalledTimes(1);
    expect(ir).toMatchObject({ source: { sha256: sha } });
  });
});
